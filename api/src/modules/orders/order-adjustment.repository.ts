import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { hasPermission } from '../../auth/auth.service.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import type {
  CancellationPolicy,
  CancellationStatus,
  PreparationStation,
  PreparationStatus,
  WaiterOrderDetail,
} from './order.model.js'
import { MAX_LINE_QUANTITY, getWaiterOrder } from './order.repository.js'
import { createCancellationNotification } from './staff-notification.repository.js'

/**
 * Module Phục vụ 5 — sửa số lượng và hủy món trên một đơn ĐÃ GỬI.
 *
 * Ba luật của module này, và lý do từng luật:
 *
 * 1. **Sửa số lượng chỉ khi quầy chưa nhận phiếu.** Module 4 nhận việc theo
 *    PHIẾU (một phiếu cho mỗi quầy của một đơn), không theo từng dòng, nên mức
 *    chi tiết thật sự có là "phiếu của quầy mang dòng này còn SUBMITTED hay
 *    không". Sau khi phiếu được ACCEPTED, người ở Bar đã bắt đầu làm theo con
 *    số in trên phiếu; sửa con số đó ở database không đổi được việc đã làm.
 * 2. **Phục vụ không tự hủy món.** Họ tạo một yêu cầu có lý do và tên mình;
 *    người có `order.cancel.approve` quyết định. Luật này nằm ở permission, và
 *    route KHÔNG nhắc tên vai trò nào — thêm một vai trò mới sau này là việc
 *    cấp permission, không phải việc sửa code.
 * 3. **Không bao giờ DELETE một dòng đơn.** Hủy cộng vào `cancelled_quantity`
 *    và để lại một dòng lịch sử. Một hoá đơn mà dòng món biến mất là một hoá
 *    đơn không đối chiếu được với phiếu đã in ở quầy.
 *
 * Món đã READY có đường riêng: mặc định từ chối, và chỉ đi được khi người yêu
 * cầu có `order.cancel.ready` VÀ nói rõ rằng đây là một lần ghi hao.
 */

export interface AdjustLineInput {
  orderId: number
  lineNo: number
  expectedLineVersion: number
  quantity: number
  reason?: string
  idempotencyKey: string
}

export interface RequestCancellationInput {
  orderId: number
  lineNo: number
  expectedLineVersion: number
  quantity: number
  reason: string
  /** Bắt buộc `true` khi món đã READY/COLLECTED: xác nhận rằng đây là ghi hao. */
  acknowledgeWaste?: boolean
  idempotencyKey: string
}

export interface DecideCancellationInput {
  cancellationId: number
  decision: 'APPROVED' | 'REJECTED'
  expectedVersion: number
  note?: string
  idempotencyKey: string
  /**
   * `true` khi lời gọi đến từ một quyết định CẢ NHÓM. Nhóm tự gửi MỘT thông
   * báo cho cả đơn; không tắt ở đây thì một lần duyệt bốn dòng sẽ đổ bốn tin
   * giống nhau vào chuông của Phục vụ.
   */
  suppressNotification?: boolean
}

export interface CancellationQueueEntry {
  cancellationId: number
  /**
   * Mã nhóm của một lần "Hủy đơn?"; `null` khi đây là yêu cầu lẻ của một món.
   * Màn duyệt gom các dòng cùng `groupId` vào MỘT thẻ.
   */
  groupId: number | null
  status: CancellationStatus
  policy: CancellationPolicy
  version: number
  visitId: number
  tableCodes: string[]
  orderId: number
  visitSequence: number
  lineNo: number
  itemName: string
  variantDisplayName: string
  station: PreparationStation
  ticketStatusAtRequest: PreparationStatus
  quantity: number
  unitPriceVnd: number
  amountVnd: number
  reason: string
  requestedByUserId: number
  requestedByDisplayName: string
  requestedAt: string
  decidedByUserId: number | null
  decidedByDisplayName: string | null
  decidedAt: string | null
  decisionNote: string | null
}

export interface CancellationQueueView {
  status: CancellationStatus
  pendingCount: number
  entries: CancellationQueueEntry[]
}

export interface CancellationDecisionResult {
  cancellationId: number
  status: CancellationStatus
  version: number
  order: WaiterOrderDetail
}

interface VisitRow extends RowDataPacket {
  id: number
  ended_at: Date | string | null
  paid_marked_at: Date | string | null
}

interface LockedLineRow extends RowDataPacket {
  line_id: number
  order_id: number
  visit_id: number
  line_no: number
  item_name: string
  item_code: string
  variant_display_name: string
  preparation_station: PreparationStation
  unit_price_vnd: string | number
  quantity: number
  cancelled_quantity: number
  version: number
  ticket_id: number | null
  ticket_status: PreparationStatus | null
  ticket_item_count: number | null
  pending_cancellation_id: number | null
}

interface CancellationRow extends RowDataPacket {
  id: number
  visit_id: number
  order_id: number
  group_id: number | null
  line_id: number
  line_no: number
  quantity: number
  reason: string
  policy: CancellationPolicy
  status: CancellationStatus
  station: PreparationStation
  ticket_status_at_request: PreparationStatus
  requested_by_user_id: number
  requested_by_display_name: string
  requested_at: Date | string
  decided_by_user_id: number | null
  decided_by_display_name: string | null
  decided_at: Date | string | null
  decision_note: string | null
  version: number
  unit_price_vnd: string | number
  item_name: string
  variant_display_name: string
  visit_sequence: number
  table_codes: string | null
}

export const MAX_CANCELLATION_REASON_LENGTH = 200
export const MAX_DECISION_NOTE_LENGTH = 200

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

function money(value: string | number, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(500, 'ORDER_AMOUNT_UNREADABLE', 'Không đọc được số tiền của đơn.', { field })
  }
  return parsed
}

/**
 * Khóa theo đúng một thứ tự: visits → sales_orders → sales_order_lines →
 * preparation_tickets.
 *
 * Cùng thứ tự mà `createWaiterOrder` dùng. Hai đường ghi khóa ngược thứ tự nhau
 * là cách sinh deadlock giữa một lần gửi đơn và một lần sửa số lượng của cùng
 * một bàn.
 */
async function lockVisitForOrder(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<VisitRow> {
  const [rows] = await connection.execute<VisitRow[]>(
    `SELECT id, ended_at, paid_marked_at FROM visits
     WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, visitId],
  )
  const visit = rows[0]
  if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy Phiên bàn trong địa điểm này.')
  if (visit.ended_at !== null) throw new AppError(409, 'VISIT_CLOSED', 'Phiên bàn đã kết thúc.')
  if (visit.paid_marked_at !== null) {
    throw new AppError(
      409,
      'VISIT_NOT_ORDERABLE',
      'Phiên bàn đang chờ hoàn tất thanh toán. Liên hệ Thu ngân để điều chỉnh.',
    )
  }
  return visit
}

async function lockOrderLine(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  orderId: number,
  lineNo: number,
): Promise<LockedLineRow> {
  const [orders] = await connection.execute<RowDataPacket[]>(
    `SELECT visit_id FROM sales_orders WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, orderId],
  )
  const orderRow = orders[0]
  if (!orderRow) throw new AppError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn trong địa điểm này.')
  await lockVisitForOrder(connection, actor, Number(orderRow.visit_id))

  const [rows] = await connection.execute<LockedLineRow[]>(
    `SELECT l.id AS line_id, l.order_id, o.visit_id, l.line_no, l.item_name, l.item_code, l.variant_display_name,
       l.preparation_station, l.unit_price_vnd, l.quantity, l.cancelled_quantity, l.version,
       t.id AS ticket_id, t.status AS ticket_status, t.item_count AS ticket_item_count,
       (SELECT c.id FROM sales_order_cancellations c WHERE c.line_id = l.id AND c.status = 'PENDING')
         AS pending_cancellation_id
     FROM sales_order_lines l
     JOIN sales_orders o ON o.venue_id = l.venue_id AND o.id = l.order_id
     LEFT JOIN preparation_tickets t
       ON t.venue_id = l.venue_id AND t.order_id = l.order_id AND t.station = l.preparation_station
     WHERE l.venue_id = ? AND l.order_id = ? AND l.line_no = ?
     FOR UPDATE`,
    [actor.venueId, orderId, lineNo],
  )
  const line = rows[0]
  if (!line) throw new AppError(404, 'ORDER_LINE_NOT_FOUND', 'Không tìm thấy dòng món trong đơn này.')
  return line
}

function assertLineVersion(line: LockedLineRow, expected: number): void {
  if (Number(line.version) !== expected) {
    throw new AppError(
      409,
      'ORDER_LINE_VERSION_CONFLICT',
      'Dòng món vừa thay đổi trên máy khác. Tải lại đơn rồi thử lại.',
      { lineNo: Number(line.line_no), currentVersion: Number(line.version) },
    )
  }
}

async function writeOperationLog(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  input: {
    action: string
    entityType: string
    entityId: number
    versionBefore: number | null
    versionAfter: number | null
    changes: unknown
    idempotencyKey: string
  },
): Promise<void> {
  await connection.execute(
    `INSERT INTO operation_log
       (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id, idempotency_key,
        action, entity_type, entity_id, entity_version_before, entity_version_after, changes, reason_code, is_undoable)
     VALUES (?, ?, 'USER', ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 'MANUAL', 0)`,
    [actor.organizationId, actor.venueId, actor.userId, actor.membershipId, actor.authSessionId ?? null,
      input.idempotencyKey, input.action, input.entityType, input.entityId,
      input.versionBefore, input.versionAfter, JSON.stringify([input.changes])],
  )
}

async function bumpVenueCursor(connection: PoolConnection, actor: AuthenticatedActor): Promise<void> {
  await connection.execute(
    `UPDATE venues SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
     WHERE organization_id = ? AND id = ?`,
    [actor.organizationId, actor.venueId],
  )
}

async function inTransaction<T>(
  transaction: PoolConnection | undefined,
  run: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = transaction ?? await databasePool.getConnection()
  const owns = transaction === undefined
  try {
    if (owns) await connection.beginTransaction()
    const result = await run(connection)
    if (owns) await connection.commit()
    return result
  } catch (error) {
    // Với transaction của middleware chống trùng, chính middleware rollback khi
    // response mang status lỗi — và nó rollback cả dòng `idempotency_keys`, nên
    // lần bấm lại sau khi sửa được xử lý như một yêu cầu mới.
    if (owns) await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    if (owns) connection.release()
  }
}

/**
 * Sửa số lượng một dòng món.
 *
 * Mở cửa sổ hẹp một cách có chủ ý: phiếu của quầy còn SUBMITTED, dòng chưa có
 * phần nào bị hủy, và không có yêu cầu hủy đang chờ. Ngoài cửa sổ đó, con đường
 * duy nhất là một yêu cầu hủy có người phê duyệt.
 */
export async function adjustOrderLineQuantity(
  actor: AuthenticatedActor,
  input: AdjustLineInput,
  transaction?: PoolConnection,
): Promise<WaiterOrderDetail> {
  return inTransaction(transaction, async (connection) => {
    const line = await lockOrderLine(connection, actor, input.orderId, input.lineNo)
    assertLineVersion(line, input.expectedLineVersion)

    if (line.pending_cancellation_id !== null) {
      throw new AppError(
        409,
        'ORDER_LINE_CANCELLATION_PENDING',
        'Dòng món đang chờ phê duyệt hủy. Chờ quyết định trước khi sửa số lượng.',
        { cancellationId: Number(line.pending_cancellation_id) },
      )
    }
    if (Number(line.cancelled_quantity) > 0) {
      throw new AppError(
        409,
        'ORDER_LINE_PARTIALLY_CANCELLED',
        'Dòng món đã có phần bị hủy. Gọi thêm bằng một đơn mới thay vì sửa dòng này.',
      )
    }
    if (line.ticket_status !== 'SUBMITTED') {
      // Đây là chốt của yêu cầu "chỉ sửa khi ticket line chưa ACCEPTED". Module 4
      // nhận việc theo phiếu, nên mức chi tiết là phiếu của quầy mang dòng này.
      throw new AppError(
        409,
        'ORDER_LINE_ALREADY_ACCEPTED',
        'Quầy đã nhận phiếu cho món này. Gửi yêu cầu hủy để người có quyền phê duyệt.',
        { station: line.preparation_station, ticketStatus: line.ticket_status },
      )
    }

    const previousQuantity = Number(line.quantity)
    if (previousQuantity === input.quantity) {
      // Không có gì đổi: không tăng version, không ghi lịch sử, không đẩy con
      // trỏ realtime. Một dòng lịch sử "3 → 3" chỉ làm loãng nhật ký.
      return getWaiterOrder(actor, input.orderId)
    }
    const unitPriceVnd = money(line.unit_price_vnd, 'unit_price_vnd')
    const deltaItems = input.quantity - previousQuantity
    const deltaAmount = deltaItems * unitPriceVnd

    await connection.execute(
      `UPDATE sales_order_lines SET quantity = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND version = ?`,
      [input.quantity, Number(line.line_id), Number(line.version)],
    )
    await connection.execute(
      `UPDATE sales_orders
       SET item_count = item_count + ?, total_amount_vnd = total_amount_vnd + ?,
           version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE venue_id = ? AND id = ?`,
      [deltaItems, deltaAmount, actor.venueId, input.orderId],
    )
    if (line.ticket_id !== null) {
      await connection.execute(
        `UPDATE preparation_tickets
         SET item_count = item_count + ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE venue_id = ? AND id = ? AND status = 'SUBMITTED'`,
        [deltaItems, actor.venueId, Number(line.ticket_id)],
      )
    }
    await connection.execute(
      `INSERT INTO sales_order_line_changes
         (organization_id, venue_id, order_id, line_id, line_no, change_kind, quantity_before, quantity_after,
          cancelled_before, cancelled_after, amount_delta_vnd, reason, actor_user_id, actor_membership_id)
       VALUES (?, ?, ?, ?, ?, 'QUANTITY_ADJUSTED', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, input.orderId, Number(line.line_id), input.lineNo,
        previousQuantity, input.quantity, Number(line.cancelled_quantity), Number(line.cancelled_quantity),
        deltaAmount, input.reason ?? null, actor.userId, actor.membershipId],
    )
    await writeOperationLog(connection, actor, {
      action: 'SALES_ORDER_LINE_ADJUSTED',
      entityType: 'sales_order_line',
      entityId: Number(line.line_id),
      versionBefore: Number(line.version),
      versionAfter: Number(line.version) + 1,
      idempotencyKey: input.idempotencyKey,
      changes: {
        type: 'sales_order_line_adjusted',
        orderId: input.orderId,
        lineNo: input.lineNo,
        itemCode: line.item_code,
        station: line.preparation_station,
        quantityBefore: previousQuantity,
        quantityAfter: input.quantity,
        amountDeltaVnd: deltaAmount,
        // Lý do là ô gõ tự do; chỉ ghi nó CÓ hay KHÔNG. Nội dung nằm ở
        // `sales_order_line_changes.reason`, nơi truy được mà không đổ vào cột
        // chi tiết của màn nhật ký.
        hasReason: Boolean(input.reason),
      },
    })
    await bumpVenueCursor(connection, actor)
    return getWaiterOrder(actor, input.orderId, connection)
  })
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
}

/**
 * Tạo yêu cầu hủy món.
 *
 * Hàm này KHÔNG hủy gì cả. Nó ghi lại ai muốn hủy, hủy bao nhiêu, vì sao, và
 * món đang ở trạng thái nào lúc đó — rồi dừng. Việc hủy xảy ra ở
 * `decideOrderLineCancellation`, bởi một người khác, có quyền khác.
 */
export async function requestOrderLineCancellation(
  actor: AuthenticatedActor,
  input: RequestCancellationInput,
  transaction?: PoolConnection,
): Promise<{ cancellationId: number; status: CancellationStatus; policy: CancellationPolicy; version: number }> {
  return inTransaction(transaction, async (connection) => {
    const line = await lockOrderLine(connection, actor, input.orderId, input.lineNo)
    assertLineVersion(line, input.expectedLineVersion)

    const remaining = Number(line.quantity) - Number(line.cancelled_quantity)
    if (input.quantity > remaining) {
      throw new AppError(
        409,
        'ORDER_LINE_QUANTITY_EXCEEDED',
        'Số lượng yêu cầu hủy vượt phần còn lại của dòng món.',
        { lineNo: input.lineNo, remainingQuantity: remaining },
      )
    }
    const ticketStatus: PreparationStatus = line.ticket_status ?? 'SUBMITTED'
    const madeAlready = ticketStatus === 'READY' || ticketStatus === 'COLLECTED'
    const policy: CancellationPolicy = madeAlready ? 'READY_WASTE' : 'STANDARD'
    if (madeAlready) {
      // Policy riêng cho món đã làm xong. Mặc định đường thường KHÔNG hủy được:
      // bỏ một ly đã pha là một lần ghi hao, và nó cần một quyền riêng cộng một
      // lần xác nhận rõ ràng, không phải cùng một cú bấm với "khách đổi ý".
      if (!await hasPermission(actor, 'order.cancel.ready')) {
        throw new AppError(
          403,
          'ORDER_CANCEL_READY_DENIED',
          'Món đã làm xong. Chỉ người có quyền ghi hao mới yêu cầu hủy được.',
          { station: line.preparation_station, ticketStatus },
        )
      }
      if (input.acknowledgeWaste !== true) {
        throw new AppError(
          409,
          'ORDER_LINE_ALREADY_READY',
          'Món đã làm xong. Hủy nghĩa là ghi hao một phần đã pha — cần xác nhận rõ.',
          { station: line.preparation_station, ticketStatus },
        )
      }
    }

    try {
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO sales_order_cancellations
           (organization_id, venue_id, visit_id, order_id, line_id, line_no, quantity, reason, policy, status,
            station, ticket_status_at_request, requested_by_user_id, requested_by_membership_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
        [actor.organizationId, actor.venueId, Number(line.visit_id), input.orderId, Number(line.line_id),
          input.lineNo, input.quantity, input.reason, policy, line.preparation_station, ticketStatus,
          actor.userId, actor.membershipId],
      )
      const cancellationId = Number(result.insertId)
      await writeOperationLog(connection, actor, {
        action: 'SALES_ORDER_CANCELLATION_REQUESTED',
        entityType: 'sales_order_cancellation',
        entityId: cancellationId,
        versionBefore: null,
        versionAfter: 1,
        idempotencyKey: input.idempotencyKey,
        changes: {
          type: 'sales_order_cancellation_requested',
          orderId: input.orderId,
          lineNo: input.lineNo,
          itemCode: line.item_code,
          station: line.preparation_station,
          quantity: input.quantity,
          policy,
          ticketStatus,
          // Lý do hủy nằm ở `sales_order_cancellations.reason` (người duyệt đọc
          // nguyên văn ở hàng chờ). Không chép vào nhật ký: đó là ô gõ tự do.
          hasReason: true,
        },
      })
      await bumpVenueCursor(connection, actor)
      return { cancellationId, status: 'PENDING' as const, policy, version: 1 }
    } catch (error) {
      if (!isDuplicateKey(error)) throw error
      // `uq_sales_order_cancellations_open` chặn yêu cầu thứ hai trên cùng dòng.
      // Không chặn thì hai yêu cầu được duyệt hai lần và hủy gấp đôi số món.
      throw new AppError(
        409,
        'ORDER_CANCELLATION_PENDING',
        'Dòng món này đã có một yêu cầu hủy đang chờ phê duyệt.',
      )
    }
  })
}

async function lockCancellation(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  cancellationId: number,
): Promise<CancellationRow> {
  const [rows] = await connection.execute<CancellationRow[]>(
    `SELECT c.*, l.unit_price_vnd, l.item_name, l.variant_display_name, l.quantity AS line_quantity,
       l.cancelled_quantity AS line_cancelled_quantity, l.version AS line_version, o.visit_sequence
     FROM sales_order_cancellations c
     JOIN sales_order_lines l ON l.id = c.line_id
     JOIN sales_orders o ON o.venue_id = c.venue_id AND o.id = c.order_id
     WHERE c.organization_id = ? AND c.venue_id = ? AND c.id = ?
     FOR UPDATE`,
    [actor.organizationId, actor.venueId, cancellationId],
  )
  const row = rows[0]
  if (!row) {
    throw new AppError(404, 'ORDER_CANCELLATION_NOT_FOUND', 'Không tìm thấy yêu cầu hủy món trong địa điểm này.')
  }
  return row
}

/**
 * Phê duyệt hoặc từ chối một yêu cầu hủy.
 *
 * Khi duyệt, dòng món, đơn và phiếu được cập nhật TRONG CÙNG transaction với
 * quyết định. Tách ra thì sẽ có một quyết định "đã duyệt" mà số món chưa đổi,
 * hoặc một đơn đã bớt tiền mà không có quyết định nào đứng sau.
 */
export async function decideOrderLineCancellation(
  actor: AuthenticatedActor,
  input: DecideCancellationInput,
  transaction?: PoolConnection,
): Promise<CancellationDecisionResult> {
  return inTransaction(transaction, async (connection) => {
    const cancellation = await lockCancellation(connection, actor, input.cancellationId)
    if (cancellation.status !== 'PENDING') {
      throw new AppError(
        409,
        'ORDER_CANCELLATION_ALREADY_DECIDED',
        'Yêu cầu hủy đã được quyết định trước đó.',
        { status: cancellation.status },
      )
    }
    if (Number(cancellation.version) !== input.expectedVersion) {
      throw new AppError(
        409,
        'ORDER_CANCELLATION_VERSION_CONFLICT',
        'Yêu cầu hủy vừa thay đổi. Tải lại hàng chờ rồi thử lại.',
        { currentVersion: Number(cancellation.version) },
      )
    }
    // Khóa lại dòng món và Phiên theo đúng thứ tự khóa của module.
    const line = await lockOrderLine(connection, actor, Number(cancellation.order_id), Number(cancellation.line_no))

    const decision = input.decision
    if (decision === 'REJECTED') {
      await connection.execute(
        `UPDATE sales_order_cancellations
         SET status = 'REJECTED', decided_by_user_id = ?, decided_at = UTC_TIMESTAMP(3), decision_note = ?,
             version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND version = ?`,
        [actor.userId, input.note ?? null, input.cancellationId, input.expectedVersion],
      )
      await writeOperationLog(connection, actor, {
        action: 'SALES_ORDER_CANCELLATION_REJECTED',
        entityType: 'sales_order_cancellation',
        entityId: input.cancellationId,
        versionBefore: input.expectedVersion,
        versionAfter: input.expectedVersion + 1,
        idempotencyKey: input.idempotencyKey,
        changes: {
          type: 'sales_order_cancellation_rejected',
          orderId: Number(cancellation.order_id),
          lineNo: Number(cancellation.line_no),
          quantity: Number(cancellation.quantity),
          policy: cancellation.policy,
          requestedByUserId: Number(cancellation.requested_by_user_id),
          hasNote: Boolean(input.note),
        },
      })
      if (input.suppressNotification !== true) {
        await createCancellationNotification(connection, actor, {
          targetUserId: Number(cancellation.requested_by_user_id),
          visitId: Number(cancellation.visit_id),
          orderId: Number(cancellation.order_id),
          cancellationGroupId: null,
          cancellationId: input.cancellationId,
          decision: 'REJECTED',
          lineCount: 1,
          quantity: Number(cancellation.quantity),
          wasteQuantity: cancellation.policy === 'READY_WASTE' ? Number(cancellation.quantity) : 0,
          amountVnd: money(line.unit_price_vnd, 'unit_price_vnd') * Number(cancellation.quantity),
          reason: cancellation.reason,
          decisionNote: input.note ?? null,
          decidedByUserId: actor.userId,
        })
      }
      await bumpVenueCursor(connection, actor)
      return {
        cancellationId: input.cancellationId,
        status: 'REJECTED' as const,
        version: input.expectedVersion + 1,
        order: await getWaiterOrder(actor, Number(cancellation.order_id), connection),
      }
    }

    const quantity = Number(cancellation.quantity)
    const remaining = Number(line.quantity) - Number(line.cancelled_quantity)
    if (quantity > remaining) {
      // Số lượng dòng có thể đã bị giảm sau khi yêu cầu được gửi. Duyệt mù sẽ
      // hủy nhiều hơn số món đang có trên đơn.
      throw new AppError(
        409,
        'ORDER_LINE_QUANTITY_EXCEEDED',
        'Phần còn lại của dòng món nhỏ hơn số lượng xin hủy. Yêu cầu cần được gửi lại.',
        { remainingQuantity: remaining, requestedQuantity: quantity },
      )
    }
    const unitPriceVnd = money(line.unit_price_vnd, 'unit_price_vnd')
    const amountVnd = unitPriceVnd * quantity

    await connection.execute(
      `UPDATE sales_order_cancellations
       SET status = 'APPROVED', decided_by_user_id = ?, decided_at = UTC_TIMESTAMP(3), decision_note = ?,
           version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND version = ?`,
      [actor.userId, input.note ?? null, input.cancellationId, input.expectedVersion],
    )
    await connection.execute(
      `UPDATE sales_order_lines
       SET cancelled_quantity = cancelled_quantity + ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [quantity, Number(line.line_id)],
    )
    await connection.execute(
      `UPDATE sales_orders
       SET cancelled_item_count = cancelled_item_count + ?, cancelled_amount_vnd = cancelled_amount_vnd + ?,
           version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE venue_id = ? AND id = ?`,
      [quantity, amountVnd, actor.venueId, Number(cancellation.order_id)],
    )
    if (line.ticket_id !== null) {
      await connection.execute(
        `UPDATE preparation_tickets
         SET cancelled_item_count = cancelled_item_count + ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE venue_id = ? AND id = ?`,
        [quantity, actor.venueId, Number(line.ticket_id)],
      )
    }
    await connection.execute(
      `INSERT INTO sales_order_line_changes
         (organization_id, venue_id, order_id, line_id, line_no, change_kind, quantity_before, quantity_after,
          cancelled_before, cancelled_after, amount_delta_vnd, reason, cancellation_id,
          actor_user_id, actor_membership_id)
       VALUES (?, ?, ?, ?, ?, 'CANCELLATION_APPROVED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, Number(cancellation.order_id), Number(line.line_id),
        Number(cancellation.line_no), Number(line.quantity), Number(line.quantity),
        Number(line.cancelled_quantity), Number(line.cancelled_quantity) + quantity,
        -amountVnd, input.note ?? null, input.cancellationId, actor.userId, actor.membershipId],
    )
    await writeOperationLog(connection, actor, {
      action: 'SALES_ORDER_CANCELLATION_APPROVED',
      entityType: 'sales_order_cancellation',
      entityId: input.cancellationId,
      versionBefore: input.expectedVersion,
      versionAfter: input.expectedVersion + 1,
      idempotencyKey: input.idempotencyKey,
      changes: {
        type: 'sales_order_cancellation_approved',
        orderId: Number(cancellation.order_id),
        lineNo: Number(cancellation.line_no),
        itemCode: line.item_code,
        station: line.preparation_station,
        quantity,
        policy: cancellation.policy,
        ticketStatus: line.ticket_status,
        amountDeltaVnd: -amountVnd,
        // Người yêu cầu và người duyệt là hai người khác nhau trên cùng một
        // dòng nhật ký: đó là cả điểm của việc phê duyệt.
        requestedByUserId: Number(cancellation.requested_by_user_id),
        hasNote: Boolean(input.note),
      },
    })
    if (input.suppressNotification !== true) {
      await createCancellationNotification(connection, actor, {
        targetUserId: Number(cancellation.requested_by_user_id),
        visitId: Number(cancellation.visit_id),
        orderId: Number(cancellation.order_id),
        cancellationGroupId: null,
        cancellationId: input.cancellationId,
        decision: 'APPROVED',
        lineCount: 1,
        quantity,
        wasteQuantity: cancellation.policy === 'READY_WASTE' ? quantity : 0,
        amountVnd,
        reason: cancellation.reason,
        decisionNote: input.note ?? null,
        decidedByUserId: actor.userId,
      })
    }
    await bumpVenueCursor(connection, actor)
    return {
      cancellationId: input.cancellationId,
      status: 'APPROVED' as const,
      version: input.expectedVersion + 1,
      order: await getWaiterOrder(actor, Number(cancellation.order_id), connection),
    }
  })
}

/** Hàng chờ phê duyệt. Chỉ người có `order.cancel.approve` đọc được (route canh). */
export async function listCancellations(
  actor: AuthenticatedActor,
  query: { status: CancellationStatus; limit: number },
): Promise<CancellationQueueView> {
  const [rows] = await databasePool.execute<CancellationRow[]>(
    `SELECT c.id, c.visit_id, c.order_id, c.group_id, c.line_id, c.line_no, c.quantity, c.reason, c.policy, c.status,
       c.station, c.ticket_status_at_request, c.requested_by_user_id, c.requested_at,
       c.decided_by_user_id, c.decided_at, c.decision_note, c.version,
       ru.display_name AS requested_by_display_name, du.display_name AS decided_by_display_name,
       l.unit_price_vnd, l.item_name, l.variant_display_name, o.visit_sequence,
       (SELECT GROUP_CONCAT(DISTINCT dt.code ORDER BY dt.code SEPARATOR ',')
          FROM table_allocations ta
          JOIN dining_tables dt ON dt.organization_id = ta.organization_id AND dt.venue_id = ta.venue_id
           AND dt.id = ta.table_id
          WHERE ta.organization_id = c.organization_id AND ta.venue_id = c.venue_id
            AND ta.visit_id = c.visit_id AND ta.kind = 'USAGE' AND ta.released_at IS NULL) AS table_codes
     FROM sales_order_cancellations c
     JOIN sales_order_lines l ON l.id = c.line_id
     JOIN sales_orders o ON o.venue_id = c.venue_id AND o.id = c.order_id
     JOIN users ru ON ru.id = c.requested_by_user_id
     LEFT JOIN users du ON du.id = c.decided_by_user_id
     WHERE c.organization_id = ? AND c.venue_id = ? AND c.status = ?
     ORDER BY c.requested_at DESC, c.id DESC
     LIMIT ?`,
    [actor.organizationId, actor.venueId, query.status, query.limit],
  )
  const [pending] = await databasePool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM sales_order_cancellations
     WHERE organization_id = ? AND venue_id = ? AND status = 'PENDING'`,
    [actor.organizationId, actor.venueId],
  )
  return {
    status: query.status,
    pendingCount: Number(pending[0]?.total ?? 0),
    entries: rows.map((row): CancellationQueueEntry => {
      const unitPriceVnd = money(row.unit_price_vnd, 'unit_price_vnd')
      return {
        cancellationId: Number(row.id),
        /**
         * Mã nhóm khi yêu cầu này thuộc một lần "Hủy đơn?"; `null` khi nó là
         * yêu cầu lẻ của một món. Màn duyệt gom các dòng cùng nhóm vào MỘT
         * thẻ và quyết định một lần.
         */
        groupId: row.group_id === null ? null : Number(row.group_id),
        status: row.status,
        policy: row.policy,
        version: Number(row.version),
        visitId: Number(row.visit_id),
        tableCodes: row.table_codes ? row.table_codes.split(',') : [],
        orderId: Number(row.order_id),
        visitSequence: Number(row.visit_sequence),
        lineNo: Number(row.line_no),
        itemName: row.item_name,
        variantDisplayName: row.variant_display_name,
        station: row.station,
        ticketStatusAtRequest: row.ticket_status_at_request,
        quantity: Number(row.quantity),
        unitPriceVnd,
        amountVnd: unitPriceVnd * Number(row.quantity),
        reason: row.reason,
        requestedByUserId: Number(row.requested_by_user_id),
        requestedByDisplayName: row.requested_by_display_name,
        requestedAt: isoDateTime(row.requested_at),
        decidedByUserId: row.decided_by_user_id === null ? null : Number(row.decided_by_user_id),
        decidedByDisplayName: row.decided_by_display_name,
        decidedAt: row.decided_at === null ? null : isoDateTime(row.decided_at),
        decisionNote: row.decision_note,
      }
    }),
  }
}

export { MAX_LINE_QUANTITY }

/* ---------------------- Module Phục vụ (v1.1) — hủy cả đơn ---------------- */

export interface RequestOrderCancellationInput {
  orderId: number
  reason: string
  /**
   * Bắt buộc `true` khi đơn còn món đã READY/COLLECTED. Không có nó thì yêu
   * cầu bị từ chối kèm danh sách món sẽ phải ghi hao, để Phục vụ nhìn thấy
   * TRƯỚC khi gửi chứ không phải sau khi đã nói với khách là xong.
   */
  acknowledgeWaste?: boolean
  idempotencyKey: string
}

export interface OrderCancellationRequestResult {
  groupId: number
  orderId: number
  /** Số dòng món đã gửi yêu cầu. */
  lineCount: number
  /** Số phần phải ghi hao nếu được duyệt; 0 nghĩa là không món nào đã làm xong. */
  wasteQuantity: number
  totalQuantity: number
  amountVnd: number
}

interface OrderLineForCancellationRow extends RowDataPacket {
  line_id: number
  line_no: number
  item_name: string
  item_code: string
  variant_display_name: string
  preparation_station: PreparationStation
  unit_price_vnd: string | number
  quantity: number
  cancelled_quantity: number
  ticket_status: PreparationStatus | null
  pending_cancellation_id: number | null
}

/**
 * "Hủy đơn?" — xin hủy MỌI phần còn lại của một đơn, bằng một yêu cầu.
 *
 * Nó không phải một lệnh hủy. Nó sinh ra đúng những dòng yêu cầu mà
 * `requestOrderLineCancellation` sinh ra, gắn chung một `group_id`, để người
 * duyệt thấy một thẻ "cả đơn" thay vì bốn thẻ rời và quyết định một lần.
 *
 * Luật giữ nguyên của đường từng dòng, không nới một chỗ nào:
 *
 * - `policy` tính theo TỪNG dòng. Món chưa làm là STANDARD, món đã xong là
 *   READY_WASTE. Đây là câu trả lời cho V7: cho hủy cả đơn kể cả khi một phần
 *   đã làm xong, nhưng phần đã làm đi theo đường ghi hao và hiện rõ là ghi hao.
 * - Có món đã làm xong thì cần `order.cancel.ready` VÀ một lần tick riêng.
 * - Dòng nào đang có yêu cầu chờ duyệt thì BỎ QUA, không ném lỗi: Phục vụ vừa
 *   xin hủy một món rồi khách đổi ý hủy cả bàn là chuyện thường, và bắt họ đi
 *   rút lại yêu cầu cũ trước là bắt họ làm việc của hệ thống.
 */
export async function requestOrderCancellation(
  actor: AuthenticatedActor,
  input: RequestOrderCancellationInput,
  transaction?: PoolConnection,
): Promise<OrderCancellationRequestResult> {
  return inTransaction(transaction, async (connection) => {
    const [orders] = await connection.execute<RowDataPacket[]>(
      'SELECT visit_id FROM sales_orders WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE',
      [actor.organizationId, actor.venueId, input.orderId],
    )
    const orderRow = orders[0]
    if (!orderRow) throw new AppError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn trong địa điểm này.')
    const visitId = Number(orderRow.visit_id)

    const [lines] = await connection.execute<OrderLineForCancellationRow[]>(
      `SELECT l.id AS line_id, l.line_no, l.item_name, l.item_code, l.variant_display_name,
              l.preparation_station, l.unit_price_vnd, l.quantity, l.cancelled_quantity,
              t.status AS ticket_status,
              (SELECT c.id FROM sales_order_cancellations c
                WHERE c.venue_id = l.venue_id AND c.line_id = l.id AND c.status = 'PENDING'
                LIMIT 1) AS pending_cancellation_id
         FROM sales_order_lines l
         LEFT JOIN preparation_tickets t
           ON t.venue_id = l.venue_id AND t.order_id = l.order_id AND t.station = l.preparation_station
        WHERE l.venue_id = ? AND l.order_id = ?
        ORDER BY l.line_no
        FOR UPDATE`,
      [actor.venueId, input.orderId],
    )

    const pending = lines.filter(
      (line) => line.pending_cancellation_id === null && Number(line.quantity) - Number(line.cancelled_quantity) > 0,
    )
    if (pending.length === 0) {
      throw new AppError(
        409,
        'ORDER_NOTHING_TO_CANCEL',
        'Đơn này không còn phần nào để hủy, hoặc mọi dòng đã có yêu cầu đang chờ duyệt.',
      )
    }

    const madeAlready = pending.filter((line) => line.ticket_status === 'READY' || line.ticket_status === 'COLLECTED')
    if (madeAlready.length > 0) {
      if (!(await hasPermission(actor, 'order.cancel.ready'))) {
        throw new AppError(
          403,
          'ORDER_CANCEL_READY_DENIED',
          'Đơn có món đã làm xong. Chỉ người có quyền ghi hao mới xin hủy cả đơn được.',
          {
            wasteLines: madeAlready.map((line) => ({
              lineNo: Number(line.line_no),
              itemName: line.item_name,
              variantDisplayName: line.variant_display_name,
            })),
          },
        )
      }
      if (input.acknowledgeWaste !== true) {
        throw new AppError(
          409,
          'ORDER_CANCEL_NEEDS_WASTE_ACK',
          'Đơn có món đã làm xong. Hủy nghĩa là ghi hao phần đã pha — cần xác nhận rõ.',
          {
            wasteLines: madeAlready.map((line) => ({
              lineNo: Number(line.line_no),
              itemName: line.item_name,
              variantDisplayName: line.variant_display_name,
              quantity: Number(line.quantity) - Number(line.cancelled_quantity),
            })),
          },
        )
      }
    }

    let groupId: number | null = null
    let totalQuantity = 0
    let wasteQuantity = 0
    let amountVnd = 0

    for (const line of pending) {
      const quantity = Number(line.quantity) - Number(line.cancelled_quantity)
      const ticketStatus: PreparationStatus = line.ticket_status ?? 'SUBMITTED'
      const policy: CancellationPolicy =
        ticketStatus === 'READY' || ticketStatus === 'COLLECTED' ? 'READY_WASTE' : 'STANDARD'
      let insertedId: number
      try {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO sales_order_cancellations
             (organization_id, venue_id, visit_id, order_id, group_id, line_id, line_no, quantity, reason, policy,
              status, station, ticket_status_at_request, requested_by_user_id, requested_by_membership_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
          [actor.organizationId, actor.venueId, visitId, input.orderId, groupId, Number(line.line_id),
            Number(line.line_no), quantity, input.reason, policy, line.preparation_station, ticketStatus,
            actor.userId, actor.membershipId],
        )
        insertedId = Number(result.insertId)
      } catch (error) {
        if (!isDuplicateKey(error)) throw error
        // Một máy khác vừa xin hủy đúng dòng này giữa lúc ta đang đọc. Khóa
        // dòng đã giữ phần lớn trường hợp; đây là lưới cuối, và câu trả lời
        // đúng là nói ra chứ không lặng lẽ bỏ qua một món.
        throw new AppError(
          409,
          'ORDER_CANCELLATION_PENDING',
          'Một món trong đơn vừa có yêu cầu hủy từ máy khác. Tải lại đơn rồi thử lại.',
        )
      }
      // Dòng đầu tiên đặt tên cho cả nhóm: nhóm luôn truy ngược được về yêu
      // cầu đã sinh ra nó, và không cần thêm một sequence nào.
      if (groupId === null) {
        groupId = insertedId
        await connection.execute('UPDATE sales_order_cancellations SET group_id = ? WHERE id = ?', [groupId, groupId])
      }
      totalQuantity += quantity
      if (policy === 'READY_WASTE') wasteQuantity += quantity
      amountVnd += money(line.unit_price_vnd, 'unit_price_vnd') * quantity
    }

    const createdGroupId = groupId as number
    await writeOperationLog(connection, actor, {
      action: 'SALES_ORDER_CANCELLATION_REQUESTED',
      entityType: 'sales_order_cancellation',
      entityId: createdGroupId,
      versionBefore: null,
      versionAfter: 1,
      idempotencyKey: input.idempotencyKey,
      changes: {
        type: 'sales_order_cancellation_requested',
        scope: 'ORDER',
        orderId: input.orderId,
        groupId: createdGroupId,
        lineCount: pending.length,
        totalQuantity,
        wasteQuantity,
        amountVnd,
        hasReason: true,
      },
    })
    await bumpVenueCursor(connection, actor)
    return {
      groupId: createdGroupId,
      orderId: input.orderId,
      lineCount: pending.length,
      wasteQuantity,
      totalQuantity,
      amountVnd,
    }
  })
}

export interface DecideOrderCancellationInput {
  groupId: number
  decision: Exclude<CancellationStatus, 'PENDING'>
  note?: string
  idempotencyKey: string
}

export interface OrderCancellationDecisionResult {
  groupId: number
  status: Exclude<CancellationStatus, 'PENDING'>
  /** Số yêu cầu con đã quyết định trong lần bấm này. */
  decidedCount: number
  order: WaiterOrderDetail
}

/**
 * Duyệt (hoặc từ chối) CẢ NHÓM bằng một lần bấm.
 *
 * Thu ngân nhìn thấy một thẻ "Đơn 2 · A3 · 4 món" và quyết định một lần. Bắt
 * họ bấm bốn lần cho một quyết định là mời họ bấm nhầm ba lần đầu và bỏ sót
 * lần thứ tư.
 *
 * Mỗi dòng con vẫn đi qua `decideOrderLineCancellation`, nên mọi luật của
 * đường từng dòng — khóa dòng món, kiểm số lượng còn lại, ghi nhật ký, cập
 * nhật tổng đơn — chạy y hệt. Hàm này chỉ là một vòng lặp trong CÙNG một
 * transaction: duyệt nửa đơn rồi hỏng là trạng thái không ai giải thích được.
 *
 * Dòng con nào đã được quyết định trước đó thì bỏ qua, không làm hỏng cả
 * nhóm: người duyệt hoàn toàn có thể đã xử lý lẻ một món trước khi mở thẻ này.
 */
export async function decideOrderCancellationGroup(
  actor: AuthenticatedActor,
  input: DecideOrderCancellationInput,
  transaction?: PoolConnection,
): Promise<OrderCancellationDecisionResult> {
  return inTransaction(transaction, async (connection) => {
    const [rows] = await connection.execute<
      (RowDataPacket & {
        id: number
        version: number
        order_id: number
        visit_id: number
        quantity: number
        policy: CancellationPolicy
        reason: string
        requested_by_user_id: number
        unit_price_vnd: string | number
      })[]
    >(
      `SELECT c.id, c.version, c.order_id, c.visit_id, c.quantity, c.policy, c.reason,
              c.requested_by_user_id, l.unit_price_vnd
         FROM sales_order_cancellations c
         JOIN sales_order_lines l ON l.id = c.line_id
        WHERE c.organization_id = ? AND c.venue_id = ? AND c.group_id = ? AND c.status = 'PENDING'
        ORDER BY c.id
        FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.groupId],
    )
    if (rows.length === 0) {
      throw new AppError(
        409,
        'ORDER_CANCELLATION_ALREADY_DECIDED',
        'Yêu cầu hủy đơn này đã được quyết định trước đó.',
      )
    }
    const first = rows[0]
    if (!first) throw new AppError(409, 'ORDER_CANCELLATION_ALREADY_DECIDED', 'Yêu cầu hủy đơn đã được quyết định.')
    const orderId = Number(first.order_id)
    for (const row of rows) {
      await decideOrderLineCancellation(
        actor,
        {
          cancellationId: Number(row.id),
          decision: input.decision,
          expectedVersion: Number(row.version),
          ...(input.note === undefined ? {} : { note: input.note }),
          // Mã chống trùng của từng dòng phải KHÁC nhau: cùng một mã cho bốn
          // lệnh ghi khác nhau sẽ bị lớp idempotency coi là một lần lặp lại và
          // ba dòng sau lặng lẽ không chạy.
          idempotencyKey: `${input.idempotencyKey}:${row.id}`,
          // Cả nhóm là MỘT quyết định, nên nó gửi MỘT thông báo ở dưới.
          suppressNotification: true,
        },
        connection,
      )
    }

    // Thông báo của cả nhóm: cộng lại từ chính những dòng vừa quyết định, chứ
    // không đọc lại đơn. Đọc lại đơn sẽ trả về trạng thái SAU khi hủy, và con
    // số trong tin phải là con số đã bị hủy.
    const quantity = rows.reduce((total, row) => total + Number(row.quantity), 0)
    const wasteQuantity = rows.reduce(
      (total, row) => total + (row.policy === 'READY_WASTE' ? Number(row.quantity) : 0),
      0,
    )
    const amountVnd = rows.reduce(
      (total, row) => total + money(row.unit_price_vnd, 'unit_price_vnd') * Number(row.quantity),
      0,
    )
    await createCancellationNotification(connection, actor, {
      targetUserId: Number(first.requested_by_user_id),
      visitId: Number(first.visit_id),
      orderId,
      cancellationGroupId: input.groupId,
      cancellationId: null,
      decision: input.decision,
      lineCount: rows.length,
      quantity,
      wasteQuantity,
      amountVnd,
      reason: first.reason,
      decisionNote: input.note ?? null,
      decidedByUserId: actor.userId,
    })

    return {
      groupId: input.groupId,
      status: input.decision,
      decidedCount: rows.length,
      order: await getWaiterOrder(actor, orderId, connection),
    }
  })
}

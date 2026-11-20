import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { currentPricePredicate, menuSourcePredicate } from '../menu/menu-catalog-sql.js'
import type { MenuUnitCode } from '../menu/menu.model.js'
import type {
  CancellationPolicy,
  MenuPriceChange,
  MenuUnavailableVariant,
  PreparationStation,
  PreparationStatus,
  PreparationTicketView,
  WaiterOrderDetail,
  WaiterOrderInput,
  WaiterOrderLine,
  WaiterOrderLineInput,
  WaiterOrderListView,
  WaiterOrderSummary,
} from './order.model.js'

/**
 * Module Phục vụ 3 — tạo đơn và đọc đơn theo Phiên bàn.
 *
 * Luật của module này nằm trong `createWaiterOrder`, và nó chỉ có một hình
 * dạng: MỌI thứ client gửi đều được tra lại trong cùng một transaction đang
 * giữ khóa dòng `visits`. Client gửi `visitId`, `variantId`, `priceId`,
 * `priceVersion`, `quantity`, `note` — không gửi giá, không gửi tên món, không
 * gửi quầy chế biến. Những giá trị đó được đọc từ danh mục rồi CHÉP vào dòng
 * đơn; một hoá đơn dựng từ dữ liệu do máy khách khai là một hoá đơn mà bất kỳ
 * ai mở được DevTools cũng sửa được.
 *
 * Giá đổi giữa lúc mở menu và lúc bấm gửi thì server KHÔNG tự lấy giá mới:
 * nó trả `MENU_PRICE_CHANGED` kèm giá mới để nhân viên nói lại với khách. Tự
 * đổi giá nghĩa là khách nghe một giá và trả một giá khác.
 */

interface VisitRow extends RowDataPacket {
  id: number
  business_date: Date | string
  ended_at: Date | string | null
  paid_marked_at: Date | string | null
}

interface CatalogRow extends RowDataPacket {
  variant_id: number
  variant_active: number
  is_sellable: number
  availability_status: 'AVAILABLE' | 'TEMPORARILY_UNAVAILABLE' | 'DISCONTINUED'
  variant_display_name: string
  unit_code: MenuUnitCode
  item_id: number
  item_code: string
  item_name: string
  item_active: number
  item_sellable_source: number
  preparation_station: PreparationStation
  price_id: number | null
  price_version: number | null
  amount_vnd: string | number | null
}

interface OrderRow extends RowDataPacket {
  id: number
  cancelled_item_count: number
  cancelled_amount_vnd: string | number
  visit_id: number
  visit_sequence: number
  business_date: Date | string
  submitted_at: Date | string
  ordered_by_user_id: number
  ordered_by_display_name: string
  line_count: number
  item_count: number
  total_amount_vnd: string | number
  stations: string | null
}

interface LineRow extends RowDataPacket {
  line_no: number
  line_version: number
  cancelled_quantity: number
  net_quantity: number
  net_total_vnd: string | number
  ticket_status: PreparationStatus | null
  cancellation_id: number | null
  cancellation_quantity: number | null
  cancellation_reason: string | null
  cancellation_policy: CancellationPolicy | null
  cancellation_version: number | null
  cancellation_requested_by: number | null
  cancellation_requested_by_name: string | null
  cancellation_requested_at: Date | string | null
  menu_item_id: number
  menu_item_variant_id: number
  item_code: string
  item_name: string
  variant_display_name: string
  unit_code: MenuUnitCode
  preparation_station: PreparationStation
  unit_price_vnd: string | number
  price_id: number
  price_version: number
  quantity: number
  line_total_vnd: string | number
  note: string | null
}

interface TicketRow extends RowDataPacket {
  id: number
  station: PreparationStation
  status: PreparationStatus
  line_count: number
  item_count: number
  cancelled_item_count: number
}

interface NextSequenceRow extends RowDataPacket {
  next_sequence: number | string
}

interface TableCodesRow extends RowDataPacket {
  table_codes: string | null
}

/** Giới hạn một lần gửi. Một giỏ dài hơn thế là một lần bấm sai, không phải một bàn khát. */
export const MAX_ORDER_LINES = 50
export const MAX_LINE_QUANTITY = 99
export const MAX_LINE_NOTE_LENGTH = 200

/**
 * Trần tiền, và lý do có trần.
 *
 * `BIGINT UNSIGNED` chứa tới 1,8e19, nhưng tiền đi qua JSON dưới dạng `number`
 * và JavaScript chỉ chính xác tới 9,007e15. Một đơn giá 1e18 lưu được vào
 * database rồi về tới trình duyệt dưới một con số đã bị làm tròn: hoá đơn lệch
 * mà không có lỗi nào được báo.
 *
 * Ba trần nhân với nhau (50 dòng × 99 món × 1e9 VND = 4,95e12) vẫn nằm trong
 * khoảng nguyên chính xác, nên mọi tổng của một đơn hợp lệ đều đúng từng đồng.
 * `ck_sales_order_lines_price` và `ck_sales_orders_total` chặn cùng những con
 * số này ở database.
 */
export const MAX_UNIT_PRICE_VND = 1_000_000_000
export const MAX_ORDER_TOTAL_VND = MAX_ORDER_LINES * MAX_LINE_QUANTITY * MAX_UNIT_PRICE_VND

function safeMoney(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null
  return parsed
}

/**
 * Đọc một con số tiền từ database.
 *
 * `bigNumberStrings: true` nên BIGINT về dưới dạng chuỗi; `Number()` trên một
 * chuỗi quá lớn cho ra một số đã làm tròn mà không báo gì. Thà trả lỗi 500 còn
 * hơn trả một hoá đơn lệch: một màn hình báo lỗi thì có người gọi điện, một
 * tổng tiền sai thì không.
 */
function readMoney(value: unknown, field: string): number {
  const parsed = safeMoney(value)
  if (parsed === null) {
    throw new AppError(500, 'ORDER_AMOUNT_UNREADABLE', 'Không đọc được số tiền của đơn.', { field })
  }
  return parsed
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

function isoDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

async function lockOrderableVisit(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<VisitRow> {
  const [rows] = await connection.execute<VisitRow[]>(
    `SELECT id, business_date, ended_at, paid_marked_at FROM visits
     WHERE organization_id = ? AND venue_id = ? AND id = ?
     FOR UPDATE`,
    [actor.organizationId, actor.venueId, visitId],
  )
  const visit = rows[0]
  if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy Phiên bàn trong địa điểm này.')
  if (visit.ended_at !== null) throw new AppError(409, 'VISIT_CLOSED', 'Phiên bàn đã kết thúc, không gửi đơn được.')
  if (visit.paid_marked_at !== null) {
    throw new AppError(
      409,
      'VISIT_NOT_ORDERABLE',
      'Phiên bàn đang chờ hoàn tất thanh toán. Liên hệ Thu ngân nếu khách muốn gọi thêm.',
    )
  }
  const [allocations] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM table_allocations
     WHERE organization_id = ? AND venue_id = ? AND visit_id = ? AND kind = 'USAGE' AND released_at IS NULL
     LIMIT 1`,
    [actor.organizationId, actor.venueId, visitId],
  )
  if (!allocations[0]) {
    throw new AppError(409, 'VISIT_NOT_SEATED', 'Phiên chưa gắn với bàn đang có khách, không gửi đơn được.')
  }
  return visit
}

/**
 * Đọc danh mục cho đúng những biến thể được gửi, trong cùng transaction và có
 * khóa chia sẻ: một lần đổi giá đang chạy song song phải chờ, nếu không snapshot
 * vừa chép xong đã là giá cũ.
 */
async function readCatalogRows(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  variantIds: number[],
): Promise<Map<number, CatalogRow>> {
  const placeholders = variantIds.map(() => '?').join(', ')
  const [rows] = await connection.execute<CatalogRow[]>(
    `SELECT mv.id AS variant_id, mv.is_active AS variant_active, mv.is_sellable, mv.availability_status,
       mv.display_name AS variant_display_name, mv.unit_code,
       mi.id AS item_id, mi.code AS item_code, mi.name AS item_name, mi.is_active AS item_active,
       ${menuSourcePredicate('mi')} AS item_sellable_source, mi.preparation_station,
       p.id AS price_id, p.version AS price_version, p.amount_vnd
     FROM menu_item_variants mv
     JOIN menu_items mi ON mi.venue_id = mv.venue_id AND mi.id = mv.menu_item_id
     JOIN menu_categories mc ON mc.venue_id = mi.venue_id AND mc.id = mi.category_id AND mc.is_active = 1
     LEFT JOIN menu_variant_prices p
       ON p.venue_id = mv.venue_id AND p.variant_id = mv.id AND ${currentPricePredicate('p')}
     WHERE mv.venue_id = ? AND mv.id IN (${placeholders})
     FOR SHARE`,
    [actor.venueId, ...variantIds],
  )
  return new Map(rows.map((row) => [Number(row.variant_id), row]))
}

interface ResolvedLine {
  input: WaiterOrderLineInput
  row: CatalogRow
  unitPriceVnd: number
  priceId: number
  priceVersion: number
}

function unavailableReason(row: CatalogRow | undefined): MenuUnavailableVariant['reason'] | null {
  if (!row) return 'NOT_IN_CATALOG'
  if (row.item_active === 0 || Number(row.item_sellable_source) === 0) return 'NOT_IN_CATALOG'
  if (row.variant_active === 0) return 'NOT_IN_CATALOG'
  if (row.is_sellable === 0) return 'NOT_SELLABLE'
  if (row.availability_status === 'DISCONTINUED') return 'NOT_SELLABLE'
  if (row.availability_status === 'TEMPORARILY_UNAVAILABLE') return 'TEMPORARILY_UNAVAILABLE'
  if (row.price_id === null) return 'NOT_IN_CATALOG'
  return null
}

/**
 * Soi CẢ giỏ rồi báo MỘT lỗi mang mọi vấn đề tìm được.
 *
 * Hai điều quan trọng:
 *
 * - Không dừng ở dòng sai đầu tiên. Nhân viên đứng cạnh bàn khách cần biết cả
 *   ba món hết hàng trong một lần.
 * - Không báo món hết trước rồi giá đổi sau. Một giỏ vừa có món hết vừa có giá
 *   đổi phải trả về cả hai, nếu không họ sửa giỏ, bấm lại, và phát hiện vấn đề
 *   thứ hai — một vòng nữa cho mỗi loại lỗi.
 *
 * Kết quả gom theo `variantId`: một biến thể có một giá hiện hành và một trạng
 * thái bán, nên hai dòng cùng biến thể (khác ghi chú) chỉ sinh một mục.
 */
function resolveLines(lines: WaiterOrderLineInput[], catalog: Map<number, CatalogRow>): ResolvedLine[] {
  const unavailable = new Map<number, MenuUnavailableVariant>()
  const priceChanges = new Map<number, MenuPriceChange>()
  const resolved: ResolvedLine[] = []

  for (const line of lines) {
    const row = catalog.get(line.variantId)
    const reason = unavailableReason(row)
    if (reason !== null || !row) {
      unavailable.set(line.variantId, {
        variantId: line.variantId,
        itemName: row?.item_name ?? '',
        variantDisplayName: row?.variant_display_name ?? '',
        reason: reason ?? 'NOT_IN_CATALOG',
      })
      continue
    }
    const priceId = Number(row.price_id)
    const priceVersion = Number(row.price_version)
    const currentAmountVnd = safeMoney(row.amount_vnd)
    if (currentAmountVnd === null || currentAmountVnd > MAX_UNIT_PRICE_VND) {
      // Giá trong danh mục vượt khoảng mà một đơn còn giữ được từng đồng. Không
      // chép nó vào dòng đơn: một con số đã mất chính xác thì mọi tổng dựng từ
      // nó đều sai, và cái sai đó không báo lỗi ở đâu cả.
      throw new AppError(
        409,
        'MENU_PRICE_OUT_OF_RANGE',
        'Giá món trong danh mục vượt mức cho phép. Báo quản lý kiểm tra lại giá trước khi gọi món này.',
        { variantId: line.variantId, maxUnitPriceVnd: MAX_UNIT_PRICE_VND },
      )
    }
    if (priceId !== line.priceId || priceVersion !== line.priceVersion) {
      priceChanges.set(line.variantId, {
        variantId: line.variantId,
        itemName: row.item_name,
        variantDisplayName: row.variant_display_name,
        submittedPriceId: line.priceId,
        submittedPriceVersion: line.priceVersion,
        currentPriceId: priceId,
        currentPriceVersion: priceVersion,
        currentAmountVnd,
      })
      continue
    }
    resolved.push({ input: line, row, unitPriceVnd: currentAmountVnd, priceId, priceVersion })
  }

  if (unavailable.size || priceChanges.size) {
    const details = { variants: [...unavailable.values()], changes: [...priceChanges.values()] }
    // Mã lỗi vẫn nói đúng chuyện gì xảy ra khi chỉ có một loại vấn đề, vì UI
    // phản ứng khác nhau: món hết thì bỏ khỏi giỏ, giá đổi thì hỏi lại khách.
    // Có cả hai thì mã nói có cả hai, và `details` luôn mang đủ hai mảng.
    if (unavailable.size && priceChanges.size) {
      throw new AppError(
        409,
        'ORDER_LINES_REJECTED',
        'Có món vừa hết và có món vừa đổi giá. Đơn chưa được gửi.',
        details,
      )
    }
    if (unavailable.size) {
      throw new AppError(
        409,
        'MENU_ITEM_UNAVAILABLE',
        'Có món vừa hết hoặc không còn được bán. Đơn chưa được gửi.',
        details,
      )
    }
    throw new AppError(
      409,
      'MENU_PRICE_CHANGED',
      'Giá món vừa thay đổi. Xác nhận lại giá mới với khách trước khi gửi đơn.',
      details,
    )
  }
  return resolved
}

async function nextVisitSequence(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<number> {
  const [rows] = await connection.execute<NextSequenceRow[]>(
    `SELECT COALESCE(MAX(visit_sequence), 0) + 1 AS next_sequence FROM sales_orders
     WHERE venue_id = ? AND visit_id = ?`,
    [actor.venueId, visitId],
  )
  return Number(rows[0]?.next_sequence ?? 1)
}

async function insertOrder(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  visit: VisitRow,
  input: WaiterOrderInput,
  resolved: ResolvedLine[],
): Promise<number> {
  const itemCount = resolved.reduce((total, line) => total + line.input.quantity, 0)
  const totalAmountVnd = resolved.reduce((total, line) => total + line.unitPriceVnd * line.input.quantity, 0)
  // Ba trần ở trên làm con số này không thể vượt khoảng nguyên chính xác. Vẫn
  // kiểm: một lần nới trần nào đó trong tương lai sẽ dừng ở đây thay vì lưu
  // lặng lẽ một tổng tiền đã sai rồi để hoá đơn chịu.
  if (!Number.isSafeInteger(totalAmountVnd) || totalAmountVnd > MAX_ORDER_TOTAL_VND) {
    throw new AppError(
      409,
      'ORDER_TOTAL_OUT_OF_RANGE',
      'Tổng tiền của đơn vượt mức cho phép. Chia thành nhiều đơn nhỏ hơn.',
      { maxOrderTotalVnd: MAX_ORDER_TOTAL_VND },
    )
  }
  const sequence = await nextVisitSequence(connection, actor, Number(visit.id))
  const [order] = await connection.execute<ResultSetHeader>(
    `INSERT INTO sales_orders
       (organization_id, venue_id, visit_id, visit_sequence, business_date, status,
        ordered_by_user_id, ordered_by_membership_id, line_count, item_count, total_amount_vnd, idempotency_key)
     VALUES (?, ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?)`,
    [actor.organizationId, actor.venueId, Number(visit.id), sequence, isoDate(visit.business_date),
      actor.userId, actor.membershipId, resolved.length, itemCount, totalAmountVnd, input.idempotencyKey],
  )
  const orderId = Number(order.insertId)

  for (const [index, line] of resolved.entries()) {
    await connection.execute(
      `INSERT INTO sales_order_lines
         (organization_id, venue_id, order_id, line_no, menu_item_id, menu_item_variant_id, price_id, price_version,
          item_code, item_name, variant_display_name, unit_code, preparation_station, unit_price_vnd, quantity, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, orderId, index + 1, Number(line.row.item_id), line.input.variantId,
        line.priceId, line.priceVersion, line.row.item_code, line.row.item_name, line.row.variant_display_name,
        line.row.unit_code, line.row.preparation_station, line.unitPriceVnd, line.input.quantity,
        line.input.note ?? null],
    )
  }

  // Routing đọc `preparation_station` đã chép vào dòng đơn. Một đơn có cả đồ
  // uống và đồ ăn sinh hai phiếu; một đơn chỉ có đồ uống sinh đúng một.
  const stations = new Map<PreparationStation, { lineCount: number; itemCount: number }>()
  for (const line of resolved) {
    const station = line.row.preparation_station
    const bucket = stations.get(station) ?? { lineCount: 0, itemCount: 0 }
    bucket.lineCount += 1
    bucket.itemCount += line.input.quantity
    stations.set(station, bucket)
  }
  for (const station of ['BAR', 'KITCHEN'] as const) {
    const bucket = stations.get(station)
    if (!bucket) continue
    const [ticket] = await connection.execute<ResultSetHeader>(
      `INSERT INTO preparation_tickets
         (organization_id, venue_id, order_id, visit_id, station, status, line_count, item_count)
       VALUES (?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)`,
      [actor.organizationId, actor.venueId, orderId, Number(visit.id), station, bucket.lineCount, bucket.itemCount],
    )
    const ticketId = Number(ticket.insertId)
    await connection.execute(
      `INSERT INTO preparation_ticket_events
         (organization_id, venue_id, ticket_id, station, from_status, to_status, ticket_version,
          actor_user_id, actor_membership_id, idempotency_key)
       VALUES (?, ?, ?, ?, NULL, 'SUBMITTED', 1, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, ticketId, station, actor.userId, actor.membershipId, input.idempotencyKey],
    )
    await connection.execute(
      `INSERT INTO preparation_print_outbox
         (organization_id, venue_id, ticket_id, station)
       VALUES (?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, ticketId, station],
    )
  }

  // Nhật ký: ai gọi món, cho Phiên nào, bao nhiêu tiền và những mã món nào.
  // KHÔNG ghi nội dung ghi chú từng món: ghi chú là chỗ nhân viên gõ tự do và
  // đã có lần mang theo tên hoặc số điện thoại khách. Chỉ ghi `hasNote` để
  // biết dòng đó có ghi chú hay không.
  await connection.execute(
    `INSERT INTO operation_log
       (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id, idempotency_key,
        action, entity_type, entity_id, entity_version_before, entity_version_after, changes, reason_code, is_undoable)
     VALUES (?, ?, 'USER', ?, ?, ?, ?, 'SALES_ORDER_CREATED', 'sales_order', ?, NULL, 1, CAST(? AS JSON), 'MANUAL', 0)`,
    [actor.organizationId, actor.venueId, actor.userId, actor.membershipId, actor.authSessionId ?? null,
      input.idempotencyKey, orderId,
      JSON.stringify([{
        type: 'sales_order_created',
        visitId: Number(visit.id),
        visitSequence: sequence,
        lineCount: resolved.length,
        itemCount,
        totalAmountVnd,
        stations: [...stations.keys()],
        lines: resolved.map((line) => ({
          itemCode: line.row.item_code,
          variantId: line.input.variantId,
          unitCode: line.row.unit_code,
          station: line.row.preparation_station,
          quantity: line.input.quantity,
          unitPriceVnd: line.unitPriceVnd,
          priceId: line.priceId,
          priceVersion: line.priceVersion,
          hasNote: Boolean(line.input.note),
        })),
      }])],
  )
  await connection.execute(
    `UPDATE venues SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
     WHERE organization_id = ? AND id = ?`,
    [actor.organizationId, actor.venueId],
  )
  return orderId
}

const orderSelect = `SELECT o.id, o.visit_id, o.visit_sequence, o.business_date, o.submitted_at,
       o.ordered_by_user_id, u.display_name AS ordered_by_display_name,
       o.line_count, o.item_count, o.cancelled_item_count, o.total_amount_vnd, o.cancelled_amount_vnd,
       (SELECT GROUP_CONCAT(DISTINCT t.station ORDER BY t.station SEPARATOR ',')
          FROM preparation_tickets t WHERE t.venue_id = o.venue_id AND t.order_id = o.id) AS stations
     FROM sales_orders o
     JOIN users u ON u.id = o.ordered_by_user_id`

function toSummary(row: OrderRow): WaiterOrderSummary {
  return {
    orderId: Number(row.id),
    visitId: Number(row.visit_id),
    visitSequence: Number(row.visit_sequence),
    status: 'SUBMITTED',
    submittedAt: isoDateTime(row.submitted_at),
    orderedByUserId: Number(row.ordered_by_user_id),
    orderedByDisplayName: row.ordered_by_display_name,
    lineCount: Number(row.line_count),
    itemCount: Number(row.item_count),
    totalAmountVnd: readMoney(row.total_amount_vnd, 'total_amount_vnd'),
    cancelledItemCount: Number(row.cancelled_item_count),
    cancelledAmountVnd: Number(row.cancelled_amount_vnd),
    netAmountVnd: readMoney(row.total_amount_vnd, 'total_amount_vnd') - Number(row.cancelled_amount_vnd),
    stations: (row.stations ? row.stations.split(',') : []) as PreparationStation[],
  }
}

type Queryable = Pool | PoolConnection

async function readOrderDetail(
  connection: Queryable,
  actor: AuthenticatedActor,
  orderId: number,
): Promise<WaiterOrderDetail> {
  const [orders] = await connection.execute<OrderRow[]>(
    `${orderSelect} WHERE o.organization_id = ? AND o.venue_id = ? AND o.id = ?`,
    [actor.organizationId, actor.venueId, orderId],
  )
  const order = orders[0]
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn trong địa điểm này.')
  const [lines] = await connection.execute<LineRow[]>(
    `SELECT l.line_no, l.menu_item_id, l.menu_item_variant_id, l.item_code, l.item_name, l.variant_display_name,
       l.unit_code, l.preparation_station, l.unit_price_vnd, l.price_id, l.price_version, l.quantity,
       l.line_total_vnd, l.note, l.version AS line_version, l.cancelled_quantity, l.net_quantity, l.net_total_vnd,
       t.status AS ticket_status,
       c.id AS cancellation_id, c.quantity AS cancellation_quantity, c.reason AS cancellation_reason,
       c.policy AS cancellation_policy, c.version AS cancellation_version,
       c.requested_by_user_id AS cancellation_requested_by, cu.display_name AS cancellation_requested_by_name,
       c.requested_at AS cancellation_requested_at
     FROM sales_order_lines l
     LEFT JOIN preparation_tickets t
       ON t.venue_id = l.venue_id AND t.order_id = l.order_id AND t.station = l.preparation_station
     LEFT JOIN sales_order_cancellations c
       ON c.line_id = l.id AND c.status = 'PENDING'
     LEFT JOIN users cu ON cu.id = c.requested_by_user_id
     WHERE l.venue_id = ? AND l.order_id = ?
     ORDER BY l.line_no`,
    [actor.venueId, orderId],
  )
  const [tickets] = await connection.execute<TicketRow[]>(
    `SELECT id, station, status, line_count, item_count, cancelled_item_count FROM preparation_tickets
     WHERE venue_id = ? AND order_id = ? ORDER BY station`,
    [actor.venueId, orderId],
  )
  return {
    ...toSummary(order),
    businessDate: isoDate(order.business_date),
    lines: lines.map((row): WaiterOrderLine => ({
      lineNo: Number(row.line_no),
      menuItemId: Number(row.menu_item_id),
      variantId: Number(row.menu_item_variant_id),
      itemCode: row.item_code,
      itemName: row.item_name,
      variantDisplayName: row.variant_display_name,
      unitCode: row.unit_code,
      preparationStation: row.preparation_station,
      unitPriceVnd: readMoney(row.unit_price_vnd, 'unit_price_vnd'),
      priceId: Number(row.price_id),
      priceVersion: Number(row.price_version),
      quantity: Number(row.quantity),
      lineTotalVnd: readMoney(row.line_total_vnd, 'line_total_vnd'),
      note: row.note,
      lineVersion: Number(row.line_version),
      cancelledQuantity: Number(row.cancelled_quantity),
      netQuantity: Number(row.net_quantity),
      netTotalVnd: Number(row.net_total_vnd),
      preparationStatus: row.ticket_status,
      // Mở sửa số lượng chỉ khi quầy CHƯA nhận phiếu và không có yêu cầu hủy
      // đang chờ. Hai điều kiện này được kiểm lại trong transaction lúc sửa;
      // ở đây chúng chỉ để màn hình không bật một cái nút chắc chắn lỗi.
      canAdjustQuantity: row.ticket_status === 'SUBMITTED'
        && row.cancellation_id === null
        && Number(row.cancelled_quantity) === 0,
      pendingCancellation: row.cancellation_id === null ? null : {
        cancellationId: Number(row.cancellation_id),
        quantity: Number(row.cancellation_quantity),
        reason: row.cancellation_reason ?? '',
        policy: row.cancellation_policy ?? 'STANDARD',
        version: Number(row.cancellation_version),
        requestedByUserId: Number(row.cancellation_requested_by),
        requestedByDisplayName: row.cancellation_requested_by_name ?? '',
        requestedAt: isoDateTime(row.cancellation_requested_at ?? new Date()),
      },
    })),
    tickets: tickets.map((row): PreparationTicketView => ({
      ticketId: Number(row.id),
      station: row.station,
      status: row.status,
      lineCount: Number(row.line_count),
      itemCount: Number(row.item_count),
      cancelledItemCount: Number(row.cancelled_item_count),
    })),
  }
}

/**
 * Một lần bấm "Gửi đơn" = một đơn mới.
 *
 * `transaction` là transaction do middleware chống trùng mở (FX-04). Khi có nó,
 * dòng `idempotency_keys` và toàn bộ đơn commit cùng nhau: không có cửa sổ nào
 * mà mã đã được ghi nhận nhưng đơn thì chưa, hoặc ngược lại. Khi không có
 * (gọi nội bộ, test), hàm tự mở và tự đóng transaction của mình.
 */
export async function createWaiterOrder(
  actor: AuthenticatedActor,
  input: WaiterOrderInput,
  transaction?: PoolConnection,
): Promise<WaiterOrderDetail> {
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()
    const visit = await lockOrderableVisit(connection, actor, input.visitId)
    const catalog = await readCatalogRows(connection, actor, input.lines.map((line) => line.variantId))
    const resolved = resolveLines(input.lines, catalog)
    const orderId = await insertOrder(connection, actor, visit, input, resolved)
    const detail = await readOrderDetail(connection, actor, orderId)
    if (ownsTransaction) await connection.commit()
    return detail
  } catch (error) {
    // Một món hết hàng, một giá vừa đổi hay một Phiên vừa đóng đều làm CẢ đơn
    // bị bỏ. Gửi một phần đơn nghĩa là Bar làm ba món trong khi nhân viên tin
    // rằng mình vừa gửi năm.
    //
    // Với transaction của middleware chống trùng, chính middleware ROLLBACK khi
    // response mang status lỗi — và nó rollback cả dòng `idempotency_keys`, nên
    // lần bấm lại sau khi sửa giỏ được xử lý như một yêu cầu mới. Gọi rollback
    // ở đây nữa sẽ đóng transaction trước khi middleware kịp làm việc đó.
    if (ownsTransaction) await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

export async function listVisitOrders(
  actor: AuthenticatedActor,
  visitId: number,
): Promise<WaiterOrderListView> {
  const [visits] = await databasePool.execute<TableCodesRow[]>(
    `SELECT GROUP_CONCAT(DISTINCT dt.code ORDER BY dt.code SEPARATOR ',') AS table_codes
     FROM visits v
     LEFT JOIN table_allocations ta
       ON ta.organization_id = v.organization_id AND ta.venue_id = v.venue_id
      AND ta.visit_id = v.id AND ta.kind = 'USAGE' AND ta.released_at IS NULL
     LEFT JOIN dining_tables dt
       ON dt.organization_id = ta.organization_id AND dt.venue_id = ta.venue_id AND dt.id = ta.table_id
     WHERE v.organization_id = ? AND v.venue_id = ? AND v.id = ?
     GROUP BY v.id`,
    [actor.organizationId, actor.venueId, visitId],
  )
  const visit = visits[0]
  if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy Phiên bàn trong địa điểm này.')
  const [rows] = await databasePool.execute<OrderRow[]>(
    `${orderSelect} WHERE o.organization_id = ? AND o.venue_id = ? AND o.visit_id = ?
     ORDER BY o.visit_sequence DESC`,
    [actor.organizationId, actor.venueId, visitId],
  )
  const orders = rows.map(toSummary)
  const totalAmountVnd = orders.reduce((total, order) => total + order.totalAmountVnd, 0)
  const cancelledAmountVnd = orders.reduce((total, order) => total + order.cancelledAmountVnd, 0)
  return {
    visitId,
    tableCodes: visit.table_codes ? visit.table_codes.split(',') : [],
    orderCount: orders.length,
    totalAmountVnd,
    cancelledAmountVnd,
    netAmountVnd: totalAmountVnd - cancelledAmountVnd,
    orders,
  }
}

/**
 * `connection` cho phép Module 5 đọc lại đơn NGAY TRONG transaction vừa sửa nó,
 * nên response mang đúng trạng thái sẽ được commit — không phải trạng thái cũ
 * đọc từ pool ở ngoài.
 */
export async function getWaiterOrder(
  actor: AuthenticatedActor,
  orderId: number,
  connection?: Queryable,
): Promise<WaiterOrderDetail> {
  return readOrderDetail(connection ?? databasePool, actor, orderId)
}

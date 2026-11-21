/**
 * Module Phục vụ (v1.1) — PV-20: hộp tin của một nhân viên.
 *
 * Hôm nay chỉ có một loại tin: "yêu cầu hủy của bạn đã được quyết định". Bảng
 * và kiểu để mở cho loại thứ hai, nhưng KHÔNG dựng sẵn một khung thông báo
 * tổng quát cho những loại chưa ai yêu cầu.
 *
 * Mọi con số trong tin là bản chép tại thời điểm quyết định. Đọc lại tin sau
 * ba tiếng phải ra đúng con số đã hiện lúc nó tới, kể cả khi đơn đã đổi tiếp.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

export type StaffNotificationKind = 'CANCELLATION_DECIDED'

export interface StaffNotificationView {
  notificationId: number
  kind: StaffNotificationKind
  visitId: number | null
  orderId: number | null
  cancellationGroupId: number | null
  cancellationId: number | null
  decision: 'APPROVED' | 'REJECTED' | null
  /** Số dòng món trong quyết định. */
  lineCount: number
  quantity: number
  /** Số phần bị ghi hao; 0 nghĩa là không món nào đã làm xong. */
  wasteQuantity: number
  amountVnd: number
  /** Lý do Phục vụ đã gửi kèm yêu cầu. */
  reason: string | null
  /** Ghi chú của người duyệt. */
  decisionNote: string | null
  decidedByUserId: number | null
  decidedByDisplayName: string | null
  decidedAt: string | null
  tableCodes: string[]
  visitSequence: number | null
  createdAt: string
  acknowledgedAt: string | null
}

export interface CreateCancellationNotificationInput {
  targetUserId: number
  visitId: number
  orderId: number
  cancellationGroupId: number | null
  cancellationId: number | null
  decision: 'APPROVED' | 'REJECTED'
  lineCount: number
  quantity: number
  wasteQuantity: number
  amountVnd: number
  reason: string | null
  decisionNote: string | null
  decidedByUserId: number
}

/**
 * Ghi một thông báo, TRONG transaction của quyết định.
 *
 * Cùng transaction là điều kiện, không phải tối ưu: một quyết định đã ghi mà
 * thông báo thất bại sẽ để Phục vụ đứng chờ một tin không bao giờ tới, và họ
 * sẽ nói với khách rằng yêu cầu vẫn đang chờ duyệt.
 *
 * Người duyệt tự duyệt yêu cầu của chính mình thì không có tin nào: một thông
 * báo về việc mình vừa làm là tiếng ồn.
 */
export async function createCancellationNotification(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  input: CreateCancellationNotificationInput,
): Promise<void> {
  if (input.targetUserId === actor.userId) return
  await connection.execute<ResultSetHeader>(
    `INSERT INTO staff_notifications
       (organization_id, venue_id, kind, target_user_id, visit_id, order_id, cancellation_group_id,
        cancellation_id, decision, line_count, quantity, waste_quantity, amount_vnd, reason, decision_note,
        decided_by_user_id, decided_at)
     VALUES (?, ?, 'CANCELLATION_DECIDED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [actor.organizationId, actor.venueId, input.targetUserId, input.visitId, input.orderId,
      input.cancellationGroupId, input.cancellationId, input.decision, input.lineCount, input.quantity,
      input.wasteQuantity, input.amountVnd, input.reason, input.decisionNote, input.decidedByUserId],
  )
}

interface NotificationRow extends RowDataPacket {
  id: number
  kind: StaffNotificationKind
  visit_id: number | null
  order_id: number | null
  cancellation_group_id: number | null
  cancellation_id: number | null
  decision: 'APPROVED' | 'REJECTED' | null
  line_count: number
  quantity: number
  waste_quantity: number
  amount_vnd: string | number
  reason: string | null
  decision_note: string | null
  decided_by_user_id: number | null
  decided_by_display_name: string | null
  decided_at: Date | string | null
  created_at: Date | string
  acknowledged_at: Date | string | null
  visit_sequence: number | null
  table_codes: string | null
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

const MAX_INBOX = 50

/**
 * Hộp tin của CHÍNH người đang đăng nhập.
 *
 * Lọc theo `target_user_id` ở máy chủ, không gửi cả hộp rồi để frontend lọc:
 * một thông báo mang lý do hủy và số tiền của một bàn mà người này không phục
 * vụ là dữ liệu vận hành của người khác.
 */
export async function listStaffNotifications(actor: AuthenticatedActor): Promise<StaffNotificationView[]> {
  const [rows] = await databasePool.execute<NotificationRow[]>(
    `SELECT n.id, n.kind, n.visit_id, n.order_id, n.cancellation_group_id, n.cancellation_id, n.decision,
            n.line_count, n.quantity, n.waste_quantity, n.amount_vnd, n.reason, n.decision_note,
            n.decided_by_user_id, n.decided_at, n.created_at, n.acknowledged_at,
            du.display_name AS decided_by_display_name,
            o.visit_sequence,
            (SELECT GROUP_CONCAT(DISTINCT dt.code ORDER BY dt.code SEPARATOR ',')
               FROM table_allocations ta
               JOIN dining_tables dt ON dt.organization_id = ta.organization_id AND dt.venue_id = ta.venue_id
                AND dt.id = ta.table_id
              WHERE ta.organization_id = n.organization_id AND ta.venue_id = n.venue_id
                AND ta.visit_id = n.visit_id AND ta.kind = 'USAGE' AND ta.released_at IS NULL) AS table_codes
       FROM staff_notifications n
       LEFT JOIN users du ON du.id = n.decided_by_user_id
       LEFT JOIN sales_orders o ON o.venue_id = n.venue_id AND o.id = n.order_id
      WHERE n.organization_id = ? AND n.venue_id = ? AND n.target_user_id = ? AND n.acknowledged_at IS NULL
      ORDER BY n.id DESC
      LIMIT ${MAX_INBOX}`,
    [actor.organizationId, actor.venueId, actor.userId],
  )
  return rows.map((row) => ({
    notificationId: Number(row.id),
    kind: row.kind,
    visitId: row.visit_id === null ? null : Number(row.visit_id),
    orderId: row.order_id === null ? null : Number(row.order_id),
    cancellationGroupId: row.cancellation_group_id === null ? null : Number(row.cancellation_group_id),
    cancellationId: row.cancellation_id === null ? null : Number(row.cancellation_id),
    decision: row.decision,
    lineCount: Number(row.line_count),
    quantity: Number(row.quantity),
    wasteQuantity: Number(row.waste_quantity),
    amountVnd: Number(row.amount_vnd),
    reason: row.reason,
    decisionNote: row.decision_note,
    decidedByUserId: row.decided_by_user_id === null ? null : Number(row.decided_by_user_id),
    decidedByDisplayName: row.decided_by_display_name,
    decidedAt: row.decided_at === null ? null : isoDateTime(row.decided_at),
    tableCodes: row.table_codes ? row.table_codes.split(',') : [],
    visitSequence: row.visit_sequence === null ? null : Number(row.visit_sequence),
    createdAt: isoDateTime(row.created_at),
    acknowledgedAt: row.acknowledged_at === null ? null : isoDateTime(row.acknowledged_at),
  }))
}

/**
 * Đánh dấu đã đọc. Chỉ người NHẬN mới xác nhận được tin của mình — một badge
 * mà người khác tắt hộ là một badge không nói lên điều gì.
 */
export async function acknowledgeStaffNotification(
  actor: AuthenticatedActor,
  notificationId: number,
): Promise<void> {
  const [result] = await databasePool.execute<ResultSetHeader>(
    `UPDATE staff_notifications SET acknowledged_at = UTC_TIMESTAMP(3)
      WHERE organization_id = ? AND venue_id = ? AND id = ? AND target_user_id = ? AND acknowledged_at IS NULL`,
    [actor.organizationId, actor.venueId, notificationId, actor.userId],
  )
  if (result.affectedRows === 0) {
    throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo chưa đọc này của bạn.')
  }
}

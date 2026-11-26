/**
 * Module Phục vụ 1 (v1.1) — đọc số liệu để tính sáu trạng thái lượt khách.
 *
 * Tách khỏi `floor-projection.repository.ts` có chủ đích: câu SQL dài của Lễ
 * tân đã đủ việc, và nhét thêm hai subquery về đơn/phiếu vào đó nghĩa là mọi
 * lần tải sơ đồ Lễ tân cũng phải trả tiền cho dữ liệu mà màn đó không dùng.
 *
 * Hàm này KHÔNG tự quyết trạng thái. Nó chỉ mang số về; luật nằm ở
 * `waiter-visit-phase.ts` và vì thế test được không cần MySQL.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { sqlBoolean } from '../../database/row-value.js'
import { AppError } from '../../errors/app-error.js'
import type { WaiterVisitActivity } from './waiter-visit-phase.js'

interface VisitActivityRow extends RowDataPacket {
  visit_id: number
  paid: number
  awaiting_payment: number
  ordering_since: Date | string | null
  order_count: number
  pending_ticket_count: number
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Số liệu của những Phiên đang hiện trên sơ đồ.
 *
 * Nhận `visitIds` thay vì tự tìm lại theo ngày kinh doanh: phép chiếu sơ đồ đã
 * quyết định Phiên nào đang hiện, và hỏi lại bằng một điều kiện khác là mở
 * đường cho hai câu trả lời lệch nhau trong cùng một lần tải màn hình.
 *
 * Danh sách rỗng thì không chạm database.
 */
export async function readWaiterVisitActivity(
  actor: AuthenticatedActor,
  visitIds: readonly number[],
): Promise<WaiterVisitActivity[]> {
  const ids = [...new Set(visitIds)].filter((id) => Number.isSafeInteger(id) && id > 0)
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  const [rows] = await databasePool.execute<VisitActivityRow[]>(
    `SELECT v.id AS visit_id,
            (v.paid_marked_at IS NOT NULL) AS paid,
            -- HU-44 v1.1: Phiên "Chờ thanh toán" khi CÒN hoá đơn chưa thu VÀ
            -- không còn món nào chưa lên hoá đơn. Khách gọi thêm sau khi đã
            -- cầm hoá đơn thì Phiên về Đang phục vụ (TN-13-K4), dù bill cũ vẫn
            -- chưa thu — bàn đó đang được phục vụ tiếp, không đang chờ trả tiền.
            (EXISTS (SELECT 1 FROM bills AS b
                      WHERE b.venue_id = v.venue_id AND b.visit_id = v.id
                        AND b.status = 'AWAITING_PAYMENT')
             AND NOT EXISTS (
               SELECT 1
                 FROM sales_order_lines AS l
                 JOIN sales_orders AS so ON so.venue_id = l.venue_id AND so.id = l.order_id
                 LEFT JOIN (
                   SELECT s.order_line_id, SUM(s.quantity) AS quantity
                     FROM bill_line_sources s
                     JOIN bills bb ON bb.venue_id = s.venue_id AND bb.id = s.bill_id
                    WHERE s.venue_id = v.venue_id AND bb.status <> 'VOIDED'
                    GROUP BY s.order_line_id
                 ) AS billed ON billed.order_line_id = l.id
                WHERE l.venue_id = v.venue_id AND so.visit_id = v.id
                  AND (l.net_quantity - IFNULL(billed.quantity, 0)) > 0
             )) AS awaiting_payment,
            v.ordering_since,
            (SELECT COUNT(*) FROM sales_orders AS o
              WHERE o.venue_id = v.venue_id AND o.visit_id = v.id) AS order_count,
            (SELECT COUNT(*) FROM preparation_tickets AS t
              WHERE t.venue_id = v.venue_id AND t.visit_id = v.id AND t.status <> 'COLLECTED')
              AS pending_ticket_count
       FROM visits AS v
      WHERE v.organization_id = ? AND v.venue_id = ? AND v.id IN (${placeholders})`,
    [actor.organizationId, actor.venueId, ...ids],
  )
  return rows.map((row) => ({
    visitId: Number(row.visit_id),
    paid: sqlBoolean(row.paid),
    awaitingPayment: sqlBoolean(row.awaiting_payment),
    orderCount: Number(row.order_count),
    pendingTicketCount: Number(row.pending_ticket_count),
    orderingSince: toDate(row.ordering_since),
  }))
}

interface OrderingVisitRow extends RowDataPacket {
  id: number
  ended_at: Date | string | null
  paid_marked_at: Date | string | null
  ordering_by_user_id: number | null
}

interface VenueSequenceRow extends RowDataPacket {
  change_seq: string
}

/**
 * Đẩy `change_seq` của địa điểm để bộ phát SSE báo cho các máy khác.
 *
 * Chép lại luật của `booking.repository.ts` thay vì gọi sang đó: hàm bên ấy là
 * nội bộ của module đặt bàn, và xuất nó ra chỉ để dùng ở đây sẽ nối hai module
 * không liên quan bằng một sợi dây mà lần refactor nào cũng vướng.
 */
async function bumpVenueChangeSequence(connection: PoolConnection, actor: AuthenticatedActor): Promise<void> {
  const [rows] = await connection.execute<VenueSequenceRow[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE',
    [actor.organizationId, actor.venueId],
  )
  const venue = rows[0]
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  await connection.execute(
    `UPDATE venues SET change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
      WHERE organization_id = ? AND id = ?`,
    [(BigInt(venue.change_seq) + 1n).toString(), actor.organizationId, actor.venueId],
  )
}

async function lockOrderingVisit(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<OrderingVisitRow> {
  const [rows] = await connection.execute<OrderingVisitRow[]>(
    `SELECT id, ended_at, paid_marked_at, ordering_by_user_id
       FROM visits
      WHERE organization_id = ? AND venue_id = ? AND id = ?
      FOR UPDATE`,
    [actor.organizationId, actor.venueId, visitId],
  )
  const visit = rows[0]
  if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách.')
  return visit
}

/**
 * Đánh dấu "máy này đang mở màn Gọi món của Phiên".
 *
 * Trả về `true` khi dấu vừa đổi chủ hoặc vừa xuất hiện — tức là khi các máy
 * KHÁC cần biết. Nhịp đập định kỳ của cùng một người chỉ làm mới mốc thời gian
 * và trả `false`.
 *
 * Phân biệt này không phải để tiết kiệm một câu UPDATE. `useRealtimeSync` ở
 * web gọi `invalidateQueries()` cho MỌI query khi nhận tín hiệu sơ đồ đổi; đẩy
 * tín hiệu sau mỗi nhịp đập 30 giây nghĩa là mọi máy trong quán tải lại mọi
 * thứ hai lần một phút, suốt ca, chỉ vì một người đang cầm menu.
 */
export async function markVisitOrdering(actor: AuthenticatedActor, visitId: number): Promise<boolean> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const visit = await lockOrderingVisit(connection, actor, visitId)
    if (visit.ended_at !== null) {
      throw new AppError(409, 'VISIT_CLOSED', 'Lượt khách đã kết thúc.')
    }
    if (visit.paid_marked_at !== null) {
      throw new AppError(409, 'VISIT_ALREADY_PAID', 'Phiên đang chờ thanh toán, không mở gọi món được.')
    }
    const changedOwner = visit.ordering_by_user_id !== actor.userId
    await connection.execute(
      `UPDATE visits SET ordering_since = UTC_TIMESTAMP(3), ordering_by_user_id = ?
        WHERE organization_id = ? AND venue_id = ? AND id = ?`,
      [actor.userId, actor.organizationId, actor.venueId, visitId],
    )
    if (changedOwner) await bumpVenueChangeSequence(connection, actor)
    await connection.commit()
    return changedOwner
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

/**
 * Gỡ dấu "đang gọi món".
 *
 * Chỉ người đang giữ dấu mới gỡ được. Cho bất kỳ ai gỡ nghĩa là máy A thoát
 * màn hình và tắt luôn màu cam mà máy B đang tạo ra, và bàn trở lại trắng
 * trong khi vẫn có người đứng đó lên đơn.
 *
 * Phiên đã đóng hoặc không có dấu thì đây là một no-op im lặng: người dùng
 * bấm quay lại không cần biết cái dấu đó còn hay mất.
 */
export async function clearVisitOrdering(actor: AuthenticatedActor, visitId: number): Promise<boolean> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE visits SET ordering_since = NULL, ordering_by_user_id = NULL
        WHERE organization_id = ? AND venue_id = ? AND id = ? AND ordering_by_user_id = ?`,
      [actor.organizationId, actor.venueId, visitId, actor.userId],
    )
    const cleared = result.affectedRows > 0
    if (cleared) await bumpVenueChangeSequence(connection, actor)
    await connection.commit()
    return cleared
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

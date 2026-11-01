import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { AppError } from '../../errors/app-error.js'
import { businessDateAt } from '../bookings/business-date.js'

/**
 * FX-02 — luật chung "bàn bận vào ngày nghiệp vụ X" cho sơ đồ bàn và mọi thao tác giữ bàn cho booking/khách chờ.
 * - Mọi ngày: bàn giữ (HOLD) và lượt khách (USAGE) chưa nhả của chính ngày X.
 * - Chỉ khi X là ca hiện tại (mốc 05:00): thêm mọi lượt khách đang mở của ngày cũ (quên đóng) — khớp với
 *   check-in vốn chặn mọi USAGE đang mở. Ngày tương lai không bị khách đang ngồi hôm nay làm bận.
 * Điều kiện dùng trên bảng table_allocations (không alias), đi kèm `released_at IS NULL`.
 */
export function occupancyScope(businessDate: string, now = new Date()): { sql: string; params: [string, number] } {
  return {
    sql: "(business_date = ? OR (kind = 'USAGE' AND ? = 1))",
    params: [businessDate, businessDate === businessDateAt(now) ? 1 : 0],
  }
}

/** Khóa (FOR UPDATE) và chặn nếu một trong các bàn đã bận vào ngày nghiệp vụ của booking/khách chờ. */
export async function assertTablesFreeForBusinessDate(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  businessDate: string,
  tableIds: number[],
  now = new Date(),
): Promise<void> {
  if (!tableIds.length) return
  const scope = occupancyScope(businessDate, now)
  const placeholders = tableIds.map(() => '?').join(',')
  const [conflicts] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM table_allocations
     WHERE organization_id = ? AND venue_id = ? AND released_at IS NULL
       AND table_id IN (${placeholders}) AND ${scope.sql}
     ORDER BY table_id, id FOR UPDATE`,
    [actor.organizationId, actor.venueId, ...tableIds, ...scope.params],
  )
  if (conflicts.length) {
    throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc đang sử dụng.')
  }
}

import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { AppError } from '../../errors/app-error.js'

export interface GroupTableRow extends RowDataPacket {
  id: number
  code: string
  kind: 'TABLE' | 'BAR_SEAT'
  capacity: number
  is_spare: number
  status: string
  zone_id: number
  is_bookable: number
}

async function lockMergeTables(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
): Promise<{ ids: number[]; tables: GroupTableRow[] }> {
  const ids = [...new Set(tableIds)].sort((a, b) => a - b)
  if (ids.length < 2) throw new AppError(400, 'MERGE_REQUIRES_MULTIPLE_TABLES', 'Cần chọn ít nhất hai bàn để ghép.')
  const placeholders = ids.map(() => '?').join(',')
  const [tables] = await connection.execute<GroupTableRow[]>(
    `SELECT dt.id, dt.code, dt.kind, dt.capacity, dt.is_spare, dt.status, dt.zone_id,
       z.is_bookable
     FROM dining_tables AS dt
     JOIN zones AS z ON z.organization_id = dt.organization_id
       AND z.venue_id = dt.venue_id AND z.id = dt.zone_id
     WHERE dt.organization_id = ? AND dt.venue_id = ? AND dt.id IN (${placeholders})
     ORDER BY dt.id FOR UPDATE`,
    [actor.organizationId, actor.venueId, ...ids],
  )
  if (tables.length !== ids.length || tables.some((table) => table.status !== 'ACTIVE')) {
    throw new AppError(400, 'TABLE_NOT_FOUND', 'Có bàn không tồn tại hoặc ngừng hoạt động.')
  }
  const spare = tables.find((table) => Boolean(table.is_spare))
  if (spare) throw new AppError(409, 'SPARE_TABLE_NOT_BOOKABLE', `Bàn ${spare.code} là bàn sơ cua.`)
  if (new Set(tables.map((table) => table.kind)).size !== 1) {
    throw new AppError(409, 'TABLE_KIND_MISMATCH', 'Không thể ghép bàn thường với ghế Bar.')
  }
  return { ids, tables }
}

export async function lockAndValidateWaitlistTables(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
): Promise<GroupTableRow[]> {
  const ids = [...new Set(tableIds)].sort((left, right) => left - right)
  if (!ids.length) throw new AppError(400, 'TABLE_REQUIRED', 'Cần chọn ít nhất một bàn.')
  const placeholders = ids.map(() => '?').join(',')
  const [tables] = await connection.execute<GroupTableRow[]>(
    `SELECT dt.id, dt.code, dt.kind, dt.capacity, dt.is_spare, dt.status, dt.zone_id,
       z.is_bookable
     FROM dining_tables AS dt
     JOIN zones AS z ON z.organization_id = dt.organization_id
       AND z.venue_id = dt.venue_id AND z.id = dt.zone_id
     WHERE dt.organization_id = ? AND dt.venue_id = ? AND dt.id IN (${placeholders})
     ORDER BY dt.id FOR UPDATE`,
    [actor.organizationId, actor.venueId, ...ids],
  )
  if (tables.length !== ids.length || tables.some((table) => table.status !== 'ACTIVE')) {
    throw new AppError(400, 'TABLE_NOT_FOUND', 'Có bàn không tồn tại hoặc ngừng hoạt động.')
  }
  const nonBookable = tables.find((table) => !table.is_bookable)
  if (nonBookable) {
    throw new AppError(409, 'ZONE_NOT_BOOKABLE', `Khu của bàn ${nonBookable.code} không nhận booking.`)
  }
  const spare = tables.find((table) => Boolean(table.is_spare))
  if (spare) {
    throw new AppError(409, 'SPARE_TABLE_NOT_BOOKABLE', `Bàn ${spare.code} là bàn sơ cua và chưa được cấu hình để nhận khách.`)
  }
  if (new Set(tables.map((table) => Number(table.zone_id))).size !== 1) {
    throw new AppError(409, 'TABLE_ZONE_MISMATCH', 'Chỉ có thể gán các bàn trong cùng một khu vực.')
  }
  if (tables.length > 1 && new Set(tables.map((table) => table.kind)).size !== 1) {
    throw new AppError(409, 'TABLE_KIND_MISMATCH', 'Không thể ghép bàn thường với ghế Bar.')
  }
  return tables
}

export async function lockAndValidateSameZoneTables(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
): Promise<GroupTableRow[]> {
  const { tables } = await lockMergeTables(connection, actor, tableIds)
  if (new Set(tables.map((table) => Number(table.zone_id))).size !== 1) {
    throw new AppError(409, 'TABLE_ZONE_MISMATCH', 'Chỉ có thể ghép các bàn trong cùng một khu vực.')
  }
  return tables
}

export async function lockAndValidateConnectedTables(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
): Promise<GroupTableRow[]> {
  const { ids, tables } = await lockMergeTables(connection, actor, tableIds)
  const placeholders = ids.map(() => '?').join(',')
  const [edges] = await connection.execute<(RowDataPacket & { low_table_id: number; high_table_id: number })[]>(
    `SELECT low_table_id, high_table_id FROM table_adjacencies
     WHERE organization_id = ? AND venue_id = ?
       AND low_table_id IN (${placeholders}) AND high_table_id IN (${placeholders})`,
    [actor.organizationId, actor.venueId, ...ids, ...ids],
  )
  const graph = new Map(ids.map((id) => [id, new Set<number>()]))
  for (const edge of edges) {
    graph.get(Number(edge.low_table_id))?.add(Number(edge.high_table_id))
    graph.get(Number(edge.high_table_id))?.add(Number(edge.low_table_id))
  }
  const visited = new Set<number>([ids[0]!])
  const queue = [ids[0]!]
  while (queue.length) {
    for (const neighbor of graph.get(queue.shift()!) ?? []) {
      if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor) }
    }
  }
  if (visited.size !== ids.length) {
    throw new AppError(409, 'TABLES_NOT_ADJACENT', 'Các bàn đã chọn không tạo thành một nhóm liền kề.')
  }
  return tables
}

export async function createTableGroup(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  businessDate: string,
): Promise<{ id: number; symbolNo: number }> {
  const [venueRows] = await connection.execute<(RowDataPacket & { group_symbol_count: number })[]>(
    'SELECT group_symbol_count FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE',
    [actor.organizationId, actor.venueId],
  )
  const maximum = Number(venueRows[0]?.group_symbol_count ?? 0)
  const [usedRows] = await connection.execute<(RowDataPacket & { symbol_no: number })[]>(
    `SELECT symbol_no FROM table_groups
     WHERE organization_id = ? AND venue_id = ? AND business_date = ? AND dissolved_at IS NULL FOR UPDATE`,
    [actor.organizationId, actor.venueId, businessDate],
  )
  const used = new Set(usedRows.map((row) => Number(row.symbol_no)))
  const symbolNo = Array.from({ length: maximum }, (_, index) => index + 1).find((value) => !used.has(value))
  if (!symbolNo) throw new AppError(409, 'GROUP_SYMBOL_UNAVAILABLE', 'Đã dùng hết ký hiệu nhóm trong ngày nghiệp vụ.')
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO table_groups
      (organization_id, venue_id, business_date, symbol_no, formed_at, formed_by_user_id)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), ?)`,
    [actor.organizationId, actor.venueId, businessDate, symbolNo, actor.userId],
  )
  return { id: result.insertId, symbolNo }
}

export async function dissolveUnusedGroups(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  groupIds: Array<number | null>,
): Promise<void> {
  for (const groupId of new Set(groupIds.filter((id): id is number => id !== null))) {
    const [active] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM table_allocations WHERE venue_id = ? AND group_id = ? AND released_at IS NULL LIMIT 1`,
      [actor.venueId, groupId],
    )
    if (!active.length) {
      await connection.execute(
        `UPDATE table_groups SET dissolved_at = UTC_TIMESTAMP(3), dissolved_by_user_id = ?
         WHERE organization_id = ? AND venue_id = ? AND id = ? AND dissolved_at IS NULL`,
        [actor.userId, actor.organizationId, actor.venueId, groupId],
      )
    }
  }
}

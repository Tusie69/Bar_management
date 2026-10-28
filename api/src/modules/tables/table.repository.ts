import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import type { TableState } from './table-state.js'

export interface TableView {
  id: number
  code: string
  displayName: string
  type: 'TABLE' | 'BAR_SEAT' | 'WAITING'
  capacity: number | null
  area: { code: string; name: string; floor: number }
  position: { x: number; y: number }
  state: TableState
  isBackup: boolean
  version: number
  activeVisit: {
    id: number
    version: number
    tableCodes: string[]
  } | null
}

interface TableRow extends RowDataPacket {
  id: number
  code: string
  display_name: string
  table_type: 'TABLE' | 'BAR_SEAT'
  capacity: number | null
  area_code: string
  area_name: string
  position_x: string
  position_y: string
  state: TableState
  is_spare: number
  version: number
  active_visit_id: number | null
  active_visit_version: number | null
  active_visit_table_codes: string | null
}

function toTableView(row: TableRow): TableView {
  return {
    id: Number(row.id),
    code: row.table_type === 'BAR_SEAT' ? row.code.replace(/^BAR0?/, '') : row.code,
    displayName: row.display_name,
    type: row.table_type,
    capacity: row.capacity,
    area: { code: row.area_code, name: row.area_name, floor: 1 },
    position: { x: Number(row.position_x), y: Number(row.position_y) },
    state: row.state,
    isBackup: Boolean(row.is_spare),
    version: row.version,
    activeVisit: row.active_visit_id === null || row.active_visit_version === null
      ? null
      : {
          id: Number(row.active_visit_id),
          version: row.active_visit_version,
          tableCodes: row.active_visit_table_codes ? row.active_visit_table_codes.split(',') : [],
        },
  }
}

export async function listTables(actor: AuthenticatedActor, businessDate: string): Promise<TableView[]> {
  const [rows] = await databasePool.execute<TableRow[]>(
    `SELECT
       dt.id, dt.code, dt.display_name, dt.kind AS table_type, dt.capacity,
       z.code AS area_code, z.name AS area_name,
       ROUND(dt.pos_x / 5.6, 3) AS position_x,
       ROUND(dt.pos_y / 7.6, 3) AS position_y,
       CASE
         WHEN COALESCE(a.has_usage, 0) = 1 THEN 'IN_USE'
         WHEN COALESCE(a.has_hold, 0) = 1 THEN 'RESERVED'
         ELSE 'AVAILABLE'
       END AS state,
       dt.is_spare, dt.version,
       a.active_visit_id, v.version AS active_visit_version,
       CASE WHEN a.active_visit_id IS NULL THEN NULL ELSE (
         SELECT GROUP_CONCAT(DISTINCT dt2.code ORDER BY dt2.id SEPARATOR ',')
         FROM table_allocations AS a2
         JOIN dining_tables AS dt2 ON dt2.venue_id = a2.venue_id AND dt2.id = a2.table_id
         WHERE a2.venue_id = dt.venue_id AND a2.visit_id = a.active_visit_id
           AND a2.kind = 'USAGE' AND a2.released_at IS NULL
       ) END AS active_visit_table_codes
     FROM dining_tables AS dt
     JOIN zones AS z ON z.id = dt.zone_id AND z.venue_id = dt.venue_id
     LEFT JOIN (
       SELECT table_id,
         MAX(kind = 'USAGE') AS has_usage,
         MAX(kind = 'HOLD') AS has_hold,
         MAX(CASE WHEN kind = 'USAGE' THEN visit_id END) AS active_visit_id
       FROM table_allocations
       WHERE venue_id = ? AND business_date = ? AND released_at IS NULL
       GROUP BY table_id
     ) AS a ON a.table_id = dt.id
     LEFT JOIN visits AS v ON v.venue_id = dt.venue_id AND v.id = a.active_visit_id AND v.ended_at IS NULL
     WHERE dt.venue_id = ? AND dt.status = 'ACTIVE'
     ORDER BY z.sort_order, dt.id`,
    [actor.venueId, businessDate, actor.venueId],
  )
  return rows.map(toTableView)
}

export interface UpdateTableStateInput {
  tableId: number
  businessDate: string
  state?: TableState
  expectedVersion?: number
  reason?: string
}

export function updateTableState(input: UpdateTableStateInput): Promise<TableView> {
  void input
  return Promise.reject(new AppError(
    409,
    'TABLE_STATE_DERIVED',
    'Trạng thái bàn được cập nhật qua gán bàn, check-in và kết thúc lượt khách.',
  ))
}

export interface ConfigureTableInput {
  tableId: number
  isSpare: boolean
  expectedVersion: number
  reason: string
}

export async function configureTable(actor: AuthenticatedActor, input: ConfigureTableInput): Promise<{
  id: number
  code: string
  isBackup: boolean
  version: number
}> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<(RowDataPacket & { id: number; code: string; is_spare: number; status: string; version: number })[]>(
      `SELECT id, code, is_spare, status, version
       FROM dining_tables
       WHERE organization_id = ? AND venue_id = ? AND id = ?
       FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.tableId],
    )
    const table = rows[0]
    if (!table) throw new AppError(404, 'TABLE_NOT_FOUND', 'Không tìm thấy bàn trong địa điểm hiện tại.')
    if (table.status !== 'ACTIVE') throw new AppError(409, 'TABLE_NOT_ACTIVE', 'Chỉ có thể cấu hình bàn đang hoạt động.')
    if (Number(table.version) !== input.expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Bàn vừa được thay đổi. Vui lòng tải lại.')
    }
    const [allocations] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM table_allocations
       WHERE organization_id = ? AND venue_id = ? AND table_id = ? AND released_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.tableId],
    )
    if (allocations.length) {
      throw new AppError(409, 'TABLE_HAS_OPEN_ALLOCATION', 'Không thể đổi cấu hình khi bàn còn HOLD hoặc đang được sử dụng.')
    }
    if (Boolean(table.is_spare) === input.isSpare) {
      throw new AppError(409, 'TABLE_CONFIGURATION_UNCHANGED', 'Cấu hình bàn không thay đổi.')
    }
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE dining_tables
       SET is_spare = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ? AND status = 'ACTIVE'`,
      [input.isSpare ? 1 : 0, actor.organizationId, actor.venueId, input.tableId, input.expectedVersion],
    )
    if (updated.affectedRows !== 1) throw new AppError(409, 'VERSION_CONFLICT', 'Bàn vừa được thay đổi. Vui lòng tải lại.')
    const [venueRows] = await connection.execute<(RowDataPacket & { change_seq: string })[]>(
      'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE',
      [actor.organizationId, actor.venueId],
    )
    const venue = venueRows[0]
    if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
    const changeSequence = (BigInt(venue.change_seq) + 1n).toString()
    await connection.execute(
      `UPDATE venues SET change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND id = ?`,
      [changeSequence, actor.organizationId, actor.venueId],
    )
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, reason_note, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'TABLE_CONFIGURATION_UPDATED', 'dining_table', ?, ?, ?, ?, 'MANUAL', ?, 0)`,
      [actor.organizationId, actor.venueId, changeSequence, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, input.tableId, input.expectedVersion, input.expectedVersion + 1,
        JSON.stringify([{ type: 'table_spare_configuration', previousIsSpare: Boolean(table.is_spare), isSpare: input.isSpare }]),
        input.reason],
    )
    await connection.commit()
    return { id: input.tableId, code: table.code, isBackup: input.isSpare, version: input.expectedVersion + 1 }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

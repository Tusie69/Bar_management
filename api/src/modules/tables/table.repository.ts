import type { RowDataPacket } from 'mysql2/promise'

import { env } from '../../config/env.js'
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

export async function listTables(businessDate: string): Promise<TableView[]> {
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
    [env.venueId, businessDate, env.venueId],
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

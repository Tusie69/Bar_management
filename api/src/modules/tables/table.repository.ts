import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { canTransitionTableState, type TableState } from './table-state.js'

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
}

interface TableRow extends RowDataPacket {
  id: number
  code: string
  display_name: string
  table_type: TableView['type']
  capacity: number | null
  area_code: string
  area_name: string
  floor_number: number
  position_x: string
  position_y: string
  state: TableState
  is_backup: number
  version: number
}

interface LockedStateRow extends RowDataPacket {
  state: TableState
  is_backup: number
  version: number
}

function toTableView(row: TableRow): TableView {
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    type: row.table_type,
    capacity: row.capacity,
    area: { code: row.area_code, name: row.area_name, floor: row.floor_number },
    position: { x: Number(row.position_x), y: Number(row.position_y) },
    state: row.state,
    isBackup: Boolean(row.is_backup),
    version: row.version,
  }
}

export async function listTables(businessDate: string): Promise<TableView[]> {
  const [rows] = await databasePool.execute<TableRow[]>(
    `SELECT
       t.id, t.code, t.display_name, t.table_type, t.capacity,
       a.code AS area_code, a.name AS area_name, a.floor_number,
       t.position_x, t.position_y,
       COALESCE(ds.state, 'AVAILABLE') AS state,
       COALESCE(ds.is_backup, FALSE) AS is_backup,
       COALESCE(ds.version, 0) AS version
     FROM tables t
     JOIN areas a ON a.id = t.area_id
     LEFT JOIN table_daily_states ds
       ON ds.table_id = t.id AND ds.business_date = ?
     WHERE t.is_active = TRUE AND t.default_visible = TRUE
     ORDER BY a.sort_order, t.sort_order`,
    [businessDate],
  )
  return rows.map(toTableView)
}

export interface UpdateTableStateInput {
  tableId: number
  businessDate: string
  state?: TableState
  isBackup?: boolean
  expectedVersion?: number
  reason?: string
}

async function lockOrCreateDailyState(
  connection: PoolConnection,
  input: UpdateTableStateInput,
): Promise<LockedStateRow> {
  const [tableRows] = await connection.execute<RowDataPacket[]>(
    'SELECT id FROM tables WHERE id = ? AND is_active = TRUE',
    [input.tableId],
  )
  if (!tableRows[0]) throw new AppError(404, 'TABLE_NOT_FOUND', 'Không tìm thấy bàn.')

  await connection.execute(
    `INSERT IGNORE INTO table_daily_states
      (business_date, table_id, state, is_backup, version)
     VALUES (?, ?, 'AVAILABLE', FALSE, 0)`,
    [input.businessDate, input.tableId],
  )
  const [stateRows] = await connection.execute<LockedStateRow[]>(
    `SELECT state, is_backup, version
     FROM table_daily_states
     WHERE business_date = ? AND table_id = ?
     FOR UPDATE`,
    [input.businessDate, input.tableId],
  )
  const state = stateRows[0]
  if (!state) throw new Error('Không thể khởi tạo trạng thái bàn')
  return state
}

export async function updateTableState(input: UpdateTableStateInput): Promise<TableView> {
  const connection = await databasePool.getConnection()

  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
    await connection.beginTransaction()
    const current = await lockOrCreateDailyState(connection, input)

    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Bàn vừa được cập nhật trên thiết bị khác. Vui lòng tải lại.')
    }

    const nextState = input.state ?? current.state
    const nextBackup = input.isBackup ?? Boolean(current.is_backup)
    if (!canTransitionTableState(current.state, nextState)) {
      throw new AppError(400, 'INVALID_TABLE_STATE_TRANSITION', `Không thể chuyển bàn từ ${current.state} sang ${nextState}.`)
    }
    if (nextBackup && nextState !== 'AVAILABLE') {
      throw new AppError(400, 'BACKUP_TABLE_NOT_AVAILABLE', 'Chỉ bàn trống mới có thể bật chế độ sơ cua.')
    }

    await connection.execute(
      `UPDATE table_daily_states
       SET state = ?, is_backup = ?, version = version + 1
       WHERE business_date = ? AND table_id = ?`,
      [nextState, nextBackup, input.businessDate, input.tableId],
    )
    await connection.execute(
      `INSERT INTO table_state_history
       (business_date, table_id, from_state, to_state, from_backup, to_backup, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.businessDate, input.tableId, current.state, nextState, Boolean(current.is_backup), nextBackup, input.reason ?? null],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  const updated = (await listTables(input.businessDate)).find((table) => table.id === input.tableId)
  if (!updated) throw new AppError(404, 'TABLE_NOT_FOUND', 'Không tìm thấy bàn.')
  return updated
}


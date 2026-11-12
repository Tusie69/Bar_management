import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import {
  createTableGroup,
  dissolveUnusedGroups,
  lockAndValidateAssignableTables,
  lockAndValidateSameKindTables,
} from '../tables/table-group.repository.js'
import { lockOccupancyConflicts, type OccupancyIntent } from '../tables/table-occupancy.js'

const supportedActions = new Set([
  'RESERVATION_TABLES_REASSIGNED',
  'RESERVATION_TABLES_MERGED',
  'VISIT_TABLES_MOVED',
  'VISIT_TABLES_MERGED',
])

interface OperationRow extends RowDataPacket {
  id: number
  action: string
  entity_type: 'reservation' | 'visit'
  entity_id: number
  entity_version_after: number
  changes: unknown
  is_undoable: number
  compensated_by: number | null
}

interface EntityRow extends RowDataPacket {
  id: number
  version: number
  business_date: Date | string
  expected_at?: Date | string
  party_size?: number
  guest_count?: number
  status?: string
  ended_at?: Date | string | null
}

interface AllocationRow extends RowDataPacket {
  id: number
  table_id: number
  group_id: number | null
  hold_id?: number
}

interface TableChange {
  previousTableIds: number[]
  newTableIds: number[]
}

export interface UndoStateItem {
  operationId: number
  action: string
  summary: string
}

export interface UndoState {
  undo: UndoStateItem | null
  redo: UndoStateItem | null
}

export interface CompensationResult {
  operationId: number
  changeSeq: number
  summary: string
  undoable: true
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function requireSession(actor: AuthenticatedActor): number {
  if (!actor.authSessionId) {
    throw new AppError(409, 'UNDO_SESSION_REQUIRED', 'Không xác định được phiên đăng nhập của thiết bị này.')
  }
  return actor.authSessionId
}

function baseAction(action: string): string {
  let result = action
  while (result.startsWith('UNDO_') || result.startsWith('REDO_')) result = result.slice(5)
  return result
}

function actionSummary(action: string): string {
  const base = baseAction(action)
  if (base === 'RESERVATION_TABLES_REASSIGNED') return 'đổi bàn booking'
  if (base === 'RESERVATION_TABLES_MERGED') return 'ghép bàn booking'
  if (base === 'VISIT_TABLES_MOVED') return 'đổi bàn lượt khách'
  return 'ghép bàn lượt khách'
}

function parseChange(value: unknown): TableChange {
  let decoded = value
  if (typeof decoded === 'string') decoded = JSON.parse(decoded) as unknown
  const values = Array.isArray(decoded) ? decoded as unknown[] : []
  const first: unknown = values[0] ?? null
  if (!first || typeof first !== 'object') throw new AppError(409, 'NOT_UNDOABLE', 'Nhật ký thao tác không đủ dữ liệu để hoàn tác.')
  const record = first as Record<string, unknown>
  const previousTableIds = Array.isArray(record.previousTableIds) ? record.previousTableIds.map(Number) : []
  const newTableIds = Array.isArray(record.newTableIds)
    ? record.newTableIds.map(Number)
    : Array.isArray(record.tableIds) ? record.tableIds.map(Number) : []
  if (!previousTableIds.length || !newTableIds.length || [...previousTableIds, ...newTableIds].some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new AppError(409, 'NOT_UNDOABLE', 'Nhật ký thao tác không đủ dữ liệu để hoàn tác.')
  }
  return {
    previousTableIds: [...new Set(previousTableIds)].sort((a, b) => a - b),
    newTableIds: [...new Set(newTableIds)].sort((a, b) => a - b),
  }
}

async function latestForSession(connection: PoolConnection, actor: AuthenticatedActor, lock = false): Promise<OperationRow | undefined> {
  const sessionId = requireSession(actor)
  const [rows] = await connection.execute<OperationRow[]>(
    `SELECT o.id, o.action, o.entity_type, o.entity_id, o.entity_version_after, o.changes,
       o.is_undoable, compensation.id AS compensated_by
     FROM operation_log AS o
     LEFT JOIN operation_log AS compensation ON compensation.compensates_operation_id = o.id
     WHERE o.organization_id = ? AND o.venue_id = ? AND o.auth_session_id = ?
       AND o.actor_kind = 'USER'
     ORDER BY o.id DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [actor.organizationId, actor.venueId, sessionId],
  )
  return rows[0]
}

function stateFor(row: OperationRow | undefined): UndoState {
  if (!row || !row.is_undoable || row.compensated_by !== null || !supportedActions.has(baseAction(row.action))) {
    return { undo: null, redo: null }
  }
  const item = { operationId: Number(row.id), action: row.action, summary: actionSummary(row.action) }
  return row.action.startsWith('UNDO_') ? { undo: null, redo: item } : { undo: item, redo: null }
}

export async function getUndoState(actor: AuthenticatedActor): Promise<UndoState> {
  const connection = await databasePool.getConnection()
  try {
    return stateFor(await latestForSession(connection, actor))
  } finally {
    connection.release()
  }
}

async function nextVenueChangeSequence(connection: PoolConnection, actor: AuthenticatedActor): Promise<number> {
  const [rows] = await connection.execute<(RowDataPacket & { change_seq: string })[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE',
    [actor.organizationId, actor.venueId],
  )
  if (!rows[0]) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  const next = BigInt(rows[0].change_seq) + 1n
  await connection.execute(
    'UPDATE venues SET change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE organization_id = ? AND id = ?',
    [next.toString(), actor.organizationId, actor.venueId],
  )
  return Number(next)
}

async function validateTables(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
  guestCount: number,
): Promise<void> {
  const tables = tableIds.length > 1
    ? await lockAndValidateSameKindTables(connection, actor, tableIds)
    : await lockAndValidateAssignableTables(connection, actor, tableIds)
  if (tables.reduce((sum, table) => sum + Number(table.capacity), 0) < guestCount) {
    throw new AppError(409, 'INSUFFICIENT_TABLE_CAPACITY', 'Các bàn cần khôi phục không còn đủ sức chứa.')
  }
}

async function assertNoConflicts(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  intent: OccupancyIntent,
  businessDate: string,
  desiredTableIds: number[],
  currentAllocationIds: number[],
): Promise<void> {
  // Same occupancy policy as every other allocation command, so a compensation
  // cannot restore a table an unreleased carry-over USAGE still holds.
  const rows = await lockOccupancyConflicts(
    connection, actor, intent, desiredTableIds, businessDate, currentAllocationIds,
  )
  if (rows.length) throw new AppError(409, 'UNDO_CONFLICT_MODIFIED', 'Không thể hoàn tác vì bàn cũ đã được sử dụng bởi thao tác khác.')
}

async function compensateReservation(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  operation: OperationRow,
  currentTableIds: number[],
  desiredTableIds: number[],
): Promise<number> {
  const [entities] = await connection.execute<EntityRow[]>(
    `SELECT id, version, business_date, expected_at, party_size, status FROM reservations
     WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, operation.entity_id],
  )
  const entity = entities[0]
  if (!entity || entity.status !== 'BOOKED' || entity.version !== Number(operation.entity_version_after)) {
    throw new AppError(409, 'UNDO_CONFLICT_MODIFIED', 'Booking đã được thay đổi sau thao tác cần hoàn tác.')
  }
  if (entity.expected_at === undefined) {
    throw new AppError(409, 'NOT_UNDOABLE', 'Booking không có đủ dữ liệu thời gian để hoàn tác.')
  }
  const startsAt = entity.expected_at
  const [allocations] = await connection.execute<AllocationRow[]>(
    `SELECT a.id, a.table_id, a.group_id, a.hold_id FROM table_allocations AS a
     JOIN table_holds AS h ON h.venue_id = a.venue_id AND h.id = a.hold_id
     WHERE h.organization_id = ? AND h.venue_id = ? AND h.reservation_id = ?
       AND h.status = 'ACTIVE' AND a.kind = 'HOLD' AND a.released_at IS NULL
     ORDER BY a.table_id, a.id FOR UPDATE`,
    [actor.organizationId, actor.venueId, operation.entity_id],
  )
  const activeIds = allocations.map((row) => Number(row.table_id))
  if (activeIds.length !== currentTableIds.length || activeIds.some((id, index) => id !== currentTableIds[index])) {
    throw new AppError(409, 'UNDO_CONFLICT_MODIFIED', 'Bàn của booking đã được thay đổi sau thao tác cần hoàn tác.')
  }
  const businessDate = dateOnly(entity.business_date)
  await validateTables(connection, actor, desiredTableIds, Number(entity.party_size))
  await assertNoConflicts(connection, actor, 'HOLD', businessDate, desiredTableIds, allocations.map((row) => Number(row.id)))
  await connection.execute(
    `UPDATE table_allocations SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?, release_reason = 'UNDO'
     WHERE organization_id = ? AND venue_id = ? AND kind = 'HOLD' AND released_at IS NULL
       AND id IN (${allocations.map(() => '?').join(',')})`,
    [actor.userId, actor.organizationId, actor.venueId, ...allocations.map((row) => Number(row.id))],
  )
  await connection.execute(
    `UPDATE table_holds SET status = 'RELEASED', released_at = UTC_TIMESTAMP(3), released_by_user_id = ?, release_reason_code = 'UNDO'
     WHERE organization_id = ? AND venue_id = ? AND reservation_id = ? AND status = 'ACTIVE'`,
    [actor.userId, actor.organizationId, actor.venueId, operation.entity_id],
  )
  await dissolveUnusedGroups(connection, actor, allocations.map((row) => row.group_id))
  const [hold] = await connection.execute<ResultSetHeader>(
    `INSERT INTO table_holds (organization_id, venue_id, hold_kind, reservation_id, starts_at, created_by_user_id)
     VALUES (?, ?, 'RESERVATION', ?, ?, ?)`,
    [actor.organizationId, actor.venueId, operation.entity_id, startsAt, actor.userId],
  )
  const group = desiredTableIds.length > 1 ? await createTableGroup(connection, actor, { businessDate }) : null
  for (const tableId of desiredTableIds) {
    await connection.execute(
      `INSERT INTO table_allocations
        (organization_id, venue_id, table_id, kind, hold_id, group_id, starts_at, business_date, created_by_user_id)
       VALUES (?, ?, ?, 'HOLD', ?, ?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, tableId, hold.insertId, group?.id ?? null,
        startsAt, businessDate, actor.userId],
    )
  }
  await connection.execute(
    `UPDATE reservations SET version = version + 1, updated_by_user_id = ?, updated_at = UTC_TIMESTAMP(3)
     WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
    [actor.userId, actor.organizationId, actor.venueId, operation.entity_id, operation.entity_version_after],
  )
  return Number(operation.entity_version_after) + 1
}

async function compensateVisit(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  operation: OperationRow,
  currentTableIds: number[],
  desiredTableIds: number[],
): Promise<number> {
  const [entities] = await connection.execute<EntityRow[]>(
    `SELECT id, version, business_date, guest_count, ended_at FROM visits
     WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, operation.entity_id],
  )
  const entity = entities[0]
  if (!entity || entity.ended_at !== null || entity.version !== Number(operation.entity_version_after)) {
    throw new AppError(409, 'UNDO_CONFLICT_MODIFIED', 'Lượt khách đã được thay đổi sau thao tác cần hoàn tác.')
  }
  const [allocations] = await connection.execute<AllocationRow[]>(
    `SELECT id, table_id, group_id FROM table_allocations
     WHERE organization_id = ? AND venue_id = ? AND visit_id = ? AND kind = 'USAGE' AND released_at IS NULL
     ORDER BY table_id, id FOR UPDATE`,
    [actor.organizationId, actor.venueId, operation.entity_id],
  )
  const activeIds = allocations.map((row) => Number(row.table_id))
  if (activeIds.length !== currentTableIds.length || activeIds.some((id, index) => id !== currentTableIds[index])) {
    throw new AppError(409, 'UNDO_CONFLICT_MODIFIED', 'Bàn của lượt khách đã được thay đổi sau thao tác cần hoàn tác.')
  }
  const businessDate = dateOnly(entity.business_date)
  await validateTables(connection, actor, desiredTableIds, Number(entity.guest_count))
  await assertNoConflicts(connection, actor, 'USAGE', businessDate, desiredTableIds, allocations.map((row) => Number(row.id)))
  await connection.execute(
    `UPDATE table_allocations SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?, release_reason = 'UNDO'
     WHERE organization_id = ? AND venue_id = ? AND visit_id = ? AND kind = 'USAGE' AND released_at IS NULL`,
    [actor.userId, actor.organizationId, actor.venueId, operation.entity_id],
  )
  await dissolveUnusedGroups(connection, actor, allocations.map((row) => row.group_id))
  const group = desiredTableIds.length > 1 ? await createTableGroup(connection, actor, { businessDate }) : null
  for (const tableId of desiredTableIds) {
    await connection.execute(
      `INSERT INTO table_allocations
        (organization_id, venue_id, table_id, kind, visit_id, group_id, starts_at, business_date, created_by_user_id)
       VALUES (?, ?, ?, 'USAGE', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, actor.venueId, tableId, operation.entity_id, group?.id ?? null, businessDate, actor.userId],
    )
  }
  await connection.execute(
    `UPDATE visits SET version = version + 1, updated_at = UTC_TIMESTAMP(3)
     WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
    [actor.organizationId, actor.venueId, operation.entity_id, operation.entity_version_after],
  )
  return Number(operation.entity_version_after) + 1
}

export async function compensateOperation(
  actor: AuthenticatedActor,
  operationId: number,
  mode: 'undo' | 'redo',
  transaction?: PoolConnection,
): Promise<CompensationResult> {
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()
    const latest = await latestForSession(connection, actor, true)
    if (!latest || Number(latest.id) !== operationId) {
      throw new AppError(409, 'NOT_LATEST_DEVICE_OPERATION', 'Chỉ được hoàn tác thao tác mới nhất của thiết bị này.')
    }
    if (!latest.is_undoable || latest.compensated_by !== null || !supportedActions.has(baseAction(latest.action))) {
      throw new AppError(409, 'NOT_UNDOABLE', 'Thao tác này không thể hoàn tác an toàn.')
    }
    if (mode === 'undo' && latest.action.startsWith('UNDO_')) {
      throw new AppError(409, 'REDO_REQUIRED', 'Thao tác mới nhất đang chờ làm lại.')
    }
    if (mode === 'redo' && !latest.action.startsWith('UNDO_')) {
      throw new AppError(409, 'UNDO_REQUIRED', 'Không có thao tác hoàn tác nào để làm lại.')
    }
    const change = parseChange(latest.changes)
    const nextVersion = latest.entity_type === 'reservation'
      ? await compensateReservation(connection, actor, latest, change.newTableIds, change.previousTableIds)
      : await compensateVisit(connection, actor, latest, change.newTableIds, change.previousTableIds)
    const changeSeq = await nextVenueChangeSequence(connection, actor)
    const action = `${mode === 'undo' ? 'UNDO' : 'REDO'}_${baseAction(latest.action)}`
    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         action, entity_type, entity_id, entity_version_before, entity_version_after, changes, reason_code,
         is_undoable, compensates_operation_id)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, 1, ?)`,
      [actor.organizationId, actor.venueId, changeSeq, actor.userId, actor.membershipId, requireSession(actor),
        action, latest.entity_type, latest.entity_id, latest.entity_version_after, nextVersion,
        JSON.stringify([{ type: 'operation_compensation', previousTableIds: change.newTableIds,
          newTableIds: change.previousTableIds, sourceOperationId: latest.id }]),
        mode === 'undo' ? 'UNDO' : 'REDO', latest.id],
    )
    if (ownsTransaction) await connection.commit()
    return {
      operationId: insert.insertId,
      changeSeq,
      summary: `${mode === 'undo' ? 'Đã hoàn tác' : 'Đã làm lại'} ${actionSummary(latest.action)}.`,
      undoable: true,
    }
  } catch (error) {
    if (ownsTransaction) await connection.rollback()
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

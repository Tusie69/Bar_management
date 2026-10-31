import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import {
  createTableGroup,
  dissolveUnusedGroups,
  lockAndValidateSameKindTables,
  lockAndValidateSameZoneTables,
} from '../tables/table-group.repository.js'

export type CloseVisitMode = 'MANUAL' | 'AFTER_PAYMENT'
export type ManualCloseReason = 'GUEST_LEFT' | 'ENTRY_ERROR'

export interface CloseVisitInput {
  visitId: number
  expectedVersion: number
  mode: CloseVisitMode
  reason: ManualCloseReason
  note?: string
}

export interface ClosedVisitView {
  id: number
  businessDate: string
  status: 'CLOSED'
  endedAt: string
  endReason: ManualCloseReason
  version: number
  releasedTables: Array<{ id: number; code: string }>
}

interface LockedVisitRow extends RowDataPacket {
  id: number
  business_date: Date | string
  ended_at: Date | string | null
  version: number
  paid_marked_at: Date | string | null
  guest_count: number
}

interface AllocationRow extends RowDataPacket {
  id: number
  table_id: number
  table_code: string
  business_date: Date | string
  group_id?: number | null
}

interface ClosedVisitRow extends RowDataPacket {
  ended_at: Date | string
  version: number
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

async function assertVisitPermission(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  permissionCode: 'visit.end' | 'visit.move' | 'visit.combine',
): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1
     FROM memberships AS m
     JOIN users AS u ON u.id = m.user_id
     JOIN membership_roles AS mr
       ON mr.organization_id = m.organization_id AND mr.membership_id = m.id
     JOIN role_permissions AS rp ON rp.role_id = mr.role_id
     JOIN permissions AS p ON p.id = rp.permission_id
     WHERE m.organization_id = ? AND m.id = ? AND m.user_id = ?
       AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'
       AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
       AND p.code = ?
     LIMIT 1`,
    [actor.organizationId, actor.membershipId, actor.userId, actor.venueId, permissionCode],
  )
  if (!rows[0]) {
    throw new AppError(
      403,
      permissionCode === 'visit.end'
        ? 'VISIT_END_FORBIDDEN'
        : permissionCode === 'visit.combine'
          ? 'VISIT_COMBINE_FORBIDDEN'
          : 'VISIT_MOVE_FORBIDDEN',
      'Tài khoản không có quyền thực hiện thao tác với lượt khách.',
    )
  }
}

async function nextVenueChangeSequence(connection: PoolConnection, actor: AuthenticatedActor): Promise<string> {
  const [rows] = await connection.execute<(RowDataPacket & { change_seq: string })[]>(
    `SELECT change_seq FROM venues
     WHERE organization_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId],
  )
  const venue = rows[0]
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  const nextSequence = (BigInt(venue.change_seq) + 1n).toString()
  await connection.execute(
    `UPDATE venues SET change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
     WHERE organization_id = ? AND id = ?`,
    [nextSequence, actor.organizationId, actor.venueId],
  )
  return nextSequence
}

export async function closeVisit(
  actor: AuthenticatedActor,
  input: CloseVisitInput,
): Promise<ClosedVisitView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    await assertVisitPermission(connection, actor, 'visit.end')

    if (input.mode === 'AFTER_PAYMENT') {
      throw new AppError(
        409,
        'PAYMENT_VERIFICATION_UNAVAILABLE',
        'Chưa có tích hợp thanh toán đáng tin cậy để tự động trả bàn.',
      )
    }

    const [visitRows] = await connection.execute<LockedVisitRow[]>(
      `SELECT id, business_date, ended_at, version, paid_marked_at, guest_count
       FROM visits
       WHERE organization_id = ? AND venue_id = ? AND id = ?
       FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.visitId],
    )
    const visit = visitRows[0]
    if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách.')
    if (visit.ended_at !== null) throw new AppError(409, 'VISIT_ALREADY_CLOSED', 'Lượt khách đã kết thúc trước đó.')
    if (visit.version !== input.expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Lượt khách vừa được thay đổi. Vui lòng tải lại.')
    }

    const [allocations] = await connection.execute<AllocationRow[]>(
      `SELECT a.id, a.table_id, dt.code AS table_code, a.business_date, a.group_id
       FROM table_allocations AS a
       JOIN dining_tables AS dt ON dt.venue_id = a.venue_id AND dt.id = a.table_id
       WHERE a.organization_id = ? AND a.venue_id = ? AND a.visit_id = ?
         AND a.kind = 'USAGE' AND a.released_at IS NULL
       ORDER BY a.table_id, a.id
       FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.visitId],
    )
    if (!allocations.length) {
      throw new AppError(409, 'VISIT_HAS_NO_ACTIVE_TABLES', 'Lượt khách không còn bàn đang sử dụng để giải phóng.')
    }

    const visitBusinessDate = dateOnly(visit.business_date)
    if (allocations.some((allocation) => dateOnly(allocation.business_date) !== visitBusinessDate)) {
      throw new AppError(409, 'VISIT_ALLOCATION_DATE_MISMATCH', 'Ngày nghiệp vụ của lượt khách và bàn không nhất quán.')
    }

    const [visitUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE visits
       SET ended_at = UTC_TIMESTAMP(3), ended_by_user_id = ?, end_reason = ?,
           updated_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND id = ?
         AND ended_at IS NULL AND version = ?`,
      [actor.userId, input.reason, actor.organizationId, actor.venueId, input.visitId, input.expectedVersion],
    )
    if (visitUpdate.affectedRows !== 1) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Lượt khách vừa được thay đổi. Vui lòng tải lại.')
    }

    const allocationIds = allocations.map((allocation) => allocation.id)
    const placeholders = allocationIds.map(() => '?').join(',')
    const [allocationUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE table_allocations
       SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?, release_reason = ?
       WHERE venue_id = ? AND id IN (${placeholders}) AND released_at IS NULL`,
      [actor.userId, input.reason, actor.venueId, ...allocationIds],
    )
    if (allocationUpdate.affectedRows !== allocationIds.length) {
      throw new AppError(409, 'ALLOCATION_RELEASE_CONFLICT', 'Danh sách bàn vừa được thay đổi. Vui lòng tải lại.')
    }
    await dissolveUnusedGroups(connection, actor, allocations.map((allocation) => allocation.group_id ?? null))

    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, reason_note, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'VISIT_CLOSED', 'visit', ?, ?, ?, ?, 'MANUAL', ?, 0)`,
      [
        actor.organizationId,
        actor.venueId,
        changeSequence,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        input.visitId,
        input.expectedVersion,
        input.expectedVersion + 1,
        JSON.stringify([
          { type: 'visit', id: input.visitId, versionBefore: input.expectedVersion, versionAfter: input.expectedVersion + 1 },
          { type: 'table_allocation', ids: allocationIds },
        ]),
        input.note ?? null,
      ],
    )

    const [closedRows] = await connection.execute<ClosedVisitRow[]>(
      'SELECT ended_at, version FROM visits WHERE venue_id = ? AND id = ?',
      [actor.venueId, input.visitId],
    )
    const closed = closedRows[0]
    if (!closed) throw new AppError(500, 'VISIT_CLOSE_READ_FAILED', 'Không đọc lại được lượt khách vừa kết thúc.')

    await connection.commit()
    return {
      id: input.visitId,
      businessDate: visitBusinessDate,
      status: 'CLOSED',
      endedAt: isoDateTime(closed.ended_at),
      endReason: input.reason,
      version: closed.version,
      releasedTables: allocations.map((allocation) => ({ id: Number(allocation.table_id), code: allocation.table_code })),
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export interface MoveVisitInput {
  visitId: number
  expectedVersion: number
  tableIds: number[]
  note?: string
}

export interface MovedVisitView {
  id: number
  businessDate: string
  version: number
  previousTables: Array<{ id: number; code: string }>
  tables: Array<{ id: number; code: string }>
}

export async function moveVisit(actor: AuthenticatedActor, input: MoveVisitInput): Promise<MovedVisitView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    await assertVisitPermission(connection, actor, 'visit.move')
    const [visitRows] = await connection.execute<LockedVisitRow[]>(
      `SELECT id, business_date, ended_at, version, paid_marked_at, guest_count
       FROM visits WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.visitId],
    )
    const visit = visitRows[0]
    if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách.')
    if (visit.ended_at !== null) throw new AppError(409, 'VISIT_ALREADY_CLOSED', 'Lượt khách đã kết thúc trước đó.')
    if (visit.version !== input.expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Lượt khách vừa được thay đổi. Vui lòng tải lại.')
    }

    const [currentAllocations] = await connection.execute<AllocationRow[]>(
      `SELECT a.id, a.table_id, dt.code AS table_code, a.business_date, a.group_id
       FROM table_allocations AS a
       JOIN dining_tables AS dt ON dt.venue_id = a.venue_id AND dt.id = a.table_id
       WHERE a.organization_id = ? AND a.venue_id = ? AND a.visit_id = ?
         AND a.kind = 'USAGE' AND a.released_at IS NULL
       ORDER BY a.table_id, a.id FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.visitId],
    )
    if (!currentAllocations.length) {
      throw new AppError(409, 'VISIT_HAS_NO_ACTIVE_TABLES', 'Lượt khách không còn bàn đang sử dụng để chuyển.')
    }
    const targetTableIds = [...new Set(input.tableIds)].sort((left, right) => left - right)
    if (!targetTableIds.length) throw new AppError(400, 'TABLE_REQUIRED', 'Cần chọn ít nhất một bàn mới.')
    const currentTableIds = currentAllocations.map((allocation) => Number(allocation.table_id))
    if (
      currentTableIds.length === targetTableIds.length
      && currentTableIds.every((tableId, index) => tableId === targetTableIds[index])
    ) {
      throw new AppError(409, 'TABLE_ASSIGNMENT_UNCHANGED', 'Lượt khách đang sử dụng đúng các bàn đã chọn.')
    }

    const targetPlaceholders = targetTableIds.map(() => '?').join(',')
    const [targetTables] = await connection.execute<(RowDataPacket & { id: number; code: string; is_spare: number; capacity: number })[]>(
      `SELECT id, code, is_spare, capacity FROM dining_tables
       WHERE organization_id = ? AND venue_id = ? AND status = 'ACTIVE' AND id IN (${targetPlaceholders})
       ORDER BY id FOR UPDATE`,
      [actor.organizationId, actor.venueId, ...targetTableIds],
    )
    if (targetTables.length !== targetTableIds.length) {
      throw new AppError(400, 'TABLE_NOT_FOUND', 'Có bàn không tồn tại hoặc ngừng hoạt động.')
    }
    if (targetTableIds.length > 1) await lockAndValidateSameKindTables(connection, actor, targetTableIds)
    const spareTable = targetTables.find((table) => Boolean(table.is_spare))
    if (spareTable) throw new AppError(409, 'SPARE_TABLE_NOT_BOOKABLE', `Bàn ${spareTable.code} là bàn sơ cua và chưa được cấu hình để nhận khách.`)
    const totalCapacity = targetTables.reduce((total, table) => total + Number(table.capacity), 0)
    if (totalCapacity < Number(visit.guest_count)) {
      throw new AppError(
        409,
        'INSUFFICIENT_TABLE_CAPACITY',
        `Các bàn đã chọn chỉ có ${totalCapacity} chỗ cho ${visit.guest_count} khách.`,
      )
    }
    const allocationIds = currentAllocations.map((allocation) => Number(allocation.id))
    const allocationPlaceholders = allocationIds.map(() => '?').join(',')
    const visitBusinessDate = dateOnly(visit.business_date)
    const [conflicts] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM table_allocations
       WHERE organization_id = ? AND venue_id = ? AND released_at IS NULL
         AND table_id IN (${targetPlaceholders})
         AND (kind = 'USAGE' OR business_date = ?)
         AND id NOT IN (${allocationPlaceholders})
       ORDER BY table_id, id FOR UPDATE`,
      [actor.organizationId, actor.venueId, ...targetTableIds, visitBusinessDate, ...allocationIds],
    )
    if (conflicts.length) throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn mới đang được giữ hoặc sử dụng.')

    const [releaseResult] = await connection.execute<ResultSetHeader>(
      `UPDATE table_allocations SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?, release_reason = 'MOVED'
       WHERE organization_id = ? AND venue_id = ? AND visit_id = ? AND kind = 'USAGE' AND released_at IS NULL`,
      [actor.userId, actor.organizationId, actor.venueId, input.visitId],
    )
    if (releaseResult.affectedRows !== currentAllocations.length) {
      throw new AppError(409, 'ALLOCATION_MOVE_CONFLICT', 'Danh sách bàn đang sử dụng vừa được thay đổi.')
    }
    const previousGroupIds = [...new Set(currentAllocations
      .map((allocation) => allocation.group_id ?? null)
      .filter((groupId): groupId is number => groupId !== null))]
    if (previousGroupIds.length > 1) {
      throw new AppError(409, 'GROUP_STATE_INCONSISTENT', 'Visit đang có nhiều group identity.')
    }
    const targetGroupId = targetTableIds.length > 1
      ? previousGroupIds[0] ?? (await createTableGroup(connection, actor, visitBusinessDate)).id
      : null
    const newAllocationIds: number[] = []
    for (const tableId of targetTableIds) {
      const [allocationResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, group_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
        [actor.organizationId, actor.venueId, tableId, input.visitId, targetGroupId, visitBusinessDate, actor.userId],
      )
      newAllocationIds.push(allocationResult.insertId)
    }
    await dissolveUnusedGroups(connection, actor, targetGroupId === null ? previousGroupIds : [])
    const [visitUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE visits SET version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND ended_at IS NULL AND version = ?`,
      [actor.organizationId, actor.venueId, input.visitId, input.expectedVersion],
    )
    if (visitUpdate.affectedRows !== 1) throw new AppError(409, 'VERSION_CONFLICT', 'Lượt khách vừa được thay đổi. Vui lòng tải lại.')

    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, reason_note, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'VISIT_TABLES_MOVED', 'visit', ?, ?, ?, ?, 'MANUAL', ?, 0)`,
      [
        actor.organizationId,
        actor.venueId,
        changeSequence,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        input.visitId,
        input.expectedVersion,
        input.expectedVersion + 1,
        JSON.stringify([{
          type: 'visit_table_move',
          previousAllocationIds: allocationIds,
          previousTableIds: currentTableIds,
          newAllocationIds,
          newTableIds: targetTableIds,
        }]),
        input.note ?? null,
      ],
    )
    await connection.commit()
    return {
      id: input.visitId,
      businessDate: visitBusinessDate,
      version: input.expectedVersion + 1,
      previousTables: currentAllocations.map((allocation) => ({
        id: Number(allocation.table_id), code: allocation.table_code,
      })),
      tables: targetTables.map((table) => ({ id: Number(table.id), code: table.code })),
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function mergeVisitTables(
  actor: AuthenticatedActor,
  input: MoveVisitInput,
): Promise<{ visit: MovedVisitView; group: { id: number; symbolNo: number; tableIds: number[] } }> {
  const connection = await databasePool.getConnection()
  const requested = [...new Set(input.tableIds)].sort((a, b) => a - b)
  try {
    await connection.beginTransaction()
    await assertVisitPermission(connection, actor, 'visit.combine')
    const [visitRows] = await connection.execute<LockedVisitRow[]>(
      `SELECT id, business_date, ended_at, version, paid_marked_at, guest_count FROM visits
       WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.visitId],
    )
    const visit = visitRows[0]
    if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách.')
    if (visit.ended_at) throw new AppError(409, 'VISIT_ALREADY_CLOSED', 'Lượt khách đã kết thúc.')
    if (visit.version !== input.expectedVersion) throw new AppError(409, 'VERSION_CONFLICT', 'Lượt khách vừa được thay đổi.')
    const tables = await lockAndValidateSameZoneTables(connection, actor, requested)
    const [allocations] = await connection.execute<(AllocationRow & { group_id: number | null })[]>(
      `SELECT a.id, a.table_id, dt.code AS table_code, a.business_date, a.group_id
       FROM table_allocations a JOIN dining_tables dt ON dt.venue_id = a.venue_id AND dt.id = a.table_id
       WHERE a.organization_id = ? AND a.venue_id = ? AND a.visit_id = ?
         AND a.kind = 'USAGE' AND a.released_at IS NULL ORDER BY a.table_id FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.visitId],
    )
    if (!allocations.length) throw new AppError(409, 'VISIT_HAS_NO_ACTIVE_TABLES', 'Visit không còn bàn nguồn để ghép.')
    const currentIds = allocations.map((row) => Number(row.table_id))
    if (currentIds.some((id) => !requested.includes(id))) throw new AppError(409, 'MERGE_CANNOT_REMOVE_TABLES', 'Ghép bàn không được loại bỏ bàn đang dùng.')
    const additions = requested.filter((id) => !currentIds.includes(id))
    if (!additions.length) throw new AppError(409, 'TABLE_ASSIGNMENT_UNCHANGED', 'Nhóm bàn không thay đổi.')
    if (tables.reduce((sum, table) => sum + Number(table.capacity), 0) < Number(visit.guest_count)) {
      throw new AppError(409, 'INSUFFICIENT_TABLE_CAPACITY', 'Nhóm bàn không đủ sức chứa.')
    }
    const placeholders = additions.map(() => '?').join(',')
    const [conflicts] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM table_allocations WHERE organization_id = ? AND venue_id = ? AND business_date = ?
       AND released_at IS NULL AND table_id IN (${placeholders}) FOR UPDATE`,
      [actor.organizationId, actor.venueId, dateOnly(visit.business_date), ...additions],
    )
    if (conflicts.length) throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một bàn được chọn đang thuộc nhóm khách khác.')
    const groupIds = [...new Set(allocations.map((row) => row.group_id).filter((id): id is number => id !== null))]
    if (groupIds.length > 1) throw new AppError(409, 'GROUP_STATE_INCONSISTENT', 'Visit đang có nhiều group identity.')
    let group: { id: number; symbolNo: number }
    if (groupIds[0]) {
      const [rows] = await connection.execute<(RowDataPacket & { symbol_no: number })[]>(
        'SELECT symbol_no FROM table_groups WHERE venue_id = ? AND id = ? AND dissolved_at IS NULL FOR UPDATE',
        [actor.venueId, groupIds[0]],
      )
      if (!rows[0]) throw new AppError(409, 'GROUP_STATE_INCONSISTENT', 'Group của visit không còn hoạt động.')
      group = { id: groupIds[0], symbolNo: Number(rows[0].symbol_no) }
    } else {
      group = await createTableGroup(connection, actor, dateOnly(visit.business_date))
      await connection.execute(
        `UPDATE table_allocations SET group_id = ? WHERE venue_id = ? AND id IN (${allocations.map(() => '?').join(',')})`,
        [group.id, actor.venueId, ...allocations.map((row) => Number(row.id))],
      )
    }
    for (const tableId of additions) {
      await connection.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, group_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
        [actor.organizationId, actor.venueId, tableId, input.visitId, group.id, dateOnly(visit.business_date), actor.userId],
      )
    }
    await connection.execute(
      `UPDATE visits SET version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
      [actor.organizationId, actor.venueId, input.visitId, input.expectedVersion],
    )
    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         action, entity_type, entity_id, entity_version_before, entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'VISIT_TABLES_MERGED', 'visit', ?, ?, ?, ?, 'MANUAL', 0)`,
      [actor.organizationId, actor.venueId, changeSequence, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, input.visitId, input.expectedVersion, input.expectedVersion + 1,
        JSON.stringify([{ type: 'table_group', groupId: group.id, previousTableIds: currentIds, tableIds: requested }])],
    )
    await connection.commit()
    return {
      visit: {
        id: input.visitId, businessDate: dateOnly(visit.business_date), version: input.expectedVersion + 1,
        previousTables: allocations.map((row) => ({ id: Number(row.table_id), code: row.table_code })),
        tables: tables.map((table) => ({ id: Number(table.id), code: table.code })),
      },
      group: { ...group, tableIds: requested },
    }
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

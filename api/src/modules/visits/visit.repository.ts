import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

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
}

interface AllocationRow extends RowDataPacket {
  id: number
  table_id: number
  table_code: string
  business_date: Date | string
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

async function assertVisitEndPermission(connection: PoolConnection, actor: AuthenticatedActor): Promise<void> {
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
       AND p.code = 'visit.end'
     LIMIT 1`,
    [actor.organizationId, actor.membershipId, actor.userId, actor.venueId],
  )
  if (!rows[0]) {
    throw new AppError(403, 'VISIT_END_FORBIDDEN', 'Tài khoản không có quyền kết thúc lượt khách.')
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
    await assertVisitEndPermission(connection, actor)

    if (input.mode === 'AFTER_PAYMENT') {
      throw new AppError(
        409,
        'PAYMENT_VERIFICATION_UNAVAILABLE',
        'Chưa có tích hợp thanh toán đáng tin cậy để tự động trả bàn.',
      )
    }

    const [visitRows] = await connection.execute<LockedVisitRow[]>(
      `SELECT id, business_date, ended_at, version, paid_marked_at
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
      `SELECT a.id, a.table_id, dt.code AS table_code, a.business_date
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

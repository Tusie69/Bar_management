import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { applicationNow } from '../../time/application-clock.js'

export interface NoShowCandidate {
  id: number
  version: number
  expectedAt: Date
  createdAt: Date
}

export type NoShowProcessResult = 'WARNED' | 'SKIPPED'

interface LockedCandidateRow extends RowDataPacket {
  id: number
  organization_id: number
  venue_id: number
  status: string
  version: number
  expected_at: Date
  created_at: Date
  no_show_warning_minutes: number
  no_show_warned_at: Date | null
}

function mysqlDateTime(value: Date): string {
  return value.toISOString().slice(0, 23).replace('T', ' ')
}

async function assertSystemPrincipal(connection: PoolConnection, systemUserId: number): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT u.id FROM users AS u
     WHERE u.id = ? AND u.username = 'system_no_show' AND u.status = 'DISABLED'
       AND NOT EXISTS (SELECT 1 FROM memberships AS m WHERE m.user_id = u.id)
     FOR UPDATE`,
    [systemUserId],
  )
  if (!rows[0]) {
    throw new Error('NO_SHOW_SYSTEM_USER_INVALID: cần user system_no_show DISABLED và không có membership')
  }
}

export async function validateNoShowSystemPrincipal(systemUserId: number): Promise<void> {
  const [rows] = await databasePool.execute<RowDataPacket[]>(
    `SELECT u.id FROM users AS u
     WHERE u.id = ? AND u.username = 'system_no_show' AND u.status = 'DISABLED'
       AND NOT EXISTS (SELECT 1 FROM memberships AS m WHERE m.user_id = u.id)`,
    [systemUserId],
  )
  if (!rows[0]) {
    throw new Error('NO_SHOW_SYSTEM_USER_INVALID: cần user system_no_show DISABLED và không có membership')
  }
}

async function nextSystemChangeSequence(
  connection: PoolConnection,
  organizationId: number,
  venueId: number,
  now: Date,
): Promise<string> {
  const [rows] = await connection.execute<(RowDataPacket & { change_seq: string })[]>(
    `SELECT change_seq FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE`,
    [organizationId, venueId],
  )
  const venue = rows[0]
  if (!venue) throw new Error('NO_SHOW_VENUE_NOT_FOUND')
  const next = (BigInt(venue.change_seq) + 1n).toString()
  await connection.execute(
    `UPDATE venues SET change_seq = ?, version = version + 1, updated_at = ?
     WHERE organization_id = ? AND id = ?`,
    [next, mysqlDateTime(now), organizationId, venueId],
  )
  return next
}

export async function listNoShowCandidates(
  organizationId: number,
  venueId: number,
  now: Date,
  automationCutoff: Date,
): Promise<NoShowCandidate[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    id: number
    version: number
    expected_at: Date
    created_at: Date
  })[]>(
    `SELECT r.id, r.version, r.expected_at, r.created_at
     FROM reservations AS r
     JOIN venues AS v ON v.organization_id = r.organization_id AND v.id = r.venue_id
     WHERE r.organization_id = ? AND r.venue_id = ? AND r.status = 'BOOKED'
       AND r.no_show_warned_at IS NULL
       AND r.created_at >= ?
       AND TIMESTAMPADD(MINUTE, v.no_show_warning_minutes, r.expected_at) <= ?
     ORDER BY r.expected_at, r.id`,
    [organizationId, venueId, mysqlDateTime(automationCutoff), mysqlDateTime(now)],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    version: Number(row.version),
    expectedAt: row.expected_at,
    createdAt: row.created_at,
  }))
}

export async function processNoShowCandidate(
  organizationId: number,
  venueId: number,
  systemUserId: number,
  candidate: NoShowCandidate,
  now: Date,
  automationCutoff: Date,
): Promise<NoShowProcessResult> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    await assertSystemPrincipal(connection, systemUserId)
    const [reservationRows] = await connection.execute<LockedCandidateRow[]>(
      `SELECT r.id, r.organization_id, r.venue_id, r.status, r.version, r.expected_at, r.created_at,
         r.no_show_warned_at, v.no_show_warning_minutes
       FROM reservations AS r
       JOIN venues AS v ON v.organization_id = r.organization_id AND v.id = r.venue_id
       WHERE r.organization_id = ? AND r.venue_id = ? AND r.id = ? FOR UPDATE`,
      [organizationId, venueId, candidate.id],
    )
    const reservation = reservationRows[0]
    const expectedAt = reservation?.expected_at instanceof Date ? reservation.expected_at : new Date(0)
    const unchanged = reservation
      && reservation.status === 'BOOKED'
      && Number(reservation.version) === candidate.version
      && expectedAt.getTime() === candidate.expectedAt.getTime()
      && reservation.created_at.getTime() === candidate.createdAt.getTime()
      && reservation.no_show_warned_at === null
      && reservation.created_at.getTime() >= automationCutoff.getTime()
      && expectedAt.getTime() + Number(reservation.no_show_warning_minutes) * 60_000 <= now.getTime()
    if (!unchanged) {
      await connection.rollback()
      return 'SKIPPED'
    }

    const [updateResult] = await connection.execute<ResultSetHeader>(
      `UPDATE reservations SET no_show_warned_at = ?, updated_at = ?
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND status = 'BOOKED'
         AND version = ? AND expected_at = ? AND no_show_warned_at IS NULL`,
      [mysqlDateTime(now), mysqlDateTime(now), organizationId, venueId, candidate.id,
        candidate.version, mysqlDateTime(candidate.expectedAt)],
    )
    if (updateResult.affectedRows !== 1) {
      await connection.rollback()
      return 'SKIPPED'
    }

    const changeSequence = await nextSystemChangeSequence(connection, organizationId, venueId, now)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'SYSTEM', NULL, NULL, NULL, 'RESERVATION_NO_SHOW_WARNING',
         'reservation', ?, ?, ?, ?, 'MANUAL_REVIEW_REQUIRED', 0)`,
      [organizationId, venueId, changeSequence, candidate.id, candidate.version, candidate.version,
        JSON.stringify([{
          type: 'manual_no_show_warning',
          expectedAt: candidate.expectedAt.toISOString(),
          warnedAt: now.toISOString(),
          policy: 'MANUAL',
        }])],
    )
    await connection.commit()
    return 'WARNED'
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function runNoShowSweep(options: {
  organizationId: number
  venueId: number
  systemUserId: number
  now?: Date
  automationCutoff: Date
}): Promise<{ warned: number; skipped: number }> {
  const now = options.now ?? applicationNow()
  await validateNoShowSystemPrincipal(options.systemUserId)
  const candidates = await listNoShowCandidates(
    options.organizationId,
    options.venueId,
    now,
    options.automationCutoff,
  )
  let warned = 0
  let skipped = 0
  for (const candidate of candidates) {
    const result = await processNoShowCandidate(
      options.organizationId,
      options.venueId,
      options.systemUserId,
      candidate,
      now,
      options.automationCutoff,
    )
    if (result === 'WARNED') warned += 1
    else skipped += 1
  }
  return { warned, skipped }
}

export function startNoShowWorker(): () => void {
  if (!env.noShowWorker.enabled || !env.noShowWorker.systemUserId || !env.noShowWorker.automationCutoff) {
    return () => undefined
  }
  const systemUserId = env.noShowWorker.systemUserId
  const automationCutoff = env.noShowWorker.automationCutoff
  let running = false
  const sweep = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      await runNoShowSweep({
        organizationId: env.organizationId,
        venueId: env.venueId,
        systemUserId,
        automationCutoff,
      })
    } catch (error) {
      console.error('No-show worker thất bại; không có thay đổi một phần được commit.', error)
    } finally {
      running = false
    }
  }
  void sweep()
  const timer = setInterval(() => void sweep(), env.noShowWorker.intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

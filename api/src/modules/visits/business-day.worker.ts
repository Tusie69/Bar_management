import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { recordTableTurn } from './table-turn.repository.js'

const supportedTimeZone = 'Asia/Ho_Chi_Minh'
const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const cutoffPattern = /^(\d{2}):(\d{2}):(\d{2})$/

interface CandidateRow extends RowDataPacket {
  id: number
  version: number
  business_date: Date | string
  timezone: string
  cutoff_local: string
}

export interface BusinessDayEndCandidate {
  id: number
  version: number
  businessDate: string
  endsAt: Date
}

export type BusinessDayEndProcessResult = 'CLOSED' | 'SKIPPED'

function mysqlDateTime(value: Date): string {
  return value.toISOString().slice(0, 23).replace('T', ' ')
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

export function businessDayEndInstant(
  businessDate: string,
  timezone: string,
  cutoffLocal: string,
): Date {
  if (timezone !== supportedTimeZone) {
    throw new Error(`BUSINESS_DAY_TIMEZONE_UNSUPPORTED: ${timezone}`)
  }
  const date = calendarDatePattern.exec(businessDate)
  const cutoff = cutoffPattern.exec(cutoffLocal)
  if (!date || !cutoff) throw new Error('BUSINESS_DAY_SCHEDULE_INVALID')
  const year = Number(date[1])
  const month = Number(date[2])
  const day = Number(date[3])
  const hour = Number(cutoff[1])
  const minute = Number(cutoff[2])
  const second = Number(cutoff[3])
  if (hour > 23 || minute > 59 || second > 59) throw new Error('BUSINESS_DAY_SCHEDULE_INVALID')

  // Asia/Ho_Chi_Minh is UTC+07:00. A business date ends at its cutoff on the next calendar day.
  return new Date(Date.UTC(year, month - 1, day + 1, hour - 7, minute, second))
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
  if (!venue) throw new Error('BUSINESS_DAY_VENUE_NOT_FOUND')
  const next = (BigInt(venue.change_seq) + 1n).toString()
  await connection.execute(
    `UPDATE venues SET change_seq = ?, version = version + 1, updated_at = ?
     WHERE organization_id = ? AND id = ?`,
    [next, mysqlDateTime(now), organizationId, venueId],
  )
  return next
}

export async function listBusinessDayEndCandidates(
  organizationId: number,
  venueId: number,
  now: Date,
): Promise<BusinessDayEndCandidate[]> {
  const [rows] = await databasePool.execute<CandidateRow[]>(
    `SELECT vi.id, vi.version, vi.business_date, v.timezone,
       TIME_FORMAT(v.business_day_cutoff_local, '%H:%i:%s') AS cutoff_local
     FROM visits AS vi
     JOIN venues AS v ON v.organization_id = vi.organization_id AND v.id = vi.venue_id
     WHERE vi.organization_id = ? AND vi.venue_id = ? AND vi.ended_at IS NULL
     ORDER BY vi.business_date, vi.id`,
    [organizationId, venueId],
  )
  return rows
    .map((row) => {
      const businessDate = dateOnly(row.business_date)
      return {
        id: Number(row.id),
        version: Number(row.version),
        businessDate,
        endsAt: businessDayEndInstant(businessDate, row.timezone, row.cutoff_local),
      }
    })
    .filter((candidate) => candidate.endsAt.getTime() <= now.getTime())
}

export async function processBusinessDayEndCandidate(
  organizationId: number,
  venueId: number,
  candidate: BusinessDayEndCandidate,
  now: Date,
): Promise<BusinessDayEndProcessResult> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [visitRows] = await connection.execute<CandidateRow[]>(
      `SELECT vi.id, vi.version, vi.business_date, v.timezone,
         TIME_FORMAT(v.business_day_cutoff_local, '%H:%i:%s') AS cutoff_local
       FROM visits AS vi
       JOIN venues AS v ON v.organization_id = vi.organization_id AND v.id = vi.venue_id
       WHERE vi.organization_id = ? AND vi.venue_id = ? AND vi.id = ? AND vi.ended_at IS NULL
       FOR UPDATE`,
      [organizationId, venueId, candidate.id],
    )
    const visit = visitRows[0]
    if (!visit) {
      await connection.rollback()
      return 'SKIPPED'
    }
    const businessDate = dateOnly(visit.business_date)
    const endsAt = businessDayEndInstant(businessDate, visit.timezone, visit.cutoff_local)
    if (
      Number(visit.version) !== candidate.version
      || businessDate !== candidate.businessDate
      || endsAt.getTime() !== candidate.endsAt.getTime()
      || endsAt.getTime() > now.getTime()
    ) {
      await connection.rollback()
      return 'SKIPPED'
    }

    const [allocationRows] = await connection.execute<(RowDataPacket & {
      id: number; table_id: number; table_code: string; group_id: number | null
    })[]>(
      `SELECT a.id, a.table_id, dt.code AS table_code, a.group_id FROM table_allocations AS a
       JOIN dining_tables AS dt ON dt.venue_id = a.venue_id AND dt.id = a.table_id
       WHERE a.organization_id = ? AND a.venue_id = ? AND a.visit_id = ?
         AND a.kind = 'USAGE' AND a.released_at IS NULL
       ORDER BY a.id FOR UPDATE`,
      [organizationId, venueId, candidate.id],
    )
    // C2: the end-of-shift close is recorded in the ledger so a forgotten visit is
    // not lost to statistics, but it is not a receptionist's Trả bàn, so
    // recordTableTurn leaves completed_at null and the badge does not count it.
    const [seatedRows] = await connection.execute<(RowDataPacket & {
      started_at: Date | string; guest_count: number; contact_name: string | null; customer_name: string | null
    })[]>(
      `SELECT v.started_at, v.guest_count, v.contact_name, c.display_name AS customer_name
       FROM visits AS v
       LEFT JOIN customers AS c ON c.organization_id = v.organization_id AND c.id = v.customer_id
       WHERE v.organization_id = ? AND v.venue_id = ? AND v.id = ?`,
      [organizationId, venueId, candidate.id],
    )
    const seated = seatedRows[0]
    const timestamp = mysqlDateTime(now)
    await connection.execute(
      `UPDATE table_allocations
       SET released_at = ?, released_by_user_id = NULL, release_reason = 'BUSINESS_DAY_END'
       WHERE organization_id = ? AND venue_id = ? AND visit_id = ?
         AND kind = 'USAGE' AND released_at IS NULL`,
      [timestamp, organizationId, venueId, candidate.id],
    )
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE visits SET ended_at = ?, ended_by_user_id = NULL, end_reason = 'BUSINESS_DAY_END',
         updated_at = ?, version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND ended_at IS NULL AND version = ?`,
      [timestamp, timestamp, organizationId, venueId, candidate.id, candidate.version],
    )
    if (updated.affectedRows !== 1) {
      await connection.rollback()
      return 'SKIPPED'
    }

    if (seated && allocationRows.length) {
      await recordTableTurn(connection, { organizationId, venueId }, {
        visitId: candidate.id,
        businessDate,
        allocations: allocationRows.map((row) => ({
          tableId: Number(row.table_id),
          tableCode: row.table_code,
          groupId: row.group_id ?? null,
        })),
        seatedAt: seated.started_at,
        releasedAt: now,
        guestCount: Number(seated.guest_count),
        guestName: seated.contact_name ?? seated.customer_name ?? 'Khách',
        endReason: 'BUSINESS_DAY_END',
        closedByUserId: null,
      })
    }

    const groupIds = [...new Set(allocationRows
      .map((row) => row.group_id)
      .filter((id): id is number => id !== null))].sort((left, right) => left - right)
    for (const groupId of groupIds) {
      await connection.execute(
        // origin = 'CLAIM' only: C1 (anh Luân, 08/11/2026) requires a LAYOUT cluster
        // to survive the business-day rollover, so the worker never touches one.
        `UPDATE table_groups AS g SET dissolved_at = ?, dissolved_by_user_id = NULL, dissolve_reason = 'BUSINESS_DAY_END'
         WHERE g.organization_id = ? AND g.venue_id = ? AND g.id = ? AND g.dissolved_at IS NULL
           AND g.origin = 'CLAIM'
           AND NOT EXISTS (
             SELECT 1 FROM table_allocations AS a
             WHERE a.organization_id = g.organization_id AND a.venue_id = g.venue_id
               AND a.group_id = g.id AND a.released_at IS NULL
           )`,
        [timestamp, organizationId, venueId, groupId],
      )
    }
    // Check-in already closed linked waitlist entries as SEATED with its own audit.
    // Ending the visit preserves that terminal history and the CHECKED_IN reservation.
    const changeSequence = await nextSystemChangeSequence(connection, organizationId, venueId, now)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'SYSTEM', NULL, NULL, NULL, 'VISIT_AUTO_CLOSED_BUSINESS_DAY',
         'visit', ?, ?, ?, ?, 'BUSINESS_DAY_END', 0)`,
      [organizationId, venueId, changeSequence, candidate.id, candidate.version, candidate.version + 1,
        JSON.stringify([{
          type: 'automatic_business_day_close',
          businessDate,
          endedAt: now.toISOString(),
          allocationIds: allocationRows.map((row) => Number(row.id)),
          tableIds: allocationRows.map((row) => Number(row.table_id)),
          groupIds: groupIds.map(Number),
        }])],
    )
    await connection.commit()
    return 'CLOSED'
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function runBusinessDayEndSweep(options: {
  organizationId: number
  venueId: number
  now?: Date
}): Promise<{ closed: number; skipped: number }> {
  const now = options.now ?? new Date()
  const candidates = await listBusinessDayEndCandidates(options.organizationId, options.venueId, now)
  let closed = 0
  let skipped = 0
  for (const candidate of candidates) {
    const result = await processBusinessDayEndCandidate(
      options.organizationId,
      options.venueId,
      candidate,
      now,
    )
    if (result === 'CLOSED') closed += 1
    else skipped += 1
  }
  return { closed, skipped }
}

export function startBusinessDayEndWorker(): () => void {
  if (!env.businessDayWorker.enabled) return () => undefined
  let running = false
  const sweep = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      await runBusinessDayEndSweep({
        organizationId: env.organizationId,
        venueId: env.venueId,
      })
    } catch (error) {
      console.error('Business-day worker thất bại; không có thay đổi một phần được commit.', error)
    } finally {
      running = false
    }
  }
  void sweep()
  const timer = setInterval(() => void sweep(), env.businessDayWorker.intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

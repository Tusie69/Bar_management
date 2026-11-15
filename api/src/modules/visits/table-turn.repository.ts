/**
 * C2 — ghi nhận lượt khách (table turn ledger).
 *
 * A table or a cluster earns +1 turn when both are true: it was IN_USE, and the
 * receptionist completed Trả bàn. Check-in records the moment the party sat down
 * (visits.started_at); closing the visit is what closes the turn, so the ledger is
 * written inside the close transaction and never from a separate call.
 *
 * Everything the turn needs is snapshotted at that moment: editing the booking or
 * splitting the cluster afterwards cannot change what the ledger says happened.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { AppError } from '../../errors/app-error.js'
import { databasePool } from '../../database/pool.js'
import { groupDisplayCode } from '../tables/floor-projection.repository.js'

export type TurnScope = 'TABLE' | 'GROUP'

/** The allocations a visit held, as the close path already has them in hand. */
export interface ClosingAllocation {
  tableId: number
  tableCode: string
  groupId: number | null
}

export interface RecordTurnInput {
  visitId: number
  businessDate: string
  allocations: ClosingAllocation[]
  seatedAt: Date | string
  releasedAt: Date | string
  guestCount: number
  guestName: string
  endReason: string
  /** Null for the business-day worker, which acts with no user. */
  closedByUserId: number | null
}

export interface RecordedTurn {
  turnId: number
  scope: TurnScope
  scopeKey: number
  turnNo: number
  counted: boolean
}

/**
 * A turn counts only when the close was a real Trả bàn. The business-day worker
 * closing a forgotten visit, an entry correction and a merge all leave history
 * behind without claiming the table served another party.
 *
 * [?] Whether the end-of-shift auto-close should count is not confirmed; the row
 * is written either way, so flipping this is a one-line change, not a backfill.
 */
function countsAsServed(endReason: string): boolean {
  return endReason === 'GUEST_LEFT' || endReason === 'AFTER_PAYMENT'
}

function mysqlDateTime(value: Date | string): string {
  const instant = value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`)
  return instant.toISOString().slice(0, 23).replace('T', ' ')
}

interface ScopeRow extends RowDataPacket {
  id: number
  origin: 'CLAIM' | 'LAYOUT'
  symbol_no: number
  name: string | null
}

/**
 * Which identity the turn belongs to.
 *
 * A LAYOUT cluster has a lasting identity, so B3+B4+B5 earns one turn for the
 * cluster and never one per member. Anything else is counted against a table: its
 * own table when the party sat alone, or the lowest member id for an ad-hoc CLAIM
 * grouping, whose id is thrown away on close and so cannot carry an ordinal from
 * one party to the next.
 */
async function resolveScope(
  connection: PoolConnection,
  actor: { organizationId: number; venueId: number },
  allocations: ClosingAllocation[],
): Promise<{ scope: TurnScope; tableId: number | null; groupId: number | null; groupCode: string | null }> {
  const groupIds = [...new Set(allocations.map((row) => row.groupId).filter((id): id is number => id !== null))]
  if (groupIds.length === 1) {
    const [rows] = await connection.execute<ScopeRow[]>(
      'SELECT id, origin, symbol_no, name FROM table_groups WHERE organization_id = ? AND venue_id = ? AND id = ?',
      [actor.organizationId, actor.venueId, groupIds[0]!],
    )
    const group = rows[0]
    if (group && group.origin === 'LAYOUT') {
      return {
        scope: 'GROUP',
        tableId: null,
        groupId: Number(group.id),
        groupCode: group.name ?? groupDisplayCode(Number(group.symbol_no)),
      }
    }
  }
  const anchor = Math.min(...allocations.map((row) => row.tableId))
  return { scope: 'TABLE', tableId: anchor, groupId: null, groupCode: null }
}

/**
 * Writes the turn for a visit that just closed. Runs inside the caller's
 * transaction, so a rolled-back close leaves no turn behind.
 *
 * Returns null when a turn already exists for this visit: a repeated Close Visit
 * must not add a second turn, and uq_turn_visit makes that true even when two
 * devices race, because the loser's insert is refused by the database rather than
 * by a check this code performed first.
 */
export async function recordTableTurn(
  connection: PoolConnection,
  actor: { organizationId: number; venueId: number },
  input: RecordTurnInput,
): Promise<RecordedTurn | null> {
  if (!input.allocations.length) return null

  const [existing] = await connection.execute<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM table_turns WHERE venue_id = ? AND visit_id = ? FOR UPDATE',
    [actor.venueId, input.visitId],
  )
  if (existing.length) return null

  const scope = await resolveScope(connection, actor, input.allocations)
  const scopeKey = scope.scope === 'GROUP' ? scope.groupId! : scope.tableId!

  const nextOrdinal = async (): Promise<number> => {
    // Deliberately not FOR UPDATE. A locking read here takes a gap lock on
    // table_turns, and the close path then takes the venue row for change_seq, so
    // two devices closing two unrelated visits deadlocked against each other.
    // uq_turn_ordinal is what actually guarantees the ordinal, and the insert
    // below retries on a collision, so correctness never depends on this read.
    const [rows] = await connection.execute<(RowDataPacket & { next_no: number })[]>(
      `SELECT COALESCE(MAX(turn_no), 0) + 1 AS next_no FROM table_turns
       WHERE venue_id = ? AND business_date = ? AND scope = ? AND scope_key = ?`,
      [actor.venueId, input.businessDate, scope.scope, scopeKey],
    )
    return Number(rows[0]?.next_no ?? 1)
  }

  const memberTableIds = [...new Set(input.allocations.map((row) => row.tableId))].sort((a, b) => a - b)
  const tableCodes = memberTableIds.map(
    (tableId) => input.allocations.find((row) => row.tableId === tableId)!.tableCode,
  )
  const counted = countsAsServed(input.endReason)
  const releasedAt = mysqlDateTime(input.releasedAt)

  // The booking behind this visit, for the source and for tracing the turn back.
  const [reservationRows] = await connection.execute<(RowDataPacket & { id: number; source_code: string | null })[]>(
    `SELECT r.id, bs.code AS source_code
     FROM reservations AS r
     LEFT JOIN booking_sources AS bs ON bs.organization_id = r.organization_id AND bs.id = r.source_id
     WHERE r.organization_id = ? AND r.venue_id = ? AND r.visit_id = ?
     LIMIT 1`,
    [actor.organizationId, actor.venueId, input.visitId],
  )
  const reservation = reservationRows[0] ?? null

  const [visitRows] = await connection.execute<(RowDataPacket & { origin: string })[]>(
    'SELECT origin FROM visits WHERE organization_id = ? AND venue_id = ? AND id = ?',
    [actor.organizationId, actor.venueId, input.visitId],
  )
  const origin = visitRows[0]?.origin ?? 'WALK_IN'

  const insertTurn = async (turnNo: number): Promise<ResultSetHeader> => {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO table_turns
        (organization_id, venue_id, business_date, scope, table_id, group_id, turn_no,
         visit_id, reservation_id, table_codes_snapshot, member_table_ids, group_code_snapshot,
         guest_name, guest_count, source_code, origin, seated_at, released_at, end_reason,
         completed_at, closed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.organizationId,
        actor.venueId,
        input.businessDate,
        scope.scope,
        scope.tableId,
        scope.groupId,
        turnNo,
        input.visitId,
        reservation ? Number(reservation.id) : null,
        JSON.stringify(tableCodes),
        JSON.stringify(memberTableIds),
        scope.groupCode,
        input.guestName,
        input.guestCount,
        reservation?.source_code ?? null,
        origin,
        mysqlDateTime(input.seatedAt),
        releasedAt,
        input.endReason,
        counted ? releasedAt : null,
        input.closedByUserId,
      ],
    )
    return result
  }

  // One attempt per ordinal another device took while we were reading. A duplicate
  // key is a statement error, not a transaction abort, so the retry stays inside
  // the caller's transaction and the close is still all-or-nothing.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const turnNo = await nextOrdinal()
    try {
      const inserted = await insertTurn(turnNo)
      return { turnId: inserted.insertId, scope: scope.scope, scopeKey, turnNo, counted }
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      const message = (error as { sqlMessage?: string } | null)?.sqlMessage ?? ''
      if (code !== 'ER_DUP_ENTRY') throw error
      // Another device committed this visit's turn first. One visit is one turn,
      // which is the rule, so there is nothing left to write.
      if (message.includes('uq_turn_visit')) return null
      if (!message.includes('uq_turn_ordinal')) throw error
    }
  }
  throw new AppError(409, 'TURN_ORDINAL_CONFLICT', 'Lượt khách vừa được ghi trên máy khác. Vui lòng thử lại.')
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

export interface TurnCounts {
  byTable: Map<number, number>
  byGroup: Map<number, number>
}

/**
 * Completed turns for one operating day, for the floor badge. Counts only turns
 * that count, so a visit auto-closed at the end of the shift does not inflate the
 * badge even though its row is in the ledger.
 */
export async function completedTurnCounts(
  connection: PoolConnection,
  actor: { organizationId: number; venueId: number },
  businessDate: string,
): Promise<TurnCounts> {
  const [rows] = await connection.execute<(RowDataPacket & { scope: TurnScope; scope_key: number; total: number })[]>(
    `SELECT scope, scope_key, COUNT(*) AS total FROM table_turns
     WHERE organization_id = ? AND venue_id = ? AND business_date = ? AND completed_at IS NOT NULL
     GROUP BY scope, scope_key`,
    [actor.organizationId, actor.venueId, businessDate],
  )
  const byTable = new Map<number, number>()
  const byGroup = new Map<number, number>()
  for (const row of rows) {
    const target = row.scope === 'GROUP' ? byGroup : byTable
    target.set(Number(row.scope_key), Number(row.total))
  }
  return { byTable, byGroup }
}

export interface TurnView {
  turnId: number
  turnNo: number
  businessDate: string
  scope: TurnScope
  /** The cluster code at the time of the turn, or null for a single table. */
  groupCode: string | null
  groupId: number | null
  tableId: number | null
  tableCodes: string[]
  memberTableIds: number[]
  guestName: string
  guestCount: number
  sourceCode: string | null
  origin: string
  seatedAt: string
  releasedAt: string
  endReason: string
  counted: boolean
  visitId: number
  reservationId: number | null
  closedByUserId: number | null
  closedByDisplayName: string | null
}

export interface TurnQuery {
  from: string
  to: string
  page: number
  pageSize: number
  /** Only turns that count as served; the default, which is what statistics mean. */
  countedOnly: boolean
  closedByUserId?: number
}
type TurnFilters = Pick<TurnQuery, 'from' | 'to' | 'countedOnly' | 'closedByUserId'>
export interface TurnSummary {
  from: string
  to: string
  completedTotal: number
  guestTotal: number
  byBusinessDate: { businessDate: string; turns: number; guests: number }[]
  byStaff: { closedByUserId: number | null; closedByDisplayName: string | null; turns: number; guests: number }[]
  byScope: { scope: TurnScope; tableId: number | null; groupId: number | null; label: string; turns: number; guests: number }[]
}

export interface TurnQueryResult {
  from: string
  to: string
  page: number
  pageSize: number
  total: number
  /** Turns that count as served in the range, whatever this page shows. */
  completedTotal: number
  guestTotal: number
  turns: TurnView[]
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function isoDateTime(value: Date | string): string {
  return (value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`)).toISOString()
}

function parseJsonArray(value: unknown): number[] {
  const decoded: unknown = typeof value === 'string' ? JSON.parse(value) : value
  return Array.isArray(decoded) ? decoded.map(Number) : []
}

function parseJsonStrings(value: unknown): string[] {
  const decoded: unknown = typeof value === 'string' ? JSON.parse(value) : value
  return Array.isArray(decoded) ? decoded.map(String) : []
}

interface TurnRow extends RowDataPacket {
  id: number
  turn_no: number
  business_date: Date | string
  scope: TurnScope
  table_id: number | null
  group_id: number | null
  group_code_snapshot: string | null
  table_codes_snapshot: unknown
  member_table_ids: unknown
  guest_name: string
  guest_count: number
  source_code: string | null
  origin: string
  seated_at: Date | string
  released_at: Date | string
  end_reason: string
  completed_at: Date | string | null
  visit_id: number
  reservation_id: number | null
  closed_by_user_id: number | null
  closed_by_display_name: string | null
}
function turnFilter(actor: { organizationId: number; venueId: number }, query: TurnFilters) {
  return {
    sql: `t.organization_id = ? AND t.venue_id = ? AND t.business_date BETWEEN ? AND ?
      ${query.countedOnly ? 'AND t.completed_at IS NOT NULL' : ''}
      ${query.closedByUserId === undefined ? '' : 'AND t.closed_by_user_id = ?'}`,
    values: [actor.organizationId, actor.venueId, query.from, query.to,
      ...(query.closedByUserId === undefined ? [] : [query.closedByUserId])],
  }
}
// Retain historical names after role revocation, while requiring an org/venue association.
const closingUserJoin = `LEFT JOIN users u ON u.id = t.closed_by_user_id AND EXISTS (
  SELECT 1 FROM memberships m JOIN membership_roles mr
    ON mr.membership_id = m.id AND mr.organization_id = m.organization_id
  WHERE m.user_id = u.id AND m.organization_id = t.organization_id
    AND (mr.venue_id = t.venue_id OR mr.venue_id IS NULL)
)`

/** Turns over a range of operating days. Built for statistics in a later sprint. */
export async function listTableTurns(
  actor: { organizationId: number; venueId: number },
  query: TurnQuery,
): Promise<TurnQueryResult> {
  const connection = await databasePool.getConnection()
  try {
    const filter = turnFilter(actor, query)
    const [totals] = await connection.execute<(RowDataPacket & {
      total: number; completed_total: number; guest_total: number
    })[]>(
      `SELECT COUNT(*) AS total,
         COUNT(completed_at) AS completed_total,
         COALESCE(SUM(IF(completed_at IS NOT NULL, guest_count, 0)), 0) AS guest_total
       FROM table_turns t WHERE ${filter.sql}`,
      filter.values,
    )
    const offset = (query.page - 1) * query.pageSize
    const [rows] = await connection.execute<TurnRow[]>(
      `SELECT t.id, turn_no, business_date, scope, table_id, group_id, group_code_snapshot,
         table_codes_snapshot, member_table_ids, guest_name, guest_count, source_code, origin,
         seated_at, released_at, end_reason, completed_at, visit_id, reservation_id,
         closed_by_user_id, u.display_name AS closed_by_display_name
       FROM table_turns t ${closingUserJoin}
       WHERE ${filter.sql}
       ORDER BY business_date DESC, t.id DESC
       LIMIT ${query.pageSize} OFFSET ${offset}`,
      filter.values,
    )
    return {
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(totals[0]?.total ?? 0),
      completedTotal: Number(totals[0]?.completed_total ?? 0),
      guestTotal: Number(totals[0]?.guest_total ?? 0),
      turns: rows.map((row) => ({
        turnId: Number(row.id),
        turnNo: Number(row.turn_no),
        businessDate: dateOnly(row.business_date),
        scope: row.scope,
        groupCode: row.group_code_snapshot,
        groupId: row.group_id === null ? null : Number(row.group_id),
        tableId: row.table_id === null ? null : Number(row.table_id),
        tableCodes: parseJsonStrings(row.table_codes_snapshot),
        memberTableIds: parseJsonArray(row.member_table_ids),
        guestName: row.guest_name,
        guestCount: Number(row.guest_count),
        sourceCode: row.source_code,
        origin: row.origin,
        seatedAt: isoDateTime(row.seated_at),
        releasedAt: isoDateTime(row.released_at),
        endReason: row.end_reason,
        counted: row.completed_at !== null,
        visitId: Number(row.visit_id),
        reservationId: row.reservation_id === null ? null : Number(row.reservation_id),
        closedByUserId: row.closed_by_user_id === null ? null : Number(row.closed_by_user_id),
        closedByDisplayName: row.closed_by_display_name,
      })),
    }
  } finally {
    connection.release()
  }
}

export async function summarizeTableTurns(
  actor: { organizationId: number; venueId: number },
  query: TurnFilters,
): Promise<TurnSummary> {
  const filter = turnFilter(actor, query)
  const connection = await databasePool.getConnection()
  type AggregateRow = RowDataPacket & { turns: number; guests: number }
  try {
    const [totals] = await connection.execute<AggregateRow[]>(
      `SELECT COUNT(t.completed_at) AS turns,
        COALESCE(SUM(IF(t.completed_at IS NOT NULL, t.guest_count, 0)), 0) AS guests
       FROM table_turns t WHERE ${filter.sql}`, filter.values,
    )
    const [dates] = await connection.execute<(AggregateRow & { business_date: Date | string })[]>(
      `SELECT t.business_date, COUNT(*) AS turns, SUM(t.guest_count) AS guests
       FROM table_turns t WHERE ${filter.sql} GROUP BY t.business_date ORDER BY t.business_date`, filter.values,
    )
    const [staff] = await connection.execute<(AggregateRow & {
      closed_by_user_id: number | null; display_name: string | null
    })[]>(
      `SELECT t.closed_by_user_id, u.display_name, COUNT(*) AS turns, SUM(t.guest_count) AS guests
       FROM table_turns t ${closingUserJoin} WHERE ${filter.sql}
       GROUP BY t.closed_by_user_id, u.display_name
       ORDER BY turns DESC, u.display_name, t.closed_by_user_id`, filter.values,
    )
    const [scopes] = await connection.execute<(AggregateRow & {
      scope: TurnScope; table_id: number | null; group_id: number | null
      group_code_snapshot: string | null; table_codes_snapshot: unknown
    })[]>(
      `SELECT a.scope, a.table_id, a.group_id, a.turns, a.guests,
         latest.group_code_snapshot, latest.table_codes_snapshot
       FROM (
         SELECT t.scope,
           CASE WHEN t.scope = 'TABLE' THEN t.table_id ELSE NULL END AS table_id,
           CASE WHEN t.scope = 'GROUP' THEN t.group_id ELSE NULL END AS group_id,
           COUNT(*) AS turns, SUM(t.guest_count) AS guests, MAX(t.id) AS latest_id
         FROM table_turns t WHERE ${filter.sql}
         GROUP BY t.scope, CASE WHEN t.scope = 'TABLE' THEN t.table_id ELSE NULL END,
           CASE WHEN t.scope = 'GROUP' THEN t.group_id ELSE NULL END
       ) a JOIN table_turns latest ON latest.id = a.latest_id
         AND latest.organization_id = ? AND latest.venue_id = ?`,
      [...filter.values, actor.organizationId, actor.venueId],
    )
    return {
      from: query.from, to: query.to,
      completedTotal: Number(totals[0]?.turns ?? 0),
      guestTotal: Number(totals[0]?.guests ?? 0),
      byBusinessDate: dates.map((row) => ({
        businessDate: dateOnly(row.business_date), turns: Number(row.turns), guests: Number(row.guests),
      })),
      byStaff: staff.map((row) => ({
        closedByUserId: row.closed_by_user_id === null ? null : Number(row.closed_by_user_id),
        closedByDisplayName: row.display_name, turns: Number(row.turns), guests: Number(row.guests),
      })),
      byScope: scopes.map((row) => ({
        scope: row.scope,
        tableId: row.table_id === null ? null : Number(row.table_id),
        groupId: row.group_id === null ? null : Number(row.group_id),
        label: (row.scope === 'GROUP' ? row.group_code_snapshot : null)
          ?? parseJsonStrings(row.table_codes_snapshot).join(' + '),
        turns: Number(row.turns), guests: Number(row.guests),
      })).sort((a, b) => b.turns - a.turns || a.label.localeCompare(b.label)),
    }
  } finally {
    connection.release()
  }
}

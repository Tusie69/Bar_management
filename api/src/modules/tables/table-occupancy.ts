/**
 * BE-01 / BF-03 — the single occupancy policy for allocating tables.
 *
 * Every command that allocates a table asks the same question, so they all ask
 * it here, with the predicate the floor projection already applies when it
 * reads. Keeping one policy on both sides is the point: the two bugs were a
 * floor that offered a table the API refused, and a floor that showed a table
 * in use while the API handed it out.
 *
 *   - an unreleased `HOLD` blocks only the business date being allocated, so
 *     each operating day is planned independently;
 *   - an unreleased `USAGE` always blocks a command that seats a party now
 *     (`intent: 'USAGE'`), whatever date it carries, because the party is
 *     physically on the table — and the unique active-usage key makes it
 *     impossible anyway;
 *   - for a command that only plans a day (`intent: 'HOLD'`), an unreleased
 *     `USAGE` blocks the dates it is relevant to: the current or a past
 *     operating day carries it over, while planning a later day sees only a
 *     USAGE of that same day, exactly as the floor projection reads it.
 *
 * No release time is ever inferred. A party still on a table blocks seating
 * today because nothing tells us when it leaves; planning a later day stays
 * under the approved planning rule, which `future-floor-projection` covers.
 *
 * Before this existed, `createWalkIn` blocked on any unreleased allocation of
 * any date (BE-01: tomorrow's hold refused a guest standing at the counter) and
 * the create-and-assign, assign, merge and seat paths filtered on business date
 * alone (BF-03: an unreleased carry-over USAGE did not block today's booking,
 * and merging a visit onto such a table leaked a raw unique-key error).
 * `moveVisit` already carried most of the right predicate; this generalises it.
 *
 * The helper only reads `table_allocations`, with the same `FOR UPDATE` the call
 * sites already used, so it does not widen any transaction's lock footprint, and
 * callers keep their own error code and message.
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { businessDateAt } from '../bookings/business-date.js'
import { applicationNow } from '../../time/application-clock.js'

/** What the calling command is about to allocate. */
export type OccupancyIntent = 'HOLD' | 'USAGE'

export interface OccupancyConflict extends RowDataPacket {
  id: number
  table_id: number
  kind: 'HOLD' | 'USAGE'
  business_date: Date | string
}

/**
 * Locks and returns the allocations that block `tableIds` on `businessDate`.
 *
 * `intent` says whether the command seats a party now or only plans a day.
 * `excludeAllocationIds` lets a command ignore allocations it already owns, such
 * as a booking keeping its own tables while its schedule is edited. `now` decides
 * which operating day is current, so a caller that already has an injected clock
 * should pass it; the rest use the application clock.
 */
export async function lockOccupancyConflicts(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  intent: OccupancyIntent,
  tableIds: number[],
  businessDate: string,
  excludeAllocationIds: number[] = [],
  now: Date = applicationNow(),
): Promise<OccupancyConflict[]> {
  if (!tableIds.length) return []
  const currentBusinessDate = businessDateAt(now)
  const tablePlaceholders = tableIds.map(() => '?').join(',')
  const exclusion = excludeAllocationIds.length
    ? ` AND a.id NOT IN (${excludeAllocationIds.map(() => '?').join(',')})`
    : ''
  // Seating now: any unreleased USAGE blocks. Planning a day: only a USAGE this
  // date would actually carry, which is how the floor projection reads it.
  const usageClause = intent === 'USAGE'
    ? "a.kind = 'USAGE'"
    : "(a.kind = 'USAGE' AND a.business_date <= ? AND (? <= ? OR a.business_date = ?))"
  const usageValues = intent === 'USAGE'
    ? []
    : [businessDate, businessDate, currentBusinessDate, businessDate]
  const [rows] = await connection.execute<OccupancyConflict[]>(
    `SELECT a.id, a.table_id, a.kind, a.business_date
     FROM table_allocations AS a
     WHERE a.organization_id = ? AND a.venue_id = ? AND a.released_at IS NULL
       AND a.table_id IN (${tablePlaceholders})
       AND (${usageClause} OR (a.kind = 'HOLD' AND a.business_date = ?))${exclusion}
     ORDER BY a.table_id, a.id
     FOR UPDATE`,
    [
      actor.organizationId, actor.venueId, ...tableIds,
      ...usageValues, businessDate,
      ...excludeAllocationIds,
    ],
  )
  return rows
}

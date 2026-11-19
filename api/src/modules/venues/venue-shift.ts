/**
 * TU-38 — the operating shift of a venue, read from its own row instead of assumed.
 *
 * `venues.business_day_start_local` and `business_day_cutoff_local` have always been the
 * source of truth for when a business day opens and when it ends, but the booking rules in
 * `business-date.ts` held the pair as the constants 17 and 5. Two venues on one deployment,
 * or one venue changing its hours, would have had the booking window silently disagree with
 * the stored configuration.
 *
 * Why a cache: every booking create, check-in, walk-in and waitlist call needs the shift, and
 * the two columns change about as often as the venue is rebuilt. One row per venue is kept in
 * process for `shiftCacheTtlMs`, and `invalidateVenueShift` drops it the moment a write
 * touches the venue, so a changed shift takes effect without waiting for the TTL.
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

export interface VenueShift {
  /** "HH:MM:SS" exactly as the column stores it. */
  startLocal: string
  cutoffLocal: string
  /** Whole hour of each boundary, which is what the business-date arithmetic needs. */
  startHour: number
  cutoffHour: number
  timeZone: string
}

/**
 * What the schema seeds a venue with, and the only shift used when no venue row is in hand —
 * a pure helper called without one, which keeps those helpers usable in isolation and in unit
 * tests. Every request path resolves the real row through `getVenueShift`.
 */
export const DEFAULT_VENUE_SHIFT: VenueShift = {
  startLocal: '17:00:00',
  cutoffLocal: '05:00:00',
  startHour: 17,
  cutoffHour: 5,
  timeZone: 'Asia/Ho_Chi_Minh',
}

const shiftCacheTtlMs = 60_000
const cache = new Map<string, { shift: VenueShift; expiresAt: number }>()

function cacheKey(actor: { organizationId: number; venueId: number }): string {
  return `${actor.organizationId}:${actor.venueId}`
}

const boundaryPattern = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Parses a "HH:MM[:SS]" boundary into its whole hour.
 *
 * A venue row that somehow holds something else is a configuration fault, not an input the
 * caller can fix, so it fails loudly rather than defaulting to midnight and quietly filing a
 * whole night of turns against the wrong operating day.
 */
export function shiftBoundaryHour(local: string, column: string): number {
  const match = boundaryPattern.exec(local)
  if (!match) {
    throw new AppError(500, 'VENUE_SHIFT_INVALID', `Cấu hình ${column} của địa điểm không hợp lệ.`)
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    throw new AppError(500, 'VENUE_SHIFT_INVALID', `Cấu hình ${column} của địa điểm không hợp lệ.`)
  }
  return hour
}

/**
 * A shift built from just the cutoff column, for the paths that already read the venue row for
 * something else and only need to know when the operating day rolls over. The opening hour is
 * irrelevant to `businessDateAt`, which is why those paths need not read it.
 */
export function shiftFromCutoff(cutoffLocal: string): VenueShift {
  return {
    ...DEFAULT_VENUE_SHIFT,
    cutoffLocal,
    cutoffHour: shiftBoundaryHour(cutoffLocal, 'business_day_cutoff_local'),
  }
}

/** Whole hours from the shift's opening to its cutoff, wrapping past midnight when it does. */
export function shiftSpanHours(shift: VenueShift): number {
  return shift.cutoffHour > shift.startHour
    ? shift.cutoffHour - shift.startHour
    : 24 - shift.startHour + shift.cutoffHour
}

/** "17:00–05:00", for the error messages that name the shift back to the receptionist. */
export function shiftLabel(shift: VenueShift): string {
  return `${shift.startLocal.slice(0, 5)}–${shift.cutoffLocal.slice(0, 5)}`
}

interface VenueShiftRow extends RowDataPacket {
  start_local: string
  cutoff_local: string
  timezone: string
}

function toShift(row: VenueShiftRow): VenueShift {
  return {
    startLocal: row.start_local,
    cutoffLocal: row.cutoff_local,
    startHour: shiftBoundaryHour(row.start_local, 'business_day_start_local'),
    cutoffHour: shiftBoundaryHour(row.cutoff_local, 'business_day_cutoff_local'),
    timeZone: row.timezone,
  }
}

const selectShift = `SELECT TIME_FORMAT(business_day_start_local, '%H:%i:%s') AS start_local,
    TIME_FORMAT(business_day_cutoff_local, '%H:%i:%s') AS cutoff_local, timezone
  FROM venues WHERE organization_id = ? AND id = ? AND status = 'ACTIVE'`

/**
 * The venue's shift, from cache when warm.
 *
 * Takes an optional connection so a caller already inside a transaction reads the same
 * snapshot it is writing against, rather than opening a second connection and risking a
 * deadlock against its own locks.
 */
export async function getVenueShift(
  actor: { organizationId: number; venueId: number },
  connection?: PoolConnection,
): Promise<VenueShift> {
  const key = cacheKey(actor)
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.shift

  const executor = connection ?? databasePool
  const [rows] = await executor.execute<VenueShiftRow[]>(selectShift, [actor.organizationId, actor.venueId])
  const row = rows[0]
  if (!row) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  const shift = toShift(row)
  cache.set(key, { shift, expiresAt: Date.now() + shiftCacheTtlMs })
  return shift
}

/** Drops the cached shift for one venue, or all of them when called with no venue. */
export function invalidateVenueShift(actor?: { organizationId: number; venueId: number }): void {
  if (!actor) {
    cache.clear()
    return
  }
  cache.delete(cacheKey(actor))
}

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { invalidateVenueShift } from './venue-shift.js'

export interface VenueSettings {
  quick_times: string[]
  upcoming_minutes: number
  no_show_minutes: number
  /** TU-38 — the operating shift, "HH:MM:SS", as `venues` stores it. */
  business_day_start_local: string
  business_day_cutoff_local: string
}

export interface VenueSettingsUpdate {
  quickTimes: string[]
  upcomingMinutes: number
  noShowMinutes: number
  /**
   * TU-38 — optional so a client that does not manage the shift keeps working unchanged.
   * Supplying one without the other is rejected by the route: a shift is a pair, and
   * validating half of it against a stored half invites an impossible combination.
   */
  businessDayStartLocal?: string
  businessDayCutoffLocal?: string
}

export const DEFAULT_QUICK_TIMES = ['21:00', '21:30', '22:00', '22:30'] as const

/** The arrival window bookings are accepted in, which the shift has to be able to serve. */
const bookingWindowStartMinutes = 19 * 60
const bookingWindowEndMinutes = 60

function minutesOfDay(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

export function isWithinBookingWindow(time: string): boolean {
  const minutes = minutesOfDay(time)
  return minutes >= bookingWindowStartMinutes || minutes <= bookingWindowEndMinutes
}

const shiftBoundaryPattern = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

/** "HH:MM" or "HH:MM:SS" on a real clock. */
export function validShiftBoundary(value: unknown): value is string {
  return typeof value === 'string' && shiftBoundaryPattern.test(value)
}

/** Normalises a boundary to the "HH:MM:SS" the column stores. */
export function normalizeShiftBoundary(value: string): string {
  return value.length === 5 ? `${value}:00` : value
}

/**
 * Whether a shift can actually serve the booking window.
 *
 * A shift is a span that may wrap past midnight, so containment is measured in minutes from
 * the opening rather than on the clock: `19:00` and `01:00` must both fall inside the span,
 * and `19:00` must come first within it. A venue opening at 20:00 would accept a booking for
 * 19:00 it could never seat, and one closing at 23:00 would accept 00:30 the same way — both
 * are rejected here rather than discovered by a receptionist at the door.
 */
export function shiftServesBookingWindow(startLocal: string, cutoffLocal: string): boolean {
  const startMinutes = minutesOfDay(startLocal)
  const span = (minutesOfDay(cutoffLocal) - startMinutes + 1440) % 1440
  if (span === 0) return false
  const offset = (minutes: number) => (minutes - startMinutes + 1440) % 1440
  const windowStart = offset(bookingWindowStartMinutes)
  const windowEnd = offset(bookingWindowEndMinutes)
  return windowStart <= span && windowEnd <= span && windowStart <= windowEnd
}

export function validQuickTimes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 24
    && value.every((time) => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    && value.every(isWithinBookingWindow)
    && new Set(value).size === value.length
}

export async function getVenueSettings(
  actor: Pick<AuthenticatedActor, 'organizationId' | 'venueId'>,
): Promise<VenueSettings> {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    upcoming_warning_minutes: number
    no_show_warning_minutes: number
    business_day_start_local: string
    business_day_cutoff_local: string
    quick_times: unknown
  })[]>(
    `SELECT v.upcoming_warning_minutes, v.no_show_warning_minutes,
       TIME_FORMAT(v.business_day_start_local, '%H:%i:%s') AS business_day_start_local,
       TIME_FORMAT(v.business_day_cutoff_local, '%H:%i:%s') AS business_day_cutoff_local,
       s.value AS quick_times
     FROM venues v
     LEFT JOIN venue_settings s
       ON s.organization_id = v.organization_id AND s.venue_id = v.id AND s.key = 'quick_times'
     WHERE v.organization_id = ? AND v.id = ? AND v.status = 'ACTIVE'`,
    [actor.organizationId, actor.venueId],
  )
  const row = rows[0]
  if (!row) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  return {
    quick_times: validQuickTimes(row.quick_times) ? row.quick_times : [...DEFAULT_QUICK_TIMES],
    upcoming_minutes: Number(row.upcoming_warning_minutes),
    no_show_minutes: Number(row.no_show_warning_minutes),
    business_day_start_local: row.business_day_start_local,
    business_day_cutoff_local: row.business_day_cutoff_local,
  }
}

export async function updateVenueSettings(
  actor: AuthenticatedActor,
  input: VenueSettingsUpdate,
): Promise<VenueSettings> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [venueRows] = await connection.execute<(RowDataPacket & {
      version: number
      change_seq: string
      late_warning_minutes: number
      upcoming_warning_minutes: number
      no_show_warning_minutes: number
      business_day_start_local: string
      business_day_cutoff_local: string
    })[]>(
      `SELECT version, change_seq, late_warning_minutes,
         upcoming_warning_minutes, no_show_warning_minutes,
         TIME_FORMAT(business_day_start_local, '%H:%i:%s') AS business_day_start_local,
         TIME_FORMAT(business_day_cutoff_local, '%H:%i:%s') AS business_day_cutoff_local
       FROM venues
       WHERE organization_id = ? AND id = ? AND status = 'ACTIVE'
       FOR UPDATE`,
      [actor.organizationId, actor.venueId],
    )
    const venue = venueRows[0]
    if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
    if (input.noShowMinutes <= Number(venue.late_warning_minutes)) {
      throw new AppError(
        400,
        'INVALID_NO_SHOW_MINUTES',
        `Mốc không tới phải lớn hơn mốc đến muộn hiện tại (${venue.late_warning_minutes} phút).`,
      )
    }

    // TU-38 — the shift. Omitting it keeps the stored pair, so a client that does not manage
    // the shift cannot blank it by sending the rest of the configuration.
    const startLocal = input.businessDayStartLocal
      ? normalizeShiftBoundary(input.businessDayStartLocal)
      : venue.business_day_start_local
    const cutoffLocal = input.businessDayCutoffLocal
      ? normalizeShiftBoundary(input.businessDayCutoffLocal)
      : venue.business_day_cutoff_local
    const shiftChanged = startLocal !== venue.business_day_start_local
      || cutoffLocal !== venue.business_day_cutoff_local
    if (shiftChanged) {
      if (!shiftServesBookingWindow(startLocal, cutoffLocal)) {
        throw new AppError(
          400,
          'SHIFT_CANNOT_SERVE_BOOKING_WINDOW',
          'Ca vận hành phải bao trọn cửa sổ nhận booking 19:00–01:00.',
        )
      }
      // Moving the cutoff moves which operating day "now" belongs to, which would strand a
      // party already at a table: their visit would suddenly belong to another day, and the
      // end-of-shift sweep would close it at a different moment than the staff expect. The
      // shift is therefore only movable between services, not during one.
      const [openVisits] = await connection.execute<(RowDataPacket & { total: number })[]>(
        `SELECT COUNT(*) AS total FROM visits
         WHERE organization_id = ? AND venue_id = ? AND ended_at IS NULL`,
        [actor.organizationId, actor.venueId],
      )
      const open = Number(openVisits[0]?.total ?? 0)
      if (open > 0) {
        throw new AppError(
          409,
          'SHIFT_CHANGE_WITH_OPEN_VISITS',
          `Còn ${open} lượt khách đang ngồi. Chỉ đổi ca vận hành khi quán không còn lượt nào mở.`,
        )
      }
    }

    await connection.execute<ResultSetHeader>(
      `INSERT INTO venue_settings (organization_id, venue_id, \`key\`, \`value\`)
       VALUES (?, ?, 'quick_times', ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
      [actor.organizationId, actor.venueId, JSON.stringify(input.quickTimes)],
    )

    const changeSequence = (BigInt(venue.change_seq) + 1n).toString()
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE venues
       SET upcoming_warning_minutes = ?, no_show_warning_minutes = ?,
         business_day_start_local = ?, business_day_cutoff_local = ?,
         change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND id = ? AND version = ?`,
      [
        input.upcomingMinutes,
        input.noShowMinutes,
        startLocal,
        cutoffLocal,
        changeSequence,
        actor.organizationId,
        actor.venueId,
        venue.version,
      ],
    )
    if (updated.affectedRows !== 1) {
      throw new AppError(409, 'CONCURRENT_UPDATE_RETRY', 'Cấu hình vừa được cập nhật. Vui lòng thử lại.')
    }

    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'VENUE_SETTINGS_UPDATED', 'venue', ?, ?, ?, ?, 'MANUAL', 0)`,
      [
        actor.organizationId,
        actor.venueId,
        changeSequence,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        actor.venueId,
        venue.version,
        venue.version + 1,
        JSON.stringify([
          { type: 'quick_times', value: input.quickTimes },
          {
            type: 'upcoming_warning_minutes',
            before: Number(venue.upcoming_warning_minutes),
            value: input.upcomingMinutes,
          },
          {
            type: 'no_show_warning_minutes',
            before: Number(venue.no_show_warning_minutes),
            value: input.noShowMinutes,
          },
          // Only recorded when it moved: an audit entry for every save would bury the one
          // change that actually matters to how the operating day is counted.
          ...(shiftChanged
            ? [
                {
                  type: 'business_day_start_local',
                  before: venue.business_day_start_local,
                  value: startLocal,
                },
                {
                  type: 'business_day_cutoff_local',
                  before: venue.business_day_cutoff_local,
                  value: cutoffLocal,
                },
              ]
            : []),
        ]),
      ],
    )
    await connection.commit()
    // TU-38: the shift is written here, so the cache is dropped the moment the transaction
    // commits rather than waiting out its TTL.
    invalidateVenueShift(actor)
    return {
      quick_times: [...input.quickTimes],
      upcoming_minutes: input.upcomingMinutes,
      no_show_minutes: input.noShowMinutes,
      business_day_start_local: startLocal,
      business_day_cutoff_local: cutoffLocal,
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

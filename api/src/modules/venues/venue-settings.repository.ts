import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

export interface VenueSettings {
  quick_times: string[]
  upcoming_minutes: number
  no_show_minutes: number
}

export interface VenueSettingsUpdate {
  quickTimes: string[]
  upcomingMinutes: number
  noShowMinutes: number
}

export const DEFAULT_QUICK_TIMES = ['21:00', '21:30', '22:00', '22:30'] as const

function minutesOfDay(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

export function isWithinBookingWindow(time: string): boolean {
  const minutes = minutesOfDay(time)
  return minutes >= 19 * 60 || minutes <= 60
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
    quick_times: unknown
  })[]>(
    `SELECT v.upcoming_warning_minutes, v.no_show_warning_minutes,
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
    })[]>(
      `SELECT version, change_seq, late_warning_minutes,
         upcoming_warning_minutes, no_show_warning_minutes
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
        `Mốc không đến phải lớn hơn mốc đến muộn hiện tại (${venue.late_warning_minutes} phút).`,
      )
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
         change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND id = ? AND version = ?`,
      [
        input.upcomingMinutes,
        input.noShowMinutes,
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
        ]),
      ],
    )
    await connection.commit()
    return {
      quick_times: [...input.quickTimes],
      upcoming_minutes: input.upcomingMinutes,
      no_show_minutes: input.noShowMinutes,
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

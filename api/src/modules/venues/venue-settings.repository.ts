import type { Connection, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

export interface VenueSettings {
  quick_times: string[]
  upcoming_minutes: number
  no_show_minutes: number
}

export function validMinuteThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 720
}

export function validQuickTimes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 24
    && value.every((time) => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
    && new Set(value).size === value.length
}

export async function initializeVenueSettings(
  actor: Pick<AuthenticatedActor, 'organizationId' | 'venueId'>,
  connection: Connection | typeof databasePool = databasePool,
): Promise<void> {
  await connection.execute(
    `INSERT INTO venue_settings (organization_id, venue_id, \`key\`, \`value\`)
     SELECT v.organization_id, v.id, defaults.setting_key,
       CASE defaults.setting_key
         WHEN 'quick_times' THEN JSON_ARRAY('21:00','21:30','22:00','22:30')
         WHEN 'upcoming_minutes' THEN CAST('10' AS JSON)
         ELSE CAST(v.no_show_warning_minutes AS JSON) END
     FROM venues v CROSS JOIN (
       SELECT 'quick_times' AS setting_key UNION ALL SELECT 'upcoming_minutes' UNION ALL SELECT 'no_show_minutes'
     ) defaults
     WHERE v.organization_id = ? AND v.id = ? AND v.status = 'ACTIVE'
     ON DUPLICATE KEY UPDATE \`value\` = venue_settings.\`value\``,
    [actor.organizationId, actor.venueId],
  )
}

export async function getVenueSettings(
  actor: Pick<AuthenticatedActor, 'organizationId' | 'venueId'>,
  connection: Connection | typeof databasePool = databasePool,
): Promise<VenueSettings> {
  const [rows] = await connection.execute<(RowDataPacket & {
    no_show_warning_minutes: number; late_warning_minutes: number; key: string | null; value: unknown
  })[]>(
    `SELECT v.no_show_warning_minutes, v.late_warning_minutes, s.\`key\`, s.\`value\`
     FROM venues v LEFT JOIN venue_settings s ON s.organization_id = v.organization_id AND s.venue_id = v.id
     WHERE v.organization_id = ? AND v.id = ? AND v.status = 'ACTIVE'`,
    [actor.organizationId, actor.venueId],
  )
  const venue = rows[0]
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  const values = new Map(rows.map((row) => [row.key, row.value]))
  // Provision new venues on first read without requiring triggers or elevated DB privileges.
  if (['quick_times', 'upcoming_minutes', 'no_show_minutes'].some((key) => !values.has(key))) {
    await initializeVenueSettings(actor, connection)
  }
  const quickTimes = values.get('quick_times')
  const upcoming = values.get('upcoming_minutes')
  const noShow = values.get('no_show_minutes')
  return {
    // Defaults for missing/invalid configuration live here, never in booking business logic.
    quick_times: validQuickTimes(quickTimes) ? quickTimes : ['21:00', '21:30', '22:00', '22:30'],
    upcoming_minutes: validMinuteThreshold(upcoming) ? upcoming : 10,
    no_show_minutes: validMinuteThreshold(noShow) && noShow > venue.late_warning_minutes
      ? noShow : venue.no_show_warning_minutes,
  }
}

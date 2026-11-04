import type { RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

export interface VenueSettings {
  quick_times: string[]
  upcoming_minutes: number
  no_show_minutes: number
}

const DEFAULT_QUICK_TIMES = ['21:00', '21:30', '22:00', '22:30']

export function validQuickTimes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 24
    && value.every((time) => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
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

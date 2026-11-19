import { Router } from 'express'

import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { AppError } from '../../errors/app-error.js'
import {
  getVenueSettings,
  shiftServesBookingWindow,
  updateVenueSettings,
  validQuickTimes,
  validShiftBoundary,
  normalizeShiftBoundary,
  type VenueSettings,
  type VenueSettingsUpdate,
} from './venue-settings.repository.js'

export const venueSettingsRouter: Router = Router()
export const settingsRouter: Router = Router()

function publicSettings(settings: VenueSettings) {
  return {
    quickTimes: settings.quick_times,
    upcomingMinutes: settings.upcoming_minutes,
    noShowMinutes: settings.no_show_minutes,
    // TU-38 — the operating shift, so a client can show and edit it instead of assuming it.
    businessDayStartLocal: settings.business_day_start_local,
    businessDayCutoffLocal: settings.business_day_cutoff_local,
  }
}

function parseSettingsUpdate(value: unknown): VenueSettingsUpdate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_SETTINGS_PAYLOAD', 'Cấu hình phải là một object JSON.')
  }
  const body = value as Record<string, unknown>
  const required = ['quickTimes', 'upcomingMinutes', 'noShowMinutes'] as const
  // TU-38 — the shift pair is optional, so a client that does not manage it keeps sending the
  // same three keys it always did.
  const optional = ['businessDayStartLocal', 'businessDayCutoffLocal'] as const
  const allowed = new Set<string>([...required, ...optional])
  if (Object.keys(body).some((key) => !allowed.has(key)) || required.some((key) => !(key in body))) {
    throw new AppError(
      400,
      'INVALID_SETTINGS_PAYLOAD',
      'Chỉ chấp nhận quickTimes, upcomingMinutes, noShowMinutes'
        + ' và cặp businessDayStartLocal/businessDayCutoffLocal.',
    )
  }
  if (!validQuickTimes(body.quickTimes)) {
    throw new AppError(
      400,
      'INVALID_QUICK_TIMES',
      'quickTimes phải có 1–24 giờ HH:mm không trùng, trong cửa sổ 19:00–01:00.',
    )
  }
  if (!Number.isInteger(body.upcomingMinutes) || Number(body.upcomingMinutes) < 1 || Number(body.upcomingMinutes) > 240) {
    throw new AppError(400, 'INVALID_UPCOMING_MINUTES', 'upcomingMinutes phải là số nguyên từ 1 đến 240.')
  }
  if (!Number.isInteger(body.noShowMinutes) || Number(body.noShowMinutes) < 0 || Number(body.noShowMinutes) > 65_535) {
    throw new AppError(400, 'INVALID_NO_SHOW_MINUTES', 'noShowMinutes phải là số nguyên từ 0 đến 65535.')
  }
  const hasStart = body.businessDayStartLocal !== undefined
  const hasCutoff = body.businessDayCutoffLocal !== undefined
  if (hasStart !== hasCutoff) {
    // A shift is a pair. Validating one half against the stored other half would let a
    // two-step edit pass through a combination neither request ever asked for.
    throw new AppError(
      400,
      'INCOMPLETE_BUSINESS_DAY_SHIFT',
      'Phải gửi cả businessDayStartLocal và businessDayCutoffLocal.',
    )
  }
  if (!hasStart) {
    return {
      quickTimes: [...body.quickTimes],
      upcomingMinutes: Number(body.upcomingMinutes),
      noShowMinutes: Number(body.noShowMinutes),
    }
  }
  if (!validShiftBoundary(body.businessDayStartLocal) || !validShiftBoundary(body.businessDayCutoffLocal)) {
    throw new AppError(
      400,
      'INVALID_BUSINESS_DAY_SHIFT',
      'Giờ mở ca và mốc cắt ca phải có dạng HH:mm hoặc HH:mm:ss.',
    )
  }
  const startLocal = normalizeShiftBoundary(body.businessDayStartLocal)
  const cutoffLocal = normalizeShiftBoundary(body.businessDayCutoffLocal)
  if (!shiftServesBookingWindow(startLocal, cutoffLocal)) {
    throw new AppError(
      400,
      'SHIFT_CANNOT_SERVE_BOOKING_WINDOW',
      'Ca vận hành phải bao trọn cửa sổ nhận booking 19:00–01:00.',
    )
  }
  return {
    quickTimes: [...body.quickTimes],
    upcomingMinutes: Number(body.upcomingMinutes),
    noShowMinutes: Number(body.noShowMinutes),
    businessDayStartLocal: startLocal,
    businessDayCutoffLocal: cutoffLocal,
  }
}

settingsRouter.get('/', requireAuthentication, async (request, response) => {
  response.set('Cache-Control', 'no-store').json(publicSettings(await getVenueSettings(requireAuthenticatedActor(request))))
})

settingsRouter.put(
  '/',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('venue.configure'),
  async (request, response) => {
    const settings = await updateVenueSettings(
      requireAuthenticatedActor(request),
      parseSettingsUpdate(request.body as unknown),
    )
    response.set('Cache-Control', 'no-store').json(publicSettings(settings))
  },
)

venueSettingsRouter.get('/:id/settings', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  const actor = requireAuthenticatedActor(request)
  if (request.params.id !== String(actor.venueId)) {
    throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  }
  response.set('Cache-Control', 'no-store').json({ venueId: actor.venueId, settings: await getVenueSettings(actor) })
})

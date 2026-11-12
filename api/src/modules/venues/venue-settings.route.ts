import { Router } from 'express'

import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { AppError } from '../../errors/app-error.js'
import {
  getVenueSettings,
  updateVenueSettings,
  validQuickTimes,
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
  }
}

function parseSettingsUpdate(value: unknown): VenueSettingsUpdate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_SETTINGS_PAYLOAD', 'Cấu hình phải là một object JSON.')
  }
  const body = value as Record<string, unknown>
  const allowed = new Set(['quickTimes', 'upcomingMinutes', 'noShowMinutes'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new AppError(400, 'INVALID_SETTINGS_PAYLOAD', 'Chỉ chấp nhận quickTimes, upcomingMinutes và noShowMinutes.')
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
  return {
    quickTimes: [...body.quickTimes],
    upcomingMinutes: Number(body.upcomingMinutes),
    noShowMinutes: Number(body.noShowMinutes),
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

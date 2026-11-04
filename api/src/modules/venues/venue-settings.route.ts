import { Router } from 'express'

import { requireAuthentication, requirePermission } from '../../auth/auth.middleware.js'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { AppError } from '../../errors/app-error.js'
import { getVenueSettings } from './venue-settings.repository.js'

export const venueSettingsRouter: Router = Router()

venueSettingsRouter.get('/:id/settings', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  const actor = requireAuthenticatedActor(request)
  if (request.params.id !== String(actor.venueId)) {
    throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  }
  response.set('Cache-Control', 'no-store').json({ venueId: actor.venueId, settings: await getVenueSettings(actor) })
})

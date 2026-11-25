/**
 * TU-42 — `GET/PUT /api/v1/dev/clock`.
 *
 * Router này CHỈ được gắn khi APP_ENV=dev (xem app.ts). Trên Production không
 * có route nào ở đây, nên `/api/v1/dev/*` rơi vào 404 mặc định — không phải
 * 403, để không lộ rằng có một tính năng bị khoá.
 *
 * GET: mọi tài khoản đã đăng nhập. Máy Lễ tân, Phục vụ cũng phải biết đang giả
 *      lập mấy giờ để header, ngày ca và đồng hồ đếm khớp với server.
 * PUT: chỉ SuperAdmin (quyền `venue.configure`, quyền chỉ cấp 1 có).
 */
import { Router } from 'express'

import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { getAuthentication, requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { hasPermission } from '../../auth/auth.service.js'
import { broadcastVenueEvent } from '../tables/floor-change-stream.js'
import { getVenueShift } from '../venues/venue-shift.js'
import { realNow } from '../../time/application-clock.js'
import { DEV_CLOCK_PRESETS, offsetFor, parseDevClockRequest } from './dev-clock.model.js'
import { readDevClock, saveDevClock } from './dev-clock.repository.js'

export const devRouter: Router = Router()

devRouter.get('/clock', requireAuthentication, async (request, response) => {
  const actor = requireAuthenticatedActor(request)
  response.set('Cache-Control', 'no-store').json(readDevClock(await hasPermission(actor, 'venue.configure')))
})

devRouter.put(
  '/clock',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('venue.configure'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    const body = parseDevClockRequest(request.body as unknown)
    const shift = await getVenueShift(actor)
    const offsetMs = offsetFor(body, realNow(), shift.cutoffHour)
    const label = body.kind === 'preset'
      ? `${body.preset} · ${DEV_CLOCK_PRESETS[body.preset]}`
      : body.kind === 'at' ? body.localDateTime : 'Giờ thật'
    await saveDevClock(actor, getAuthentication(request)?.displayName ?? '', offsetMs, label)
    const state = readDevClock(true)
    // Mọi máy đang mở sơ đồ nhận sự kiện này qua kênh SSE sẵn có và tự tải lại.
    await broadcastVenueEvent(actor.organizationId, actor.venueId, 'dev-clock-changed', {
      offsetMs: state.offsetMs, now: state.now,
    })
    response.set('Cache-Control', 'no-store').json(state)
  },
)

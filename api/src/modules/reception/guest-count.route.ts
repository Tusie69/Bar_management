import { Router } from 'express'

import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { AppError } from '../../errors/app-error.js'
import { publishFloorChange } from '../tables/floor-change-stream.js'
import { validateCalendarDate } from '../bookings/business-date.js'
import {
  getReceptionGuestCount,
  updateReceptionGuestCount,
  type GuestCountUpdate,
} from './guest-count.repository.js'

export const receptionRouter: Router = Router()

const valueKeys = [
  'arrivedBefore',
  'arrivedAfter',
  'arrivedTotal',
  'bookedTables',
  'bookedGuests',
  'returningGuests',
] as const

function businessDate(value: unknown): string {
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày kinh doanh không hợp lệ.')
  return validateCalendarDate(value)
}

export function parseGuestCountUpdate(value: unknown): GuestCountUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_GUEST_COUNT', 'Dữ liệu bộ đếm không hợp lệ.')
  }
  const body = value as Record<string, unknown>
  const allowed = new Set(['businessDate', 'version', ...valueKeys])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new AppError(400, 'INVALID_GUEST_COUNT', 'Phải gửi đầy đủ đúng sáu chỉ số, ngày và version.')
  }
  const version = body.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new AppError(400, 'INVALID_VERSION', 'Phiên bản bộ đếm không hợp lệ.')
  }
  const values = Object.fromEntries(
    valueKeys.map((key) => {
      const parsed = body[key]
      if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > 4_294_967_295) {
        throw new AppError(400, 'INVALID_GUEST_COUNT', 'Sáu chỉ số phải là số nguyên không âm hợp lệ.')
      }
      return [key, parsed]
    }),
  ) as unknown as Pick<GuestCountUpdate, (typeof valueKeys)[number]>
  return { businessDate: businessDate(body.businessDate), expectedVersion: version, ...values }
}

receptionRouter.get(
  '/guest-counts',
  requireAuthentication,
  requirePermission('customer.view_masked'),
  async (request, response) => {
    const date = businessDate(request.query.date)
    response.set('Cache-Control', 'no-store').json({
      guestCount: await getReceptionGuestCount(requireAuthenticatedActor(request), date),
    })
  },
)

receptionRouter.put(
  '/guest-counts',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('reservation.update'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    const result = await updateReceptionGuestCount(actor, parseGuestCountUpdate(request.body))
    response.set('Cache-Control', 'no-store').json({ guestCount: result.guestCount })
    void publishFloorChange({
      organizationId: actor.organizationId,
      venueId: actor.venueId,
      changeSeq: String(result.changeSeq),
    })
  },
)

import { Router } from 'express'

import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { env } from '../../config/env.js'
import { AppError } from '../../errors/app-error.js'
import {
  assignBookingTables,
  checkInBooking,
  closeBooking,
  createBooking,
  createWalkIn,
  getBookingById,
  listBookings,
  listBookingSources,
  mergeBookingTables,
  revealBookingPhone,
  searchBookings,
  updateBooking,
} from './booking.repository.js'
import { formatBookingExport, listBookingExportItems } from './booking-export.js'
import { assertCurrentBusinessDate, validateCalendarDate } from './business-date.js'
import { PhoneRevealRateLimiter } from './phone-rate-limit.js'

export const bookingRouter: Router = Router()
const phoneRevealLimiter = env.phone.revealRateLimitMax && env.phone.revealRateLimitWindowMs
  ? new PhoneRevealRateLimiter(env.phone.revealRateLimitMax, env.phone.revealRateLimitWindowMs)
  : null

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu gửi lên không hợp lệ.')
  }
  return value as Record<string, unknown>
}

function businessDate(value: unknown): string {
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày làm việc không hợp lệ.')
  return validateCalendarDate(value)
}

function positiveInteger(value: unknown, code: string, message: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, code, message)
  return parsed
}

function requiredText(value: unknown, maximum: number, code: string, message: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new AppError(400, code, message)
  }
  return value.trim()
}

function optionalText(value: unknown, maximum: number, code: string, message: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.trim().length > maximum) throw new AppError(400, code, message)
  return value.trim() || undefined
}

function bookingBody(value: unknown) {
  const body = objectBody(value)
  const note = optionalText(body.note, 500, 'INVALID_NOTE', 'Ghi chú không được vượt quá 500 ký tự.')
  let phoneNumber: string | null | undefined
  if (Object.prototype.hasOwnProperty.call(body, 'phoneNumber')) {
    if (body.phoneNumber !== null && (typeof body.phoneNumber !== 'string' || body.phoneNumber.length > 40)) {
      throw new AppError(422, 'INVALID_PHONE_NUMBER', 'Số điện thoại không hợp lệ.')
    }
    phoneNumber = body.phoneNumber === null ? null : body.phoneNumber.trim()
    if (phoneNumber === '') phoneNumber = null
  }
  return {
    guestName: requiredText(body.guestName, 120, 'INVALID_GUEST_NAME', 'Tên khách phải dài từ 1 đến 120 ký tự.'),
    partySize: positiveInteger(body.partySize, 'INVALID_PARTY_SIZE', 'Số khách không hợp lệ.'),
    expectedAt: requiredText(body.expectedAt, 40, 'INVALID_EXPECTED_AT', 'Giờ khách đến không hợp lệ.'),
    businessDate: businessDate(body.businessDate),
    sourceCode: requiredText(body.sourceCode, 30, 'INVALID_SOURCE', 'Nguồn đặt bàn không hợp lệ.'),
    ...(note === undefined ? {} : { note }),
    ...(phoneNumber === undefined ? {} : { phoneNumber }),
    body,
  }
}

bookingRouter.get('/', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  const date = businessDate(request.query.date)
  response.json({ businessDate: date, bookings: await listBookings(requireAuthenticatedActor(request), date) })
})

bookingRouter.get('/sources', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  response.json({ sources: await listBookingSources(requireAuthenticatedActor(request)) })
})

bookingRouter.get('/search', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  const date = businessDate(request.query.date)
  if (typeof request.query.q !== 'string' || !request.query.q.trim() || request.query.q.trim().length > 120) {
    throw new AppError(400, 'INVALID_SEARCH_QUERY', 'Từ khóa tìm kiếm phải dài từ 1 đến 120 ký tự.')
  }
  const query = request.query.q.trim()
  response.json({
    businessDate: date,
    query,
    bookings: await searchBookings(requireAuthenticatedActor(request), date, query),
  })
})

bookingRouter.get('/export', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  const date = businessDate(request.query.date)
  const text = formatBookingExport(date, await listBookingExportItems(requireAuthenticatedActor(request), date))
  response
    .status(200)
    .type('text/plain; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="21gam-bookings-${date}.txt"`)
    .send(text)
})

bookingRouter.get('/:id', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  response.json({ booking: await getBookingById(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
  ) })
})

bookingRouter.post('/', requireAuthentication, requireCsrfProtection, requirePermission('reservation.create'), async (request, response) => {
  const { body: _body, ...input } = bookingBody(request.body)
  void _body
  const booking = await createBooking(requireAuthenticatedActor(request), {
    ...input,
  })
  response.status(201).json({ booking })
})

bookingRouter.put('/:id', requireAuthentication, requireCsrfProtection, requirePermission('reservation.update'), async (request, response) => {
  const { body, ...input } = bookingBody(request.body)
  response.json({ booking: await updateBooking(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    {
      ...input,
      expectedVersion: positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    },
  ) })
})

bookingRouter.post(
  '/:id/phone:reveal',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('booking.phone.reveal'),
  requirePermission('customer.phone.reveal'),
  async (request, response) => {
    const id = positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.')
    const actor = requireAuthenticatedActor(request)
    if (!phoneRevealLimiter) {
      throw new AppError(503, 'PHONE_REVEAL_POLICY_UNAVAILABLE', 'Chức năng gọi khách chưa được cấu hình đầy đủ.')
    }
    phoneRevealLimiter.assertAllowed(actor.userId, id)
    const phoneNumber = await revealBookingPhone(actor, id)
    response
      .set('Cache-Control', 'no-store, private, max-age=0')
      .set('Pragma', 'no-cache')
      .json({ phoneNumber })
  },
)

bookingRouter.post('/walk-ins', requireAuthentication, requireCsrfProtection, requirePermission('visit.walkin'), async (request, response) => {
  const body = objectBody(request.body)
  if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
  const result = await createWalkIn(requireAuthenticatedActor(request), {
    partySize: positiveInteger(body.partySize, 'INVALID_PARTY_SIZE', 'Số khách không hợp lệ.'),
    businessDate: assertCurrentBusinessDate(body.businessDate),
    tableIds: body.tableIds.map((id) => positiveInteger(id, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')),
    ...(typeof body.guestName === 'string' && body.guestName.trim() ? { guestName: body.guestName.trim() } : {}),
  })
  response.status(201).json(result)
})

bookingRouter.post('/:id/assign', requireAuthentication, requireCsrfProtection, requirePermission('table.assign'), async (request, response) => {
  const body = objectBody(request.body)
  if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
  const tableIds = body.tableIds.map((id) => positiveInteger(id, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.'))
  response.json({ booking: await assignBookingTables(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    tableIds,
  ) })
})

bookingRouter.post('/:id/merge', requireAuthentication, requireCsrfProtection, requirePermission('visit.combine'), async (request, response) => {
  const body = objectBody(request.body)
  if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
  response.json(await mergeBookingTables(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    body.tableIds.map((id) => positiveInteger(id, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')),
  ))
})

bookingRouter.post('/:id/cancel', requireAuthentication, requireCsrfProtection, requirePermission('reservation.cancel'), async (request, response) => {
  const body = objectBody(request.body)
  if (body.reasonNote !== undefined && (typeof body.reasonNote !== 'string' || body.reasonNote.trim().length > 300)) {
    throw new AppError(400, 'INVALID_CANCEL_NOTE', 'Lý do hủy không được vượt quá 300 ký tự.')
  }
  const reasonNote = typeof body.reasonNote === 'string' ? body.reasonNote.trim() : ''
  response.json({ booking: await closeBooking(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    'CANCELLED',
    reasonNote || undefined,
  ) })
})

bookingRouter.post('/:id/no-show', requireAuthentication, requireCsrfProtection, requirePermission('reservation.mark_no_show'), async (request, response) => {
  const body = objectBody(request.body)
  response.json({ booking: await closeBooking(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    'NO_SHOW',
  ) })
})

bookingRouter.post('/:id/check-in', requireAuthentication, requireCsrfProtection, requirePermission('visit.checkin'), async (request, response) => {
  const body = objectBody(request.body)
  response.json({ booking: await checkInBooking(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
  ) })
})

import { Router } from 'express'

import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { env } from '../../config/env.js'
import { AppError } from '../../errors/app-error.js'
import { idempotent, idempotencyTransaction } from '../../middleware/idempotency.js'
import { parseCapacityOverride } from '../tables/table-capacity.js'
import { assertNoteHasNoPhoneNumber } from '../../security/note-privacy.js'
import { applicationNow } from '../../time/application-clock.js'
import {
  assignBookingTables,
  checkInBooking,
  confirmBookingLate,
  initiateBookingCall,
  recordBookingCallOutcome,
  createAndAssignBooking,
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
  type BookingClassification,
} from './booking.repository.js'
import { formatDailyBookingText, getDailyBookingTextInput } from './booking-export.js'
import { assertCurrentBusinessDate, validateCalendarDate } from './business-date.js'
import { assertPhoneDisclosureAllowed, PhoneRevealRateLimiter } from './phone-rate-limit.js'
import { resolveBookingMetadata, type GuestType } from './booking-metadata.js'
import { parseHonorific, parseIconKeys, parseSocialPlatform } from './booking-flags.js'
import { searchReception } from './reception-search.repository.js'

export const bookingRouter: Router = Router()
const phoneRevealLimiter = env.phone.revealRateLimitMax && env.phone.revealRateLimitWindowMs
  ? new PhoneRevealRateLimiter(env.phone.revealRateLimitMax, env.phone.revealRateLimitWindowMs)
  : null

function assertPhoneDisclosurePolicy(actor: ReturnType<typeof requireAuthenticatedActor>, bookingId: number): void {
  assertPhoneDisclosureAllowed(phoneRevealLimiter, actor.userId, bookingId)
}

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

function optionalClassification(value: unknown): BookingClassification | undefined {
  if (value === undefined) return undefined
  if (value === 'RETURNING' || value === 'NEW' || value === 'UNCLASSIFIED') return value
  throw new AppError(400, 'INVALID_BOOKING_CLASSIFICATION', 'Loại khách không hợp lệ.')
}

function bookingBody(value: unknown, mode: 'create' | 'update') {
  const body = objectBody(value)
  const note = optionalText(body.note, 500, 'INVALID_NOTE', 'Ghi chú không được vượt quá 500 ký tự.')
  const noteProvided = Object.prototype.hasOwnProperty.call(body, 'note')
  if (noteProvided) assertNoteHasNoPhoneNumber(note)
  const classification = optionalClassification(body.classification)
  const guestType = body.guestType as GuestType | null | undefined
  resolveBookingMetadata({
    ...(guestType === undefined ? {} : { guestType }),
    ...(classification === undefined ? {} : { classification }),
  })
  if (body.isBirthday !== undefined && typeof body.isBirthday !== 'boolean') {
    throw new AppError(400, 'INVALID_BIRTHDAY', 'Sinh nhật phải là giá trị boolean.')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'lateConfirmedAt')) {
    throw new AppError(400, 'LATE_CONFIRMATION_READ_ONLY', 'Thời điểm tới muộn chỉ được ghi qua thao tác nghiệp vụ riêng.')
  }
  let phoneNumber: string | null | undefined
  if (Object.prototype.hasOwnProperty.call(body, 'phoneNumber')) {
    if (body.phoneNumber !== null && (typeof body.phoneNumber !== 'string' || body.phoneNumber.length > 20)) {
      throw new AppError(422, 'INVALID_PHONE_NUMBER', 'Số điện thoại không hợp lệ.')
    }
    phoneNumber = body.phoneNumber === null ? null : body.phoneNumber.trim()
    if (phoneNumber === '') phoneNumber = null
  }
  const guestName = optionalText(
    body.guestName,
    120,
    'INVALID_GUEST_NAME',
    'Tên khách không được vượt quá 120 ký tự.',
  )
  // 0016's columns: icons map onto is_boss_table/is_designated, and the
  // platform is only kept while the source is SOCIAL (resolved in the repository).
  const iconFlags = parseIconKeys(body.iconKeys)
  const honorific = parseHonorific(body.honorific)
  const socialPlatform = parseSocialPlatform(body.socialPlatform)
  if (mode === 'create' && !guestName && !phoneNumber) {
    throw new AppError(400, 'BOOKING_CONTACT_REQUIRED', 'Cần ít nhất tên khách hoặc số điện thoại.')
  }
  return {
    ...(guestName ? { guestName } : {}),
    partySize: positiveInteger(body.partySize, 'INVALID_PARTY_SIZE', 'Số khách không hợp lệ.'),
    expectedAt: requiredText(body.expectedAt, 40, 'INVALID_EXPECTED_AT', 'Giờ khách đến không hợp lệ.'),
    businessDate: businessDate(body.businessDate),
    sourceCode: requiredText(body.sourceCode, 30, 'INVALID_SOURCE', 'Nguồn đặt bàn không hợp lệ.'),
    ...(classification === undefined ? {} : { classification }),
    ...(guestType === undefined ? {} : { guestType }),
    ...(body.isBirthday === undefined ? {} : { isBirthday: body.isBirthday }),
    ...(mode === 'update'
      ? noteProvided ? { note: note ?? null } : {}
      : note === undefined ? {} : { note }),
    ...(phoneNumber === undefined ? {} : { phoneNumber }),
    ...(iconFlags === undefined ? {} : { iconFlags }),
    ...(honorific === undefined ? {} : { honorific }),
    ...(socialPlatform === undefined ? {} : { socialPlatform }),
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
  const explicitLast3 = typeof request.query.last3 === 'string' ? request.query.last3.trim() : undefined
  if (explicitLast3 !== undefined && !/^\d{3}$/.test(explicitLast3)) {
    throw new AppError(400, 'INVALID_PHONE_SUFFIX', 'Ba số cuối điện thoại phải gồm đúng 3 chữ số.')
  }
  const explicitName = typeof request.query.name === 'string' ? request.query.name.trim() : undefined
  if (explicitName !== undefined && (!explicitName || explicitName.length > 120)) {
    throw new AppError(400, 'INVALID_SEARCH_QUERY', 'Từ khóa tìm kiếm phải dài từ 1 đến 120 ký tự.')
  }
  const legacy = typeof request.query.q === 'string' ? request.query.q.trim() : undefined
  if (legacy !== undefined && (!legacy || legacy.length > 120)) {
    throw new AppError(400, 'INVALID_SEARCH_QUERY', 'Từ khóa tìm kiếm phải dài từ 1 đến 120 ký tự.')
  }
  if (legacy && explicitLast3 === undefined && explicitName === undefined) {
    response.json({
      businessDate: date,
      query: legacy,
      bookings: await searchBookings(requireAuthenticatedActor(request), date, legacy),
    })
    return
  }
  const last3 = explicitLast3 ?? (legacy && /^\d{3}$/.test(legacy) ? legacy : undefined)
  const name = explicitName ?? (legacy && !/^\d{3}$/.test(legacy) ? legacy : undefined)
  if (!last3 && !name) throw new AppError(400, 'INVALID_SEARCH_QUERY', 'Cần nhập 3 số cuối hoặc tên khách.')
  const result = await searchReception(requireAuthenticatedActor(request), date, {
    ...(last3 ? { last3 } : {}),
    ...(name ? { name } : {}),
  })
  response.json({
    businessDate: date,
    query: { ...(last3 ? { last3 } : {}), ...(name ? { name } : {}) },
    ...result,
  })
})

bookingRouter.get('/export', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  const date = businessDate(request.query.date)
  const text = formatDailyBookingText(await getDailyBookingTextInput(requireAuthenticatedActor(request), date))
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

bookingRouter.post('/', requireAuthentication, requireCsrfProtection, requirePermission('reservation.create'), idempotent('booking.create'), async (request, response) => {
  const { body: _body, ...input } = bookingBody(request.body, 'create')
  void _body
  const booking = await createBooking(requireAuthenticatedActor(request), {
    ...input,
  }, applicationNow(), idempotencyTransaction(response))
  response.status(201).json({ booking })
})

bookingRouter.post(
  '/direct',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('reservation.create'),
  requirePermission('table.assign'),
  idempotent('booking.direct'),
  async (request, response) => {
    const { body, ...input } = bookingBody(request.body, 'create')
    if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
    const tableIds = body.tableIds.map((id) => positiveInteger(id, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.'))
    const capacityOverrideConfirmed = parseCapacityOverride(body.capacityOverrideConfirmed)
    response.status(201).json({ booking: await createAndAssignBooking(requireAuthenticatedActor(request), {
      ...input,
      tableIds,
      ...(capacityOverrideConfirmed === undefined ? {} : { capacityOverrideConfirmed }),
    }, applicationNow(), idempotencyTransaction(response)) })
  },
)

bookingRouter.post(
  '/:id/call',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('booking.phone.call'),
  async (request, response) => {
  objectBody(request.body)
  const id = positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.')
  const actor = requireAuthenticatedActor(request)
  assertPhoneDisclosurePolicy(actor, id)
  const result = await initiateBookingCall(
    actor,
    id,
    applicationNow(),
  )
  response
    .set('Cache-Control', 'no-store, private, max-age=0')
    .set('Pragma', 'no-cache')
    .status(201)
    .json(result)
  },
)

bookingRouter.post('/:id/calls/:callId/outcome', requireAuthentication, requireCsrfProtection, requirePermission('booking.phone.call'), async (request, response) => {
  const body = objectBody(request.body)
  const outcome = body.outcome
  if (outcome !== 'CONTACTED' && outcome !== 'NO_ANSWER' && outcome !== 'LATE_CONFIRMED') {
    throw new AppError(400, 'INVALID_CALL_OUTCOME', 'Kết quả cuộc gọi không hợp lệ.')
  }
  response.json(await recordBookingCallOutcome(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(request.params.callId, 'INVALID_CALL_ID', 'Mã lần gọi không hợp lệ.'),
    outcome,
    body.bookingVersion === undefined
      ? undefined
      : positiveInteger(body.bookingVersion, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    applicationNow(),
  ))
})

bookingRouter.put('/:id', requireAuthentication, requireCsrfProtection, requirePermission('reservation.update'), async (request, response) => {
  const { body, ...input } = bookingBody(request.body, 'update')
  response.json({ booking: await updateBooking(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    {
      ...input,
      expectedVersion: positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    },
    applicationNow(),
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
    assertPhoneDisclosurePolicy(actor, id)
    const phoneNumber = await revealBookingPhone(actor, id)
    response
      .set('Cache-Control', 'no-store, private, max-age=0')
      .set('Pragma', 'no-cache')
      .json({ phoneNumber })
  },
)

bookingRouter.post('/walk-ins', requireAuthentication, requireCsrfProtection, requirePermission('visit.walkin'), idempotent('booking.walk_in'), async (request, response) => {
  const body = objectBody(request.body)
  if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
  if (body.phoneNumber !== undefined
    && (typeof body.phoneNumber !== 'string' || body.phoneNumber.length > 20)) {
    throw new AppError(422, 'INVALID_PHONE_NUMBER', 'Số điện thoại không hợp lệ.')
  }
  const guestName = optionalText(body.guestName, 120, 'INVALID_GUEST_NAME', 'Tên khách không được vượt quá 120 ký tự.')
  const walkInOverride = parseCapacityOverride(body.capacityOverrideConfirmed)
  const result = await createWalkIn(requireAuthenticatedActor(request), {
    partySize: positiveInteger(body.partySize, 'INVALID_PARTY_SIZE', 'Số khách không hợp lệ.'),
    businessDate: assertCurrentBusinessDate(body.businessDate, applicationNow()),
    tableIds: body.tableIds.map((id) => positiveInteger(id, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')),
    ...(guestName ? { guestName } : {}),
    ...(typeof body.phoneNumber === 'string' && body.phoneNumber.trim()
      ? { phoneNumber: body.phoneNumber.trim() } : {}),
    ...(walkInOverride === undefined ? {} : { capacityOverrideConfirmed: walkInOverride }),
  }, idempotencyTransaction(response))
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
    parseCapacityOverride(body.capacityOverrideConfirmed),
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
    parseCapacityOverride(body.capacityOverrideConfirmed),
  ))
})

bookingRouter.post('/:id/cancel', requireAuthentication, requireCsrfProtection, requirePermission('reservation.cancel'), async (request, response) => {
  const body = objectBody(request.body)
  if (body.reasonNote !== undefined && (typeof body.reasonNote !== 'string' || body.reasonNote.trim().length > 300)) {
    throw new AppError(400, 'INVALID_CANCEL_NOTE', 'Lý do hủy không được vượt quá 300 ký tự.')
  }
  const reasonNote = typeof body.reasonNote === 'string' ? body.reasonNote.trim() : ''
  assertNoteHasNoPhoneNumber(reasonNote)
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

bookingRouter.post('/:id/late-confirm', requireAuthentication, requireCsrfProtection, requirePermission('reservation.update'), async (request, response) => {
  const body = objectBody(request.body)
  response.json(await confirmBookingLate(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    applicationNow(),
  ))
})

bookingRouter.post('/:id/check-in', requireAuthentication, requireCsrfProtection, requirePermission('visit.checkin'), async (request, response) => {
  const body = objectBody(request.body)
  response.json({ booking: await checkInBooking(
    requireAuthenticatedActor(request),
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    applicationNow(),
  ) })
})

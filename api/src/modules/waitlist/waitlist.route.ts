import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import { validateCalendarDate } from '../bookings/business-date.js'
import {
  createWaitlistEntry,
  cancelWaitlistEntry,
  recordWaitlistContact,
  waitlistCancelReasons,
  attemptChannels,
  contactOutcomes,
  listWaitlist,
  seatWaitlistEntry,
  type ContactChannel,
} from './waitlist.repository.js'

export const waitlistRouter: Router = Router()
const contactChannels = new Set<ContactChannel>(['IN_PERSON', 'PHONE_CALLBACK', 'ZALO_THREAD', 'FANPAGE_THREAD', 'OTHER'])

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu gửi lên không hợp lệ.')
  }
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, code: string, message: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, code, message)
  return parsed
}

function partySize(value: unknown): number {
  const parsed = positiveInteger(value, 'INVALID_PARTY_SIZE', 'Số khách không hợp lệ.')
  if (parsed > 500) throw new AppError(400, 'INVALID_PARTY_SIZE', 'Số khách phải từ 1 đến 500.')
  return parsed
}

function containsPhoneNumber(value: string): boolean {
  return /\d{8,}/.test(value.replace(/[\s.\-()]/g, ''))
}

waitlistRouter.get('/', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  const businessDate = validateCalendarDate(request.query.date)
  response.json({ businessDate, entries: await listWaitlist(requireAuthenticatedActor(request), businessDate) })
})

waitlistRouter.post('/', requireAuthentication, requireCsrfProtection, requirePermission('waitlist.create'), async (request, response) => {
  const body = objectBody(request.body)
  const kind = body.kind ?? 'WALK_IN'
  if (kind !== 'WALK_IN' && kind !== 'ADVANCE_RESERVATION') {
    throw new AppError(400, 'INVALID_WAITLIST_KIND', 'Unsupported waitlist kind.')
  }
  if (kind === 'ADVANCE_RESERVATION') {
    if (body.guestName !== undefined || body.partySize !== undefined || body.phoneNumber !== undefined) {
      throw new AppError(400, 'INVALID_WAITLIST_SHAPE', 'Advance guest details come from the reservation.')
    }
  } else if (typeof body.guestName !== 'string' || !body.guestName.trim() || body.guestName.trim().length > 120) {
    throw new AppError(400, 'INVALID_GUEST_NAME', 'Guest name must contain 1 to 120 characters.')
  }
  if (kind === 'WALK_IN' && body.reservationId !== undefined) {
    throw new AppError(400, 'INVALID_WAITLIST_SHAPE', 'Walk-ins cannot reference a reservation.')
  }
  if (typeof body.contactChannel !== 'string' || !contactChannels.has(body.contactChannel as ContactChannel)) {
    throw new AppError(400, 'INVALID_CONTACT_CHANNEL', 'Kênh liên hệ không hợp lệ.')
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.trim().length > 500)) {
    throw new AppError(400, 'INVALID_NOTE', 'Ghi chú không được vượt quá 500 ký tự.')
  }
  if (body.phoneNumber !== undefined && (typeof body.phoneNumber !== 'string' || body.phoneNumber.trim().length > 30)) {
    throw new AppError(400, 'INVALID_PHONE_NUMBER', 'Số điện thoại không hợp lệ.')
  }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note && containsPhoneNumber(note)) {
    throw new AppError(422, 'PHONE_IN_NOTE_FORBIDDEN', 'Không ghi số điện thoại vào ghi chú.')
  }
  response.status(201).json({ entry: await createWaitlistEntry(requireAuthenticatedActor(request), {
    ...(kind === 'ADVANCE_RESERVATION'
      ? { kind, reservationId: positiveInteger(body.reservationId, 'INVALID_RESERVATION_ID', 'Mã booking không hợp lệ.') }
      : { kind, guestName: (body.guestName as string).trim(), partySize: partySize(body.partySize),
          ...(typeof body.phoneNumber === 'string' && body.phoneNumber.trim() ? { phoneNumber: body.phoneNumber.trim() } : {}) }),
    businessDate: validateCalendarDate(body.businessDate),
    contactChannel: body.contactChannel as ContactChannel,
    ...(note ? { note } : {}),
  }) })
})

function mutationInput(request: { params: { id?: unknown }; body: unknown }) {
  const body = objectBody(request.body)
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.trim().length > 300)) {
    throw new AppError(400, 'INVALID_NOTE', 'Ghi chú không được vượt quá 300 ký tự.')
  }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note && containsPhoneNumber(note)) {
    throw new AppError(422, 'PHONE_IN_NOTE_FORBIDDEN', 'Không ghi số điện thoại vào ghi chú.')
  }
  return {
    body,
    input: {
      entryId: positiveInteger(request.params.id, 'INVALID_WAITLIST_ID', 'Mã khách chờ không hợp lệ.'),
      expectedVersion: positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản khách chờ không hợp lệ.'),
      ...(note ? { note } : {}),
    },
  }
}

waitlistRouter.post('/:id/cancel', requireAuthentication, requireCsrfProtection, requirePermission('waitlist.cancel'), async (request, response) => {
  const { body, input } = mutationInput(request)
  const reasonCode = body.reasonCode as typeof waitlistCancelReasons[number]
  if (!waitlistCancelReasons.includes(reasonCode)) {
    throw new AppError(400, 'INVALID_CANCEL_REASON', 'Lý do hủy khách chờ không hợp lệ.')
  }
  response.json({ entry: await cancelWaitlistEntry(requireAuthenticatedActor(request), { ...input, reasonCode }) })
})

waitlistRouter.post('/:id/contact-attempts', requireAuthentication, requireCsrfProtection, requirePermission('waitlist.record_contact'), async (request, response) => {
  const { body, input } = mutationInput(request)
  const channel = body.channel as typeof attemptChannels[number]
  const outcome = body.outcome as typeof contactOutcomes[number]
  if (!attemptChannels.includes(channel)) throw new AppError(400, 'INVALID_CONTACT_CHANNEL', 'Kênh liên hệ không hợp lệ.')
  if (!contactOutcomes.includes(outcome)) throw new AppError(400, 'INVALID_CONTACT_OUTCOME', 'Kết quả liên hệ không hợp lệ.')
  response.json({ entry: await recordWaitlistContact(requireAuthenticatedActor(request), { ...input, channel, outcome }) })
})

waitlistRouter.post(
  '/:id/seat',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('waitlist.accept_offer'),
  requirePermission('reservation.create'),
  requirePermission('table.assign'),
  async (request, response) => {
    const body = objectBody(request.body)
    if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
    response.json(await seatWaitlistEntry(requireAuthenticatedActor(request), {
      entryId: positiveInteger(request.params.id, 'INVALID_WAITLIST_ID', 'Mã khách chờ không hợp lệ.'),
      expectedVersion: positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản khách chờ không hợp lệ.'),
      tableIds: body.tableIds.map((value) => positiveInteger(value, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')),
    }))
  },
)

import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import { validateCalendarDate } from '../bookings/business-date.js'
import {
  createWaitlistEntry,
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
  if (typeof body.guestName !== 'string' || !body.guestName.trim() || body.guestName.trim().length > 120) {
    throw new AppError(400, 'INVALID_GUEST_NAME', 'Tên khách phải dài từ 1 đến 120 ký tự.')
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
    guestName: body.guestName.trim(),
    partySize: partySize(body.partySize),
    businessDate: validateCalendarDate(body.businessDate),
    contactChannel: body.contactChannel as ContactChannel,
    ...(typeof body.phoneNumber === 'string' && body.phoneNumber.trim() ? { phoneNumber: body.phoneNumber.trim() } : {}),
    ...(note ? { note } : {}),
  }) })
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

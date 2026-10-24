import { Router } from 'express'

import { AppError } from '../../errors/app-error.js'
import {
  assignBookingTables,
  checkInBooking,
  closeBooking,
  createBooking,
  createWalkIn,
  listBookings,
} from './booking.repository.js'

export const bookingRouter = Router()

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu gửi lên không hợp lệ.')
  }
  return value as Record<string, unknown>
}

function businessDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày làm việc không hợp lệ.')
  }
  return value
}

function positiveInteger(value: unknown, code: string, message: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, code, message)
  return parsed
}

bookingRouter.get('/', async (request, response) => {
  const date = businessDate(request.query.date)
  response.json({ businessDate: date, bookings: await listBookings(date) })
})

bookingRouter.post('/', async (request, response) => {
  const body = objectBody(request.body)
  if (typeof body.guestName !== 'string' || !body.guestName.trim()) {
    throw new AppError(400, 'GUEST_NAME_REQUIRED', 'Cần nhập tên khách.')
  }
  if (typeof body.expectedAt !== 'string') throw new AppError(400, 'EXPECTED_AT_REQUIRED', 'Cần nhập giờ khách đến.')
  if (typeof body.sourceCode !== 'string') throw new AppError(400, 'SOURCE_REQUIRED', 'Cần chọn nguồn đặt bàn.')
  const booking = await createBooking({
    guestName: body.guestName.trim(),
    partySize: positiveInteger(body.partySize, 'INVALID_PARTY_SIZE', 'Số khách không hợp lệ.'),
    expectedAt: body.expectedAt,
    businessDate: businessDate(body.businessDate),
    sourceCode: body.sourceCode,
    ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
  })
  response.status(201).json({ booking })
})

bookingRouter.post('/walk-ins', async (request, response) => {
  const body = objectBody(request.body)
  if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
  const result = await createWalkIn({
    partySize: positiveInteger(body.partySize, 'INVALID_PARTY_SIZE', 'Số khách không hợp lệ.'),
    businessDate: businessDate(body.businessDate),
    tableIds: body.tableIds.map((id) => positiveInteger(id, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')),
    ...(typeof body.guestName === 'string' && body.guestName.trim() ? { guestName: body.guestName.trim() } : {}),
  })
  response.status(201).json(result)
})

bookingRouter.post('/:id/assign', async (request, response) => {
  const body = objectBody(request.body)
  if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
  const tableIds = body.tableIds.map((id) => positiveInteger(id, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.'))
  response.json({ booking: await assignBookingTables(
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    tableIds,
  ) })
})

bookingRouter.post('/:id/cancel', async (request, response) => {
  const body = objectBody(request.body)
  response.json({ booking: await closeBooking(
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    'CANCELLED',
  ) })
})

bookingRouter.post('/:id/no-show', async (request, response) => {
  const body = objectBody(request.body)
  response.json({ booking: await closeBooking(
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
    'NO_SHOW',
  ) })
})

bookingRouter.post('/:id/check-in', async (request, response) => {
  const body = objectBody(request.body)
  response.json({ booking: await checkInBooking(
    positiveInteger(request.params.id, 'INVALID_BOOKING_ID', 'Mã booking không hợp lệ.'),
    positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.'),
  ) })
})

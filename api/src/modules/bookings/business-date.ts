import { AppError } from '../../errors/app-error.js'

export const bookingTimeZone = 'Asia/Ho_Chi_Minh'
export const bookingDayStartHour = 17
export const bookingDayCutoffHour = 5

const calendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const expectedAtPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/

interface LocalDateTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export interface BookingSchedule {
  expectedAtUtc: Date
  mysqlExpectedAt: string
  businessDate: string
  localDateTime: LocalDateTime
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function formatCalendarDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

function previousCalendarDate(year: number, month: number, day: number): string {
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() - 1)
  return formatCalendarDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
}

export function validateCalendarDate(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày làm việc phải có dạng YYYY-MM-DD.')
  }
  const match = calendarDatePattern.exec(value)
  if (!match) throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày làm việc phải có dạng YYYY-MM-DD.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày làm việc không tồn tại trên lịch.')
  }
  return value
}

export function currentBusinessDate(now = new Date()): string {
  const local = localPartsAt(now)
  if (local.hour >= bookingDayCutoffHour && local.hour < bookingDayStartHour) {
    throw new AppError(409, 'WALK_IN_OUTSIDE_BUSINESS_HOURS', 'Walk-in chỉ được nhận trong ca 17:00–05:00.')
  }
  return local.hour < bookingDayCutoffHour
    ? previousCalendarDate(local.year, local.month, local.day)
    : formatCalendarDate(local.year, local.month, local.day)
}

export function assertCurrentBusinessDate(value: unknown, now = new Date()): string {
  const supplied = validateCalendarDate(value)
  const current = currentBusinessDate(now)
  if (supplied !== current) {
    throw new AppError(409, 'BUSINESS_DATE_NOT_CURRENT', 'Walk-in phải thuộc ngày nghiệp vụ của ca hiện tại.')
  }
  return supplied
}

function localPartsAt(date: Date): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: bookingTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

export function validateBookingSchedule(expectedAt: unknown, suppliedBusinessDate: unknown): BookingSchedule {
  const businessDate = validateCalendarDate(suppliedBusinessDate)
  if (typeof expectedAt !== 'string') {
    throw new AppError(400, 'INVALID_EXPECTED_AT', 'Giờ khách đến phải là thời gian RFC3339 có offset.')
  }
  const match = expectedAtPattern.exec(expectedAt)
  if (!match) {
    throw new AppError(400, 'INVALID_EXPECTED_AT', 'Giờ khách đến phải là thời gian RFC3339 có offset.')
  }
  const expectedAtUtc = new Date(expectedAt)
  if (Number.isNaN(expectedAtUtc.getTime())) {
    throw new AppError(400, 'INVALID_EXPECTED_AT', 'Giờ khách đến không tồn tại trên lịch.')
  }

  const supplied = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  }
  try {
    validateCalendarDate(formatCalendarDate(supplied.year, supplied.month, supplied.day))
  } catch {
    throw new AppError(400, 'INVALID_EXPECTED_AT', 'Giờ khách đến không tồn tại trên lịch.')
  }
  if (supplied.hour > 23 || supplied.minute > 59 || supplied.second > 59) {
    throw new AppError(400, 'INVALID_EXPECTED_AT', 'Giờ khách đến không tồn tại trên lịch.')
  }
  const local = localPartsAt(expectedAtUtc)
  if (Object.keys(supplied).some((key) => supplied[key as keyof typeof supplied] !== local[key as keyof LocalDateTime])) {
    throw new AppError(
      400,
      'EXPECTED_AT_TIMEZONE_MISMATCH',
      `Giờ khách đến phải biểu diễn đúng giờ địa phương ${bookingTimeZone}.`,
    )
  }
  if (local.hour >= bookingDayCutoffHour && local.hour < bookingDayStartHour) {
    throw new AppError(400, 'EXPECTED_AT_OUTSIDE_BUSINESS_HOURS', 'Giờ khách đến phải nằm trong khoảng 17:00–05:00.')
  }
  const derivedBusinessDate = local.hour < bookingDayCutoffHour
    ? previousCalendarDate(local.year, local.month, local.day)
    : formatCalendarDate(local.year, local.month, local.day)
  if (derivedBusinessDate !== businessDate) {
    throw new AppError(
      400,
      'BUSINESS_DATE_MISMATCH',
      'Ngày làm việc không khớp với giờ khách đến theo ca 17:00–05:00.',
    )
  }
  return {
    expectedAtUtc,
    mysqlExpectedAt: expectedAtUtc.toISOString().slice(0, 23).replace('T', ' '),
    businessDate,
    localDateTime: local,
  }
}

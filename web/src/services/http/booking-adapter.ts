import type { BookingSourceCode } from "@/domain/enums"
import { venueParts, type BusinessDate } from "@/lib/time"
import { ApiError } from "../contracts"

const sourceCodes = ["HOTLINE", "FANPAGE", "ZALO", "SHAREHOLDER", "STAFF", "SOCIAL", "OTHER"] as const
const statuses = ["BOOKED", "CHECKED_IN", "CANCELLED", "NO_SHOW"] as const
const displayStatuses = ["UPCOMING", "WAITING", "LATE", "NO_SHOW", "CHECKED_IN", "CANCELLED"] as const
const classifications = ["RETURNING", "NEW", "UNCLASSIFIED"] as const

export type BookingStatus = (typeof statuses)[number]
export type BookingDisplayStatus = (typeof displayStatuses)[number]
export type BookingClassification = (typeof classifications)[number]

export interface BackendBookingPayload {
  id: number
  guestName: string
  phoneLast3: string | null
  partySize: number
  expectedAt: Date
  businessDate: string
  classification: string
  status: string
  source: string
  sourceCode: string
  tableCodes: string[]
  note: string | null
  version: number
  displayStatus: string
  minutesLate: number
  autoNoShowDue: boolean
}

export interface HttpBooking {
  id: number
  guestName: string
  phoneLast3: string | null
  partySize: number
  expectedAt: Date
  businessDate: BusinessDate
  classification: BookingClassification
  status: BookingStatus
  source: string
  sourceCode: BookingSourceCode
  tableCodes: string[]
  note: string | null
  version: number
  displayStatus: BookingDisplayStatus
  minutesLate: number
  autoNoShowDue: boolean
}

export interface BookingWriteFields {
  guestName: string
  partySize: number
  expectedAt: Date
  businessDate: BusinessDate
  sourceCode: BookingSourceCode
  note?: string | null
  phoneNumber?: string | null
  classification?: BookingClassification
}

export interface BookingCreatePayload {
  guestName: string
  partySize: number
  expectedAt: string
  businessDate: BusinessDate
  sourceCode: BookingSourceCode
  note?: string
  phoneNumber?: string | null
  classification?: BookingClassification
}

export interface DirectBookingCreatePayload extends BookingCreatePayload {
  tableIds: number[]
}

export interface BookingUpdatePayload extends BookingCreatePayload {
  version: number
}

export type AssignmentTableState = "AVAILABLE" | "RESERVED" | "IN_USE" | "OUT_OF_SERVICE"

export interface BackendAssignmentTablePayload {
  id: number
  code: string
  state: string
  isBackup: boolean
}

export interface AssignmentTable {
  id: number
  code: string
  state: AssignmentTableState
  isSpare: boolean
}

const includes = <T extends string>(values: readonly T[], value: string): value is T => values.includes(value as T)

function contractError(code: string, message: string): never {
  throw new ApiError(502, code, message)
}

function requireDate(value: Date, id: number): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    contractError("INVALID_BOOKING_DATE", `Booking #${id} có expectedAt không hợp lệ.`)
  }
  return value
}

export function mapBooking(payload: BackendBookingPayload): HttpBooking {
  if (!includes(statuses, payload.status)) {
    contractError("UNSUPPORTED_BOOKING_STATUS", `Booking #${payload.id} có trạng thái không được hỗ trợ.`)
  }
  if (!includes(displayStatuses, payload.displayStatus)) {
    contractError("UNSUPPORTED_BOOKING_DISPLAY_STATUS", `Booking #${payload.id} có trạng thái hiển thị không hợp lệ.`)
  }
  if (!includes(sourceCodes, payload.sourceCode)) {
    contractError("UNSUPPORTED_BOOKING_SOURCE", `Booking #${payload.id} có nguồn không được hỗ trợ.`)
  }
  if (!includes(classifications, payload.classification)) {
    contractError("UNSUPPORTED_BOOKING_CLASSIFICATION", `Booking #${payload.id} có loại khách không hợp lệ.`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.businessDate)) {
    contractError("INVALID_BUSINESS_DATE", `Booking #${payload.id} có ngày nghiệp vụ không hợp lệ.`)
  }
  return {
    ...payload,
    id: Number(payload.id),
    version: Number(payload.version),
    partySize: Number(payload.partySize),
    minutesLate: Number(payload.minutesLate),
    expectedAt: requireDate(payload.expectedAt, payload.id),
    businessDate: payload.businessDate,
    status: payload.status,
    displayStatus: payload.displayStatus,
    sourceCode: payload.sourceCode,
    classification: payload.classification,
    tableCodes: [...payload.tableCodes],
  }
}

function commonPayload(fields: BookingWriteFields): BookingCreatePayload {
  const guestName = fields.guestName.trim()
  if (!guestName || guestName.length > 120) {
    throw new ApiError(400, "INVALID_GUEST_NAME", "Tên khách phải dài từ 1 đến 120 ký tự.")
  }
  if (!Number.isSafeInteger(fields.partySize) || fields.partySize <= 0) {
    throw new ApiError(400, "INVALID_PARTY_SIZE", "Số khách không hợp lệ.")
  }
  if (!(fields.expectedAt instanceof Date) || Number.isNaN(fields.expectedAt.getTime())) {
    throw new ApiError(400, "INVALID_EXPECTED_AT", "Giờ khách đến không hợp lệ.")
  }
  const note = fields.note?.trim()
  const phoneNumber = typeof fields.phoneNumber === "string" ? fields.phoneNumber.trim() : fields.phoneNumber
  if (typeof phoneNumber === "string" && (!phoneNumber || phoneNumber.length > 40)) {
    throw new ApiError(422, "INVALID_PHONE_NUMBER", "Số điện thoại không hợp lệ.")
  }
  if (note && note.length > 500) throw new ApiError(400, "INVALID_NOTE", "Ghi chú không được vượt quá 500 ký tự.")
  return {
    guestName,
    partySize: fields.partySize,
    expectedAt: venueRfc3339(fields.expectedAt),
    businessDate: fields.businessDate,
    sourceCode: fields.sourceCode,
    ...(fields.classification === undefined ? {} : { classification: fields.classification }),
    ...(note ? { note } : {}),
    ...(phoneNumber === undefined ? {} : { phoneNumber }),
  }
}

function venueRfc3339(value: Date): string {
  const parts = venueParts(value)
  const pad = (part: number) => String(part).padStart(2, "0")
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:00+07:00`
}

export function createBookingPayload(fields: BookingWriteFields): BookingCreatePayload {
  return commonPayload(fields)
}

export function directBookingCreatePayload(
  fields: BookingWriteFields,
  tableIds: number[],
): DirectBookingCreatePayload {
  const uniqueTableIds = [...new Set(tableIds)]
  if (!uniqueTableIds.length || uniqueTableIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new ApiError(400, "TABLE_REQUIRED", "Cần chọn ít nhất một bàn hợp lệ.")
  }
  return { ...commonPayload(fields), tableIds: uniqueTableIds }
}

export function fullUpdateBookingPayload(
  current: HttpBooking,
  fields: Partial<BookingWriteFields>,
): BookingUpdatePayload {
  const merged: BookingWriteFields = {
    guestName: fields.guestName ?? current.guestName,
    partySize: fields.partySize ?? current.partySize,
    expectedAt: fields.expectedAt ?? current.expectedAt,
    businessDate: fields.businessDate ?? current.businessDate,
    sourceCode: fields.sourceCode ?? current.sourceCode,
    classification: fields.classification ?? current.classification,
    note: fields.note === undefined ? current.note : fields.note,
    ...(Object.prototype.hasOwnProperty.call(fields, "phoneNumber") ? { phoneNumber: fields.phoneNumber } : {}),
  }
  return {
    ...commonPayload(merged),
    version: current.version,
  }
}

export function cancelBookingPayload(version: number, reasonNote?: string) {
  const note = reasonNote?.trim()
  if (note && note.length > 300) {
    throw new ApiError(400, "INVALID_CANCEL_NOTE", "Lý do hủy không được vượt quá 300 ký tự.")
  }
  return { version, ...(note ? { reasonNote: note } : {}) }
}

export function assignmentPayload(version: number, tableIds: number[]) {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new ApiError(400, "INVALID_VERSION", "Phiên bản booking không hợp lệ.")
  }
  const uniqueTableIds = [...new Set(tableIds)]
  if (!uniqueTableIds.length || uniqueTableIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new ApiError(400, "TABLE_REQUIRED", "Cần chọn ít nhất một bàn hợp lệ.")
  }
  return { version, tableIds: uniqueTableIds }
}

export function mapAssignmentTable(payload: BackendAssignmentTablePayload): AssignmentTable {
  const tableStates = ["AVAILABLE", "RESERVED", "IN_USE", "OUT_OF_SERVICE"] as const
  if (!includes(tableStates, payload.state)) {
    contractError("UNSUPPORTED_TABLE_STATE", `Bàn ${payload.code} có trạng thái không được hỗ trợ.`)
  }
  return {
    id: Number(payload.id),
    code: payload.code,
    state: payload.state,
    isSpare: Boolean(payload.isBackup),
  }
}

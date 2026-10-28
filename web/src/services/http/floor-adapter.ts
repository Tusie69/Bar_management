import type { BookingSourceCode, VisitOrigin } from "@/domain/enums"
import type { Catalog, ClaimView, FloorState, FloorTableState, TableLiveState } from "@/domain/models"
import type { BusinessDate } from "@/lib/time"
import { ApiError } from "../contracts"

const zoneCodes = ["A", "B", "C", "BAR"] as const
const sourceCodes = ["HOTLINE", "FANPAGE", "ZALO", "SHAREHOLDER", "STAFF", "SOCIAL", "OTHER"] as const
const visitOrigins = ["RESERVATION", "WALK_IN", "WAITLIST"] as const

export interface BackendCatalog {
  venue: Catalog["venue"]
  zones: Array<Omit<Catalog["zones"][number], "code"> & { code: string }>
  tables: Array<{
    id: number
    version: number
    code: string
    displayName: string
    zoneId: number
    zoneCode: string
    kind: "TABLE" | "BAR_SEAT"
    capacity: number
    seqNo: number | null
    isSpare: boolean
    status: "ACTIVE" | "OUT_OF_SERVICE"
    x: number | null
    y: number | null
    width: number | null
    height: number | null
  }>
  combinations: Array<Omit<Catalog["combinations"][number], "pendingConfirmation">>
}

export interface BackendSource {
  code: string
  name: string
}

export interface BackendTableState {
  id: number
  code: string
  state: "AVAILABLE" | "RESERVED" | "IN_USE" | "OUT_OF_SERVICE"
  isBackup: boolean
  activeVisit: {
    id: number
    version: number
    tableCodes: string[]
    displayName: string
    phoneLast3: string | null
    guestCount: number
    startedAt: Date
    origin: string
    paid: boolean
    note: string | null
  } | null
}

export interface BackendBooking {
  id: number
  guestName: string
  phoneLast3: string | null
  partySize: number
  expectedAt: Date
  businessDate: string
  status: "BOOKED" | "CHECKED_IN" | "CANCELLED" | "NO_SHOW"
  sourceCode: string
  tableCodes: string[]
  note: string | null
  version: number
  displayStatus: "UPCOMING" | "WAITING" | "LATE" | "NO_SHOW" | "CHECKED_IN" | "CANCELLED"
  minutesLate: number
}

function contractError(code: string, message: string): never {
  throw new ApiError(502, code, message)
}

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return values.includes(value as T)
}

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    contractError("INVALID_BACKEND_DATE", `Backend trả về ${field} không hợp lệ.`)
  }
  return value
}

export function mapCatalog(payload: BackendCatalog, sources: BackendSource[]): Catalog {
  const zones = payload.zones.map((zone) => {
    if (!includes(zoneCodes, zone.code)) {
      contractError("UNSUPPORTED_ZONE_CODE", `Floor Map chưa hỗ trợ mã khu '${zone.code}'.`)
    }
    return { ...zone, code: zone.code }
  })

  const tables = payload.tables.map((table) => {
    if (!includes(zoneCodes, table.zoneCode)) {
      contractError("UNSUPPORTED_ZONE_CODE", `Bàn ${table.code} thuộc mã khu chưa được hỗ trợ '${table.zoneCode}'.`)
    }
    if (table.x === null || table.y === null || table.width === null || table.height === null) {
      contractError("CATALOG_GEOMETRY_MISSING", `Bàn ${table.code} thiếu vị trí hoặc kích thước trong database.`)
    }
    return {
      id: table.id,
      version: table.version,
      code: table.code,
      displayName: table.displayName,
      zoneId: table.zoneId,
      zoneCode: table.zoneCode,
      kind: table.kind,
      capacity: table.capacity,
      seqNo: table.seqNo,
      isSpare: table.isSpare,
      status: table.status,
      x: table.x,
      y: table.y,
      w: table.width,
      h: table.height,
      // Chair orientation is intentionally omitted: the schema does not store it.
      ...(table.kind === "BAR_SEAT" ? { seating: "bar" as const } : {}),
    }
  })

  return {
    venue: payload.venue,
    zones,
    tables,
    combinations: payload.combinations,
    sources: sources.map((source) => {
      if (!includes(sourceCodes, source.code)) {
        contractError("UNSUPPORTED_BOOKING_SOURCE", `Backend trả về nguồn booking chưa được hỗ trợ '${source.code}'.`)
      }
      return { code: source.code, name: source.name }
    }),
  }
}

function bookingClaim(booking: BackendBooking, tableIds: number[]): ClaimView {
  if (!includes(sourceCodes, booking.sourceCode)) {
    contractError("UNSUPPORTED_BOOKING_SOURCE", `Booking #${booking.id} có sourceCode không được hỗ trợ.`)
  }
  return {
    kind: "reservation",
    visitId: null,
    reservationId: booking.id,
    waitlistEntryId: null,
    holdId: null,
    displayName: booking.guestName,
    phoneLast3: booking.phoneLast3,
    partySize: booking.partySize,
    startsAt: validDate(booking.expectedAt, `expectedAt của booking #${booking.id}`),
    deadlineAt: null,
    paid: false,
    origin: null,
    tableIds,
    groupId: null,
    symbolNo: null,
    warning: booking.displayStatus === "LATE" ? "late" : booking.displayStatus === "NO_SHOW" ? "noshow" : null,
    minutesLate: booking.minutesLate,
    sourceCode: booking.sourceCode as BookingSourceCode,
    note: booking.note,
    version: booking.version,
  }
}

function visitClaim(table: BackendTableState, tableIds: number[]): ClaimView | null {
  const visit = table.activeVisit
  if (!visit) return null
  if (!includes(visitOrigins, visit.origin)) {
    contractError("UNSUPPORTED_VISIT_ORIGIN", `Visit #${visit.id} có origin không được hỗ trợ.`)
  }
  return {
    kind: "visit",
    visitId: visit.id,
    reservationId: null,
    waitlistEntryId: null,
    holdId: null,
    displayName: visit.displayName,
    phoneLast3: visit.phoneLast3,
    partySize: visit.guestCount,
    startsAt: validDate(visit.startedAt, `startedAt của visit #${visit.id}`),
    deadlineAt: null,
    paid: visit.paid,
    origin: visit.origin as VisitOrigin,
    tableIds,
    groupId: null,
    symbolNo: null,
    warning: null,
    minutesLate: 0,
    sourceCode: null,
    note: visit.note,
    version: visit.version,
  }
}

function tableState(table: BackendTableState, booking: BackendBooking | undefined): TableLiveState {
  if (table.state === "OUT_OF_SERVICE") return "oos"
  if (table.state === "IN_USE") return "seated"
  if (table.state === "RESERVED") {
    if (booking?.displayStatus === "LATE") return "late"
    if (booking?.displayStatus === "NO_SHOW") return "noshow"
    return "reserved"
  }
  return table.isBackup ? "spare" : "free"
}

export function mapFloorState(
  at: Date,
  businessDate: BusinessDate,
  tables: BackendTableState[],
  bookings: BackendBooking[],
  catalog: Catalog,
): FloorState {
  const tableIdByCode = new Map(catalog.tables.map((table) => [table.code, table.id]))
  const bookingByTableCode = new Map<string, BackendBooking>()
  for (const booking of bookings) {
    if (booking.status !== "BOOKED") continue
    for (const code of booking.tableCodes) bookingByTableCode.set(code, booking)
  }

  const states: FloorTableState[] = tables.map((table) => {
    const booking = bookingByTableCode.get(table.code)
    const visitTableIds =
      table.activeVisit?.tableCodes
        .map((code) => tableIdByCode.get(code))
        .filter((id): id is number => id !== undefined) ?? []
    const bookingTableIds =
      booking?.tableCodes.map((code) => tableIdByCode.get(code)).filter((id): id is number => id !== undefined) ?? []
    return {
      tableId: table.id,
      state: tableState(table, booking),
      claim:
        table.state === "IN_USE"
          ? visitClaim(table, visitTableIds)
          : table.state === "RESERVED" && booking
            ? bookingClaim(booking, bookingTableIds)
            : null,
    }
  })

  return {
    at,
    businessDate,
    tables: states,
    // The backend does not expose persisted seating-group symbols in this read model yet.
    groups: [],
    changeSeq: catalog.venue.changeSeq,
  }
}

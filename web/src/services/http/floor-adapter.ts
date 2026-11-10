import type { BookingSourceCode, VisitOrigin } from "@/domain/enums"
import type { Catalog, ClaimView, FloorState, FloorTableState, TableLiveState } from "@/domain/models"
import { businessDateOf, type BusinessDate } from "@/lib/time"
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

export interface BackendFloorGroup {
  id: number
  version?: number
  name?: string
  zoneId?: number
  totalSeats?: number
  displayState?: BackendDisplayState
  isOutOfService?: boolean
  claim?: BackendFloorClaimProjection | null
  seatedTurnCount?: number
  completedTurnCount?: number
  currentTurnNo?: number | null
  businessDate?: BusinessDate
  symbolNo: number
  displayCode?: string
  tableIds: number[]
}

export type BackendDisplayState =
  "EMPTY" | "BOOKED" | "UPCOMING" | "CONTACTED" | "LATE" | "LATE_CONFIRMED" | "NO_SHOW" | "IN_USE" | "OUT_OF_SERVICE"

export interface BackendFloorClaimProjection {
  kind: "RESERVATION" | "VISIT" | "WAITLIST_HOLD"
  reservationId: number | null
  visitId: number | null
  waitlistEntryId: number | null
  holdId: number | null
  guestName: string
  phoneLast3: string | null
  partySize: number
  turnNo: number | null
  flags: Array<"BIRTHDAY" | "NEW" | "RETURNING">
  groupId: number | null
  groupDisplayCode: string | null
  groupMemberTableIds: number[]
  startsAt: Date
  deadlineAt: Date | null
  holdOverdue: boolean
  paid: boolean
  origin: string | null
  sourceCode: string | null
  version: number
  lateConfirmedAt?: Date | null
  canCall?: boolean
  reservedExpectedAt?: Date | null
  contactedAt?: Date | null
  contactStatus?: ClaimView["contactStatus"]
  iconKeys?: string[]
  honorific?: ClaimView["honorific"]
}

export interface BackendFloorTableProjection {
  tableId: number
  seatedTurnCount?: number
  claimOwner?: "GROUP" | "TABLE" | null
  isOutOfService?: boolean
  tableCode: string
  catalogStatus: "ACTIVE" | "OUT_OF_SERVICE"
  isSpare: boolean
  displayState: BackendDisplayState
  arrivalPhase: "SCHEDULED" | "ARRIVING" | "WAITING" | "LATE" | "LATE_CONFIRMED" | "NO_SHOW" | null
  arrivalTime: Date | null
  minutesLate: number
  claim: BackendFloorClaimProjection | null
  groupId: number | null
  groupDisplayCode: string | null
  groupMemberTableIds: number[]
  staleFromPreviousDay: boolean
}

export interface BackendFloorProjection {
  businessDate: string
  serverNow: string
  changeSeq: string
  tables: BackendFloorTableProjection[]
  groups: BackendFloorGroup[]
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
  staleFromPreviousDay?: boolean
  allocationBusinessDate?: string | null
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
      seating: table.kind === "BAR_SEAT" ? ("bar" as const) : undefined,
    }
  })

  return {
    venue: payload.venue,
    zones,
    tables,
    combinations: payload.combinations.map((combination) => ({ ...combination, pendingConfirmation: null })),
    sources: sources.map((source) => {
      if (!includes(sourceCodes, source.code)) {
        contractError("UNSUPPORTED_BOOKING_SOURCE", `Backend trả về nguồn booking chưa được hỗ trợ '${source.code}'.`)
      }
      return { id: null, code: source.code, name: source.name }
    }),
  }
}

function bookingClaim(booking: BackendBooking, tableIds: number[], group?: BackendFloorGroup): ClaimView {
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
    groupId: group?.id ?? null,
    symbolNo: group?.symbolNo ?? null,
    warning: booking.displayStatus === "LATE" ? "late" : booking.displayStatus === "NO_SHOW" ? "noshow" : null,
    minutesLate: booking.minutesLate,
    sourceCode: booking.sourceCode as BookingSourceCode,
    note: booking.note,
    version: booking.version,
  }
}

function visitClaim(table: BackendTableState, tableIds: number[], group?: BackendFloorGroup): ClaimView | null {
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
    groupId: group?.id ?? null,
    symbolNo: group?.symbolNo ?? null,
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
  groups: BackendFloorGroup[] = [],
): FloorState {
  const tableIdByCode = new Map(catalog.tables.map((table) => [table.code, table.id]))
  const bookingByTableCode = new Map<string, BackendBooking>()
  const groupByTableId = new Map(groups.flatMap((group) => group.tableIds.map((tableId) => [tableId, group] as const)))
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
    const group = groupByTableId.get(table.id)
    return {
      tableId: table.id,
      // Prefer the allocation projection: startedAt can belong to a different
      // business date. The fallback supports older servers during rollout.
      staleFromPreviousDay:
        table.staleFromPreviousDay ??
        (table.allocationBusinessDate
          ? table.allocationBusinessDate < businessDate
          : Boolean(table.activeVisit && businessDateOf(table.activeVisit.startedAt) < businessDate)),
      state: tableState(table, booking),
      claim:
        table.state === "IN_USE"
          ? visitClaim(table, visitTableIds, group)
          : table.state === "RESERVED" && booking
            ? bookingClaim(booking, bookingTableIds, group)
            : null,
    }
  })

  return {
    at,
    businessDate,
    tables: states,
    groups: groups.map(({ id, symbolNo, displayCode, tableIds }) => ({ id, symbolNo, displayCode, tableIds })),
    changeSeq: catalog.venue.changeSeq,
  }
}

export function projectionState(
  table: Pick<BackendFloorTableProjection, "displayState" | "isOutOfService" | "claim" | "isSpare">,
): TableLiveState {
  if (table.isOutOfService || table.displayState === "OUT_OF_SERVICE") return "oos"
  if (table.displayState === "IN_USE") return "seated"
  if (table.claim?.kind === "WAITLIST_HOLD") return table.claim.holdOverdue ? "hold_overdue" : "hold"
  if (table.displayState === "LATE") return "late"
  if (table.displayState === "LATE_CONFIRMED") return "late_confirmed"
  if (table.displayState === "NO_SHOW") return "noshow"
  if (table.displayState === "UPCOMING") return "upcoming"
  if (table.displayState === "CONTACTED") return "upcoming"
  if (table.displayState === "BOOKED") return "reserved"
  return table.isSpare ? "spare" : "free"
}

function projectionClaim(
  table: Pick<BackendFloorTableProjection, "tableId" | "tableCode" | "displayState" | "claim" | "minutesLate">,
  group?: BackendFloorGroup,
): ClaimView | null {
  const claim = table.claim
  if (!claim) return null
  if (claim.origin !== null && !includes(visitOrigins, claim.origin)) {
    contractError("UNSUPPORTED_VISIT_ORIGIN", `Visit #${claim.visitId ?? "?"} có origin không được hỗ trợ.`)
  }
  if (claim.sourceCode !== null && !includes(sourceCodes, claim.sourceCode)) {
    contractError("UNSUPPORTED_BOOKING_SOURCE", `Claim của bàn ${table.tableCode} có sourceCode không được hỗ trợ.`)
  }
  const tableIds = claim.groupMemberTableIds.length ? claim.groupMemberTableIds : [table.tableId]
  return {
    kind: claim.kind === "VISIT" ? "visit" : claim.kind === "WAITLIST_HOLD" ? "waitlist_hold" : "reservation",
    visitId: claim.visitId,
    reservationId: claim.reservationId,
    waitlistEntryId: claim.waitlistEntryId,
    holdId: claim.holdId,
    displayName: claim.guestName,
    phoneLast3: claim.phoneLast3,
    partySize: claim.partySize,
    startsAt: validDate(claim.startsAt, `startsAt của bàn ${table.tableCode}`),
    deadlineAt: claim.deadlineAt === null ? null : validDate(claim.deadlineAt, `deadlineAt của bàn ${table.tableCode}`),
    paid: claim.paid,
    origin: claim.origin as VisitOrigin | null,
    tableIds,
    groupId: claim.groupId,
    symbolNo: group?.symbolNo ?? null,
    groupDisplayCode: claim.groupDisplayCode,
    turnNo: claim.turnNo,
    flags: [...claim.flags],
    warning: table.displayState === "LATE" ? "late" : table.displayState === "NO_SHOW" ? "noshow" : null,
    minutesLate: table.minutesLate,
    sourceCode: claim.sourceCode as BookingSourceCode | null,
    // Floor projection intentionally never carries raw notes.
    note: null,
    version: claim.version,
    lateConfirmedAt: claim.lateConfirmedAt ?? null,
    canCall: claim.canCall ?? false,
    ...(claim.reservedExpectedAt === undefined
      ? {}
      : {
          reservedExpectedAt:
            claim.reservedExpectedAt === null ? null : validDate(claim.reservedExpectedAt, "reservedExpectedAt"),
        }),
    ...(claim.contactedAt === undefined
      ? {}
      : {
          contactedAt: claim.contactedAt === null ? null : validDate(claim.contactedAt, "contactedAt"),
        }),
    ...(claim.contactStatus === undefined ? {} : { contactStatus: claim.contactStatus }),
    ...(claim.iconKeys === undefined ? {} : { iconKeys: [...claim.iconKeys] }),
    ...(claim.honorific === undefined ? {} : { honorific: claim.honorific }),
  }
}

function safeChangeSequence(value: string): number {
  if (!/^\d+$/.test(value)) contractError("INVALID_CHANGE_SEQUENCE", "Backend trả về changeSeq không hợp lệ.")
  const sequence = Number(value)
  if (!Number.isSafeInteger(sequence))
    contractError("UNSAFE_CHANGE_SEQUENCE", "changeSeq vượt giới hạn an toàn của trình duyệt.")
  return sequence
}

/** Maps only server-derived projection fields; no browser clock or booking-list inference is used. */
export function mapFloorProjection(payload: BackendFloorProjection, catalog: Catalog): FloorState {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.businessDate)) {
    contractError("INVALID_BUSINESS_DATE", "Backend trả về businessDate không hợp lệ.")
  }
  const serverNow = new Date(payload.serverNow)
  if (Number.isNaN(serverNow.getTime())) contractError("INVALID_SERVER_NOW", "Backend trả về serverNow không hợp lệ.")
  const catalogIds = new Set(catalog.tables.map((table) => table.id))
  const groupsById = new Map(payload.groups.map((group) => [group.id, group]))
  const seenTableIds = new Set<number>()
  const tables = payload.tables.map((table): FloorTableState => {
    if (!catalogIds.has(table.tableId)) contractError("UNKNOWN_TABLE", `Projection chứa bàn lạ #${table.tableId}.`)
    if (seenTableIds.has(table.tableId)) contractError("DUPLICATE_TABLE", `Projection lặp bàn #${table.tableId}.`)
    seenTableIds.add(table.tableId)
    const group = table.groupId === null ? undefined : groupsById.get(table.groupId)
    if (
      table.groupId !== null &&
      (!group || group.displayCode !== table.groupDisplayCode || !group.tableIds.includes(table.tableId))
    ) {
      contractError("INCONSISTENT_FLOOR_GROUP", `Nhóm của bàn ${table.tableCode} không nhất quán.`)
    }
    return {
      tableId: table.tableId,
      state: projectionState(table),
      ...(table.seatedTurnCount === undefined ? {} : { seatedTurnCount: table.seatedTurnCount }),
      ...(table.claimOwner === undefined ? {} : { claimOwner: table.claimOwner }),
      claim: projectionClaim(table, group),
      staleFromPreviousDay: Boolean(table.staleFromPreviousDay),
    }
  })
  return {
    at: serverNow,
    businessDate: payload.businessDate as BusinessDate,
    tables,
    groups: payload.groups.map((group) => {
      const { claim, displayState } = group
      return {
        id: group.id,
        symbolNo: group.symbolNo,
        displayCode: group.displayCode,
        ...(group.version === undefined ? {} : { version: group.version }),
        ...(group.name === undefined ? {} : { name: group.name }),
        ...(group.zoneId === undefined ? {} : { zoneId: group.zoneId }),
        ...(group.totalSeats === undefined ? {} : { totalSeats: group.totalSeats }),
        ...(group.isOutOfService === undefined ? {} : { isOutOfService: group.isOutOfService }),
        ...(group.seatedTurnCount === undefined ? {} : { seatedTurnCount: group.seatedTurnCount }),
        ...(group.completedTurnCount === undefined ? {} : { completedTurnCount: group.completedTurnCount }),
        ...(group.currentTurnNo === undefined ? {} : { currentTurnNo: group.currentTurnNo }),
        ...(group.businessDate === undefined ? {} : { businessDate: group.businessDate }),
        tableIds: [...group.tableIds],
        ...(group.displayState === undefined
          ? {}
          : {
              state: projectionState({
                displayState: group.displayState,
                isOutOfService: group.isOutOfService,
                claim: claim ?? null,
                isSpare: false,
              }),
            }),
        ...(claim === undefined
          ? {}
          : {
              claim: projectionClaim(
                {
                  tableId: group.tableIds[0],
                  tableCode: group.displayCode ?? String(group.id),
                  claim,
                  displayState: displayState ?? "EMPTY",
                  minutesLate: group.claim?.reservedExpectedAt
                    ? Math.max(0, Math.floor((serverNow.getTime() - group.claim.reservedExpectedAt.getTime()) / 60_000))
                    : 0,
                },
                group,
              ),
            }),
      }
    }),
    changeSeq: safeChangeSequence(payload.changeSeq),
  }
}

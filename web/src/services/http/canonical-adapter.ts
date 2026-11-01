import type {
  AvailabilityResult,
  Catalog,
  FloorState,
  ReservationView,
  ShiftOverview,
  WaitlistEntryView,
} from "@/domain/models"
import type { WaitlistChannel, WaitlistKind, WaitlistStatus } from "@/domain/enums"
import { businessDateOf, fmtTime, venueParts } from "@/lib/time"
import type { HttpBooking } from "./booking-adapter"

/** Fields absent from the backend are explicitly unavailable, never synthesized. */
export function mapReservation(booking: HttpBooking, catalog: Catalog): ReservationView {
  const tableIds = catalog.tables.filter((table) => booking.tableCodes.includes(table.code)).map((table) => table.id)
  return {
    id: booking.id,
    version: booking.version,
    customerId: null,
    displayName: booking.guestName,
    phoneLast3: booking.phoneLast3,
    partySize: booking.partySize,
    expectedAt: booking.expectedAt,
    businessDate: booking.businessDate,
    classification: booking.classification,
    status: booking.status,
    sourceCode: booking.sourceCode,
    note: booking.note,
    tableIds,
    holdId: null,
    symbolNo: null,
    subState: booking.status === "BOOKED" ? (tableIds.length ? "DANG_GIU_BAN" : "CHO_PHAN_BAN") : null,
    warning:
      booking.displayStatus === "LATE"
        ? "late"
        : booking.displayStatus === "NO_SHOW" && booking.status === "BOOKED"
          ? "noshow"
          : null,
    minutesLate: booking.minutesLate,
    waitlistEntryId: null,
    visitId: null,
    checkedInAt: null,
    closedAt: null,
    closeReasonCode: null,
    closeReasonNote: null,
    createdAt: null,
    createdByName: "Chưa có dữ liệu người tạo",
  }
}

export interface BackendWaitlistEntry {
  id: number
  version: number
  kind: WaitlistKind
  guestName: string
  phoneLast3?: string | null
  partySize: number
  businessDate: string
  queuedAt: Date
  status: WaitlistStatus
  contactChannel: WaitlistChannel
  reservationId: number | null
  reservationExpectedAt: Date | null
  visitId: number | null
  note: string | null
}

export function mapWaitlist(entry: BackendWaitlistEntry): WaitlistEntryView {
  return {
    id: entry.id,
    version: entry.version,
    kind: entry.kind,
    displayName: entry.guestName,
    phoneLast3: entry.phoneLast3 ?? null,
    customerId: null,
    partySize: entry.partySize,
    preferenceMode: null,
    preferences: [],
    channel: entry.contactChannel,
    businessDate: entry.businessDate,
    queuedAt: entry.queuedAt,
    status: entry.status,
    claimedBy: null,
    claimExpiresAt: null,
    offeredAt: null,
    hold: null,
    reservationId: entry.reservationId,
    reservationExpectedAt: entry.reservationExpectedAt ?? null,
    attempts: null,
    note: entry.note,
    callbackRequested: null,
    closedAt: null,
  }
}

export function deriveAvailability(
  at: Date,
  partySize: number,
  floor: FloorState,
  bookings: HttpBooking[],
  catalog: Catalog,
): AvailabilityResult {
  const tables = catalog.tables.map((table) => {
    const live = floor.tables.find((state) => state.tableId === table.id)
    const conflicts = bookings.filter(
      (booking) => booking.status === "BOOKED" && booking.tableCodes.includes(table.code),
    )
    let status: AvailabilityResult["tables"][number]["status"] = "available"
    let reason = "Trống theo trạng thái máy chủ. Máy chủ kiểm tra lại khi phân bàn."
    if (!live) {
      status = "not_bookable"
      reason = "Chưa có trạng thái bàn từ máy chủ."
    } else if (live.state === "oos") {
      status = "oos"
      reason = "Bàn ngừng phục vụ."
    } else if (live.state === "seated") {
      status = "occupied_unknown_end"
      reason = "Đang có khách, chưa biết giờ nhả bàn."
    } else if (live.staleFromPreviousDay) {
      status = "reserved"
      reason = "Bàn chưa nhả từ hôm trước. Cần nhả bàn thủ công."
    } else if (["reserved", "late", "noshow", "hold", "hold_overdue"].includes(live.state)) {
      status = "reserved"
      reason = "Máy chủ đang giữ bàn."
    } else if (table.isSpare || live.state === "spare") {
      status = "spare"
      reason = "Bàn sơ cua."
    } else if (!catalog.zones.find((zone) => zone.id === table.zoneId)?.isBookable) {
      status = "not_bookable"
      reason = "Khu không nhận đặt bàn."
    } else if (table.capacity < partySize) {
      status = "too_small"
      reason = "Không đủ chỗ cho số khách."
    }
    return {
      tableId: table.id,
      status,
      reason,
      claimStartsAt: live?.claim?.startsAt ?? null,
      bookingConflicts: conflicts.map((booking) => ({ reservationId: booking.id, expectedAt: booking.expectedAt })),
    }
  })
  return {
    at,
    businessDate: floor.businessDate,
    partySize,
    policy: catalog.venue.reservationHoldPolicy,
    tables,
    combinations: catalog.combinations.map((combination) => {
      const members = combination.memberIds.map((id) => tables.find((table) => table.tableId === id))
      // Capacity is evaluated for the entire combination rather than each member.
      const available =
        combination.capacity >= partySize &&
        members.length > 0 &&
        members.every((member) => member && ["available", "too_small"].includes(member.status))
      return {
        combinationId: combination.id,
        capacity: combination.capacity,
        available,
        reason: available
          ? "Có thể ghép, máy chủ kiểm tra lại khi phân bàn."
          : "Cụm bàn chưa sẵn sàng hoặc không đủ chỗ.",
      }
    }),
  }
}

export function deriveOverview(
  now: Date,
  floor: FloorState,
  bookings: HttpBooking[],
  waitlist: WaitlistEntryView[],
  catalog: Catalog,
): ShiftOverview {
  const visits = new Map(
    floor.tables.flatMap((table) =>
      table.claim?.kind === "visit" && table.claim.visitId !== null
        ? [[table.claim.visitId, table.claim] as const]
        : [],
    ),
  )
  const booked = bookings.filter((booking) => booking.status === "BOOKED")
  const activeWaitlist = waitlist.filter((entry) => !["SEATED", "DECLINED", "CANCELLED"].includes(entry.status))
  const inUse = new Set(floor.tables.filter((table) => table.state === "seated").map((table) => table.tableId))
  const tableIds = catalog.tables.filter((table) => table.kind === "TABLE")
  const barSeats = catalog.tables.filter((table) => table.kind === "BAR_SEAT")
  return {
    businessDate: businessDateOf(now),
    reservationsTotal: bookings.length,
    reservationsUpcoming60: booked.filter(
      (booking) => booking.expectedAt >= now && booking.expectedAt.getTime() <= now.getTime() + 3_600_000,
    ).length,
    reservationsUnassigned: booked.filter((booking) => !booking.tableCodes.length).length,
    checkedInReservations: bookings.filter((booking) => booking.status === "CHECKED_IN").length,
    seatedVisits: visits.size,
    seatedGuests: [...visits.values()].reduce((sum, visit) => sum + visit.partySize, 0),
    // Completed walk-ins and historical seating instants have no read endpoint.
    visitsTonight: null,
    guestsTonight: null,
    tablesInUse: tableIds.filter((table) => inUse.has(table.id)).length,
    tablesTotal: tableIds.length,
    barSeatsInUse: barSeats.filter((table) => inUse.has(table.id)).length,
    barSeatsTotal: barSeats.length,
    attention: new Set(
      floor.tables
        .filter((table) => table.claim?.warning || table.staleFromPreviousDay)
        .map((table) => `${table.claim?.kind}:${table.claim?.visitId ?? table.claim?.reservationId}`),
    ).size,
    waitlistAdvance: activeWaitlist.filter((entry) => entry.kind === "ADVANCE_RESERVATION").length,
    waitlistWalkIn: activeWaitlist.filter((entry) => entry.kind === "WALK_IN").length,
    byHour: Array.from({ length: 12 }, (_, index) => (index + 17) % 24).map((hour) => ({
      hour: fmtTime(new Date(Date.UTC(2000, 0, 1, hour - 7))),
      expected: bookings
        .filter((booking) => booking.status !== "CANCELLED" && venueParts(booking.expectedAt).hour === hour)
        .reduce((sum, booking) => sum + booking.partySize, 0),
      seated: null,
    })),
    byZone: catalog.zones.map((zone) => ({
      zone: zone.code,
      name: zone.name,
      total: catalog.tables.filter((table) => table.zoneId === zone.id).length,
      inUse: catalog.tables.filter((table) => table.zoneId === zone.id && inUse.has(table.id)).length,
    })),
  }
}

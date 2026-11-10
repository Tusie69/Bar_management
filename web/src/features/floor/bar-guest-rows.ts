import type { ClaimView, FloorGroup, FloorTableState, TableLiveState, TableView } from "@/domain/models"
import { fmtTime } from "@/lib/time"

export interface BarGuestRowIcons {
  cake?: boolean
  vip?: boolean
  returning?: boolean
  newGuest?: boolean
  pin?: boolean
}

export interface BarGuestRow {
  bookingKey: string
  seatNumbers: number[]
  seatsLabel: string
  time: string | null
  partySize: number
  guestName: string
  state: TableLiveState
  icons: BarGuestRowIcons
}

export interface BuildBarGuestRowsOptions {
  tables: TableView[]
  states?: Map<number, FloorTableState> | FloorTableState[] | null
  groups?: FloorGroup[] | null
}

/**
 * Bounds of the free inner rectangle in the bar zone ("Khu pha chế" area).
 * Counter inner corner: x = 424, y = 430.
 * Back bar inner edge: x = 540, y = 716.
 * Leaving 2px padding from architectural walls:
 * x = 426, y = 432, width = 112 (426..538), height = 284 (432..716).
 */
export const DEFAULT_BAR_GUEST_LIST_BOUNDS = {
  x: 426,
  y: 432,
  width: 112,
  height: 284,
} as const

/**
 * Extracts the numerical sequence number of a bar seat (1..21).
 */
export function extractBarSeatNumber(table: TableView): number | null {
  if (table.seqNo != null && table.seqNo > 0) {
    return table.seqNo
  }
  const match = table.code.match(/\d+/)
  if (match) {
    const num = parseInt(match[0], 10)
    if (!Number.isNaN(num) && num > 0) return num
  }
  return null
}

/**
 * Checks if a table belongs to the bar seating zone or is a bar seat.
 */
export function isBarSeat(table: TableView): boolean {
  return table.kind === "BAR_SEAT" || table.zoneCode === "BAR" || /^BAR/i.test(table.code)
}

/**
 * Formats a list of seat numbers into the concise standard:
 * - Single seat: "Bar1"
 * - Consecutive range: "Bar7-8", "Bar1-3"
 * - Non-consecutive list: "Bar15, 19", "Bar5, 17"
 * - Mixed: "Bar1-2, 5"
 */
export function formatBarSeatLabel(seatNumbers: number[]): string {
  if (!seatNumbers.length) return ""
  const sorted = Array.from(new Set(seatNumbers)).sort((a, b) => a - b)

  const ranges: Array<[number, number]> = []
  let start = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    if (cur === prev + 1) {
      prev = cur
    } else {
      ranges.push([start, prev])
      start = cur
      prev = cur
    }
  }
  ranges.push([start, prev])

  return ranges
    .map(([s, e], idx) => {
      const seg = s === e ? `${s}` : `${s}-${e}`
      return idx === 0 ? `Bar${seg}` : seg
    })
    .join(", ")
}

/**
 * Formats the customer name according to the business rules:
 * - Real name is preserved without alteration.
 * - Walk-in or phone-only bookings without a name show "Khách Walk-in".
 * - Never shows a phone number or made-up name.
 */
export function formatBarGuestName(displayName?: string | null): string {
  const raw = (displayName ?? "").trim()
  if (!raw) return "Khách Walk-in"

  // Check if string contains only phone number digits / separators (e.g. 0901234567, +84..., 090-123)
  const isPhoneOnly =
    (!/[a-zA-ZÀ-ỹ]/.test(raw) && /\d{4,}/.test(raw)) ||
    /^\+?[\d\s.\-()]{6,}$/.test(raw)
  if (isPhoneOnly) {
    return "Khách Walk-in"
  }

  // Walk-in synonyms
  if (/^(khách walk-in|walk-in|khách vãng lai|khách lẻ|khách)$/i.test(raw)) {
    return "Khách Walk-in"
  }

  return raw
}

/**
 * Formats the booked time according to the rules:
 * - Before check-in: uses booked time (claim.reservedExpectedAt ?? claim.startsAt).
 * - After check-in (seated / visit): uses reservedExpectedAt when present.
 *   Never shows the entry time (startsAt) as if it were the booked time. Absent shows nothing (null).
 */
export function formatBarBookedTime(
  claim: ClaimView | null | undefined,
  state: TableLiveState,
): string | null {
  if (!claim) return null

  const isCheckedIn = state === "seated" || claim.kind === "visit"

  if (isCheckedIn) {
    // After check-in, only show booked time if reservedExpectedAt is present
    if (claim.reservedExpectedAt) {
      const timeStr = fmtTime(claim.reservedExpectedAt)
      return timeStr === "--:--" ? null : timeStr
    }
    return null
  }

  // Before check-in
  const expectedDate = claim.reservedExpectedAt ?? claim.startsAt
  if (expectedDate) {
    const timeStr = fmtTime(expectedDate)
    return timeStr === "--:--" ? null : timeStr
  }

  return null
}

/**
 * Resolves special icons from real claim metadata.
 * Real data only; never hardcoded or hallucinated.
 */
export function extractBarGuestIcons(claim: ClaimView | null | undefined): BarGuestRowIcons {
  const icons: BarGuestRowIcons = {}
  if (!claim) return icons

  const tokens = [
    ...(Array.isArray(claim.flags) ? claim.flags : []),
    ...(Array.isArray(claim.iconKeys) ? claim.iconKeys : []),
  ]
    .filter(Boolean)
    .map((t) => String(t).trim().toLowerCase())

  if (
    tokens.some(
      (k) => k === "birthday" || k === "cake" || k === "is_birthday" || k === "sinh nhật" || k === "sinh nhat",
    )
  ) {
    icons.cake = true
  }

  if (
    tokens.some((k) => k === "star" || k === "vip" || k === "boss" || k === "bàn sếp" || k === "ban sep")
  ) {
    icons.vip = true
  }

  const hasReturning = tokens.some(
    (k) => k === "returning" || k === "fire" || k === "regular" || k === "khách quen" || k === "khach quen",
  )
  const hasNew = tokens.some((k) => k === "new" || k === "khách mới" || k === "khach moi")

  if (hasReturning) {
    icons.returning = true
  } else if (hasNew) {
    icons.newGuest = true
  }

  if (tokens.some((k) => k === "pin" || k === "designated" || k === "chỉ định" || k === "chi dinh")) {
    icons.pin = true
  }

  return icons
}

interface GroupedBooking {
  bookingKey: string
  seatNumbers: number[]
  claim: ClaimView
  state: TableLiveState
}

/**
 * Pure function mapping floor model data to bar guest rows.
 *
 * Rules:
 * - One row per booking even with several seats.
 * - A booking with both tables and Bar seats lists only its Bar seats, with the booking's total count.
 * - Cancelled bookings are gone.
 * - Sort by seat number (lowest seat number first).
 * - No hardcoded data, no duplicate rows.
 * - Guest count comes from partySize (never multiplied by seats).
 */
export function buildBarGuestRows(
  tablesOrOptions: TableView[] | BuildBarGuestRowsOptions,
  maybeStates?: Map<number, FloorTableState> | FloorTableState[] | null,
  _maybeGroups?: FloorGroup[] | null,
): BarGuestRow[] {
  let tables: TableView[]
  let statesInput: Map<number, FloorTableState> | FloorTableState[] | null | undefined

  if (Array.isArray(tablesOrOptions)) {
    tables = tablesOrOptions
    statesInput = maybeStates
  } else if (tablesOrOptions && typeof tablesOrOptions === "object") {
    tables = tablesOrOptions.tables
    statesInput = tablesOrOptions.states
  } else {
    return []
  }

  if (!tables || !tables.length) return []

  const statesMap: Map<number, FloorTableState> =
    statesInput instanceof Map
      ? statesInput
      : Array.isArray(statesInput)
        ? new Map(statesInput.map((s) => [s.tableId, s]))
        : new Map()

  // Track bookings by unique key to combine multi-seat bookings into 1 row
  const bookingMap = new Map<string, GroupedBooking>()
  // Keep object identity mapping for claims that may not have explicit IDs
  const claimRefKeyMap = new Map<ClaimView, string>()

  // Filter only bar seats
  const barTables = tables.filter(isBarSeat)

  for (const table of barTables) {
    const fs = statesMap.get(table.id)
    if (!fs || !fs.claim) continue

    const state = fs.state
    // Free, spare, or out of service seats do not have active guest rows
    if (state === "free" || state === "spare" || state === "oos") continue

    const claim = fs.claim
    // Cancelled bookings are gone
    if (
      (claim as unknown as { status?: string }).status === "CANCELLED" ||
      (claim as unknown as { cancelledAt?: unknown }).cancelledAt != null
    ) {
      continue
    }

    const seatNo = extractBarSeatNumber(table)
    if (seatNo == null) continue

    // Determine authoritative booking key
    let bookingKey = claimRefKeyMap.get(claim)
    if (!bookingKey) {
      if (claim.reservationId != null) {
        bookingKey = `res:${claim.reservationId}`
      } else if (claim.visitId != null) {
        bookingKey = `visit:${claim.visitId}`
      } else if (claim.holdId != null) {
        bookingKey = `hold:${claim.holdId}`
      } else if (claim.waitlistEntryId != null) {
        bookingKey = `wait:${claim.waitlistEntryId}`
      } else if (claim.groupId != null) {
        bookingKey = `group:${claim.groupId}`
      } else if (claim.tableIds && claim.tableIds.length > 0) {
        const sortedIds = [...claim.tableIds].sort((a, b) => a - b).join(",")
        bookingKey = `tables:${sortedIds}`
      } else {
        bookingKey = `claim_${table.id}_${claim.displayName ?? ""}_${claim.startsAt ? new Date(claim.startsAt).getTime() : ""}`
      }
      claimRefKeyMap.set(claim, bookingKey)
    }

    let existing = bookingMap.get(bookingKey)
    if (!existing) {
      existing = {
        bookingKey,
        seatNumbers: [],
        claim,
        state,
      }
      bookingMap.set(bookingKey, existing)
    }

    if (!existing.seatNumbers.includes(seatNo)) {
      existing.seatNumbers.push(seatNo)
    }

    // If one of the seats has a more advanced state (e.g. seated), prefer seated
    if (state === "seated") {
      existing.state = "seated"
    }
  }

  // Convert to output rows
  const rows: BarGuestRow[] = []

  for (const item of bookingMap.values()) {
    item.seatNumbers.sort((a, b) => a - b)
    const seatsLabel = formatBarSeatLabel(item.seatNumbers)
    const time = formatBarBookedTime(item.claim, item.state)
    const partySize = item.claim.partySize ?? 1
    const guestName = formatBarGuestName(item.claim.displayName)
    const icons = extractBarGuestIcons(item.claim)

    rows.push({
      bookingKey: item.bookingKey,
      seatNumbers: item.seatNumbers,
      seatsLabel,
      time,
      partySize,
      guestName,
      state: item.state,
      icons,
    })
  }

  // Sort rows by seat number (lowest seat number first)
  rows.sort((a, b) => (a.seatNumbers[0] ?? 0) - (b.seatNumbers[0] ?? 0))

  return rows
}

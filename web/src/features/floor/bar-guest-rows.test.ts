import { describe, expect, it } from "vitest"
import type { ClaimView, FloorTableState, TableLiveState, TableView } from "@/domain/models"
import {
  buildBarGuestRows,
  extractBarGuestIcons,
  formatBarBookedTime,
  formatBarGuestName,
  formatBarSeatLabel,
} from "./bar-guest-rows"

function makeTable(id: number, seqNo: number, code = `BAR${String(seqNo).padStart(2, "0")}`, kind = "BAR_SEAT", zoneCode = "BAR"): TableView {
  return {
    id,
    version: 1,
    code,
    displayName: `Ghế ${seqNo}`,
    zoneId: 2,
    zoneCode: zoneCode as any,
    kind: kind as any,
    capacity: 1,
    seqNo,
    isSpare: false,
    status: "ACTIVE",
    x: 350,
    y: 400 + seqNo * 10,
    w: 24,
    h: 24,
    seating: "bar",
  }
}

function makeClaim(partial: Partial<ClaimView> = {}): ClaimView {
  return {
    kind: "reservation",
    visitId: null,
    reservationId: 101,
    waitlistEntryId: null,
    holdId: null,
    displayName: "Nguyễn Văn Nam",
    phoneLast3: "456",
    partySize: 2,
    startsAt: new Date("2026-11-09T14:00:00.000Z"), // 21:00 UTC+7
    deadlineAt: null,
    paid: false,
    origin: null,
    tableIds: [1],
    groupId: null,
    warning: null,
    minutesLate: 0,
    sourceCode: null,
    note: null,
    version: 1,
    reservedExpectedAt: null,
    iconKeys: [],
    flags: [],
    ...partial,
  }
}

function makeState(tableId: number, state: TableLiveState, claim: ClaimView | null): FloorTableState {
  return {
    tableId,
    state,
    claim,
    staleFromPreviousDay: false,
  }
}

describe("bar-guest-rows formatting helpers", () => {
  it("formats bar seat label for single, consecutive, and non-adjacent seats", () => {
    // 1 seat
    expect(formatBarSeatLabel([1])).toBe("Bar1")
    expect(formatBarSeatLabel([7])).toBe("Bar7")

    // 2 consecutive seats
    expect(formatBarSeatLabel([7, 8])).toBe("Bar7-8")
    expect(formatBarSeatLabel([1, 2, 3])).toBe("Bar1-3")

    // non-adjacent seats (shorter form: Bar prefix on first item only)
    expect(formatBarSeatLabel([5, 17])).toBe("Bar5, 17")
    expect(formatBarSeatLabel([15, 19])).toBe("Bar15, 19")
    expect(formatBarSeatLabel([1, 5, 17])).toBe("Bar1, 5, 17")
    expect(formatBarSeatLabel([12, 15, 19])).toBe("Bar12, 15, 19")

    // mixed ranges and a range plus a single seat
    expect(formatBarSeatLabel([2, 3, 4, 19])).toBe("Bar2-4, 19")
    expect(formatBarSeatLabel([15, 16, 19])).toBe("Bar15-16, 19")
    expect(formatBarSeatLabel([1, 2, 5, 6, 17])).toBe("Bar1-2, 5-6, 17")
  })

  it("formats guest name without displaying phone numbers or fake names", () => {
    // Real name preserved
    expect(formatBarGuestName("Nam")).toBe("Nam")
    expect(formatBarGuestName("Trần Thị Bích Ngọc")).toBe("Trần Thị Bích Ngọc")

    // Empty or whitespace shows Khách Walk-in
    expect(formatBarGuestName("")).toBe("Khách Walk-in")
    expect(formatBarGuestName("   ")).toBe("Khách Walk-in")
    expect(formatBarGuestName(null)).toBe("Khách Walk-in")
    expect(formatBarGuestName(undefined)).toBe("Khách Walk-in")

    // Phone number without name shows Khách Walk-in (never reveals phone)
    expect(formatBarGuestName("0901234567")).toBe("Khách Walk-in")
    expect(formatBarGuestName("+84901234567")).toBe("Khách Walk-in")
    expect(formatBarGuestName("090-123-4567")).toBe("Khách Walk-in")

    // Walk-in synonyms
    expect(formatBarGuestName("Walk-in")).toBe("Khách Walk-in")
    expect(formatBarGuestName("khách lẻ")).toBe("Khách Walk-in")
  })

  it("formats booked time accurately before and after check-in", () => {
    const claimBeforeCheckin = makeClaim({
      startsAt: new Date("2026-11-09T14:00:00.000Z"), // 21:00 UTC+7
      reservedExpectedAt: null,
    })
    // Before check-in: uses startsAt
    expect(formatBarBookedTime(claimBeforeCheckin, "reserved")).toBe("21:00")
    expect(formatBarBookedTime(claimBeforeCheckin, "upcoming")).toBe("21:00")

    // After check-in with reservedExpectedAt: uses reservedExpectedAt
    const claimSeatedWithBookedTime = makeClaim({
      kind: "visit",
      startsAt: new Date("2026-11-09T14:45:00.000Z"), // 21:45 entry time
      reservedExpectedAt: new Date("2026-11-09T14:00:00.000Z"), // 21:00 booked time
    })
    expect(formatBarBookedTime(claimSeatedWithBookedTime, "seated")).toBe("21:00")

    // After check-in without reservedExpectedAt (walk-in or missing HTTP data): shows nothing
    const claimSeatedWalkIn = makeClaim({
      kind: "visit",
      startsAt: new Date("2026-11-09T14:45:00.000Z"), // entry time
      reservedExpectedAt: null,
    })
    expect(formatBarBookedTime(claimSeatedWalkIn, "seated")).toBeNull()
  })

  it("extracts icons only from real metadata", () => {
    expect(extractBarGuestIcons(null)).toEqual({})

    // Birthday
    expect(extractBarGuestIcons(makeClaim({ flags: ["BIRTHDAY"] }))).toEqual({ cake: true })
    expect(extractBarGuestIcons(makeClaim({ iconKeys: ["cake"] }))).toEqual({ cake: true })

    // VIP
    expect(extractBarGuestIcons(makeClaim({ flags: ["VIP"] }))).toEqual({ vip: true })

    // Returning vs New
    expect(extractBarGuestIcons(makeClaim({ flags: ["RETURNING"] }))).toEqual({ returning: true })
    expect(extractBarGuestIcons(makeClaim({ flags: ["NEW"] }))).toEqual({ newGuest: true })

    // No icons
    expect(extractBarGuestIcons(makeClaim({ flags: [], iconKeys: [] }))).toEqual({})
  })
})

describe("buildBarGuestRows", () => {
  it("handles one seat", () => {
    const tables = [makeTable(1, 1)]
    const states = new Map([
      [1, makeState(1, "reserved", makeClaim({ displayName: "Nam", partySize: 1 }))],
    ])

    const rows = buildBarGuestRows(tables, states)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.seatsLabel).toBe("Bar1")
    expect(rows[0]!.seatNumbers).toEqual([1])
    expect(rows[0]!.guestName).toBe("Nam")
    expect(rows[0]!.partySize).toBe(1)
    expect(rows[0]!.time).toBe("21:00")
  })

  it("handles two seats for one booking", () => {
    const tables = [makeTable(7, 7), makeTable(8, 8)]
    const claim = makeClaim({
      reservationId: 78,
      displayName: "Hưng",
      partySize: 2,
      tableIds: [7, 8],
    })
    const states = new Map([
      [7, makeState(7, "reserved", claim)],
      [8, makeState(8, "reserved", claim)],
    ])

    const rows = buildBarGuestRows(tables, states)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.seatsLabel).toBe("Bar7-8")
    expect(rows[0]!.seatNumbers).toEqual([7, 8])
    expect(rows[0]!.guestName).toBe("Hưng")
    expect(rows[0]!.partySize).toBe(2)
  })

  it("handles non-adjacent seats for one booking", () => {
    const tables = [makeTable(5, 5), makeTable(17, 17)]
    const claim = makeClaim({
      reservationId: 517,
      displayName: "Đức",
      partySize: 2,
      tableIds: [5, 17],
    })
    const states = new Map([
      [5, makeState(5, "reserved", claim)],
      [17, makeState(17, "reserved", claim)],
    ])

    const rows = buildBarGuestRows(tables, states)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.seatsLabel).toBe("Bar5, 17")
    expect(rows[0]!.seatNumbers).toEqual([5, 17])
    expect(rows[0]!.guestName).toBe("Đức")
  })

  it("handles a booking with both tables and Bar seats", () => {
    // Table B3 (id 200) + Bar Seat 1 (id 1)
    const tableB3: TableView = {
      id: 200,
      version: 1,
      code: "B3",
      displayName: "Bàn B3",
      zoneId: 1,
      zoneCode: "B",
      kind: "TABLE",
      capacity: 4,
      seqNo: null,
      isSpare: false,
      status: "ACTIVE",
      x: 200,
      y: 200,
      w: 48,
      h: 46,
      seating: "four-sides",
    }
    const bar1 = makeTable(1, 1)
    const tables = [tableB3, bar1]

    const claim = makeClaim({
      reservationId: 888,
      displayName: "Khánh",
      partySize: 5,
      tableIds: [200, 1],
    })
    const states = new Map([
      [200, makeState(200, "seated", claim)],
      [1, makeState(1, "seated", claim)],
    ])

    const rows = buildBarGuestRows(tables, states)
    // Lists only its Bar seats, with the booking's total count
    expect(rows).toHaveLength(1)
    expect(rows[0]!.seatsLabel).toBe("Bar1")
    expect(rows[0]!.seatNumbers).toEqual([1])
    expect(rows[0]!.partySize).toBe(5)
    expect(rows[0]!.guestName).toBe("Khánh")
  })

  it("distinguishes before check-in and after check-in time display", () => {
    const bar1 = makeTable(1, 1)
    const bar2 = makeTable(2, 2)
    const tables = [bar1, bar2]

    // bar1: before check-in (reserved)
    const claimBefore = makeClaim({
      reservationId: 101,
      displayName: "Khách 1",
      startsAt: new Date("2026-11-09T13:30:00.000Z"), // 20:30 UTC+7
    })

    // bar2: after check-in without reservedExpectedAt (e.g. walk-in entry at 20:45)
    const claimAfterNoBookedTime = makeClaim({
      kind: "visit",
      visitId: 202,
      reservationId: null,
      displayName: "Khách 2",
      startsAt: new Date("2026-11-09T13:45:00.000Z"), // entry time
      reservedExpectedAt: null,
    })

    const states = new Map([
      [1, makeState(1, "reserved", claimBefore)],
      [2, makeState(2, "seated", claimAfterNoBookedTime)],
    ])

    const rows = buildBarGuestRows(tables, states)
    expect(rows).toHaveLength(2)

    // Before check-in shows booked time
    expect(rows[0]!.time).toBe("20:30")

    // After check-in without reservedExpectedAt shows null (never entry time)
    expect(rows[1]!.time).toBeNull()
  })

  it("shows reservedExpectedAt after check-in when present", () => {
    const bar1 = makeTable(1, 1)
    const tables = [bar1]

    const claim = makeClaim({
      kind: "visit",
      visitId: 301,
      reservationId: 101,
      displayName: "Khách Có Đặt Trước",
      startsAt: new Date("2026-11-09T14:15:00.000Z"), // check-in entry time 21:15
      reservedExpectedAt: new Date("2026-11-09T14:00:00.000Z"), // booked time 21:00
    })

    const states = new Map([[1, makeState(1, "seated", claim)]])
    const rows = buildBarGuestRows(tables, states)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.time).toBe("21:00")
  })

  it("removes cancelled bookings", () => {
    const bar1 = makeTable(1, 1)
    const bar2 = makeTable(2, 2)
    const tables = [bar1, bar2]

    const cancelledClaim = makeClaim({
      reservationId: 999,
      displayName: "Khách Đã Huỷ",
      // marked cancelled
      ...({ status: "CANCELLED" } as any),
    })

    const activeClaim = makeClaim({
      reservationId: 100,
      displayName: "Khách Hoạt Động",
    })

    const states = new Map([
      [1, makeState(1, "free", cancelledClaim)], // free / cancelled seat
      [2, makeState(2, "reserved", activeClaim)],
    ])

    const rows = buildBarGuestRows(tables, states)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.guestName).toBe("Khách Hoạt Động")
  })

  it("handles many bookings sorted by seat number", () => {
    const t3 = makeTable(3, 3)
    const t1 = makeTable(1, 1)
    const t7 = makeTable(7, 7)
    const t8 = makeTable(8, 8)
    const tables = [t3, t1, t8, t7] // unordered tables

    const claim1 = makeClaim({ reservationId: 1, displayName: "Guest 1", tableIds: [1] })
    const claim3 = makeClaim({ reservationId: 3, displayName: "Guest 3", tableIds: [3] })
    const claim78 = makeClaim({ reservationId: 78, displayName: "Guest 7-8", tableIds: [7, 8] })

    const states = new Map([
      [1, makeState(1, "seated", claim1)],
      [3, makeState(3, "reserved", claim3)],
      [7, makeState(7, "upcoming", claim78)],
      [8, makeState(8, "upcoming", claim78)],
    ])

    const rows = buildBarGuestRows(tables, states)
    expect(rows).toHaveLength(3)
    // Sorted by seat number: 1, 3, 7-8
    expect(rows[0]!.seatsLabel).toBe("Bar1")
    expect(rows[1]!.seatsLabel).toBe("Bar3")
    expect(rows[2]!.seatsLabel).toBe("Bar7-8")
  })

  it("preserves long Vietnamese name", () => {
    const table = makeTable(1, 1)
    const longName = "Nguyễn Thị Hoàng Oanh"
    const states = new Map([
      [1, makeState(1, "seated", makeClaim({ displayName: longName }))],
    ])

    const rows = buildBarGuestRows([table], states)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.guestName).toBe(longName)
  })

  it("handles no name / phone-only booking and never outputs phone numbers", () => {
    const t1 = makeTable(1, 1)
    const t2 = makeTable(2, 2)
    const t3 = makeTable(3, 3)

    const emptyNameClaim = makeClaim({ reservationId: 1, displayName: "", phoneLast3: "999" })
    const phoneOnlyClaim = makeClaim({
      reservationId: 2,
      displayName: "0901234567",
      phoneLast3: "567",
    })
    const walkinClaim = makeClaim({
      reservationId: 3,
      displayName: "Walk-in",
      phoneLast3: null,
    })

    const states = new Map([
      [1, makeState(1, "seated", emptyNameClaim)],
      [2, makeState(2, "seated", phoneOnlyClaim)],
      [3, makeState(3, "seated", walkinClaim)],
    ])

    const rows = buildBarGuestRows([t1, t2, t3], states)
    expect(rows).toHaveLength(3)

    // All should resolve to "Khách Walk-in"
    expect(rows[0]!.guestName).toBe("Khách Walk-in")
    expect(rows[1]!.guestName).toBe("Khách Walk-in")
    expect(rows[2]!.guestName).toBe("Khách Walk-in")

    // Verify absolutely no phone numbers in output
    for (const r of rows) {
      expect(r.guestName).not.toMatch(/\d{3,}/)
      expect(JSON.stringify(r)).not.toContain("0901234567")
      expect(JSON.stringify(r)).not.toContain("999")
    }
  })

  it("ensures guest count is not multiplied by seats", () => {
    // 3 seats allocated to 1 booking of partySize 4
    const t10 = makeTable(10, 10)
    const t11 = makeTable(11, 11)
    const t12 = makeTable(12, 12)

    const claim = makeClaim({
      reservationId: 444,
      displayName: "Party 4",
      partySize: 4,
      tableIds: [10, 11, 12],
    })

    const states = new Map([
      [10, makeState(10, "reserved", claim)],
      [11, makeState(11, "reserved", claim)],
      [12, makeState(12, "reserved", claim)],
    ])

    const rows = buildBarGuestRows([t10, t11, t12], states)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.seatsLabel).toBe("Bar10-12")
    // Total count is 4, NOT 4 * 3 = 12
    expect(rows[0]!.partySize).toBe(4)
  })

  it("handles BR-05 case: Bar2-4 booking with 12 guests and 4 metadata icons", () => {
    const t2 = makeTable(2, 2)
    const t3 = makeTable(3, 3)
    const t4 = makeTable(4, 4)

    const claim = makeClaim({
      reservationId: 234,
      displayName: "Overflow guest",
      partySize: 12,
      tableIds: [2, 3, 4],
      startsAt: new Date("2026-11-09T15:00:00.000Z"), // 22:00 UTC+7
      flags: ["BIRTHDAY", "RETURNING"],
      iconKeys: ["star", "pin"],
    })

    const states = new Map([
      [2, makeState(2, "reserved", claim)],
      [3, makeState(3, "reserved", claim)],
      [4, makeState(4, "reserved", claim)],
    ])

    const rows = buildBarGuestRows([t2, t3, t4], states)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.seatsLabel).toBe("Bar2-4")
    expect(rows[0]!.seatNumbers).toEqual([2, 3, 4])
    expect(rows[0]!.guestName).toBe("Overflow guest")
    expect(rows[0]!.partySize).toBe(12)
    expect(rows[0]!.time).toBe("22:00")
    expect(rows[0]!.icons).toEqual({
      cake: true,
      vip: true,
      returning: true,
      pin: true,
    })
  })
})

import { describe, expect, it } from "vitest"
import type { ReservationView } from "@/domain/models"
import { buildGuestCount, GUEST_COUNT_SPLIT } from "./guest-count"

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  const d = new Date(2026, 10, 12, h, m, 0, 0)
  return d
}

let nextId = 1
function booking(p: Partial<ReservationView> & { partySize: number }): ReservationView {
  const expectedAt = p.expectedAt ?? at("20:00")
  return {
    id: nextId++,
    version: 1,
    customerId: null,
    displayName: "Khách",
    hasGuestName: true,
    phoneLast3: null,
    expectedAt,
    businessDate: "2026-11-12",
    classification: "UNCLASSIFIED",
    guestType: null,
    isBirthday: false,
    status: "BOOKED",
    sourceCode: "PHONE",
    note: null,
    tableIds: [],
    holdId: null,
    symbolNo: null,
    subState: null,
    warning: "none",
    minutesLate: 0,
    waitlistEntryId: null,
    visitId: null,
    checkedInAt: null,
    closedAt: null,
    closeReasonCode: null,
    ...p,
  } as ReservationView
}

describe("buildGuestCount", () => {
  it("gives every row zero when there is nothing booked", () => {
    const c = buildGuestCount([])
    expect(c).toMatchObject({
      splitLabel: "21:30",
      arrivedBefore: 0,
      arrivedAfter: 0,
      arrivedTotal: 0,
      bookedTables: 0,
      bookedGuests: 0,
      returningGuests: 0,
    })
    expect(buildGuestCount(undefined).arrivedTotal).toBe(0)
  })

  it("splits only the guests who already arrived, around the boundary", () => {
    const c = buildGuestCount([
      booking({ partySize: 4, status: "CHECKED_IN", checkedInAt: at("19:10") }),
      booking({ partySize: 8, status: "CHECKED_IN", checkedInAt: at("21:00") }),
      booking({ partySize: 6, status: "CHECKED_IN", checkedInAt: at("22:40") }),
      // Not seated yet: counts as booked, never as arrived.
      booking({ partySize: 20, status: "BOOKED", expectedAt: at("23:30") }),
    ])
    expect(c.arrivedBefore).toBe(12)
    expect(c.arrivedAfter).toBe(6)
    // The relation the mockup's own figures show: 12 + 6 = 18.
    expect(c.arrivedTotal).toBe(c.arrivedBefore + c.arrivedAfter)
    expect(c.arrivedTotal).toBe(18)
    expect(c.bookedGuests).toBe(38)
  })

  it("puts an after-midnight arrival on the late side, not the early side", () => {
    const c = buildGuestCount([booking({ partySize: 3, status: "CHECKED_IN", checkedInAt: at("01:15") })])
    expect(c.arrivedBefore).toBe(0)
    expect(c.arrivedAfter).toBe(3)
  })

  it("falls back to the booked time when a seated booking has no check-in time", () => {
    const c = buildGuestCount([
      booking({ partySize: 5, status: "CHECKED_IN", checkedInAt: null, expectedAt: at("19:00") }),
    ])
    expect(c.arrivedBefore).toBe(5)
  })

  it("leaves cancelled and no-show bookings out of every figure", () => {
    const c = buildGuestCount([
      booking({ partySize: 9, status: "CANCELLED", tableIds: [1] }),
      booking({ partySize: 7, status: "NO_SHOW", tableIds: [2], classification: "RETURNING" }),
      booking({ partySize: 2, status: "BOOKED", tableIds: [3] }),
    ])
    expect(c.bookedGuests).toBe(2)
    expect(c.bookedTables).toBe(1)
    expect(c.returningGuests).toBe(0)
  })

  it("counts a table once when several bookings share it, and counts Khách quen from classification", () => {
    const c = buildGuestCount([
      booking({ partySize: 2, tableIds: [5, 6], classification: "RETURNING" }),
      booking({ partySize: 3, tableIds: [6, 7], classification: "NEW" }),
      // iconKeys is demo decoration and must not move the figure.
      booking({ partySize: 1, tableIds: [7], iconKeys: ["RETURNING"] }),
    ])
    expect(c.bookedTables).toBe(3)
    expect(c.returningGuests).toBe(1)
  })

  it("labels the rows with the boundary it used", () => {
    expect(buildGuestCount([], { hour: 20, minute: 5 }).splitLabel).toBe("20:05")
    expect(GUEST_COUNT_SPLIT).toEqual({ hour: 21, minute: 30 })
  })
})

import { describe, expect, it } from "vitest"
import { fromVenueLocal } from "@/lib/time"
import {
  BOOKING_SLOTS,
  GUEST_QUICK,
  bookingCalendarDate,
  bookingInstant,
  bookingSlots,
  businessMinute,
  isBookingSlot,
  parseOtherGuests,
  slotLabel,
  validateBookingTime,
} from "./booking-rules"

const BD = "2026-10-27"
const NOON = fromVenueLocal(BD, "12:00")

describe("guest count", () => {
  it("TC-01 quick picks are exactly 1..10", () => expect([...GUEST_QUICK]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
  it("TC-02/03 Khác accepts 11 and 20", () => {
    expect(parseOtherGuests("11")).toMatchObject({ ok: true, value: 11 })
    expect(parseOtherGuests(" 20 ")).toMatchObject({ ok: true, value: 20 })
  })
  it("TC-04 Khác rejects 10", () => expect(parseOtherGuests("10").ok).toBe(false))
  it("TC-05 Khác rejects 0, negatives, decimals, letters, empty", () => {
    for (const v of ["0", "-3", "12.5", "12,5", "abc", "1e2", ""]) expect(parseOtherGuests(v).ok).toBe(false)
  })
})

describe("booking slots", () => {
  it("has exactly 13 slots, 19:00 → 01:00, every 30 minutes, in business order", () => {
    expect(BOOKING_SLOTS).toEqual([
      "19:00",
      "19:30",
      "20:00",
      "20:30",
      "21:00",
      "21:30",
      "22:00",
      "22:30",
      "23:00",
      "23:30",
      "00:00",
      "00:30",
      "01:00",
    ])
    const mins = BOOKING_SLOTS.map(businessMinute)
    mins.slice(1).forEach((m, i) => expect(m - mins[i]).toBe(30))
  })
  it("TC-07/08/12 valid; TC-09/13/14 invalid", () => {
    expect(validateBookingTime(BD, "19:00", NOON)).toBeNull()
    expect(validateBookingTime(BD, "19:30", NOON)).toBeNull()
    expect(validateBookingTime(BD, "01:00", NOON)).toBeNull()
    expect(isBookingSlot("19:15")).toBe(false)
    expect(validateBookingTime(BD, "01:30", NOON)).not.toBeNull()
    expect(validateBookingTime(BD, "18:30", NOON)).not.toBeNull()
  })
  it("labels in AM/PM", () => {
    expect(BOOKING_SLOTS.map(slotLabel)).toEqual([
      "7:00 PM",
      "7:30 PM",
      "8:00 PM",
      "8:30 PM",
      "9:00 PM",
      "9:30 PM",
      "10:00 PM",
      "10:30 PM",
      "11:00 PM",
      "11:30 PM",
      "12:00 AM",
      "12:30 AM",
      "1:00 AM",
    ])
  })
  it("TC-10 11:30 PM stays on the business date", () => {
    expect(bookingCalendarDate(BD, "23:30")).toBe(BD)
    expect(bookingInstant(BD, "23:30").toISOString()).toBe("2026-10-27T16:30:00.000Z")
  })
  it("TC-11 12:00 AM uses the next calendar date", () => {
    expect(bookingCalendarDate(BD, "00:00")).toBe("2026-10-28")
    expect(bookingInstant(BD, "00:00").toISOString()).toBe("2026-10-27T17:00:00.000Z")
  })
  it("TC-15 month end rolls into the next month", () => {
    expect(bookingCalendarDate("2026-10-31", "00:30")).toBe("2026-11-01")
    expect(bookingInstant("2026-10-31", "00:30").toISOString()).toBe("2026-10-31T17:30:00.000Z")
  })
  it("TC-16 year end rolls into the next year", () => {
    expect(bookingCalendarDate("2026-12-31", "01:00")).toBe("2027-01-01")
    expect(bookingInstant("2026-12-31", "01:00").toISOString()).toBe("2026-12-31T18:00:00.000Z")
  })
  it("disables past slots for today only", () => {
    const now = fromVenueLocal(BD, "21:42")
    const s = bookingSlots(BD, now)
    expect(s.filter((x) => x.disabled).map((x) => x.time)).toEqual([
      "19:00",
      "19:30",
      "20:00",
      "20:30",
      "21:00",
      "21:30",
    ])
    expect(bookingSlots("2026-10-28", now).some((x) => x.disabled)).toBe(false)
  })
})

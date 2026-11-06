import { describe, expect, it } from "vitest"
import { businessDateOf, fromVenueLocal } from "@/lib/time"
import {
  BOOKING_SLOTS,
  BOOKING_MINUTES,
  GUEST_QUICK,
  bookingCalendarDate,
  bookingInstant,
  bookingSlotGroups,
  bookingSlots,
  businessMinute,
  configuredQuickSlots,
  isConfiguredQuickTime,
  isBookingSlot,
  isBookingTime,
  usableQuickTimes,
  isWithinBookingReceptionWindow,
  parseOtherGuests,
  slotLabel,
  validateBookingCheckInDate,
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

describe("booking check-in business date", () => {
  it("allows guests arriving early in the current business date", () => {
    expect(validateBookingCheckInDate("2026-10-29", fromVenueLocal("2026-10-29", "19:00"))).toBeNull()
  })

  it("rejects a future business date and keeps the previous date after midnight", () => {
    expect(validateBookingCheckInDate("2026-10-30", fromVenueLocal("2026-10-29", "19:00"))).not.toBeNull()
    expect(validateBookingCheckInDate("2026-10-29", fromVenueLocal("2026-10-30", "00:30"))).toBeNull()
  })

  it("reports no active check-in shift during 05:00–17:00", () => {
    expect(validateBookingCheckInDate("2026-10-30", fromVenueLocal("2026-10-30", "12:00"))).toContain("05:00–17:00")
  })

  it.each([
    ["2026-10-29", "18:00", "2026-10-29", true],
    ["2026-10-29", "23:30", "2026-10-30", false],
    ["2026-10-30", "00:30", "2026-10-29", true],
    ["2026-10-30", "04:59", "2026-10-29", true],
    ["2026-10-30", "05:00", "2026-10-29", false],
    ["2026-10-30", "12:00", "2026-10-30", false],
    ["2026-10-30", "16:59", "2026-10-30", false],
    ["2026-10-30", "17:00", "2026-10-30", true],
  ])("applies the official boundary %s %s", (calendarDate, time, businessDate, accepted) => {
    expect(validateBookingCheckInDate(businessDate, fromVenueLocal(calendarDate, time)) === null).toBe(accepted)
  })
})

describe("booking slots", () => {
  it("has exactly 25 slots, 19:00 → 01:00, every 15 minutes, in business order", () => {
    expect(BOOKING_SLOTS).toEqual([
      "19:00",
      "19:15",
      "19:30",
      "19:45",
      "20:00",
      "20:15",
      "20:30",
      "20:45",
      "21:00",
      "21:15",
      "21:30",
      "21:45",
      "22:00",
      "22:15",
      "22:30",
      "22:45",
      "23:00",
      "23:15",
      "23:30",
      "23:45",
      "00:00",
      "00:15",
      "00:30",
      "00:45",
      "01:00",
    ])
    const mins = BOOKING_SLOTS.map(businessMinute)
    mins.slice(1).forEach((m, i) => expect(m - mins[i]).toBe(15))
  })
  it("TC-07/08/12 valid; TC-09/13/14 invalid", () => {
    expect(validateBookingTime(BD, "19:00", NOON)).toBeNull()
    expect(validateBookingTime(BD, "19:30", NOON)).toBeNull()
    expect(validateBookingTime(BD, "01:00", NOON)).toBeNull()
    expect(isBookingSlot("19:15")).toBe(true)
    expect(validateBookingTime(BD, "01:30", NOON)).not.toBeNull()
    expect(validateBookingTime(BD, "18:30", NOON)).not.toBeNull()
  })
  it("adds venue quick times without removing canonical choices or changing an entered value", () => {
    const quickTimes = ["20:15", "22:45", "00:15", "20:17"]
    expect(isConfiguredQuickTime("20:15", quickTimes)).toBe(true)
    expect(validateBookingTime(BD, "20:15", NOON, undefined, quickTimes)).toBeNull()
    expect(configuredQuickSlots(BD, NOON, quickTimes).map((slot) => slot.time)).toEqual(["20:15", "22:45", "00:15"])
    expect(bookingSlots(BD, NOON).map((slot) => slot.time)).toEqual(BOOKING_SLOTS)
    expect(validateBookingTime(BD, "20:17", NOON, undefined, quickTimes)).not.toBeNull()
  })
  it.each([
    ["24:00", false],
    ["19:60", false],
    ["99:99", false],
    ["19:00", true],
    ["21:00", true],
    ["23:30", true],
    ["00:30", true],
    ["01:00", true],
    ["01:01", false],
    ["10:00", false],
    ["18:59", false],
  ])("checks the backend reception window at %s", (time, allowed) => {
    expect(isWithinBookingReceptionWindow(time)).toBe(allowed)
  })
  it("labels every slot in 24-hour format", () => {
    expect(BOOKING_SLOTS.map(slotLabel)).toEqual(BOOKING_SLOTS)
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
  it.each([
    ["2026-10-31T05:00:00.000Z", 0],
    ["2026-10-31T12:15:00.000Z", 1],
    ["2026-10-31T14:15:00.000Z", 9],
    ["2026-10-31T16:45:00.000Z", 19],
    ["2026-10-31T17:30:00.000Z", 22],
  ])("disables exactly the quarter-hour slots before %s", (instant, disabled) => {
    const now = new Date(instant)
    expect(bookingSlots("2026-10-31", now).filter((slot) => slot.disabled).map((slot) => slot.time))
      .toEqual(BOOKING_SLOTS.slice(0, disabled))
    expect(bookingSlots("2026-11-01", now).some((slot) => slot.disabled)).toBe(false)
  })
  it("keeps all slots enabled for a future business date", () => {
    expect(bookingSlots("2026-11-01", fromVenueLocal("2026-10-31", "23:45")).every((slot) => !slot.disabled)).toBe(true)
  })
  it("keeps the slot at the exact current instant enabled", () => {
    const slots = bookingSlots("2026-10-31", fromVenueLocal("2026-11-01", "00:30"))
    expect(slots.find((slot) => slot.time === "00:30")?.disabled).toBe(false)
    expect(slots.find((slot) => slot.time === "01:00")?.disabled).toBe(false)
  })
  it("disables a slot immediately after its instant without a past-time grace", () => {
    const now = new Date(fromVenueLocal(BD, "21:30").getTime() + 1)
    expect(bookingSlots(BD, now).find((slot) => slot.time === "21:30")?.disabled).toBe(true)
    expect(validateBookingTime(BD, "21:30", now)).not.toBeNull()
    const groups = bookingSlotGroups(BD, now)
    expect(groups[0].slots).toHaveLength(20)
    expect(groups[1].slots.map((slot) => slot.time)).toEqual(["00:00", "00:15", "00:30", "00:45", "01:00"])
    expect(groups[1].slots.every((slot) => slot.calendarDate === "2026-10-28" && !slot.disabled)).toBe(true)
  })
  it("returns identical availability for equivalent instants written with different timezone offsets", () => {
    const vietnam = new Date("2026-10-31T21:15:00+07:00")
    const newYork = new Date("2026-10-31T10:15:00-04:00")
    expect(vietnam.getTime()).toBe(newYork.getTime())
    expect(bookingSlots("2026-10-31", vietnam)).toEqual(bookingSlots("2026-10-31", newYork))
  })
})

describe("15-minute wheel (R6, NA-13, TU-16)", () => {
  it("offers only the four quarter-hour minute values", () => {
    expect(BOOKING_MINUTES).toEqual(["00", "15", "30", "45"])
    expect(BOOKING_MINUTES).not.toContain("35")
  })
  it("accepts 22:30 and quarter-hour stops inside 19:00-01:00", () => {
    for (const time of ["19:00", "22:30", "23:45", "00:30", "01:00"]) expect(isBookingTime(time)).toBe(true)
    expect(validateBookingTime(BD, "22:30", NOON)).toBeNull()
  })
  it("rejects off-step and out-of-window values", () => {
    for (const time of ["22:17", "22:35", "18:55", "01:05", "05:00", "", null]) expect(isBookingTime(time)).toBe(false)
    expect(validateBookingTime(BD, "22:17", NOON)).not.toBeNull()
    expect(validateBookingTime(BD, "01:05", NOON)).not.toBeNull()
  })
  it("keeps quick times from settings, without inventing any", () => {
    expect(usableQuickTimes(undefined)).toEqual([])
    expect(usableQuickTimes(["20:10", "18:00", "21:03", "00:30"])).toEqual(["00:30"])
  })
  it("maps 23:30 and 00:30 to the same business date", () => {
    expect(bookingInstant(BD, "23:30").toISOString()).toBe(new Date(`${BD}T23:30:00+07:00`).toISOString())
    expect(businessDateOf(bookingInstant(BD, "23:30"))).toBe(BD)
    expect(businessDateOf(bookingInstant(BD, "00:30"))).toBe(BD)
    expect(bookingCalendarDate(BD, "00:30")).not.toBe(BD)
  })
})

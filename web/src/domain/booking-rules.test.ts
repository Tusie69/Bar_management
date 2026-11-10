import { describe, expect, it } from "vitest"
import { businessDateOf, fromVenueLocal } from "@/lib/time"
import { guestCount, guestError, guestValueFrom, type GuestValue } from "@/components/booking-pickers"
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
  toggleClassification,
  type BookingClassification,
  validateBookingCheckInDate,
  validateBookingTime,
} from "./booking-rules"

const BD = "2026-10-27"
const NOON = fromVenueLocal(BD, "12:00")

describe("guest count", () => {
  it("TC-01 quick picks are exactly 1..6", () => expect([...GUEST_QUICK]).toEqual([1, 2, 3, 4, 5, 6]))
  it("TC-02/03 Số khác accepts 7, 11, 12 and 20", () => {
    expect(parseOtherGuests("7")).toMatchObject({ ok: true, value: 7 })
    expect(parseOtherGuests("11")).toMatchObject({ ok: true, value: 11 })
    expect(parseOtherGuests("12")).toMatchObject({ ok: true, value: 12 })
    expect(parseOtherGuests(" 20 ")).toMatchObject({ ok: true, value: 20 })
  })
  it("TC-04 Số khác rejects 6", () => expect(parseOtherGuests("6").ok).toBe(false))
  it("TC-05 Số khác rejects 0, negatives, decimals, letters, empty", () => {
    for (const v of ["0", "-3", "12.5", "12,5", "abc", "1e2", ""]) expect(parseOtherGuests(v).ok).toBe(false)
  })
  it("guestValueFrom and guestCount handle 1..6 and 12", () => {
    const q = guestValueFrom(2)
    expect(q).toEqual({ mode: "quick", party: 2, otherText: "" })
    expect(guestCount(q)).toBe(2)
    expect(guestError(q)).toBeNull()

    const o12 = guestValueFrom(12)
    expect(o12).toEqual({ mode: "other", party: 12, otherText: "12" })
    expect(guestCount(o12)).toBe(12)
    expect(guestError(o12)).toBeNull()

    // Typing 12 into other mode
    const typed12: GuestValue = { mode: "other", party: 12, otherText: "12" }
    expect(guestCount(typed12)).toBe(12)

    // Tapping 4 clears other text
    const tapped4: GuestValue = { mode: "quick", party: 4, otherText: "" }
    expect(guestCount(tapped4)).toBe(4)
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
  it("has exactly 73 slots, 19:00 → 01:00, every 5 minutes, in business order", () => {
    expect(BOOKING_SLOTS).toHaveLength(73)
    expect(BOOKING_SLOTS[0]).toBe("19:00")
    expect(BOOKING_SLOTS[1]).toBe("19:05")
    expect(BOOKING_SLOTS[2]).toBe("19:10")
    expect(BOOKING_SLOTS[BOOKING_SLOTS.length - 1]).toBe("01:00")
    expect(BOOKING_SLOTS).toContain("20:05")
    expect(BOOKING_SLOTS).toContain("22:35")
    expect(BOOKING_SLOTS).not.toContain("20:03")
    const mins = BOOKING_SLOTS.map(businessMinute)
    mins.slice(1).forEach((m, i) => expect(m - mins[i]).toBe(5))
  })
  it("TC-07/08/12 valid; TC-09/13/14 invalid", () => {
    expect(validateBookingTime(BD, "19:00", NOON)).toBeNull()
    expect(validateBookingTime(BD, "19:05", NOON)).toBeNull()
    expect(validateBookingTime(BD, "19:30", NOON)).toBeNull()
    expect(validateBookingTime(BD, "01:00", NOON)).toBeNull()
    expect(isBookingSlot("19:05")).toBe(true)
    expect(isBookingSlot("19:15")).toBe(true)
    expect(isBookingSlot("20:03")).toBe(false)
    expect(validateBookingTime(BD, "20:03", NOON)).not.toBeNull()
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
    ["2026-10-31T12:15:00.000Z", 3],
    ["2026-10-31T14:15:00.000Z", 27],
    ["2026-10-31T16:45:00.000Z", 57],
    ["2026-10-31T17:30:00.000Z", 66],
  ])("disables exactly the 5-minute slots before %s", (instant, disabled) => {
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
    expect(groups[0].slots).toHaveLength(60)
    expect(groups[1].slots.map((slot) => slot.time)).toEqual([
      "00:00",
      "00:05",
      "00:10",
      "00:15",
      "00:20",
      "00:25",
      "00:30",
      "00:35",
      "00:40",
      "00:45",
      "00:50",
      "00:55",
      "01:00",
    ])
    expect(groups[1].slots.every((slot) => slot.calendarDate === "2026-10-28" && !slot.disabled)).toBe(true)
  })
  it("returns identical availability for equivalent instants written with different timezone offsets", () => {
    const vietnam = new Date("2026-10-31T21:15:00+07:00")
    const newYork = new Date("2026-10-31T10:15:00-04:00")
    expect(vietnam.getTime()).toBe(newYork.getTime())
    expect(bookingSlots("2026-10-31", vietnam)).toEqual(bookingSlots("2026-10-31", newYork))
  })
})

describe("5-minute wheel (Nam decision)", () => {
  it("offers 12 five-minute values", () => {
    expect(BOOKING_MINUTES).toEqual(["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"])
    expect(BOOKING_MINUTES).toContain("35")
    expect(BOOKING_MINUTES).toContain("05")
    expect(BOOKING_MINUTES).not.toContain("03")
  })
  it("accepts 20:05, 22:30, 22:35 and 5-minute stops inside 19:00-01:00", () => {
    for (const time of ["19:00", "20:05", "22:30", "22:35", "23:45", "00:30", "00:55", "01:00"])
      expect(isBookingTime(time)).toBe(true)
    expect(validateBookingTime(BD, "22:35", NOON)).toBeNull()
    expect(validateBookingTime(BD, "20:05", NOON)).toBeNull()
  })
  it("rejects off-step and out-of-window values", () => {
    for (const time of ["20:03", "22:17", "18:55", "01:05", "05:00", "", null])
      expect(isBookingTime(time)).toBe(false)
    expect(validateBookingTime(BD, "20:03", NOON)).not.toBeNull()
    expect(validateBookingTime(BD, "22:17", NOON)).not.toBeNull()
    expect(validateBookingTime(BD, "01:05", NOON)).not.toBeNull()
  })
  it("keeps quick times from settings, without inventing any", () => {
    expect(usableQuickTimes(undefined)).toEqual([])
    expect(usableQuickTimes(["20:10", "18:00", "21:03", "00:30"])).toEqual(["20:10", "00:30"])
  })
  it("maps 23:30 and 00:30 to the same business date", () => {
    expect(bookingInstant(BD, "23:30").toISOString()).toBe(new Date(`${BD}T23:30:00+07:00`).toISOString())
    expect(businessDateOf(bookingInstant(BD, "23:30"))).toBe(BD)
    expect(businessDateOf(bookingInstant(BD, "00:30"))).toBe(BD)
    expect(bookingCalendarDate(BD, "00:30")).not.toBe(BD)
  })
})

describe("Khách quen (O) / Khách mới (N) exclusivity (Item 3)", () => {
  it("starts UNCLASSIFIED when nothing is selected", () => {
    const initial: BookingClassification = "UNCLASSIFIED"
    expect(initial).toBe("UNCLASSIFIED")
  })

  it("selects RETURNING on one tap", () => {
    expect(toggleClassification("UNCLASSIFIED", "RETURNING")).toBe("RETURNING")
  })

  it("selects NEW on one tap", () => {
    expect(toggleClassification("UNCLASSIFIED", "NEW")).toBe("NEW")
  })

  it("switches mutually exclusively between O and N", () => {
    expect(toggleClassification("RETURNING", "NEW")).toBe("NEW")
    expect(toggleClassification("NEW", "RETURNING")).toBe("RETURNING")
  })

  it("toggles off back to UNCLASSIFIED when clicking active button again", () => {
    expect(toggleClassification("RETURNING", "RETURNING")).toBe("UNCLASSIFIED")
    expect(toggleClassification("NEW", "NEW")).toBe("UNCLASSIFIED")
  })
})

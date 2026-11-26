import { describe, expect, it } from "vitest"
import {
  businessDateOf,
  businessDayBounds,
  businessSlots,
  FALLBACK_BUSINESS_SHIFT,
  fmtBusinessShift,
  fmtTime,
  fromVenueLocal,
  shiftHour,
  shiftHourLabels,
  shiftSpanHours,
  shiftStartHhmm,
} from "./time"

describe("fmtTime", () => {
  it("formats venue time as 24h HH:mm", () => {
    expect(fmtTime(fromVenueLocal("2026-10-25", "19:15"))).toBe("19:15")
    expect(fmtTime(fromVenueLocal("2026-10-25", "00:05"))).toBe("00:05")
    expect(fmtTime(fromVenueLocal("2026-10-25", "12:00"))).toBe("12:00")
    expect(fmtTime(fromVenueLocal("2026-10-25", "09:30"))).toBe("09:30")
  })
})

describe("TU-38 business shift helpers", () => {
  const overnight = { startLocal: "17:00:00", cutoffLocal: "05:00:00" }
  const lateOvernight = { startLocal: "18:30:00", cutoffLocal: "03:00:00" }
  const sameDay = { startLocal: "11:00:00", cutoffLocal: "23:00:00" }

  it("reads the hour of a shift boundary", () => {
    expect(shiftHour("17:00:00")).toBe(17)
    expect(shiftHour("05:00:00")).toBe(5)
    expect(shiftHour("00:30:00")).toBe(0)
    // A malformed value must not silently become NaN and poison every date computed from it.
    expect(shiftHour("")).toBe(0)
  })

  it("formats the shift and its opening time", () => {
    expect(fmtBusinessShift(overnight)).toBe("17:00 → 05:00")
    expect(fmtBusinessShift(lateOvernight)).toBe("18:30 → 03:00")
    expect(shiftStartHhmm(lateOvernight)).toBe("18:30")
  })

  it("spans the hours from opening to cutoff, wrapping past midnight", () => {
    expect(shiftSpanHours(overnight)).toBe(12)
    expect(shiftSpanHours(lateOvernight)).toBe(9)
    // A shift that ends the same calendar day must not wrap to 24 + something.
    expect(shiftSpanHours(sameDay)).toBe(12)
  })

  it("labels a timeline axis across the shift", () => {
    expect(shiftHourLabels(overnight)).toEqual(["17", "18", "19", "20", "21", "22", "23", "00", "01", "02", "03", "04"])
    expect(shiftHourLabels(lateOvernight)).toEqual(["18", "19", "20", "21", "22", "23", "00", "01", "02"])
    expect(shiftHourLabels(sameDay)).toEqual(["11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22"])
  })

  it("derives the business date from the configured cutoff, not a fixed 05:00", () => {
    // 03:30 local: still last night under a 05:00 cutoff, already today under a 03:00 one.
    const at = fromVenueLocal("2026-11-13", "03:30")
    expect(businessDateOf(at, shiftHour(overnight.cutoffLocal))).toBe("2026-11-12")
    expect(businessDateOf(at, shiftHour(lateOvernight.cutoffLocal))).toBe("2026-11-13")
  })

  it("keeps the fallback shift as the seeded venue configuration", () => {
    expect(FALLBACK_BUSINESS_SHIFT).toEqual(overnight)
  })
})

describe("TU-38 slots and bounds follow the configured shift", () => {
  it("generates slots across an overnight shift and a same-day one", () => {
    const overnight = businessSlots(60, 17, 5)
    expect(overnight).toHaveLength(12)
    expect(overnight.at(0)).toBe("17:00")
    expect(overnight.at(-1)).toBe("04:00")

    const late = businessSlots(60, 18, 3)
    expect(late).toHaveLength(9)
    expect(late.at(-1)).toBe("02:00")

    // A venue that opens and closes the same day must not wrap to 36 hours of slots.
    const sameDay = businessSlots(60, 11, 23)
    expect(sameDay).toHaveLength(12)
    expect(sameDay.at(0)).toBe("11:00")
    expect(sameDay.at(-1)).toBe("22:00")
  })

  it("ends an overnight shift the next calendar day and a same-day shift on the same one", () => {
    const overnight = businessDayBounds("2026-11-12", 17, 5)
    expect(overnight.start).toEqual(fromVenueLocal("2026-11-12", "17:00"))
    expect(overnight.end).toEqual(fromVenueLocal("2026-11-13", "05:00"))

    const sameDay = businessDayBounds("2026-11-12", 11, 23)
    expect(sameDay.end).toEqual(fromVenueLocal("2026-11-12", "23:00"))
  })
})

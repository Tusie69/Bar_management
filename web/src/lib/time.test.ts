import { describe, expect, it } from "vitest"
import { fmtTime12, fromVenueLocal } from "./time"

describe("fmtTime12", () => {
  it("formats venue time as 12h", () => {
    expect(fmtTime12(fromVenueLocal("2026-10-25", "19:15"))).toBe("7:15 PM")
    expect(fmtTime12(fromVenueLocal("2026-10-25", "00:05"))).toBe("12:05 AM")
    expect(fmtTime12(fromVenueLocal("2026-10-25", "12:00"))).toBe("12:00 PM")
    expect(fmtTime12(fromVenueLocal("2026-10-25", "09:30"))).toBe("9:30 AM")
  })
})

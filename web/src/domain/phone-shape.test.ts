import { describe, expect, it } from "vitest"
import { countPhoneDigits, normalizePhoneText } from "./phone-shape"

describe("phone shape primitives", () => {
  it("normalizes compatibility characters while preserving other decimal digits", () => {
    expect(normalizePhoneText("＋８４．١٢٣")).toBe("+84.١٢٣")
  })

  it("counts decimal digits across scripts and compatibility forms", () => {
    expect(countPhoneDigits("⑩.٠٩۰-๑๒３ 𝟒")).toBe(9)
    expect(countPhoneDigits("Khách")).toBe(0)
  })
})

import { describe, expect, it } from "vitest"
import { CANCEL_REASONS } from "@/domain/enums"
import { NOTE_PHONE_ERROR } from "@/lib/text"
import {
  buildCancelBookingArgs,
  CANCEL_NOTE_MAX_LENGTH,
  CANCEL_NOTE_TOO_LONG_ERROR,
  DEFAULT_CANCEL_REASON,
  validateCancelBookingInput,
} from "./cancel-booking"

describe("mobile cancel-booking validation and payload args", () => {
  it("reuses the shared desktop CANCEL_REASONS list excluding NO_SHOW_CONFIRMED", () => {
    expect(CANCEL_REASONS.map((r) => r.value)).toEqual([
      "CUSTOMER_REQUEST",
      "DUPLICATE",
      "ENTRY_ERROR",
      "VENUE_DECISION",
      "OTHER",
    ])
    expect(DEFAULT_CANCEL_REASON).toBe("CUSTOMER_REQUEST")
  })

  it("allows empty note for standard reasons and trims entered notes", () => {
    expect(validateCancelBookingInput("CUSTOMER_REQUEST", "")).toMatchObject({
      trimmedNote: "",
      hasPhone: false,
      tooLong: false,
      missingRequiredNote: false,
      error: null,
      canSubmit: true,
    })
    expect(buildCancelBookingArgs("DUPLICATE", "  Đặt trùng bàn  ")).toEqual({
      reason: "DUPLICATE",
      note: "Đặt trùng bàn",
    })
  })

  it("requires a non-blank note when OTHER is selected", () => {
    const emptyOther = validateCancelBookingInput("OTHER", "   ")
    expect(emptyOther.missingRequiredNote).toBe(true)
    expect(emptyOther.canSubmit).toBe(false)
    expect(emptyOther.error).toBeNull()
    expect(() => buildCancelBookingArgs("OTHER", "   ")).toThrow("Ghi rõ lý do khác.")

    expect(buildCancelBookingArgs("OTHER", " Khách đổi lịch ")).toEqual({
      reason: "OTHER",
      note: "Khách đổi lịch",
    })
  })

  it.each(["0901234567", "0901 234 567", "+84 901 234 567", "0084.901.234.567", "Khách gọi từ 0912-345-678"])(
    "rejects phone numbers in note: %s",
    (note) => {
      const result = validateCancelBookingInput("CUSTOMER_REQUEST", note)
      expect(result.hasPhone).toBe(true)
      expect(result.error).toBe(NOTE_PHONE_ERROR)
      expect(result.canSubmit).toBe(false)
      expect(() => buildCancelBookingArgs("CUSTOMER_REQUEST", note)).toThrow(NOTE_PHONE_ERROR)
    },
  )

  it("enforces the 300-character trimmed maximum", () => {
    const exact = "a".repeat(CANCEL_NOTE_MAX_LENGTH)
    expect(validateCancelBookingInput("CUSTOMER_REQUEST", `  ${exact}  `).canSubmit).toBe(true)

    const over = "a".repeat(CANCEL_NOTE_MAX_LENGTH + 1)
    const result = validateCancelBookingInput("CUSTOMER_REQUEST", over)
    expect(result.tooLong).toBe(true)
    expect(result.error).toBe(CANCEL_NOTE_TOO_LONG_ERROR)
    expect(result.canSubmit).toBe(false)
    expect(() => buildCancelBookingArgs("CUSTOMER_REQUEST", over)).toThrow(CANCEL_NOTE_TOO_LONG_ERROR)
  })
})

import { describe, expect, it } from "vitest"
import { CANCEL_REASONS } from "@/domain/enums"
import { NOTE_PHONE_ERROR, noteHasPhoneNumber } from "@/lib/text"
import {
  buildCancelBookingArgs,
  CANCEL_NOTE_MAX_LENGTH,
  CANCEL_NOTE_TOO_LONG_ERROR,
  DEFAULT_CANCEL_REASON,
  validateCancelBookingInput,
} from "./cancel-booking"
import { noteHasNormalizedPhoneNumber } from "./note-phone-privacy"

// Unicode-separator phones (e.g. en-dash, non-breaking hyphen, middle dot, non-ASCII digits
// other than full-width NFKC digits) are a server-side follow-up (owner: backend) rather than a client rule.
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

  it.each([
    "0901234567",
    "0901 234 567",
    "+84 901 234 567",
    "0084.901.234.567",
    "Khách gọi từ 0912-345-678",
    // API note-privacy.test.ts canonical rejected examples
    "0987654321",
    "0987 654 321",
    "0987.654.321",
    "0987-654-321",
    "(0987) 654-321",
    "+84 987 654 321",
    "0084 987 654 321",
    "Gọi khách theo số 0987 654 321 giúp em",
    // Raw ASCII-dash note rejected by API regex
    "Khách hủy khung 00.30-01.15 12 khách, bàn A5.",
  ])("rejects raw phone numbers in note (API parity): %s", (note) => {
    expect(noteHasPhoneNumber(note.trim())).toBe(true)
    expect(noteHasNormalizedPhoneNumber(note)).toBe(true)
    const result = validateCancelBookingInput("CUSTOMER_REQUEST", note)
    expect(result.hasPhone).toBe(true)
    expect(result.error).toBe(NOTE_PHONE_ERROR)
    expect(result.canSubmit).toBe(false)
    expect(() => buildCancelBookingArgs("CUSTOMER_REQUEST", note)).toThrow(NOTE_PHONE_ERROR)
  })

  it.each([
    ["leading Arabic-Indic digit adjacent to local phone", "\u0661090-123-4567"],
    ["trailing fullwidth digit adjacent to local phone", "090-123-4567\uFF11"],
    ["leading fullwidth plus adjacent to +84 phone", "\uFF0B+84 901 234 567"],
  ])("rejects raw API-blocked phone even when adjacent to Unicode lookalikes (%s)", (_label, note) => {
    expect(noteHasPhoneNumber(note.trim())).toBe(true)
    expect(noteHasNormalizedPhoneNumber(note)).toBe(true)
    const result = validateCancelBookingInput("CUSTOMER_REQUEST", note)
    expect(result.hasPhone).toBe(true)
    expect(result.error).toBe(NOTE_PHONE_ERROR)
    expect(result.canSubmit).toBe(false)
    expect(() => buildCancelBookingArgs("CUSTOMER_REQUEST", note)).toThrow(NOTE_PHONE_ERROR)
  })

  it.each([
    ["full-width compact local", "０９０１２３４５６７"],
    ["full-width digits + space", "０９０ １２３ ４５６７"],
    ["full-width digits + dots", "０９０．１２３．４５６７"],
    ["full-width digits + hyphen-minus", "０９０－１２３－４５６７"],
    ["full-width parens + hyphen-minus", "（０９０）１２３－４５６７"],
    ["full-width +84", "＋８４ ９０１ ２３４ ５６７"],
    ["full-width 0084 + dots", "００８４．９０１．２３４．５６７"],
    ["full-width phone in prose", "Khách gọi từ ０９０ １２３ ４５６７"],
    [
      "overnight note with full-width local phone appended",
      "Khách hủy khung 00.30\u201301.15 12 khách, bàn A5. Gọi lại ０９０ １２３ ４５６７",
    ],
    [
      "overnight note with full-width +84 phone appended",
      "Khách hủy khung 00.30\u201301.15 12 khách, bàn A5. ＋８４ ９０１ ２３４ ５６７",
    ],
    ["full-width phone followed by khách", "Khách hủy ０９０ １２３ ４５ ６７ khách"],
    ["grouped full-width phone followed by khách", "Khách hủy ０９０１ ２３４ ５６７ khách"],
    ["full-width phone split across time-like dot", "Khách hủy ０９０ １２.３４ ５６７ khách"],
    ["full-width phone after table label", "Bàn ０９０ １２３ ４５６７"],
    ["full-width phone after tel label", "Gọi tel０９ ０１.２３-０４.５６"],
  ])("rejects full-width digit phone variant via NFKC (%s): %s", (_label, note) => {
    expect(noteHasNormalizedPhoneNumber(note)).toBe(true)
    const result = validateCancelBookingInput("CUSTOMER_REQUEST", note)
    expect(result.hasPhone).toBe(true)
    expect(result.error).toBe(NOTE_PHONE_ERROR)
    expect(result.canSubmit).toBe(false)
    expect(() => buildCancelBookingArgs("CUSTOMER_REQUEST", note)).toThrow(NOTE_PHONE_ERROR)
  })

  it("keeps valid notes eligible (API parity + NA-03) and preserves original trimmed note", () => {
    for (const validNote of [
      "Khách đổi lịch sang tối thứ 7",
      "Bàn 102, 4 khách, sinh nhật",
      "Đặt nhầm ngày 20-11-2026",
      "Mã đơn #123456",
      // API note-privacy.test.ts canonical accepted examples
      "Ngày 20261029",
      "Mã đơn 12345678",
      "Bàn A12 lúc 21:30",
      "Khách đi 4 người, cọc 500000",
      "Mã 1234567890",
      // Review NA-03 examples & ordinary notes with times/ranges/headcounts
      "Khách hủy khung 00.30\u201301.15 12 khách, bàn A5.",
      "Khách hủy khung 00:30\u201301:15 12 khách, bàn A5.",
      "Khách hủy khung 00.30\u201301.15, 12 khách, bàn A5.",
      "Đổi từ 09:00 sang 10h15, ghép A2 + A4 cho 12 người.",
      "22.30-01.00 6 khách",
      "22.30\u201301.00 6 khách",
      "Bàn 01 \u2013 00.30\u201301.15 12 khách",
      "Đổi khung 00.30\u201301.15 (12 khách) sang bàn A2 + A4",
      "Ngày 20\u201311\u20132026 00.30\u201301.15 8 người, phòng VIP 01",
      "G01 \u2013 00.30\u201301.15 12 khách",
    ]) {
      expect(noteHasPhoneNumber(validNote.trim())).toBe(false)
      const result = validateCancelBookingInput("OTHER", validNote)
      expect(result.hasPhone).toBe(false)
      expect(result.error).toBeNull()
      expect(result.canSubmit).toBe(true)
    }

    expect(buildCancelBookingArgs("OTHER", "  Khách ở tầng ２ — hẹn 19:30  ")).toEqual({
      reason: "OTHER",
      note: "Khách ở tầng ２ — hẹn 19:30",
    })
    expect(
      buildCancelBookingArgs("CUSTOMER_REQUEST", "  Khách hủy khung 00.30\u201301.15 12 khách, bàn A5.  "),
    ).toEqual({
      reason: "CUSTOMER_REQUEST",
      note: "Khách hủy khung 00.30\u201301.15 12 khách, bàn A5.",
    })
  })

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

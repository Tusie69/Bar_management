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
import { normalizeNoteForPhoneCheck, noteHasNormalizedPhoneNumber } from "./note-phone-privacy"

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
    // API note-privacy.test.ts canonical examples
    "0987654321",
    "0987 654 321",
    "0987.654.321",
    "0987-654-321",
    "(0987) 654-321",
    "+84 987 654 321",
    "0084 987 654 321",
    "Gọi khách theo số 0987 654 321 giúp em",
  ])("rejects phone numbers in note: %s", (note) => {
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
    expect(noteHasNormalizedPhoneNumber(note)).toBe(true)
    const result = validateCancelBookingInput("CUSTOMER_REQUEST", note)
    expect(result.hasPhone).toBe(true)
    expect(result.error).toBe(NOTE_PHONE_ERROR)
    expect(result.canSubmit).toBe(false)
    expect(() => buildCancelBookingArgs("CUSTOMER_REQUEST", note)).toThrow(NOTE_PHONE_ERROR)
  })

  it.each([
    ["full-width digits + space", "０９０ １２３ ４５６７"],
    ["full-width +84", "＋８４ ９０１ ２３４ ５６７"],
    ["full-width 0084 + dots", "００８４．９０１．２３４．５６７"],
    ["Arabic-Indic digits", "٠٩٠ ١٢٣ ٤٥٦٧"],
    ["Arabic-Indic +84", "＋٨٤ ٩٠١ ٢٣٤ ٥٦٧"],
    ["Extended Arabic-Indic digits", "۰۹۰ ۱۲۳ ۴۵۶۷"],
    ["U+2010 hyphen", "090\u2010123\u20104567"],
    ["U+2011 non-breaking hyphen", "090\u2011123\u20114567"],
    ["U+2012 figure dash", "090\u2012123\u20124567"],
    ["U+2013 en dash", "090\u2013123\u20134567"],
    ["U+2014 em dash", "090\u2014123\u20144567"],
    ["U+2015 horizontal bar", "090\u2015123\u20154567"],
    ["U+2212 minus sign", "090\u2212123\u22124567"],
    ["U+2043 hyphen bullet", "090\u2043123\u20434567"],
    ["U+FE58 small em dash", "090\uFE58123\uFE584567"],
    ["U+FE63 small hyphen-minus", "090\uFE63123\uFE634567"],
    ["U+FF0D fullwidth hyphen-minus", "090\uFF0D123\uFF0D4567"],
    ["U+00AD soft hyphen", "090\u00AD123\u00AD4567"],
    ["U+00A0 NBSP", "090\u00A0123\u00A04567"],
    ["U+2007 figure space", "090\u2007123\u20074567"],
    ["U+2009 thin space", "090\u2009123\u20094567"],
    ["U+200A hair space", "090\u200A123\u200A4567"],
    ["U+202F narrow no-break space", "090\u202F123\u202F4567"],
    ["U+3000 ideographic space", "090\u3000123\u30004567"],
    ["U+200B zero-width space", "090\u200B123\u200B4567"],
    ["U+00B7 middle dot", "090\u00B7123\u00B74567"],
    ["U+2024 one dot leader", "090\u2024123\u20244567"],
    ["U+FE52 small full stop", "090\uFE52123\uFE524567"],
    ["U+FF0E fullwidth full stop", "090\uFF0E123\uFF0E4567"],
    ["U+3002 ideographic full stop", "090\u3002123\u30024567"],
    ["mixed Unicode digits and separators in prose", "Khách gọi từ ０９０\u2011١٢٣\u202F4567"],
  ])("rejects Unicode phone variant (%s): %s", (_label, note) => {
    expect(noteHasNormalizedPhoneNumber(note)).toBe(true)
    const result = validateCancelBookingInput("CUSTOMER_REQUEST", note)
    expect(result.hasPhone).toBe(true)
    expect(result.error).toBe(NOTE_PHONE_ERROR)
    expect(result.canSubmit).toBe(false)
    expect(() => buildCancelBookingArgs("CUSTOMER_REQUEST", note)).toThrow(NOTE_PHONE_ERROR)
  })

  it("keeps valid text and short numeric references eligible and preserves original trimmed note", () => {
    expect(normalizeNoteForPhoneCheck("０９０\u2011١٢٣\u202F4567")).toBe("090-123 4567")

    for (const validNote of [
      "Khách đổi lịch sang tối thứ 7",
      "Bàn 102, 4 khách, sinh nhật",
      "Đặt nhầm ngày 20-11-2026",
      "Mã đơn #123456",
      // API note-privacy.test.ts accepted examples
      "Ngày 20261029",
      "Mã đơn 12345678",
      "Bàn A12 lúc 21:30",
      "Khách đi 4 người, cọc 500000",
      "Mã 1234567890",
      // Review NA-03 examples & realistic Vietnamese notes
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

  it.each([
    ["raw ASCII-dash overnight note rejected by API", "Khách hủy khung 00.30-01.15 12 khách, bàn A5."],
    [
      "overnight note with Unicode-formatted local phone appended",
      "Khách hủy khung 00.30\u201301.15 12 khách, bàn A5. Gọi lại ０９０\u2011١٢٣\u202F4567",
    ],
    [
      "overnight note with Unicode +84 phone appended",
      "Khách hủy khung 00.30\u201301.15 12 khách, bàn A5. ＋８４ ９０１ ２３４ ５６７",
    ],
    ["disguised Unicode phone followed by khách", "Khách hủy ０９０ １２３ ４５ ６７ khách"],
    ["grouped Unicode phone followed by khách", "Khách hủy ０９０１ ２３４ ５６７ khách"],
    ["Unicode phone split across time-like dot", "Khách hủy ０９０ １２.３４ ５６７ khách"],
    ["Unicode phone after table label", "Bàn ０９０ １２３ ４５６７"],
    ["unlabelled dotted digits", "Khách hủy ０９.０１\u2013２３.４５ ６７"],
  ])("still rejects %s", (_label, note) => {
    expect(noteHasNormalizedPhoneNumber(note)).toBe(true)
    const result = validateCancelBookingInput("CUSTOMER_REQUEST", note)
    expect(result.hasPhone).toBe(true)
    expect(result.error).toBe(NOTE_PHONE_ERROR)
    expect(result.canSubmit).toBe(false)
    expect(() => buildCancelBookingArgs("CUSTOMER_REQUEST", note)).toThrow(NOTE_PHONE_ERROR)
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

import { describe, expect, it } from "vitest"
import {
  buildListParams,
  buildSummaryQuery,
  fillBusinessDateSeries,
  formatEndReason,
  formatScopeLabel,
  formatStaffName,
  formatTimeRange,
  formatTurnSource,
  get7DayRange,
  getSummaryUncountedTotal,
  getWeekRange,
  hasCheckedInByStaffField,
  isTurnOpen,
  maskPhoneNumbersInText,
  resolveStaffIdentity,
  resolveTurnDateRange,
} from "./turns-helpers"

describe("turns-helpers (NA-34 pure logic)", () => {
  it("computes Monday-Sunday week range from any business date in the week", () => {
    // 2026-11-15 is a Sunday -> week is Mon 2026-11-09 .. Sun 2026-11-15
    expect(getWeekRange("2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" })
    // 2026-11-09 is a Monday -> week is Mon 2026-11-09 .. Sun 2026-11-15
    expect(getWeekRange("2026-11-09")).toEqual({ from: "2026-11-09", to: "2026-11-15" })
    // 2026-11-12 is a Thursday -> week is Mon 2026-11-09 .. Sun 2026-11-15
    expect(getWeekRange("2026-11-12")).toEqual({ from: "2026-11-09", to: "2026-11-15" })
    // Cross-year boundary: 2026-12-30 (Wed) -> Mon 2026-12-28 .. Sun 2027-01-03
    expect(getWeekRange("2026-12-30")).toEqual({ from: "2026-12-28", to: "2027-01-03" })
  })

  it("resolves today, week, 7days, and specific date presets cleanly", () => {
    expect(get7DayRange("2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" })
    expect(resolveTurnDateRange("today", "2026-11-15", "2026-11-10")).toEqual({
      from: "2026-11-15",
      to: "2026-11-15",
    })
    expect(resolveTurnDateRange("week", "2026-11-12", "2026-11-10")).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
    })
    expect(resolveTurnDateRange("7days", "2026-11-15", "2026-11-10")).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
    })
    expect(resolveTurnDateRange("date", "2026-11-15", "2026-11-10")).toEqual({
      from: "2026-11-10",
      to: "2026-11-10",
    })
  })

  it("fills every business date in range with 0 turns and 0 guests when omitted by summary", () => {
    const filled = fillBusinessDateSeries("2026-11-09", "2026-11-15", [
      { businessDate: "2026-11-10", turns: 3, guests: 13 },
      { businessDate: "2026-11-14", turns: 5, guests: 24 },
    ])
    expect(filled).toEqual([
      { businessDate: "2026-11-09", turns: 0, guests: 0 },
      { businessDate: "2026-11-10", turns: 3, guests: 13 },
      { businessDate: "2026-11-11", turns: 0, guests: 0 },
      { businessDate: "2026-11-12", turns: 0, guests: 0 },
      { businessDate: "2026-11-13", turns: 0, guests: 0 },
      { businessDate: "2026-11-14", turns: 5, guests: 24 },
      { businessDate: "2026-11-15", turns: 0, guests: 0 },
    ])
  })

  it("formats null staff as Hệ thống and preserves display names", () => {
    expect(formatStaffName(null, null)).toBe("Hệ thống")
    expect(formatStaffName(null, "Ignorable")).toBe("Hệ thống")
    expect(formatStaffName(5, "Lễ tân 1")).toBe("Lễ tân 1")
    expect(formatStaffName(9, null)).toBe("Nhân viên #9")
  })

  it("maps end reasons and open turn status in Vietnamese and identifies uncounted reasons", () => {
    expect(formatEndReason(null, "OPEN")).toEqual({
      label: "Đang ngồi",
      isUncounted: false,
      isOpen: true,
    })
    expect(formatEndReason("GUEST_LEFT", "CLOSED")).toEqual({
      label: "Đã trả bàn",
      isUncounted: false,
      isOpen: false,
    })
    expect(formatEndReason("AFTER_PAYMENT")).toEqual({
      label: "Sau thanh toán",
      isUncounted: false,
      isOpen: false,
    })
    expect(formatEndReason("ENTRY_ERROR")).toEqual({
      label: "Nhập nhầm",
      isUncounted: true,
      isOpen: false,
    })
    expect(formatEndReason("BUSINESS_DAY_END")).toEqual({
      label: "Hệ thống đóng ca",
      isUncounted: true,
      isOpen: false,
    })
  })

  it("prefers checkedInBy* over closedBy* and falls back only when checkedInBy* is absent", () => {
    expect(
      resolveStaffIdentity({
        checkedInByUserId: 7,
        checkedInByDisplayName: "Thu ngân check-in",
        closedByUserId: 2,
        closedByDisplayName: "Lễ tân 2",
      }),
    ).toEqual({ userId: 7, displayName: "Thu ngân check-in" })

    expect(
      resolveStaffIdentity({
        checkedInByUserId: null,
        checkedInByDisplayName: null,
        closedByUserId: 2,
        closedByDisplayName: "Lễ tân 2",
      }),
    ).toEqual({ userId: null, displayName: null })

    expect(
      resolveStaffIdentity({
        closedByUserId: 2,
        closedByDisplayName: "Lễ tân 2",
      }),
    ).toEqual({ userId: 2, displayName: "Lễ tân 2" })

    expect(
      hasCheckedInByStaffField({
        byStaff: [{ closedByUserId: 1, closedByDisplayName: "Lễ tân 1", turns: 1, guests: 2 }] as never,
      }),
    ).toBe(false)
    expect(
      hasCheckedInByStaffField({
        byStaff: [
          {
            checkedInByUserId: 1,
            checkedInByDisplayName: "Lễ tân 1",
            turns: 1,
            guests: 2,
          },
        ],
      }),
    ).toBe(true)
  })

  it("masks phone numbers inside guest text and keeps ordinary names intact", () => {
    expect(maskPhoneNumbersInText("Anh Tuấn 0912345678")).toBe("Anh Tuấn ***678")
    expect(maskPhoneNumbersInText("+84 912 345 678")).toBe("***678")
    expect(maskPhoneNumbersInText("Nhóm bạn Hà")).toBe("Nhóm bạn Hà")
  })

  it("formats scope labels, sources, and venue-timezone HH:mm ranges", () => {
    expect(
      formatScopeLabel({ scope: "GROUP", groupCode: "C1", tableCodes: ["B3", "B4"] }),
    ).toBe("C1")
    expect(
      formatScopeLabel({ scope: "TABLE", groupCode: null, tableCodes: ["B2"] }),
    ).toBe("B2")
    expect(formatTurnSource("HOTLINE", "RESERVATION")).toBe("Hotline")
    expect(formatTurnSource(null, "WALK_IN")).toBe("Walk-in")
    expect(
      formatTimeRange("2026-11-15T13:00:00.000Z", "2026-11-15T16:30:00.000Z", "CLOSED"),
    ).toBe("20:00 → 23:30")
    expect(formatTimeRange("2026-11-15T14:30:00.000Z", null, "OPEN")).toBe("21:30 → —")
    expect(isTurnOpen({ status: "OPEN", releasedAt: null })).toBe(true)
    expect(isTurnOpen({ status: "CLOSED", releasedAt: "2026-11-15T16:30:00.000Z" })).toBe(false)
  })

  it("builds summary and list params with includeUncounted and checkedInByUserId (plus legacy fallback)", () => {
    expect(buildSummaryQuery("2026-11-09", "2026-11-15", false)).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
    })
    expect(buildSummaryQuery("2026-11-09", "2026-11-15", true)).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
      includeUncounted: true,
    })
    expect(buildListParams("2026-11-09", "2026-11-15", true, 42, 2, 20)).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
      page: 2,
      pageSize: 20,
      includeUncounted: true,
      checkedInByUserId: 42,
    })
    expect(
      buildListParams("2026-11-09", "2026-11-15", false, 42, 1, 20, "closedByUserId"),
    ).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
      page: 1,
      pageSize: 20,
      closedByUserId: 42,
    })
  })

  it("computes uncounted total solely from summary aggregates", () => {
    expect(
      getSummaryUncountedTotal({
        from: "2026-11-15",
        to: "2026-11-15",
        completedTotal: 3,
        guestTotal: 17,
        byBusinessDate: [{ businessDate: "2026-11-15", turns: 5, guests: 24 }],
        byStaff: [],
        byScope: [],
      }),
    ).toBe(2)
  })
})

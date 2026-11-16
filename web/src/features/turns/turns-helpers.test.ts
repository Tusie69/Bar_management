import { describe, expect, it } from "vitest"
import { ApiError } from "@/services/contracts"
import {
  buildListParams,
  buildSummaryQuery,
  computeTurnKpis,
  fillBusinessDateSeries,
  formatAnonymousGuestLabel,
  formatAnonymousVisitTimestamp,
  formatDuplicateCustomerLine,
  formatEndReason,
  formatLedgerRangeCaption,
  formatRemainingAnonymousCount,
  formatScopeLabel,
  formatStaffName,
  formatTimeRange,
  formatTurnCode,
  formatTurnSource,
  get30DayRange,
  get7DayRange,
  getSummaryUncountedTotal,
  getWeekRange,
  hasCheckedInByStaffField,
  isTurnOpen,
  mapCustomerHistoryError,
  maskPhoneNumbersInText,
  resolveAnonymousPageAction,
  resolveDuplicatePageRecovery,
  resolveStaffIdentity,
  resolveTurnDateRange,
  resolveTurnWriteAccess,
  validateAnonymousAssignPhone,
  validateNewCustomerName,
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

  it("resolves today, week, 7days, 30days, and specific date presets cleanly", () => {
    expect(get7DayRange("2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" })
    expect(get30DayRange("2026-11-15")).toEqual({ from: "2026-10-17", to: "2026-11-15" })
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
    expect(resolveTurnDateRange("30days", "2026-11-15", "2026-11-10")).toEqual({
      from: "2026-10-17",
      to: "2026-11-15",
    })
    expect(resolveTurnDateRange("date", "2026-11-15", "2026-11-10")).toEqual({
      from: "2026-11-10",
      to: "2026-11-10",
    })
    expect(formatLedgerRangeCaption("today", "2026-11-15", "2026-11-15")).toBe("ca 15/11")
    expect(formatLedgerRangeCaption("30days", "2026-10-17", "2026-11-15")).toBe(
      "30 ngày (17/10 - 15/11)",
    )
    expect(formatTurnCode(1042)).toBe("L-1042")
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

  it("computes uncounted total and 4 KPI values solely from summary aggregates", () => {
    const summary = {
      from: "2026-11-15",
      to: "2026-11-15",
      completedTotal: 12,
      openTotal: 4,
      guestTotal: 39,
      byBusinessDate: [{ businessDate: "2026-11-15", turns: 14, guests: 45 }],
      byStaff: [],
      byScope: [],
    }
    expect(getSummaryUncountedTotal(summary)).toBe(2)
    expect(computeTurnKpis(summary)).toEqual({
      arrivedTotal: 12,
      guestTotal: 39,
      openTotal: 4,
      closedCountedTotal: 8,
    })
  })

  it("resolves write access across OWNER, ADMIN WRITE, ADMIN READ_ONLY, and HTTP principal permissions", () => {
    expect(
      resolveTurnWriteAccess({
        mode: "mock",
        role: "OWNER",
        hasPrincipal: false,
        permissions: [],
      }),
    ).toEqual({ isReadOnly: false, canAssignAnonymous: true })

    expect(
      resolveTurnWriteAccess({
        mode: "mock",
        role: "ADMIN",
        userAccessLevel: "WRITE",
        hasPrincipal: false,
        permissions: [],
      }),
    ).toEqual({ isReadOnly: false, canAssignAnonymous: true })

    expect(
      resolveTurnWriteAccess({
        mode: "mock",
        role: "ADMIN",
        userAccessLevel: "READ_ONLY",
        hasPrincipal: false,
        permissions: [],
      }),
    ).toEqual({ isReadOnly: true, canAssignAnonymous: false })

    expect(
      resolveTurnWriteAccess({
        mode: "http",
        role: "ADMIN",
        principalAccessLevel: "READ_ONLY",
        hasPrincipal: true,
        permissions: ["report.read"],
      }),
    ).toEqual({ isReadOnly: true, canAssignAnonymous: false })

    expect(
      resolveTurnWriteAccess({
        mode: "http",
        role: "ADMIN",
        principalAccessLevel: "WRITE",
        hasPrincipal: true,
        permissions: ["report.read", "customer.history.manage"],
      }),
    ).toEqual({ isReadOnly: false, canAssignAnonymous: true })
  })

  it("formats anonymous visits and duplicate customer lines with masked phones only", () => {
    expect(formatAnonymousGuestLabel(1044, null)).toBe("Khách Walk-in #1044")
    expect(formatAnonymousGuestLabel(1044, "Khách")).toBe("Khách Walk-in #1044")
    expect(formatAnonymousGuestLabel(1045, "Nhóm áo đen 0912345678")).toBe("Nhóm áo đen ***678")

    expect(
      formatAnonymousVisitTimestamp("2026-11-16T13:41:00.000Z", "2026-11-16", "2026-11-16"),
    ).toBe("20:41 hôm nay")
    expect(
      formatAnonymousVisitTimestamp("2026-11-12T13:41:00.000Z", "2026-11-12", "2026-11-16"),
    ).toBe("20:41 12/11")

    expect(formatRemainingAnonymousCount(3, false)).toBe("3 lượt khuyết danh còn lại")
    expect(formatRemainingAnonymousCount(50, true)).toBe("Hơn 50 lượt khuyết danh còn lại")

    expect(
      formatDuplicateCustomerLine({ displayName: "Nguyễn An", maskedPhone: "••• 678" }),
    ).toBe("Nguyễn An · ••• 678")
    expect(
      formatDuplicateCustomerLine({ displayName: "Nguyễn An 0901234678", maskedPhone: null }),
    ).toBe("Nguyễn An ***678 · chưa có SĐT")
  })

  it("validates VN phones, new customer names, and maps NA-34 API errors safely", () => {
    expect(validateAnonymousAssignPhone("")).toBeTruthy()
    expect(validateAnonymousAssignPhone("+84901234678")).toBeTruthy()
    expect(validateAnonymousAssignPhone("0901 234 678")).toBeNull()

    expect(validateNewCustomerName("   ")).toBeTruthy()
    expect(validateNewCustomerName("Nguyễn An 0901234678")).toContain("không được chứa số điện thoại")
    expect(validateNewCustomerName("Nguyễn An")).toBeNull()

    expect(
      mapCustomerHistoryError(
        new ApiError(422, "CUSTOMER_NAME_REQUIRED", "Cần nhập tên khách."),
        "assign",
      ),
    ).toMatchObject({ requiresName: true, isConflict: false, isForbidden: false })

    expect(
      mapCustomerHistoryError(
        new ApiError(403, "CUSTOMER_ORG_WRITE_REQUIRED", "Need org write"),
        "merge",
      ),
    ).toMatchObject({ isForbidden: true, isConflict: false })

    expect(
      mapCustomerHistoryError(new ApiError(409, "VERSION_CONFLICT", "Changed"), "assign"),
    ).toMatchObject({ isConflict: true, isForbidden: false })

    const unexpected = mapCustomerHistoryError(
      new ApiError(500, "INTERNAL", "Lỗi với số 0901234678"),
      "assign",
    )
    expect(unexpected.message).not.toContain("0901234678")
    expect(unexpected.message).toContain("***678")
  })

  it("never exposes a full phone in local invalid-phone errors or 422 responses (D-01)", () => {
    const localInvalid = validateAnonymousAssignPhone("123")
    expect(localInvalid).toBe("Số điện thoại phải gồm 10 chữ số bắt đầu bằng 0.")
    expect(localInvalid).not.toMatch(/0\d{9}/)

    for (const sample of [
      "0901234678",
      "0901.234.678",
      "0901-234-678",
      "(090) 123-4678",
      "+84 901 234 678",
      "(+84) 901 234 678",
    ]) {
      const generic422 = mapCustomerHistoryError(
        new ApiError(422, "VALIDATION_FAILED", `Giá trị ${sample} không hợp lệ`),
        "assign",
      )
      expect(generic422.message).not.toContain("901")
      expect(generic422.message).not.toContain("123")
      expect(generic422.message).toContain("***678")
      expect(generic422.message).not.toMatch(/0\d{9}/)
    }

    const reused = mapCustomerHistoryError(
      new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Reused key"),
      "assign",
    )
    expect(reused.requiresName).toBe(false)
    expect(reused.isConflict).toBe(false)
    expect(reused.message).toBeTruthy()
  })

  it("computes anonymous page traversal/recovery and duplicate page recovery cleanly (D-02, D-03)", () => {
    // 50 local skips on page 1 with hasMore=true -> advance to page 2
    expect(
      resolveAnonymousPageAction({
        page: 1,
        dataPage: 1,
        visitsCount: 50,
        visibleCount: 0,
        hasMore: true,
        isPending: false,
        isFetching: false,
      }),
    ).toBe("advance")

    // Do not advance while still fetching stale cache or mismatched page
    expect(
      resolveAnonymousPageAction({
        page: 1,
        dataPage: 1,
        visitsCount: 50,
        visibleCount: 0,
        hasMore: true,
        isPending: false,
        isFetching: true,
      }),
    ).toBe("stay")

    // Page > 1 became empty after concurrent removal -> recover to page 1
    expect(
      resolveAnonymousPageAction({
        page: 2,
        dataPage: 2,
        visitsCount: 0,
        visibleCount: 0,
        hasMore: false,
        isPending: false,
        isFetching: false,
      }),
    ).toBe("recover")

    // Duplicate final page empty with remaining total=50 -> recover to page 1
    expect(
      resolveDuplicatePageRecovery({
        page: 2,
        dataPage: 2,
        pairsCount: 0,
        total: 50,
        pageSize: 50,
        isPending: false,
        isFetching: false,
      }),
    ).toBe(1)

    // Page 3 empty with total=100 -> recover to page 2
    expect(
      resolveDuplicatePageRecovery({
        page: 3,
        dataPage: 3,
        pairsCount: 0,
        total: 100,
        pageSize: 50,
        isPending: false,
        isFetching: false,
      }),
    ).toBe(2)

    // Page 1 empty with total=0 -> stays (no recovery needed)
    expect(
      resolveDuplicatePageRecovery({
        page: 1,
        dataPage: 1,
        pairsCount: 0,
        total: 0,
        pageSize: 50,
        isPending: false,
        isFetching: false,
      }),
    ).toBeNull()
  })
})

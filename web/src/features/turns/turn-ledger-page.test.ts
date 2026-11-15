import { createElement, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TableTurnQuery, TableTurnSummary, TableTurnsParams, TableTurnsResult } from "@/domain/models"
import { ApiError } from "@/services/contracts"

const mockState = vi.hoisted(() => ({
  canRead: true,
  businessDate: "2026-11-15",
  summaryCalls: [] as TableTurnQuery[],
  turnsCalls: [] as TableTurnsParams[],
  summaryResult: {
    data: undefined as TableTurnSummary | undefined,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  turnsResult: {
    data: undefined as TableTurnsResult | undefined,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}))

vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined })
  vi.stubGlobal("document", {
    documentElement: { classList: { toggle: () => undefined }, style: {} },
    querySelector: () => null,
  })
})

vi.mock("@/hooks/use-data", () => ({
  useBusinessDate: () => mockState.businessDate,
  useTableTurnSummary: (params: TableTurnQuery, enabled = true) => {
    if (enabled) mockState.summaryCalls.push(params)
    return mockState.summaryResult
  },
  useTableTurns: (params: TableTurnsParams, enabled = true) => {
    if (enabled) mockState.turnsCalls.push(params)
    return mockState.turnsResult
  },
}))

vi.mock("@/state/session", () => ({
  useCan: (permission: string) => permission === "report.read" && mockState.canRead,
  useSession: (selector: (s: { principal: null; permissions: string[] }) => unknown) =>
    selector({
      principal: null,
      permissions: mockState.canRead ? ["report.read"] : [],
    }),
}))

import TurnLedgerPage from "./turn-ledger-page"
import { TurnsDailyChart } from "./turns-daily-chart"
import { resolveRadioKeyTargetIndex } from "./turns-helpers"
import { TurnsRadioGroup } from "./turns-radio-group"
import { StaffBreakdownCard, TopScopesCard } from "./turns-side-cards"

function makeSummaryFixture(): TableTurnSummary {
  return {
    from: "2026-11-09",
    to: "2026-11-15",
    completedTotal: 21,
    guestTotal: 91,
    byBusinessDate: [
      { businessDate: "2026-11-10", turns: 3, guests: 13 },
      { businessDate: "2026-11-14", turns: 5, guests: 24 },
    ],
    byStaff: [
      { checkedInByUserId: 1, checkedInByDisplayName: "Lễ tân 1", turns: 14, guests: 50 },
      { checkedInByUserId: 2, checkedInByDisplayName: "Lễ tân 2", turns: 7, guests: 41 },
      { checkedInByUserId: null, checkedInByDisplayName: null, turns: 2, guests: 9 },
    ],
    byScope: [
      { scope: "GROUP", tableId: null, groupId: 10, label: "C1", turns: 8, guests: 48 },
      { scope: "TABLE", tableId: 1, groupId: null, label: "B1", turns: 7, guests: 22 },
      { scope: "TABLE", tableId: 2, groupId: null, label: "B2", turns: 6, guests: 21 },
      { scope: "TABLE", tableId: 3, groupId: null, label: "B3", turns: 5, guests: 15 },
      { scope: "TABLE", tableId: 4, groupId: null, label: "B4", turns: 4, guests: 12 },
      { scope: "TABLE", tableId: 5, groupId: null, label: "B5", turns: 4, guests: 11 },
      { scope: "TABLE", tableId: 6, groupId: null, label: "B6", turns: 3, guests: 9 },
      { scope: "TABLE", tableId: 7, groupId: null, label: "B7", turns: 3, guests: 8 },
      { scope: "TABLE", tableId: 8, groupId: null, label: "B8", turns: 2, guests: 6 },
      { scope: "TABLE", tableId: 9, groupId: null, label: "B9", turns: 2, guests: 5 },
      { scope: "TABLE", tableId: 10, groupId: null, label: "B10-SHOULD-NOT-APPEAR", turns: 1, guests: 2 },
    ],
  }
}

function makeTurnsFixture(): TableTurnsResult {
  return {
    from: "2026-11-09",
    to: "2026-11-15",
    page: 1,
    pageSize: 20,
    total: 3,
    completedTotal: 2,
    guestTotal: 11,
    turns: [
      {
        turnId: 101,
        status: "CLOSED",
        turnNo: 1,
        businessDate: "2026-11-15",
        scope: "GROUP",
        groupCode: "C1",
        groupId: 10,
        tableId: null,
        tableCodes: ["B3", "B4"],
        memberTableIds: [3, 4],
        guestName: "Nhóm bạn Hà 0912345678",
        guestCount: 8,
        sourceCode: "HOTLINE",
        origin: "RESERVATION",
        seatedAt: "2026-11-15T13:00:00.000Z",
        releasedAt: "2026-11-15T16:00:00.000Z",
        endReason: "GUEST_LEFT",
        counted: true,
        visitId: 1101,
        reservationId: 2101,
        checkedInByUserId: 1,
        checkedInByDisplayName: "Lễ tân 1",
        closedByUserId: 1,
        closedByDisplayName: "Lễ tân 1",
      },
      {
        turnId: 102,
        status: "CLOSED",
        turnNo: 2,
        businessDate: "2026-11-15",
        scope: "TABLE",
        groupCode: null,
        groupId: null,
        tableId: 1,
        tableCodes: ["B1"],
        memberTableIds: [1],
        guestName: "Nhập nhầm bàn",
        guestCount: 3,
        sourceCode: "ZALO",
        origin: "RESERVATION",
        seatedAt: "2026-11-15T13:15:00.000Z",
        releasedAt: "2026-11-15T13:20:00.000Z",
        endReason: "ENTRY_ERROR",
        counted: false,
        visitId: 1102,
        reservationId: 2102,
        checkedInByUserId: 2,
        checkedInByDisplayName: "Lễ tân 2",
        closedByUserId: 2,
        closedByDisplayName: "Lễ tân 2",
      },
      {
        turnId: 103,
        status: "CLOSED",
        turnNo: 3,
        businessDate: "2026-11-15",
        scope: "TABLE",
        groupCode: null,
        groupId: null,
        tableId: 2,
        tableCodes: ["B2"],
        memberTableIds: [2],
        guestName: "Khách cuối ca",
        guestCount: 4,
        sourceCode: null,
        origin: "WALK_IN",
        seatedAt: "2026-11-15T16:00:00.000Z",
        releasedAt: "2026-11-15T22:00:00.000Z",
        endReason: "BUSINESS_DAY_END",
        counted: false,
        visitId: 1103,
        reservationId: null,
        checkedInByUserId: null,
        checkedInByDisplayName: null,
        closedByUserId: null,
        closedByDisplayName: null,
      },
    ],
  }
}

function collectElements(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (!node || typeof node !== "object") return out
  if (Array.isArray(node)) {
    for (const item of node) collectElements(item, out)
    return out
  }
  const el = node as ReactElement<{ children?: unknown }>
  if ("type" in el && "props" in el) {
    out.push(el)
    if (el.props?.children) collectElements(el.props.children, out)
  }
  return out
}

describe("TurnLedgerPage & subcomponents (NA-34 UI)", () => {
  beforeEach(() => {
    mockState.canRead = true
    mockState.businessDate = "2026-11-15"
    mockState.summaryCalls = []
    mockState.turnsCalls = []
    mockState.summaryResult = {
      data: makeSummaryFixture(),
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    mockState.turnsResult = {
      data: makeTurnsFixture(),
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
  })

  it("renders summary totals, masks phones, marks uncounted rows, and excludes Sprint 5 CRM sections", () => {
    const html = renderToString(createElement(TurnLedgerPage, { initialPreset: "week" }))
    expect(html).toContain("Lượt tới quán")
    expect(html).toContain(">21<")
    expect(html).toContain("Tổng khách")
    expect(html).toContain(">91<")
    // Uncounted metric card hidden until toggle is active
    expect(html).not.toContain('data-testid="turns-metric-uncounted"')
    // Every day in Mon-Sun (09/11 .. 15/11) filled including 0-turn days
    for (const bd of [
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]) {
      expect(html).toContain(`data-business-date="${bd}"`)
    }
    // Staff column header ("Người check-in") + null staff Hệ thống
    expect(html).toContain("Người check-in")
    expect(html).not.toContain("Người trả bàn")
    expect(html).toContain("Hệ thống")
    // Phone masked, never raw
    expect(html).toContain("Nhóm bạn Hà ***678")
    expect(html).not.toContain("0912345678")
    // Uncounted reasons in Vietnamese
    expect(html).toContain("Nhập nhầm")
    expect(html).toContain("Hệ thống đóng ca")
    expect(html).toContain("Không tính")
    // Forbidden Sprint 5 features
    expect(html).not.toContain("Có thanh toán")
    expect(html).not.toContain("Thu thập")
    expect(html).not.toContain("Gán lượt khuyết danh")
    expect(html).not.toContain("Gợi ý trùng hồ sơ")
  })

  it("passes today range by default and hides Theo ngày on single-day view", () => {
    const html = renderToString(createElement(TurnLedgerPage))
    expect(mockState.summaryCalls.at(-1)).toEqual({ from: "2026-11-15", to: "2026-11-15" })
    expect(mockState.turnsCalls.at(-1)).toEqual({
      from: "2026-11-15",
      to: "2026-11-15",
      page: 1,
      pageSize: 20,
    })
    expect(html).not.toContain('data-testid="turns-daily-section"')
  })

  it("renders TopScopesCard using summary.byScope as-is (top 10, GROUP not unnested)", () => {
    const summary = makeSummaryFixture()
    const html = renderToString(createElement(TopScopesCard, { byScope: summary.byScope }))
    expect(html).toContain("C1")
    expect(html).toContain("Cụm")
    expect(html).toContain("B1")
    expect(html).toContain("B9")
    expect(html).not.toContain("B10-SHOULD-NOT-APPEAR")
    // GROUP C1 keeps its 8 turns and 48 guests intact without unnesting B3/B4
    expect(html).toContain(">48<")
  })

  it("renders open turns with em-dash end time, Đang ngồi chip, and checkedInBy* precedence", () => {
    const baseTurns = makeTurnsFixture()
    mockState.summaryResult = {
      ...mockState.summaryResult,
      data: {
        ...makeSummaryFixture(),
        byStaff: [
          {
            checkedInByUserId: 8,
            checkedInByDisplayName: "NV Check-in 8",
            closedByUserId: 1,
            closedByDisplayName: "Lễ tân 1",
            turns: 3,
            guests: 10,
          } as never,
        ],
      },
    }
    mockState.turnsResult = {
      ...mockState.turnsResult,
      data: {
        ...baseTurns,
        turns: [
          {
            turnId: 999,
            turnNo: 1,
            businessDate: "2026-11-15",
            scope: "TABLE",
            groupCode: null,
            groupId: null,
            tableId: 4,
            tableCodes: ["B4"],
            memberTableIds: [4],
            guestName: "Chị Thảo",
            guestCount: 4,
            sourceCode: "WALK_IN",
            origin: "WALK_IN",
            status: "OPEN",
            seatedAt: "2026-11-15T14:30:00.000Z",
            releasedAt: null,
            endReason: null,
            counted: true,
            visitId: 1999,
            reservationId: null,
            checkedInByUserId: 8,
            checkedInByDisplayName: "NV Check-in 8",
            closedByUserId: 1,
            closedByDisplayName: "Lễ tân 1",
          } as unknown as TableTurnsResult["turns"][number],
        ],
      },
    }

    const html = renderToString(createElement(TurnLedgerPage))
    expect(html).toContain("21:30 → —")
    expect(html).toContain("Đang ngồi")
    expect(html).toContain('data-testid="turns-open-chip"')
    expect(html).toContain("NV Check-in 8")
    // Open turns are counted immediately -> no "Không tính" badge on open turn
    expect(html).not.toContain('data-testid="turns-uncounted-mark"')
  })

  it("triggers checkedInByUserId / staff filter when clicking a staff row and leaves Hệ thống non-filterable", () => {
    const onSelectStaff = vi.fn()
    const tree = StaffBreakdownCard({
      byStaff: makeSummaryFixture().byStaff,
      selectedStaffId: undefined,
      onSelectStaff,
    })
    const elements = collectElements(tree)
    const staffBtn = elements.find(
      (el) =>
        el.type === "button" &&
        (el.props as Record<string, unknown>)["data-testid"] === "turns-staff-filter-1",
    ) as ReactElement<{ onClick: (e: { stopPropagation: () => void }) => void }> | undefined
    expect(staffBtn).toBeDefined()
    staffBtn!.props.onClick({ stopPropagation: () => undefined })
    expect(onSelectStaff).toHaveBeenCalledWith(1)

    const systemBtn = elements.find(
      (el) =>
        el.type === "button" &&
        (el.props as Record<string, unknown>)["data-testid"] === "turns-staff-filter-null",
    )
    expect(systemBtn).toBeUndefined()
  })

  it("renders loading skeleton, empty state, error retry state, and 403 permission state", () => {
    // Loading
    mockState.summaryResult = { ...mockState.summaryResult, data: undefined, isPending: true }
    mockState.turnsResult = { ...mockState.turnsResult, data: undefined, isPending: true }
    expect(renderToString(createElement(TurnLedgerPage))).toContain('data-testid="turns-loading-skeleton"')

    // Empty
    mockState.summaryResult = {
      ...mockState.summaryResult,
      isPending: false,
      data: {
        from: "2026-11-15",
        to: "2026-11-15",
        completedTotal: 0,
        guestTotal: 0,
        byBusinessDate: [],
        byStaff: [],
        byScope: [],
      },
    }
    mockState.turnsResult = {
      ...mockState.turnsResult,
      isPending: false,
      data: {
        from: "2026-11-15",
        to: "2026-11-15",
        page: 1,
        pageSize: 20,
        total: 0,
        completedTotal: 0,
        guestTotal: 0,
        turns: [],
      },
    }
    const emptyHtml = renderToString(createElement(TurnLedgerPage))
    expect(emptyHtml).toContain('data-testid="turns-empty-state"')
    expect(emptyHtml).toContain("Chưa có lượt nào trong khoảng này")

    // Error
    mockState.summaryResult = {
      ...mockState.summaryResult,
      data: undefined,
      isError: true,
      error: new Error("Mất kết nối"),
    }
    const errHtml = renderToString(createElement(TurnLedgerPage))
    expect(errHtml).toContain('data-testid="turns-error-state"')
    expect(errHtml).toContain("Thử lại")

    // 403 API error
    mockState.summaryResult = {
      ...mockState.summaryResult,
      data: undefined,
      isError: true,
      error: new ApiError(403, "PERMISSION_DENIED", "Forbidden"),
    }
    expect(renderToString(createElement(TurnLedgerPage))).toContain('data-testid="turns-forbidden-state"')

    // Client permission missing
    mockState.summaryResult = { ...mockState.summaryResult, isError: false, error: null }
    mockState.canRead = false
    expect(renderToString(createElement(TurnLedgerPage))).toContain("403 · Thiếu quyền report.read")
  })

  it("renders explicit lượt/khách units without k suffix in daily chart and daily table (NA34U-01)", () => {
    const days = [
      { businessDate: "2026-11-14", turns: 31, guests: 95 },
      { businessDate: "2026-11-15", turns: 0, guests: 0 },
    ]
    const chartHtml = renderToString(createElement(TurnsDailyChart, { days }))
    expect(chartHtml).toContain("31 lượt")
    expect(chartHtml).toContain("95 khách")
    expect(chartHtml).not.toContain("95k")
    expect(chartHtml).not.toContain("(k)")
  })

  it("renders Bàn ghép for combined TABLE scope, Cụm for GROUP, and explanatory footnote without recounting (NA34U-03)", () => {
    const html = renderToString(
      createElement(TopScopesCard, {
        byScope: [
          { scope: "TABLE", tableId: 11, groupId: null, label: "B11 + B12", turns: 20, guests: 97 },
          { scope: "GROUP", tableId: null, groupId: 10, label: "C1", turns: 8, guests: 48 },
          { scope: "TABLE", tableId: 1, groupId: null, label: "B1", turns: 7, guests: 22 },
        ],
      }),
    )
    expect(html).toContain('data-scope-type="TABLE"')
    expect(html).toContain("B11 + B12")
    expect(html).toContain("Bàn ghép")
    expect(html).toContain(">20<")
    expect(html).toContain(">97<")
    expect(html).toContain('data-scope-type="GROUP"')
    expect(html).toContain("Cụm")
    expect(html).toContain("Bàn")
    expect(html).toContain('data-testid="turns-top-scopes-footnote"')
    expect(html).toContain("bàn đại diện")
  })

  it("renders roving tabIndex and handles ArrowLeft/ArrowRight wraparound in TurnsRadioGroup (NA34U-04)", () => {
    const onValueChange = vi.fn()
    const options = [
      { id: "today", label: "Ca hôm nay", testId: "opt-today" },
      { id: "week", label: "Tuần này", testId: "opt-week" },
      { id: "7days", label: "7 ngày", testId: "opt-7days" },
    ] as const

    const htmlWeekSelected = renderToString(
      createElement(TurnsRadioGroup, {
        ariaLabel: "Khoảng ngày",
        options,
        value: "week",
        onValueChange,
      }),
    )
    expect(htmlWeekSelected).toContain('data-testid="opt-today"')
    expect(htmlWeekSelected).toMatch(/tabindex="-1"[^>]*data-testid="opt-today"/)
    expect(htmlWeekSelected).toMatch(/tabindex="0"[^>]*data-testid="opt-week"/)
    expect(htmlWeekSelected).toMatch(/tabindex="-1"[^>]*data-testid="opt-7days"/)

    // When value is undefined (e.g. date picker active), first item stays tabbable
    const htmlNoneSelected = renderToString(
      createElement(TurnsRadioGroup, {
        ariaLabel: "Khoảng ngày",
        options,
        value: undefined,
        onValueChange,
      }),
    )
    expect(htmlNoneSelected).toMatch(/tabindex="0"[^>]*data-testid="opt-today"/)

    // Verify ArrowRight / ArrowLeft / Up / Down / Home / End wraparound index navigation
    expect(resolveRadioKeyTargetIndex("ArrowRight", 0, 3)).toBe(1)
    expect(resolveRadioKeyTargetIndex("ArrowRight", 2, 3)).toBe(0)
    expect(resolveRadioKeyTargetIndex("ArrowDown", 1, 3)).toBe(2)
    expect(resolveRadioKeyTargetIndex("ArrowLeft", 0, 3)).toBe(2)
    expect(resolveRadioKeyTargetIndex("ArrowUp", 0, 3)).toBe(2)
    expect(resolveRadioKeyTargetIndex("Home", 2, 3)).toBe(0)
    expect(resolveRadioKeyTargetIndex("End", 0, 3)).toBe(2)
    expect(resolveRadioKeyTargetIndex("Tab", 0, 3)).toBeNull()
  })
})

import { createElement, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  AnonymousAssignmentResult,
  AnonymousVisitQuery,
  AnonymousVisitsResult,
  CustomerMergeResult,
  DuplicateCustomersResult,
  DuplicateDismissalResult,
  TableTurnQuery,
  TableTurnSummary,
  TableTurnsParams,
  TableTurnsResult,
  UndoAnonymousAssignmentResult,
} from "@/domain/models"
import { ApiError } from "@/services/contracts"

const mockState = vi.hoisted(() => ({
  canRead: true,
  role: "OWNER" as "OWNER" | "ADMIN" | "RECEPTIONIST",
  userAccessLevel: undefined as "WRITE" | "READ_ONLY" | undefined,
  principal: null as {
    id: number
    username: string
    displayName: string
    organizationId: number
    venueId: number
    roles: string[]
    accessLevel: "WRITE" | "READ_ONLY" | null
  } | null,
  permissions: ["report.read", "customer.history.manage"] as string[],
  businessDate: "2026-11-15",
  summaryCalls: [] as TableTurnQuery[],
  turnsCalls: [] as TableTurnsParams[],
  anonymousCalls: [] as AnonymousVisitQuery[],
  duplicateCalls: [] as Array<{ page?: number; pageSize?: number }>,
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
  anonymousResult: {
    data: undefined as AnonymousVisitsResult | undefined,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  duplicatesResult: {
    data: undefined as DuplicateCustomersResult | undefined,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  assignMutation: {
    isPending: false,
    mutateAsync: vi.fn<() => Promise<AnonymousAssignmentResult>>(),
  },
  undoMutation: {
    isPending: false,
    mutateAsync: vi.fn<() => Promise<UndoAnonymousAssignmentResult>>(),
  },
  mergeMutation: {
    isPending: false,
    mutateAsync: vi.fn<() => Promise<CustomerMergeResult>>(),
  },
  dismissMutation: {
    isPending: false,
    mutateAsync: vi.fn<() => Promise<DuplicateDismissalResult>>(),
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

vi.mock("@/hooks/use-customer-history", () => ({
  useAnonymousVisits: (query: AnonymousVisitQuery) => {
    mockState.anonymousCalls.push(query)
    return mockState.anonymousResult
  },
  useDuplicateCustomers: (query: { page?: number; pageSize?: number } = {}) => {
    mockState.duplicateCalls.push(query)
    return mockState.duplicatesResult
  },
  useAssignAnonymousVisit: () => mockState.assignMutation,
  useUndoAnonymousAssignment: () => mockState.undoMutation,
  useMergeDuplicateCustomers: () => mockState.mergeMutation,
  useDismissDuplicateCustomers: () => mockState.dismissMutation,
}))

vi.mock("@/state/session", () => ({
  useCan: (permission: string) => permission === "report.read" && mockState.canRead,
  useSession: (
    selector: (s: {
      user: { id: number; displayName: string; role: string; deviceLabel: string; accessLevel?: "WRITE" | "READ_ONLY" }
      principal: typeof mockState.principal
      permissions: string[]
    }) => unknown,
  ) =>
    selector({
      user: {
        id: 3,
        displayName: "Chủ quán",
        role: mockState.role,
        deviceLabel: "Test",
        ...(mockState.userAccessLevel ? { accessLevel: mockState.userAccessLevel } : {}),
      },
      principal: mockState.principal,
      permissions: mockState.canRead ? mockState.permissions : [],
    }),
}))

import TurnLedgerPage from "./turn-ledger-page"
import { AnonymousVisitsCard, DuplicateCustomersCard, DuplicateMergeSummary } from "./turns-customer-history-cards"
import { TurnsDailyChart } from "./turns-daily-chart"
import { resolveRadioKeyTargetIndex } from "./turns-helpers"
import { TurnsRadioGroup } from "./turns-radio-group"
import { StaffBreakdownCard, TopScopesCard } from "./turns-side-cards"

function makeSummaryFixture(): TableTurnSummary {
  return {
    from: "2026-11-09",
    to: "2026-11-15",
    completedTotal: 21,
    openTotal: 4,
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

function makeAnonymousFixture(): AnonymousVisitsResult {
  return {
    page: 1,
    pageSize: 50,
    hasMore: false,
    visits: [
      {
        visitId: 1044,
        displayCode: "L-1044",
        tableLabel: "A1",
        guestCount: 4,
        seatedAt: "2026-11-15T13:41:00.000Z",
        businessDate: "2026-11-15",
        version: 1,
      },
      {
        visitId: 1049,
        displayCode: "L-1049",
        tableLabel: "BAR05 + BAR06",
        guestCount: 2,
        seatedAt: "2026-11-12T14:48:00.000Z",
        businessDate: "2026-11-12",
        version: 1,
      },
    ],
  }
}

function makeDuplicatesFixture(): DuplicateCustomersResult {
  return {
    page: 1,
    pageSize: 50,
    total: 3,
    canMerge: true,
    canDismiss: true,
    pairs: [
      {
        source: {
          id: 10,
          displayName: "Nguyễn An",
          maskedPhone: null,
          version: 1,
          visitCount: 3,
          bookingCount: 0,
        },
        target: {
          id: 11,
          displayName: "Nguyễn An",
          maskedPhone: "••• 678",
          version: 2,
          visitCount: 5,
          bookingCount: 2,
        },
      },
      {
        source: {
          id: 12,
          displayName: "Trần Minh",
          maskedPhone: null,
          version: 1,
          visitCount: 1,
          bookingCount: 0,
        },
        target: {
          id: 13,
          displayName: "Trần Minh",
          maskedPhone: "••• 321",
          version: 1,
          visitCount: 4,
          bookingCount: 1,
        },
      },
    ],
  }
}

describe("TurnLedgerPage & subcomponents (NA-34 UI)", () => {
  beforeEach(() => {
    mockState.canRead = true
    mockState.role = "OWNER"
    mockState.userAccessLevel = undefined
    mockState.principal = null
    mockState.permissions = ["report.read", "customer.history.manage"]
    mockState.businessDate = "2026-11-15"
    mockState.summaryCalls = []
    mockState.turnsCalls = []
    mockState.anonymousCalls = []
    mockState.duplicateCalls = []
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
    mockState.anonymousResult = {
      data: makeAnonymousFixture(),
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    mockState.duplicatesResult = {
      data: makeDuplicatesFixture(),
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
  })

  it("renders 4 KPI cards, masks phones, marks uncounted rows, shows NGÀY CA on multi-day, and places NA-34 cards in right column + side cards below", () => {
    const html = renderToString(createElement(TurnLedgerPage, { initialPreset: "week" }))
    expect(html).toContain("Lượt tới quán")
    expect(html).toContain(">21<")
    expect(html).toContain("Tổng khách")
    expect(html).toContain(">91<")
    expect(html).toContain("Đang ngồi")
    expect(html).toContain(">4<")
    expect(html).toContain("lượt đang phục vụ trong khoảng")
    expect(html).not.toContain("bàn đang phục vụ trong khoảng")
    expect(html).toContain("Đã trả bàn")
    expect(html).toContain(">17<")
    // 30-day preset pill exists alongside existing presets
    expect(html).toContain('data-testid="turns-range-30days"')
    expect(html).toContain("30 ngày")
    // Uncounted metric card hidden in favor of 4-card Figma KPI row
    expect(html).not.toContain('data-testid="turns-metric-uncounted"')
    // Multi-day view shows NGÀY CA column and turn code L-<visitId>
    expect(html).toContain(">Ngày ca</th>")
    expect(html).toContain("L-1101")
    expect(html).toContain("Sổ lượt - tuần 09/11 - 15/11")
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
    // Payment/collection KPIs remain excluded; NA-34 anonymous + duplicate cards are rendered in right column
    expect(html).not.toContain("Có thanh toán")
    expect(html).not.toContain("Thu thập")
    const anonPos = html.indexOf('data-testid="turns-anon-card"')
    const dupPos = html.indexOf('data-testid="turns-dup-card"')
    const bottomPos = html.indexOf('data-testid="turns-bottom-grid"')
    const staffPos = html.indexOf('data-testid="turns-staff-card"')
    const topScopesPos = html.indexOf('data-testid="turns-top-scopes-card"')
    expect(anonPos).toBeGreaterThan(-1)
    expect(dupPos).toBeGreaterThan(anonPos)
    expect(bottomPos).toBeGreaterThan(dupPos)
    expect(staffPos).toBeGreaterThan(bottomPos)
    expect(topScopesPos).toBeGreaterThan(staffPos)
  })

  it("passes today range by default, hides Theo ngày and NGÀY CA on single-day view, and supports 30days preset", () => {
    const html = renderToString(createElement(TurnLedgerPage))
    expect(mockState.summaryCalls.at(-1)).toEqual({ from: "2026-11-15", to: "2026-11-15" })
    expect(mockState.turnsCalls.at(-1)).toEqual({
      from: "2026-11-15",
      to: "2026-11-15",
      page: 1,
      pageSize: 20,
    })
    expect(html).not.toContain('data-testid="turns-daily-section"')
    expect(html).not.toContain(">Ngày ca</th>")
    expect(html).toContain("Sổ lượt - ca 15/11")

    const html30 = renderToString(createElement(TurnLedgerPage, { initialPreset: "30days" }))
    expect(mockState.summaryCalls.at(-1)).toEqual({ from: "2026-10-17", to: "2026-11-15" })
    expect(mockState.turnsCalls.at(-1)).toEqual({
      from: "2026-10-17",
      to: "2026-11-15",
      page: 1,
      pageSize: 20,
    })
    expect(html30).toContain('data-testid="turns-daily-section"')
    expect(html30).toContain(">Ngày ca</th>")
    expect(html30).toContain("Sổ lượt - 30 ngày (17/10 - 15/11)")
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
      (el) => el.type === "button" && (el.props as Record<string, unknown>)["data-testid"] === "turns-staff-filter-1",
    ) as ReactElement<{ onClick: (e: { stopPropagation: () => void }) => void }> | undefined
    expect(staffBtn).toBeDefined()
    staffBtn!.props.onClick({ stopPropagation: () => undefined })
    expect(onSelectStaff).toHaveBeenCalledWith(1)

    const systemBtn = elements.find(
      (el) =>
        el.type === "button" && (el.props as Record<string, unknown>)["data-testid"] === "turns-staff-filter-null",
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
        openTotal: 0,
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

  it("renders long staff names with bounded wrapping and wraps 3-table clusters at + separators (B-01, B-02, B-03)", () => {
    const baseSummary = makeSummaryFixture()
    mockState.summaryResult = {
      ...mockState.summaryResult,
      data: {
        ...baseSummary,
        completedTotal: 12,
        openTotal: 4,
        byStaff: [
          {
            checkedInByUserId: 7,
            checkedInByDisplayName: "Nguyễn Thị Ngọc Huyền",
            turns: 12,
            guests: 39,
          },
        ],
      },
    }
    const baseTurns = makeTurnsFixture()
    mockState.turnsResult = {
      ...mockState.turnsResult,
      data: {
        ...baseTurns,
        total: 2,
        completedTotal: 2,
        turns: [
          {
            ...baseTurns.turns[0]!,
            turnId: 201,
            visitId: 1188,
            status: "OPEN",
            scope: "TABLE",
            groupCode: null,
            groupId: null,
            tableId: 17,
            tableCodes: ["BAR07", "BAR08", "BAR09"],
            memberTableIds: [17, 18, 19],
            guestName: "Đặng Quang Ngọc",
            guestCount: 3,
            sourceCode: null,
            origin: "WAITLIST",
            releasedAt: null,
            endReason: null,
            counted: true,
            checkedInByUserId: 7,
            checkedInByDisplayName: "Nguyễn Thị Ngọc Huyền",
            closedByUserId: null,
            closedByDisplayName: null,
          },
          {
            ...baseTurns.turns[0]!,
            turnId: 202,
            visitId: 1193,
            status: "CLOSED",
            scope: "TABLE",
            groupCode: null,
            groupId: null,
            tableId: 15,
            tableCodes: ["BAR05", "BAR06"],
            memberTableIds: [15, 16],
            guestName: "Phan Phương Bảo",
            guestCount: 5,
            sourceCode: "STAFF",
            origin: "RESERVATION",
            endReason: "GUEST_LEFT",
            counted: true,
            checkedInByUserId: 7,
            checkedInByDisplayName: "Nguyễn Thị Ngọc Huyền",
          },
        ],
      },
    }

    const html = renderToString(createElement(TurnLedgerPage, { initialPreset: "30days" }))

    // B-01: Long staff name uses bounded 2-line wrapper and full accessible title, not unbounded whitespace-nowrap
    expect(html).toContain('class="turns-history-staff-col"')
    expect(html).not.toMatch(/<td[^>]*turns-history-staff-col[^>]*whitespace-nowrap/)
    expect(html).toContain('class="turns-staff-name" title="Nguyễn Thị Ngọc Huyền">Nguyễn Thị Ngọc Huyền</span>')

    // B-02: OPEN KPI counts lượt (4), even with multi-table turns, and uses lượt caption
    expect(html).toContain("lượt đang phục vụ trong khoảng")
    expect(html).not.toContain("bàn đang phục vụ trong khoảng")

    // B-03: 3-table cluster splits at " + " into nowrap tokens so codes never split mid-code
    expect(html).toContain(
      '<span class="whitespace-nowrap">BAR07 +</span> <span class="whitespace-nowrap">BAR08 +</span> <span class="whitespace-nowrap">BAR09</span>',
    )
    expect(html).toContain(
      '<span class="whitespace-nowrap">BAR05 +</span> <span class="whitespace-nowrap">BAR06</span>',
    )
    expect(html).toContain("Đặng Quang Ngọc")
    expect(html).toContain("Phan Phương Bảo")
    expect(html).not.toMatch(/<td[^>]*turns-history-source-col[^>]*whitespace-nowrap/)
    expect(html).not.toMatch(/<td[^>]*turns-history-end-col[^>]*whitespace-nowrap/)
  })

  it("renders AnonymousVisitsCard states: populated, date-range sync, empty, loading, error+retry, 403, and masked phone", () => {
    const pageHtml = renderToString(createElement(TurnLedgerPage, { initialPreset: "7days" }))
    expect(mockState.anonymousCalls.at(-1)).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
      page: 1,
      pageSize: 50,
    })
    expect(pageHtml).toContain("Gán lượt khuyết danh vào khách")
    expect(pageHtml).toContain("Thao tác sửa lịch sử - hoàn tác được")
    expect(pageHtml).toContain("L-1044 · Khách Walk-in #1044")
    expect(pageHtml).toContain("A1 · 4 khách · 20:41 hôm nay")
    expect(pageHtml).toContain("2 lượt khuyết danh còn lại")
    expect(pageHtml).toContain('placeholder="Nhập SĐT để tìm khách"')
    expect(pageHtml).toContain("Gán vào khách")
    expect(pageHtml).toContain("Bỏ qua")

    // Empty state
    mockState.anonymousResult = {
      ...mockState.anonymousResult,
      data: { page: 1, pageSize: 50, hasMore: false, visits: [] },
    }
    const emptyHtml = renderToString(
      createElement(AnonymousVisitsCard, {
        from: "2026-11-15",
        to: "2026-11-15",
        currentBusinessDate: "2026-11-15",
        isReadOnly: false,
      }),
    )
    expect(emptyHtml).toContain("Không còn lượt khuyết danh trong khoảng này")

    // Loading state
    mockState.anonymousResult = { ...mockState.anonymousResult, data: undefined, isPending: true }
    expect(
      renderToString(
        createElement(AnonymousVisitsCard, {
          from: "2026-11-15",
          to: "2026-11-15",
          currentBusinessDate: "2026-11-15",
          isReadOnly: false,
        }),
      ),
    ).toContain('data-testid="turns-anon-loading"')

    // Error + Retry state
    mockState.anonymousResult = {
      ...mockState.anonymousResult,
      isPending: false,
      isError: true,
      error: new Error("Lỗi mạng 0901234678"),
    }
    const errHtml = renderToString(
      createElement(AnonymousVisitsCard, {
        from: "2026-11-15",
        to: "2026-11-15",
        currentBusinessDate: "2026-11-15",
        isReadOnly: false,
      }),
    )
    expect(errHtml).toContain('data-testid="turns-anon-error"')
    expect(errHtml).toContain("Thử lại")
    expect(errHtml).not.toContain("0901234678")

    // 403 API error
    mockState.anonymousResult = {
      ...mockState.anonymousResult,
      error: new ApiError(403, "PERMISSION_DENIED", "Forbidden"),
    }
    expect(
      renderToString(
        createElement(AnonymousVisitsCard, {
          from: "2026-11-15",
          to: "2026-11-15",
          currentBusinessDate: "2026-11-15",
          isReadOnly: false,
        }),
      ),
    ).toContain('data-testid="turns-anon-forbidden"')
  })

  it("renders DuplicateCustomersCard states, masked phone only, READ_ONLY, and venue-scoped ADMIN restrictions", () => {
    const dupHtml = renderToString(createElement(DuplicateCustomersCard, { isReadOnly: false }))
    expect(dupHtml).toContain("Gợi ý trùng hồ sơ")
    expect(dupHtml).toContain("hệ thống đề xuất, Quản lý quyết định")
    expect(dupHtml).toContain("Nguyễn An · ••• 678")
    expect(dupHtml).toContain("Nguyễn An · chưa có SĐT")
    expect(dupHtml).toContain("5 lượt · 2 đặt bàn")
    expect(dupHtml).toContain("3 lượt · 0 đặt bàn")
    expect(dupHtml).toContain("cùng tên, một hồ sơ chưa có SĐT")
    expect(dupHtml).toContain("1/3")
    expect(dupHtml).toContain('data-testid="turns-dup-next-btn"')
    expect(dupHtml).toContain("Gộp")
    expect(dupHtml).toContain("Khác nhau")
    expect(dupHtml).not.toMatch(/0\d{9}/)

    // Venue-scoped ADMIN WRITE: Card 1 writable, Card 2 merge/dismiss disabled with explanation
    mockState.role = "ADMIN"
    mockState.userAccessLevel = "WRITE"
    mockState.duplicatesResult = {
      ...mockState.duplicatesResult,
      data: {
        ...makeDuplicatesFixture(),
        canMerge: false,
        canDismiss: false,
      },
    }
    const venueScopedHtml = renderToString(createElement(TurnLedgerPage))
    expect(venueScopedHtml).not.toContain('data-testid="turns-anon-readonly-note"')
    expect(venueScopedHtml).toContain('data-testid="turns-dup-permission-note"')
    expect(venueScopedHtml).toContain("quyền toàn tổ chức")
    expect(venueScopedHtml).toMatch(
      /disabled=""[^>]*data-testid="turns-dup-merge-btn"|data-testid="turns-dup-merge-btn"[^>]*disabled/,
    )

    // READ_ONLY ADMIN: Card 1 inputs disabled + note, Card 2 buttons disabled + note
    mockState.principal = {
      id: 99,
      username: "admin_ro",
      displayName: "Admin Chỉ đọc",
      organizationId: 1,
      venueId: 1,
      roles: ["ADMIN"],
      accessLevel: "READ_ONLY",
    }
    mockState.permissions = ["report.read"]
    const readOnlyHtml = renderToString(createElement(TurnLedgerPage))
    expect(readOnlyHtml).toContain('data-testid="turns-anon-readonly-note"')
    expect(readOnlyHtml).toContain("Tài khoản chỉ xem")
    expect(readOnlyHtml).toMatch(
      /disabled=""[^>]*data-testid="turns-anon-phone-input"|data-testid="turns-anon-phone-input"[^>]*disabled/,
    )
    expect(readOnlyHtml).toMatch(
      /disabled=""[^>]*data-testid="turns-anon-submit-btn"|data-testid="turns-anon-submit-btn"[^>]*disabled/,
    )
    expect(readOnlyHtml).toContain('data-testid="turns-dup-permission-note"')

    // Empty, loading, error states on DuplicateCustomersCard
    mockState.duplicatesResult = {
      ...mockState.duplicatesResult,
      data: { page: 1, pageSize: 50, total: 0, canMerge: true, canDismiss: true, pairs: [] },
    }
    expect(renderToString(createElement(DuplicateCustomersCard, { isReadOnly: false }))).toContain(
      'data-testid="turns-dup-empty"',
    )

    mockState.duplicatesResult = { ...mockState.duplicatesResult, data: undefined, isPending: true }
    expect(renderToString(createElement(DuplicateCustomersCard, { isReadOnly: false }))).toContain(
      'data-testid="turns-dup-loading"',
    )

    mockState.duplicatesResult = {
      ...mockState.duplicatesResult,
      isPending: false,
      isError: true,
      error: new Error("Mất kết nối"),
    }
    const dupErrHtml = renderToString(createElement(DuplicateCustomersCard, { isReadOnly: false }))
    expect(dupErrHtml).toContain('data-testid="turns-dup-error"')
    expect(dupErrHtml).toContain("Thử lại")
  })

  it("renders exact Vietnamese merge confirmation direction copy with distinct source/target (D-04)", () => {
    const dialogBodyHtml = renderToString(
      createElement(DuplicateMergeSummary, {
        pair: {
          source: {
            id: 21,
            displayName: "Lê Minh Chưa SĐT",
            maskedPhone: null,
            version: 1,
            visitCount: 2,
            bookingCount: 0,
          },
          target: {
            id: 22,
            displayName: "Lê Minh Đã Có SĐT",
            maskedPhone: "••• 899",
            version: 4,
            visitCount: 7,
            bookingCount: 3,
          },
        },
      }),
    )
    expect(dialogBodyHtml).toContain("Hồ sơ được giữ lại:")
    expect(dialogBodyHtml).toContain("Lê Minh Đã Có SĐT · ••• 899")
    expect(dialogBodyHtml).toContain("Hồ sơ sẽ được gộp vào hồ sơ trên:")
    expect(dialogBodyHtml).toContain("Lê Minh Chưa SĐT · chưa có SĐT")
    expect(dialogBodyHtml).not.toContain("Hồ sơ sẽ gộp vào:<")
    expect(dialogBodyHtml).toContain(
      "Toàn bộ lịch sử của hồ sơ chưa có SĐT sẽ được chuyển sang hồ sơ được giữ lại. Thao tác này không thể hoàn tác.",
    )
    // Kept target appears before merged-in source
    expect(dialogBodyHtml.indexOf("Lê Minh Đã Có SĐT · ••• 899")).toBeLessThan(
      dialogBodyHtml.indexOf("Lê Minh Chưa SĐT · chưa có SĐT"),
    )
    expect(dialogBodyHtml).not.toMatch(/0\d{9}/)
  })
})

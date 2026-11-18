import { createElement, type ReactNode } from "react"
import { renderToString } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import type { RoleCode } from "@/domain/enums"
import type { TableLiveState } from "@/domain/models"
import type { FloorModel } from "../floor/use-floor-model"
import { MobileContext, type MobileCtx } from "./context"

vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined })
  vi.stubGlobal("document", {
    documentElement: { classList: { toggle: () => undefined }, style: {} },
    querySelector: () => null,
  })
})

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

vi.mock("@/features/operations/use-undo-redo", () => ({
  useUndoRedo: () => ({
    enabled: true,
    undo: null,
    redo: null,
    pending: false,
    apply: vi.fn(),
  }),
  useUndoRedoShortcuts: vi.fn(),
}))

vi.mock("@/hooks/use-reception-search", () => ({
  useReceptionSearch: () => ({
    mode: "phone" as const,
    value: "",
    active: false,
    searching: false,
    error: null,
    result: undefined,
    tableIds: [],
    setValue: vi.fn(),
    toggleMode: vi.fn(),
  }),
}))

vi.mock("@/hooks/use-plan-width", () => ({
  usePlanWidth: () => 390,
}))

vi.mock("@/hooks/use-data", () => ({
  useAvailability: () => ({ data: undefined, isPlaceholderData: false, isError: false }),
  useBusinessDate: () => "2026-11-17",
  useReceptionGuestCount: () => ({ data: undefined }),
  useUpdateReceptionGuestCount: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDayBookingsExport: () => ({ isFetching: false, refetch: vi.fn() }),
}))

vi.mock("../reservations/zalo-booking-export", () => ({
  ZaloBookingExport: ({
    children,
  }: {
    children: (arg: { copy: () => Promise<void>; loading: boolean }) => ReactNode
  }) => children({ copy: async () => undefined, loading: false }),
}))

import { MapScreen } from "./map"
import { BellButton, PlainHeader } from "./ui"

function makeCtx(role: RoleCode): MobileCtx {
  const model: FloorModel = {
    loading: false,
    error: null,
    catalog: {
      venue: {
        id: 1,
        version: 1,
        name: "21GAM",
        timezone: "Asia/Ho_Chi_Minh",
        businessDayStartLocal: "17:00",
        businessDayCutoffLocal: "05:00",
        upcomingWarningMinutes: 15,
        lateWarningMinutes: 15,
        noShowWarningMinutes: 30,
        waitlistHoldDefaultMinutes: 15,
        waitlistClaimLeaseSeconds: 60,
        reservationHoldPolicy: "SEQUENTIAL",
        reservationWindowMinutes: null,
        groupSymbolCount: 12,
        changeSeq: 1,
      },
      zones: [{ id: 1, version: 1, code: "A", name: "Khu A", isBookable: true, isWaitingArea: false }],
      tables: [],
      combinations: [],
      sources: [],
    },
    floor: {
      at: new Date("2026-11-17T21:30:00+07:00"),
      businessDate: "2026-11-17",
      tables: [],
      groups: [],
      changeSeq: 1,
    },
    tables: [],
    byId: new Map(),
    states: new Map(),
    counts: {} as Record<TableLiveState, number>,
    codes: () => [],
    label: (id) => `B${id}`,
    freeIds: new Set<number>(),
  }

  return {
    model,
    now: new Date("2026-11-17T21:30:00+07:00"),
    today: "2026-11-17",
    businessDate: "2026-11-17",
    role,
    isOwner: role === "OWNER",
    can: () => true,
    th: { late: 15, noshow: 30 },
    reservations: [],
    waitlist: [],
    unread: 5,
    go: vi.fn(),
    openAlerts: vi.fn(),
    openAccount: vi.fn(),
    openCount: vi.fn(),
    openCountEdit: vi.fn(),
    openDetail: vi.fn(),
    openEntryDetail: vi.fn(),
    openStatus: vi.fn(),
    openForm: vi.fn(),
    openTable: vi.fn(),
    ask: vi.fn(),
    startPick: vi.fn(),
  }
}

function renderWithCtx(role: RoleCode, node: ReactNode): string {
  const client = new QueryClient()
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(MobileContext.Provider, { value: makeCtx(role) }, node),
    ),
  )
}

describe("Notification bell removal for RECEPTIONIST", () => {
  it("shows the unread dot on Menu without a bell and keeps Undo/Redo for RECEPTIONIST", () => {
    const html = renderWithCtx(
      "RECEPTIONIST",
      createElement(MapScreen, {
        selected: null,
        onSelect: vi.fn(),
        pick: null,
        pickSel: [],
        onPickToggle: vi.fn(),
        onPickCancel: vi.fn(),
        onPickConfirm: vi.fn(),
        pickBusy: false,
      }),
    )

    expect(html).not.toContain('aria-label="Thông báo')
    expect(html).not.toContain("lucide-bell")
    expect(html).toMatch(/<button[^>]*aria-label="Menu, 5 thông báo chưa xem"[^>]*>(?:(?!<\/button>).)*data-testid="reception-menu-unread"/s)
    expect(html).not.toContain('<span class="flex-1"></span>')
    expect(html).toContain('aria-label="Hoàn tác"')
    expect(html).toContain('aria-label="Làm lại"')
  })

  it("renders null from BellButton and omits any bell button in PlainHeader for RECEPTIONIST", () => {
    expect(renderWithCtx("RECEPTIONIST", createElement(BellButton, { square: true }))).toBe("")
    expect(renderWithCtx("RECEPTIONIST", createElement(BellButton, { glass: true }))).toBe("")

    const headerHtml = renderWithCtx("RECEPTIONIST", createElement(PlainHeader, { title: "Sơ đồ bàn" }))
    expect(headerHtml).not.toContain("Thông báo")
    expect(headerHtml).not.toContain("lucide-bell")
    expect(headerHtml).not.toContain("bg-st-noshow")
  })

  it("keeps BellButton and unread badge intact for non-receptionist roles (OWNER)", () => {
    const bellHtml = renderWithCtx("OWNER", createElement(BellButton, { square: true }))
    expect(bellHtml).toContain('aria-label="Thông báo, 5 chưa xem"')
    expect(bellHtml).toContain("lucide-bell")
    expect(bellHtml).toContain("bg-st-noshow")
    expect(bellHtml).toContain(">5<")

    const headerHtml = renderWithCtx("OWNER", createElement(PlainHeader, { title: "Danh sách" }))
    expect(headerHtml).toContain('aria-label="Thông báo, 5 chưa xem"')
  })
})

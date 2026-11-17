import { createElement, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FloorState, ReceptionGuestCount, ReservationView, TableView, WaitlistEntryView } from "@/domain/models"
import { ApiError } from "@/services/contracts"

const mockState = vi.hoisted(() => ({
  canRead: true,
  businessDate: "2026-11-15",
  now: new Date("2026-11-15T22:00:00+07:00"),
  floorModel: {
    loading: false,
    error: null as unknown,
    catalog: undefined,
    floor: undefined as FloorState | undefined,
    tables: [] as TableView[],
    byId: new Map<number, TableView>(),
    states: new Map(),
    counts: { free: 0, reserved: 0, upcoming: 0, noshow: 0, seated: 0, spare: 0 },
    codes: () => [] as string[],
    label: (id: number) => `B${id}`,
    freeIds: [] as number[],
  },
  guestCount: {
    data: undefined as ReceptionGuestCount | undefined,
    isLoading: false,
    error: null as unknown,
  },
  reservations: {
    data: [] as ReservationView[],
    isLoading: false,
    error: null as unknown,
  },
  waitlist: {
    data: [] as WaitlistEntryView[],
    isLoading: false,
    error: null as unknown,
  },
}))

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    refetchQueries: vi.fn(),
  }),
}))

vi.mock("@/features/floor/use-floor-model", () => ({
  useFloorModel: () => mockState.floorModel,
}))

vi.mock("@/hooks/use-data", () => ({
  useBusinessDate: () => mockState.businessDate,
  useNow: () => mockState.now,
  useReceptionGuestCount: () => mockState.guestCount,
  useReservations: () => mockState.reservations,
  useWaitlist: () => mockState.waitlist,
}))

vi.mock("./shift-overview-hooks", () => ({
  useCanReadShiftOverview: () => mockState.canRead,
  isForbiddenError: (err: unknown) =>
    err instanceof ApiError && (err.status === 403 || err.code === "PERMISSION_DENIED"),
}))

import ShiftOverviewPage from "./shift-overview-page"

function renderPage(): string {
  return renderToString(createElement(ShiftOverviewPage) as ReactElement)
}

function seedPopulatedState() {
  const tables: TableView[] = [
    {
      id: 1,
      version: 1,
      code: "A1",
      displayName: "A1",
      zoneId: 1,
      zoneCode: "A",
      kind: "TABLE",
      seqNo: 1,
      isSpare: false,
      status: "ACTIVE",
      capacity: 4,
      x: 0,
      y: 0,
      w: 50,
      h: 50,
      seating: undefined,
    },
    {
      id: 2,
      version: 1,
      code: "B1",
      displayName: "B1",
      zoneId: 2,
      zoneCode: "B",
      kind: "TABLE",
      seqNo: 1,
      isSpare: false,
      status: "ACTIVE",
      capacity: 4,
      x: 0,
      y: 0,
      w: 50,
      h: 50,
      seating: undefined,
    },
    {
      id: 3,
      version: 1,
      code: "BAR01",
      displayName: "BAR01",
      zoneId: 4,
      zoneCode: "BAR",
      kind: "BAR_SEAT",
      seqNo: 1,
      isSpare: false,
      status: "ACTIVE",
      capacity: 1,
      x: 0,
      y: 0,
      w: 20,
      h: 20,
      seating: "bar",
    },
  ]

  mockState.floorModel = {
    loading: false,
    error: null,
    catalog: undefined,
    floor: { at: mockState.now, businessDate: "2026-11-15", tables: [], groups: [], changeSeq: 1 },
    tables,
    byId: new Map(tables.map((t) => [t.id, t])),
    states: new Map([
      [
        1,
        {
          tableId: 1,
          state: "seated",
          claim: null,
          staleFromPreviousDay: false,
        },
      ],
      [
        2,
        {
          tableId: 2,
          state: "free",
          claim: null,
          staleFromPreviousDay: false,
        },
      ],
      [
        3,
        {
          tableId: 3,
          state: "free",
          claim: null,
          staleFromPreviousDay: false,
        },
      ],
    ]),
    counts: { free: 2, reserved: 0, upcoming: 0, noshow: 0, seated: 1, spare: 0 },
    codes: () => [],
    label: (id) => `B${id}`,
    freeIds: [2, 3],
  }

  mockState.guestCount = {
    data: {
      businessDate: "2026-11-15",
      bookedTables: 14,
      bookedGuests: 56,
      arrivedTotal: 38,
      arrivedBefore: 24,
      arrivedAfter: 14,
      returningGuests: 16,
      version: 3,
      updatedAt: new Date("2026-11-15T21:40:00+07:00"),
    },
    isLoading: false,
    error: null,
  }

  mockState.reservations = { data: [], isLoading: false, error: null }
  mockState.waitlist = { data: [], isLoading: false, error: null }
}

describe("ShiftOverviewPage", () => {
  beforeEach(() => {
    mockState.canRead = true
    seedPopulatedState()
  })

  it("renders all KPI rows, read-only floor zones, alerts empty state, and zone occupancy", () => {
    const html = renderPage()

    expect(html).toContain("Tổng bàn đặt")
    expect(html).toContain("Tổng khách đặt")
    expect(html).toContain("Đã tới")
    expect(html).toContain("Đang ngồi")
    expect(html).toContain("Bàn trống")
    expect(html).toContain("Bàn chờ")

    expect(html).toContain("Khách trước 21:30")
    expect(html).toContain("Khách sau 21:30")
    expect(html).toContain("Khách quen (O)")
    expect(html).toContain("Khách mới (N)")
    expect(html).toContain("Lễ tân nhập")
    expect(html).toContain("Tự động")

    expect(html).toContain("Sơ đồ bàn — chỉ xem")
    expect(html).toContain("KHU A")
    expect(html).toContain("KHU B")
    expect(html).toContain("KHU C")
    expect(html).toContain("QUẦY BAR")

    expect(html).toContain("Cảnh báo điều hành")
    expect(html).toContain("Không có cảnh báo")
    expect(html).toContain("Tỷ lệ lấp bàn theo khu")
    expect(html).toContain("Quầy Bar")
    expect(html).toContain("Không tính ghế quầy Bar")
    expect(html).toContain("0/1 ghế")
  })

  it("renders 'Chưa nhập' when reception guest-count version is 0", () => {
    mockState.guestCount.data = {
      businessDate: "2026-11-15",
      bookedTables: 0,
      bookedGuests: 0,
      arrivedTotal: 0,
      arrivedBefore: 0,
      arrivedAfter: 0,
      returningGuests: 0,
      version: 0,
      updatedAt: null,
    }
    const html = renderPage()
    expect(html).toContain("Chưa nhập")
  })

  it("renders mismatch warning badge when returningGuests exceeds arrivedTotal", () => {
    mockState.guestCount.data = {
      businessDate: "2026-11-15",
      bookedTables: 5,
      bookedGuests: 20,
      arrivedTotal: 10,
      arrivedBefore: 6,
      arrivedAfter: 4,
      returningGuests: 13,
      version: 2,
      updatedAt: null,
    }
    const html = renderPage()
    expect(html).toContain("-3")
    expect(html).toContain("Số Lễ tân nhập chưa khớp")
  })

  it("renders loading skeletons matching KPI card structure (top, middle, footer)", () => {
    mockState.floorModel.loading = true
    const html = renderPage()
    expect(html).toContain('data-testid="shift-overview-loading"')
    expect(html.match(/data-testid="so-kpi-skeleton-card"/g)).toHaveLength(10)
    expect(html.match(/class="so-kpi-top"/g)).toHaveLength(10)
    expect(html.match(/class="so-kpi-middle"/g)).toHaveLength(10)
    expect(html.match(/class="so-kpi-footer"/g)).toHaveLength(10)
  })

  it("renders error state with retry action", () => {
    mockState.guestCount.error = new Error("Mất kết nối máy chủ")
    const html = renderPage()
    expect(html).toContain('data-testid="shift-overview-error"')
    expect(html).toContain("Mất kết nối máy chủ")
    expect(html).toContain("Thử lại")
  })

  it("renders 403 forbidden screen when missing report.read permission or on 403 API error", () => {
    mockState.canRead = false
    const html = renderPage()
    expect(html).toContain('data-testid="shift-overview-forbidden"')
    expect(html).toContain("report.read")

    mockState.canRead = true
    mockState.guestCount.error = new ApiError(403, "PERMISSION_DENIED", "Forbidden")
    const htmlApi403 = renderPage()
    expect(htmlApi403).toContain('data-testid="shift-overview-forbidden"')
  })

  it("differentiates primary/secondary KPI tiers, stretches desktop alerts shell, and preserves grouped floor chip classes", () => {
    const tables = mockState.floorModel.tables
    mockState.floorModel.floor = {
      at: mockState.now,
      businessDate: "2026-11-15",
      tables: [],
      groups: [{ id: 10, displayCode: "G01", symbolNo: 1, tableIds: [1] }],
      changeSeq: 1,
    }
    mockState.floorModel.tables = tables
    mockState.waitlist = {
      data: [
        {
          id: 1,
          version: 1,
          kind: "WALK_IN",
          displayName: "Khách chờ",
          phoneLast3: "123",
          customerId: null,
          partySize: 2,
          preferenceMode: null,
          preferences: [],
          channel: "IN_PERSON",
          businessDate: "2026-11-15",
          queuedAt: new Date(mockState.now.getTime() - 40 * 60_000),
          status: "WAITING",
          claimedBy: null,
          claimExpiresAt: null,
          offeredAt: null,
          hold: null,
          reservationId: null,
          reservationExpectedAt: null,
          attempts: null,
          note: null,
          callbackRequested: null,
          closedAt: null,
        },
      ],
      isLoading: false,
      error: null,
    }

    const html = renderPage()
    expect(html.match(/so-kpi-card--primary/g)).toHaveLength(6)
    expect(html.match(/so-kpi-card--secondary/g)).toHaveLength(4)
    expect(html).toContain('class="so-panel so-panel--alerts"')
    expect(html).toContain('class="so-alerts-scroll-shell"')
    expect(html).toContain('class="so-chip so-chip--inuse so-chip--grouped"')
  })
})

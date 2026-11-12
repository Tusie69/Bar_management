import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { FloorTableState, TableView, ZoneView } from "@/domain/models"
import { BAR_SEATS, FIXTURES, FLOOR_H, FLOOR_W, TABLES, ZONES } from "@/domain/venue-layout"
import { STATE_META } from "@/components/status-meta"
import { FloorCanvas } from "./floor-canvas"
import {
  calculateStatusCounts,
  computeZoneBounds,
  findGroupRepresentativeId,
  formatCellGuestName,
  formatGroupCode,
  groupCode,
  groupDisplayName,
  resolveCellCornerIcons,
  supportedFlags,
  tableCanActivate,
  GUEST_ICON_PRIORITY,
  fixturePathPoints,
} from "./floor-visual-rules"

const createTable = (
  id: number,
  x: number,
  y: number,
  w = 40,
  h = 30,
  zoneCode: "A" | "B" | "C" | "BAR" = "A",
  isSpare = false,
) =>
  ({
    id,
    version: 1,
    code: `T${id}`,
    displayName: `Bàn T${id}`,
    zoneId: 1,
    zoneCode,
    kind: "TABLE",
    capacity: 4,
    seqNo: null,
    isSpare,
    status: "ACTIVE",
    x,
    y,
    w,
    h,
    seating: "pairs-tb",
  }) as TableView

const realTables: TableView[] = [
  ...TABLES.map(
    (t, i) =>
      ({
        id: i + 1,
        version: 1,
        code: t.code,
        displayName: `Bàn ${t.code}`,
        zoneId: 1,
        zoneCode: t.zone,
        kind: "TABLE",
        capacity: t.capacity,
        seqNo: null,
        isSpare: t.isSpare,
        status: "ACTIVE",
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        seating: t.seating,
      }) as TableView,
  ),
  ...BAR_SEATS.map(
    (s, i) =>
      ({
        id: TABLES.length + i + 1,
        version: 1,
        code: `BAR${String(s.no).padStart(2, "0")}`,
        displayName: `Ghế ${s.no}`,
        zoneId: 2,
        zoneCode: "BAR",
        kind: "BAR_SEAT",
        capacity: 1,
        seqNo: s.no,
        isSpare: false,
        status: "ACTIVE",
        x: s.x,
        y: s.y,
        w: 21,
        h: 21,
        seating: "pairs-tb",
      }) as TableView,
  ),
]

const dummyZones: ZoneView[] = ZONES.map((z, i) => ({
  id: i + 1,
  version: 1,
  code: z.code,
  name: z.name,
  isBookable: true,
  isWaitingArea: false,
  displayOrder: i + 1,
}))

function renderCanvas(props: {
  tables: TableView[]
  mode: "live" | "availability"
  groups?: any[]
  selectedIds: number[]
  states?: Map<number, FloorTableState>
}) {
  return renderToString(
    createElement(FloorCanvas, {
      zones: dummyZones,
      now: new Date("2026-11-09T19:30:00Z"),
      onTableClick: () => {},
      ...props,
    }),
  )
}

describe("floor camera fit bounds (Item 2 & 8)", () => {
  const sampleTables: TableView[] = [
    createTable(1, 100, 200, 40, 30, "A"),
    createTable(2, 120, 260, 40, 30, "A"),
    createTable(3, 300, 400, 50, 40, "B"),
    createTable(4, 320, 450, 50, 40, "B"),
  ]

  it("calculates ALL bounds containing the floor frame, every fixture and the doors", () => {
    const allBounds = computeZoneBounds(realTables, "ALL", 0)
    expect(allBounds).not.toBeNull()

    // 1. Contains the floor frame rect (x:20, y:20, w:FLOOR_W-40, h:FLOOR_H-20)
    const frame = { x: 20, y: 20, w: FLOOR_W - 40, h: FLOOR_H - 20 }
    expect(allBounds!.x).toBeLessThanOrEqual(frame.x)
    expect(allBounds!.y).toBeLessThanOrEqual(frame.y)
    expect(allBounds!.x + allBounds!.w).toBeGreaterThanOrEqual(frame.x + frame.w)
    expect(allBounds!.y + allBounds!.h).toBeGreaterThanOrEqual(frame.y + frame.h)

    // 2. Contains every fixture, checked against its own path rather than
    //    numbers copied from one particular floor layout.
    for (const f of FIXTURES) {
      for (const [px, py] of fixturePathPoints(f.d)) {
        expect(allBounds!.x).toBeLessThanOrEqual(px)
        expect(allBounds!.x + allBounds!.w).toBeGreaterThanOrEqual(px)
        expect(allBounds!.y).toBeLessThanOrEqual(py)
        expect(allBounds!.y + allBounds!.h).toBeGreaterThanOrEqual(py)
      }
    }

    // 3. Contains all tables and seats
    for (const t of realTables) {
      const hw = (t.w || 22) / 2
      const hh = (t.h || 22) / 2
      expect(allBounds!.x).toBeLessThanOrEqual(t.x - hw)
      expect(allBounds!.x + allBounds!.w).toBeGreaterThanOrEqual(t.x + hw)
      expect(allBounds!.y).toBeLessThanOrEqual(t.y - hh)
      expect(allBounds!.y + allBounds!.h).toBeGreaterThanOrEqual(t.y + hh)
    }
  })

  it("ensures zone Bar bounds contains every bar seat", () => {
    const barBounds = computeZoneBounds(realTables, "BAR", 12)
    expect(barBounds).not.toBeNull()

    const barSeats = realTables.filter((t) => t.zoneCode === "BAR")
    expect(barSeats.length).toBe(21)
    for (const s of barSeats) {
      expect(barBounds!.x).toBeLessThanOrEqual(s.x - s.w / 2)
      expect(barBounds!.x + barBounds!.w).toBeGreaterThanOrEqual(s.x + s.w / 2)
      expect(barBounds!.y).toBeLessThanOrEqual(s.y - s.h / 2)
      expect(barBounds!.y + barBounds!.h).toBeGreaterThanOrEqual(s.y + s.h / 2)
    }
  })

  it("ensures transformed floor frame stays inside viewports at 360, 390, 768, and 1280 widths", () => {
    const allBounds = computeZoneBounds(realTables, "ALL", 0)!
    const frame = { x: 20, y: 20, w: FLOOR_W - 40, h: FLOOR_H - 20 }

    const viewports = [
      { w: 360, h: 800, isPhone: true },
      { w: 390, h: 844, isPhone: true },
      { w: 768, h: 1024, isPhone: false },
      { w: 1280, h: 800, isPhone: false },
    ]

    for (const vp of viewports) {
      let k: number
      let x: number
      let y: number

      if (vp.isPhone) {
        const padH = 8
        const scaleX = (vp.w - padH * 2) / allBounds.w
        const scaleY = (vp.h - 16) / allBounds.h
        const isWidthLimited = scaleX <= scaleY
        expect(isWidthLimited).toBe(true)

        k = scaleX
        x = padH - allBounds.x * k
        y = -allBounds.y * k
      } else {
        const pad = 18
        k = Math.min((vp.w - pad * 2) / allBounds.w, (vp.h - pad * 2) / allBounds.h)
        x = (vp.w - allBounds.w * k) / 2 - allBounds.x * k
        y = (vp.h - allBounds.h * k) / 2 - allBounds.y * k
      }

      // Check transformed frame edges on screen
      const frameLeft = x + frame.x * k
      const frameRight = x + (frame.x + frame.w) * k
      const frameTop = y + frame.y * k
      const frameBottom = y + (frame.y + frame.h) * k

      // Must stay strictly within viewport
      expect(frameLeft).toBeGreaterThanOrEqual(0)
      expect(frameRight).toBeLessThanOrEqual(vp.w)
      expect(frameTop).toBeGreaterThanOrEqual(0)
      expect(frameBottom).toBeLessThanOrEqual(vp.h)

      // On phones, horizontal padding is exactly 8px (P4: map enlarged)
      if (vp.isPhone) {
        expect(Math.round(frameLeft)).toBe(8)
        expect(Math.round(vp.w - frameRight)).toBe(8)
        // Top alignment on phones: frameTop is exactly 0
        expect(Math.round(frameTop)).toBe(0)
      }
    }
  })

  it("returns null for an empty zone to allow fallback handling", () => {
    const bounds = computeZoneBounds(sampleTables, "C", 24)
    expect(bounds).toBeNull()
  })

  it("returns full default floor bounds for ALL when table list is empty", () => {
    const bounds = computeZoneBounds([], "ALL", 0)
    expect(bounds).toEqual({
      x: 20,
      y: 20,
      w: FLOOR_W - 40,
      h: FLOOR_H - 20,
    })
  })
})

describe("merge-group G-code numbering (Item 6 & 8)", () => {
  it("formats numeric group symbols as G01, G02, etc.", () => {
    expect(groupCode(1)).toBe("G01")
    expect(groupCode(2)).toBe("G02")
    expect(groupCode(10)).toBe("G10")
    expect(groupCode(26)).toBe("G26")
  })

  it("returns null for non-positive or missing numbers", () => {
    expect(groupCode(0)).toBeNull()
    expect(groupCode(null)).toBeNull()
    expect(groupCode(undefined)).toBeNull()
    expect(groupCode(-5)).toBeNull()
  })

  it("converts legacy ◆A / ◆B or letter group references to G-code", () => {
    expect(formatGroupCode("◆A")).toBe("G01")
    expect(formatGroupCode("◆B")).toBe("G02")
    expect(formatGroupCode("◆Z")).toBe("G26")
    expect(formatGroupCode("A")).toBe("G01")
    expect(formatGroupCode("B")).toBe("G02")
    expect(formatGroupCode("G01")).toBe("G01")
    expect(formatGroupCode(1)).toBe("G01")
    expect(formatGroupCode(null)).toBeNull()
  })
})

describe("guest-type icon priority (Item 5)", () => {
  it("defines full approved priority order: ⭐ VIP > 📌 Chỉ định > 🎂 Sinh nhật > 🔥 Khách quen > 🆕 Khách mới", () => {
    expect(GUEST_ICON_PRIORITY).toEqual(["VIP", "DESIGNATED", "BIRTHDAY", "RETURNING", "NEW"])
  })

})

describe("StatusLegend counts and deduplication (Item 8)", () => {
  it("counts a merged group once per status", () => {
    const tables: TableView[] = [
      createTable(6, 100, 100, 34, 30, "B"),
      createTable(8, 140, 100, 34, 30, "B"),
      createTable(7, 100, 140, 34, 30, "B"),
    ]

    const states = new Map<number, FloorTableState>([
      [
        6,
        {
          tableId: 6,
          state: "seated",
          staleFromPreviousDay: false,
          claim: {
            kind: "visit",
            visitId: 10,
            reservationId: null,
            waitlistEntryId: null,
            holdId: null,
            displayName: "Anh Luân",
            phoneLast3: "123",
            partySize: 7,
            startsAt: new Date(),
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: [6, 8],
            groupId: 101,
            symbolNo: 1,
            groupDisplayCode: "G01",
            warning: null,
            minutesLate: 0,
            sourceCode: null,
            note: null,
            version: 1,
          },
        },
      ],
      [
        8,
        {
          tableId: 8,
          state: "seated",
          staleFromPreviousDay: false,
          claim: {
            kind: "visit",
            visitId: 10,
            reservationId: null,
            waitlistEntryId: null,
            holdId: null,
            displayName: "Anh Luân",
            phoneLast3: "123",
            partySize: 7,
            startsAt: new Date(),
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: [6, 8],
            groupId: 101,
            symbolNo: 1,
            groupDisplayCode: "G01",
            warning: null,
            minutesLate: 0,
            sourceCode: null,
            note: null,
            version: 1,
          },
        },
      ],
      [
        7,
        {
          tableId: 7,
          state: "free",
          staleFromPreviousDay: false,
          claim: null,
        },
      ],
    ])

    const counts = calculateStatusCounts(tables, states)
    // B6 and B8 belong to the same group 101 in 'seated' status -> counts.seated should be 1, NOT 2!
    expect(counts.seated).toBe(1)
    expect(counts.free).toBe(1)
  })

  it("the three states (late, late_confirmed, noshow) give the same label and color", () => {
    // Label, short label, and color tokens must be identical
    expect(STATE_META.late.label).toBe("Tới muộn")
    expect(STATE_META.late_confirmed.label).toBe("Tới muộn")
    expect(STATE_META.noshow.label).toBe("Tới muộn")

    expect(STATE_META.late.short).toBe("Tới muộn")
    expect(STATE_META.late_confirmed.short).toBe("Tới muộn")
    expect(STATE_META.noshow.short).toBe("Tới muộn")

    expect(STATE_META.late.color).toBe("var(--st-noshow)")
    expect(STATE_META.late_confirmed.color).toBe("var(--st-noshow)")
    expect(STATE_META.noshow.color).toBe("var(--st-noshow)")

    expect(STATE_META.late.ink).toBe("var(--st-noshow-ink)")
    expect(STATE_META.late_confirmed.ink).toBe("var(--st-noshow-ink)")
    expect(STATE_META.noshow.ink).toBe("var(--st-noshow-ink)")

    expect(STATE_META.late.tint).toBe("var(--st-noshow-tint)")
    expect(STATE_META.late_confirmed.tint).toBe("var(--st-noshow-tint)")
    expect(STATE_META.noshow.tint).toBe("var(--st-noshow-tint)")

    // hold_overdue (Quá hạn) is a different business state and keeps its own label
    expect(STATE_META.hold_overdue.label).toBe("Quá hạn giữ, chờ xử lý")
    expect(STATE_META.hold_overdue.short).toBe("Quá hạn")
  })

  it("maps late, late_confirmed, and noshow into the combined Tới muộn (noshow) chip", () => {
    const tables: TableView[] = [
      createTable(1, 100, 100, 40, 30, "A"),
      createTable(2, 100, 150, 40, 30, "A"),
      createTable(3, 100, 200, 40, 30, "A"),
    ]

    const states = new Map<number, FloorTableState>([
      [
        1,
        {
          tableId: 1,
          state: "late",
          staleFromPreviousDay: false,
          claim: {
            kind: "reservation",
            visitId: null,
            reservationId: 1,
            waitlistEntryId: null,
            holdId: null,
            displayName: "Khách 1",
            phoneLast3: "456",
            partySize: 2,
            startsAt: new Date(),
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: [1],
            groupId: null,
            symbolNo: null,
            warning: "late",
            minutesLate: 15,
            sourceCode: null,
            note: null,
            version: 1,
          },
        },
      ],
      [
        2,
        {
          tableId: 2,
          state: "late_confirmed",
          staleFromPreviousDay: false,
          claim: {
            kind: "reservation",
            visitId: null,
            reservationId: 2,
            waitlistEntryId: null,
            holdId: null,
            displayName: "Khách 2",
            phoneLast3: "789",
            partySize: 4,
            startsAt: new Date(),
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: [2],
            groupId: null,
            symbolNo: null,
            warning: "late",
            minutesLate: 20,
            sourceCode: null,
            note: null,
            version: 1,
            lateConfirmedAt: new Date(),
          },
        },
      ],
      [
        3,
        {
          tableId: 3,
          state: "noshow",
          staleFromPreviousDay: false,
          claim: {
            kind: "reservation",
            visitId: null,
            reservationId: 3,
            waitlistEntryId: null,
            holdId: null,
            displayName: "Khách 3",
            phoneLast3: "111",
            partySize: 2,
            startsAt: new Date(),
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: [3],
            groupId: null,
            symbolNo: null,
            warning: "noshow",
            minutesLate: 35,
            sourceCode: null,
            note: null,
            version: 1,
          },
        },
      ],
    ])

    const counts = calculateStatusCounts(tables, states)
    // All three states (late, late_confirmed, noshow) sum into the combined noshow chip
    expect(counts.noshow).toBe(3)
  })

  it("legend count equals their sum with a group counted once", () => {
    const tables: TableView[] = [
      createTable(1, 100, 100, 40, 30, "A"),
      createTable(2, 100, 150, 40, 30, "A"),
      createTable(3, 100, 200, 40, 30, "A"),
    ]

    const states = new Map<number, FloorTableState>([
      [
        1,
        {
          tableId: 1,
          state: "late",
          staleFromPreviousDay: false,
          claim: {
            kind: "reservation",
            visitId: null,
            reservationId: 1,
            waitlistEntryId: null,
            holdId: null,
            displayName: "Nhóm VIP",
            phoneLast3: "456",
            partySize: 6,
            startsAt: new Date(),
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: [1, 2],
            groupId: 99,
            symbolNo: 99,
            warning: "late",
            minutesLate: 15,
            sourceCode: null,
            note: null,
            version: 1,
          },
        },
      ],
      [
        2,
        {
          tableId: 2,
          state: "late_confirmed",
          staleFromPreviousDay: false,
          claim: {
            kind: "reservation",
            visitId: null,
            reservationId: 1,
            waitlistEntryId: null,
            holdId: null,
            displayName: "Nhóm VIP",
            phoneLast3: "456",
            partySize: 6,
            startsAt: new Date(),
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: [1, 2],
            groupId: 99,
            symbolNo: 99,
            warning: "late",
            minutesLate: 15,
            sourceCode: null,
            note: null,
            version: 1,
            lateConfirmedAt: new Date(),
          },
        },
      ],
      [
        3,
        {
          tableId: 3,
          state: "noshow",
          staleFromPreviousDay: false,
          claim: {
            kind: "reservation",
            visitId: null,
            reservationId: 3,
            waitlistEntryId: null,
            holdId: null,
            displayName: "Khách lẻ",
            phoneLast3: "789",
            partySize: 2,
            startsAt: new Date(),
            deadlineAt: null,
            paid: false,
            origin: null,
            tableIds: [3],
            groupId: null,
            symbolNo: null,
            warning: "noshow",
            minutesLate: 35,
            sourceCode: null,
            note: null,
            version: 1,
          },
        },
      ],
    ])

    const counts = calculateStatusCounts(tables, states)
    // Tables 1 & 2 share group grp-99 -> counts as 1. Table 3 is standalone -> counts as 1.
    // Total noshow count = 2 (sum with group dedup applied)
    expect(counts.noshow).toBe(2)
  })

  it("counts hold_overdue under the combined Không tới (noshow) chip while preserving its business state", () => {
    const tables: TableView[] = [createTable(1, 100, 100, 40, 30, "A")]
    const states = new Map<number, FloorTableState>([
      [
        1,
        {
          tableId: 1,
          state: "hold_overdue",
          staleFromPreviousDay: false,
          claim: {
            kind: "waitlist_hold",
            visitId: null,
            reservationId: null,
            waitlistEntryId: 10,
            holdId: 1,
            displayName: "Khách chờ",
            phoneLast3: "333",
            partySize: 2,
            startsAt: new Date(),
            deadlineAt: new Date(Date.now() - 300_000),
            paid: false,
            origin: null,
            tableIds: [1],
            groupId: null,
            symbolNo: null,
            warning: null,
            minutesLate: 5,
            sourceCode: null,
            note: null,
            version: 1,
          },
        },
      ],
    ])

    const counts = calculateStatusCounts(tables, states)
    expect(counts.noshow).toBe(1)
  })

  it("counts spare tables as Sơ cua", () => {
    const tables: TableView[] = [
      createTable(10, 231, 685, 38, 38, "A", true), // A10 spare
      createTable(11, 284, 80, 34, 34, "C", true), // C4 spare
    ]

    const states = new Map<number, FloorTableState>([
      [10, { tableId: 10, state: "free", staleFromPreviousDay: false, claim: null }],
      [11, { tableId: 11, state: "spare", staleFromPreviousDay: false, claim: null }],
    ])

    const counts = calculateStatusCounts(tables, states)
    expect(counts.spare).toBe(2)
  })
})

describe("adaptive floor visual rules legacy compatibility", () => {
  it("renders only verified, supported customer flags", () => {
    expect(supportedFlags(["RETURNING", "NEW", "RETURNING"])).toEqual(["RETURNING", "NEW"])
  })

  it("resolves representative anchor table for mixed and Bar groups (K1 Section 7)", () => {
    const a = createTable(1, 0, 0)
    const b = createTable(2, 100, 0)
    expect(findGroupRepresentativeId([a, b])).toBe(1)
  })

  it("allows a remotely unavailable selected table to be activated for deselection", () => {
    const pickable = new Set([8])
    expect(tableCanActivate(7, pickable, new Set([7]))).toBe(true)
    expect(tableCanActivate(9, pickable, new Set([7]))).toBe(false)
  })
})

describe("waitlist marker display per zone mode (Section MARKER)", () => {
  const sampleTables: TableView[] = [
    createTable(1, 100, 200, 40, 30, "A"),
    createTable(2, 120, 260, 40, 30, "A"),
    createTable(3, 300, 400, 50, 40, "B"),
    createTable(4, 320, 450, 50, 40, "B"),
  ]

  const countMarkers = (html: string) => (html.match(/aria-label="Bàn chờ/g) || []).length

  it("renders SVG camera marker when zoneFocus is ALL, and no HTML overlay", () => {
    const html = renderToString(
      createElement(FloorCanvas, {
        tables: sampleTables,
        zones: dummyZones,
        mode: "live",
        selectedIds: [],
        zoneFocus: "ALL",
        now: new Date("2026-11-04T14:30:00Z"),
        onTableClick: () => {},
        waitingCount: 5,
        onOpenWaitlist: () => {},
      }),
    )

    // Exactly one marker in output
    expect(countMarkers(html)).toBe(1)
    // Rendered inside SVG foreignObject camera group
    expect(html).toContain("<foreignObject")
    expect(html).toContain("Bàn chờ +5")
    expect(html).toContain('aria-label="Bàn chờ, 5 khách đang chờ"')
    // No floating HTML overlay
    expect(html).not.toContain("pointer-events-auto absolute bottom-3 right-3 z-10")
  })

  it("renders floating HTML overlay when zoneFocus is a specific zone, and no SVG foreignObject", () => {
    const zonesToTest = ["A", "B", "C", "BAR"] as const
    for (const zone of zonesToTest) {
      const html = renderToString(
        createElement(FloorCanvas, {
          tables: sampleTables,
          zones: dummyZones,
          mode: "live",
          selectedIds: [],
          zoneFocus: zone,
          now: new Date("2026-11-04T14:30:00Z"),
          onTableClick: () => {},
          waitingCount: 3,
          onOpenWaitlist: () => {},
        }),
      )

      // Exactly one marker rendered at any moment (never both)
      expect(countMarkers(html)).toBe(1)
      // Floating HTML overlay used outside camera transform
      expect(html).toContain("pointer-events-auto absolute bottom-3 right-3 z-10")
      expect(html).toContain("Bàn chờ +3")
      expect(html).toContain('aria-label="Bàn chờ, 3 khách đang chờ"')
      // No SVG foreignObject waitlist marker
      expect(html).not.toMatch(/<foreignObject[^>]*>\s*<button[^>]*aria-label="Bàn chờ/)
    }
  })

  it("renders no marker if onOpenWaitlist is not provided", () => {
    const htmlAll = renderToString(
      createElement(FloorCanvas, {
        tables: sampleTables,
        zones: dummyZones,
        mode: "live",
        selectedIds: [],
        zoneFocus: "ALL",
        now: new Date("2026-11-04T14:30:00Z"),
        onTableClick: () => {},
        waitingCount: 5,
      }),
    )
    expect(countMarkers(htmlAll)).toBe(0)

    const htmlZone = renderToString(
      createElement(FloorCanvas, {
        tables: sampleTables,
        zones: dummyZones,
        mode: "live",
        selectedIds: [],
        zoneFocus: "A",
        now: new Date("2026-11-04T14:30:00Z"),
        onTableClick: () => {},
        waitingCount: 5,
      }),
    )
    expect(countMarkers(htmlZone)).toBe(0)
  })

  it("preserves accessible name and count when waitingCount is 0 or undefined", () => {
    const htmlZero = renderToString(
      createElement(FloorCanvas, {
        tables: sampleTables,
        zones: dummyZones,
        mode: "live",
        selectedIds: [],
        zoneFocus: "B",
        now: new Date("2026-11-04T14:30:00Z"),
        onTableClick: () => {},
        waitingCount: 0,
        onOpenWaitlist: () => {},
      }),
    )
    expect(htmlZero).toContain('aria-label="Bàn chờ, 0 khách đang chờ"')
    expect(htmlZero).toContain("Bàn chờ</span>")

    const htmlUndefined = renderToString(
      createElement(FloorCanvas, {
        tables: sampleTables,
        zones: dummyZones,
        mode: "live",
        selectedIds: [],
        zoneFocus: "BAR",
        now: new Date("2026-11-04T14:30:00Z"),
        onTableClick: () => {},
        onOpenWaitlist: () => {},
      }),
    )
    expect(htmlUndefined).toContain('aria-label="Bàn chờ"')
    expect(htmlUndefined).toContain("Bàn chờ</span>")
  })
})

const table = (id: number, x: number, y: number, w = 40, h = 30) => ({ id, x, y, w, h, kind: "TABLE" }) as TableView

describe("adaptive floor visual rules", () => {
  it("keeps group display codes deterministic beyond Z", () => {
    expect(groupCode(1)).toBe("G01")
    expect(groupCode(26)).toBe("G26")
    expect(groupCode(27)).toBe("G27")
    expect(groupCode(null)).toBeNull()
  })

  it("renders only verified, supported customer flags", () => {
    expect(supportedFlags(["RETURNING", "NEW", "RETURNING"])).toEqual(["RETURNING", "NEW"])
  })

  it("resolves representative anchor table for mixed and Bar groups (K1 Section 7)", () => {
    const a = table(1, 0, 0)
    const b = table(2, 100, 0)
    expect(findGroupRepresentativeId([a, b])).toBe(1)
  })

  it("allows a remotely unavailable selected table to be activated for deselection", () => {
    const pickable = new Set([8])
    expect(tableCanActivate(7, pickable, new Set([7]))).toBe(true)
    expect(tableCanActivate(9, pickable, new Set([7]))).toBe(false)
  })
})
describe("Group border redesign - status-colored thick borders and neutral selection ring", () => {
  it("keeps adjacent tables in one booking as separate cells with 3px status border and no data-group-color", () => {
    const tB5 = realTables.find((t) => t.code === "B5")!
    const tB6 = realTables.find((t) => t.code === "B6")!
    const group = { id: 101, symbolNo: 1, tableIds: [tB5.id, tB6.id] }

    const states = new Map<number, FloorTableState>([
      [tB5.id, { state: "reserved", tableId: tB5.id, claim: { reservationId: 1, tableIds: [tB5.id, tB6.id], displayName: "Nam", partySize: 4, startsAt: new Date() } } as any],
      [tB6.id, { state: "reserved", tableId: tB6.id, claim: { reservationId: 1, tableIds: [tB5.id, tB6.id], displayName: "Nam", partySize: 4, startsAt: new Date() } } as any],
    ])

    const html = renderCanvas({
      tables: realTables,
      mode: "live",
      groups: [group],
      states,
      selectedIds: [],
    })

    // Both tables render their own individual cells
    expect(html).toContain(">B5<")
    expect(html).toContain(">B6<")
    // Border uses business status color, not group palette
    expect(html).not.toContain("data-group-color")
    expect(html).toContain(`stroke="${STATE_META.reserved.color}"`)
    // Group members have thick 3px border
    expect(html).toContain('stroke-width="3"')
  })

  it("keeps tables far apart in one booking with 3px status border and no connector", () => {
    const tA0 = realTables.find((t) => t.code === "A0")!
    const tC1 = realTables.find((t) => t.code === "C1")!
    const group = { id: 102, symbolNo: 1, tableIds: [tA0.id, tC1.id] }

    const states = new Map<number, FloorTableState>([
      [tA0.id, { state: "seated", tableId: tA0.id, claim: { visitId: 10, tableIds: [tA0.id, tC1.id], displayName: "Party", partySize: 6, startsAt: new Date() } } as any],
      [tC1.id, { state: "seated", tableId: tC1.id, claim: { visitId: 10, tableIds: [tA0.id, tC1.id], displayName: "Party", partySize: 6, startsAt: new Date() } } as any],
    ])

    const html = renderCanvas({
      tables: realTables,
      mode: "live",
      groups: [group],
      states,
      selectedIds: [],
    })

    expect(html).toContain(">A0<")
    expect(html).toContain(">C1<")
    expect(html).not.toContain("data-group-color")
    expect(html).toContain(`stroke="${STATE_META.seated.color}"`)
    expect(html).toContain('stroke-width="3"')
  })

  it("keeps Bar seats in one booking as separate circles with 3px status border", () => {
    const bar = realTables.filter((t) => t.kind === "BAR_SEAT")
    const pair = bar.slice(0, 2) // Bar 1, Bar 2
    const group = { id: 103, symbolNo: 1, tableIds: pair.map((t) => t.id) }

    const html = renderCanvas({
      tables: realTables,
      mode: "live",
      groups: [group],
      selectedIds: [],
    })

    expect(html).toContain(">1<")
    expect(html).toContain(">2<")
    expect(html).not.toContain("data-group-color")
    expect(html).toContain('stroke-width="3"')
  })

  it("renders normal 2px border for single tables versus 3px for grouped tables", () => {
    const single = realTables.find((t) => t.code === "C4")!
    const pair = [realTables.find((t) => t.code === "B3")!, realTables.find((t) => t.code === "B4")!]
    const group = { id: 104, symbolNo: 1, tableIds: pair.map((t) => t.id) }

    const html = renderCanvas({
      tables: [single, ...pair],
      mode: "live",
      groups: [group],
      selectedIds: [],
    })

    expect(html).toContain('stroke-width="2"')
    expect(html).toContain('stroke-width="3"')
  })

  it("shows neutral #64748B selection ring on all members when selected, and removes it on deselect", () => {
    const bar = realTables.filter((t) => t.kind === "BAR_SEAT")
    const pair = bar.slice(0, 2) // Bar 1, Bar 2
    const group = { id: 105, symbolNo: 1, tableIds: pair.map((t) => t.id) }

    // When selecting Bar 1:
    const htmlSelected = renderCanvas({
      tables: realTables,
      mode: "live",
      groups: [group],
      selectedIds: [pair[0].id],
    })

    // Both seats get the dashed ring in neutral #64748B
    const ringMatches = (htmlSelected.match(/data-selection-ring="1"/g) || []).length
    expect(ringMatches).toBeGreaterThanOrEqual(2)
    expect(htmlSelected).toContain('stroke="#64748B"')
    expect(htmlSelected).toContain('stroke-dasharray="5 3"')

    // When deselected:
    const htmlDeselected = renderCanvas({
      tables: realTables,
      mode: "live",
      groups: [group],
      selectedIds: [],
    })

    expect(htmlDeselected).not.toContain('data-selection-ring="1"')
    expect(htmlDeselected).not.toContain('stroke="#64748B"')
  })

  it("does not duplicate guest count badge across tables in a multi-table booking", () => {
    const tB5 = realTables.find((t) => t.code === "B5")!
    const tB6 = realTables.find((t) => t.code === "B6")!
    const group = { id: 106, symbolNo: 1, tableIds: [tB5.id, tB6.id] }

    const states = new Map<number, FloorTableState>([
      [tB5.id, { state: "seated", tableId: tB5.id, claim: { visitId: 11, tableIds: [tB5.id, tB6.id], displayName: "Anh Nam", partySize: 5, startsAt: new Date() } } as any],
      [tB6.id, { state: "seated", tableId: tB6.id, claim: { visitId: 11, tableIds: [tB5.id, tB6.id], displayName: "Anh Nam", partySize: 5, startsAt: new Date() } } as any],
    ])

    const html = renderCanvas({
      tables: [tB5, tB6],
      mode: "live",
      groups: [group],
      states,
      selectedIds: [],
    })

    // Guest count badge is shown only once on the first member, never repeated on each table, and never as "5 khách" cell text
    const badgeMatches = (html.match(/data-testid="guest-count-badge"/g) || []).length
    expect(badgeMatches).toBe(1)
    expect(html).toContain(">5<")
    expect(html).not.toContain(">5 khách<")
  })

  it("formats Bar seat groups and table groups correctly", () => {
    const bar = realTables.filter((t) => t.kind === "BAR_SEAT")
    const pair = bar.slice(4, 6) // Bar 5, 6
    expect(groupDisplayName(pair)).toBe("Bar5-6")

    const triple = bar.slice(9, 12) // Bar 10, 11, 12
    expect(groupDisplayName(triple)).toBe("Bar10-12")

    const bTables = realTables.filter((t) => ["B5", "B6", "B7"].includes(t.code))
    expect(groupDisplayName(bTables)).toBe("B5-B6-B7")
  })

  describe("J1 - Redesigned table cells, corner badges, TurnBadge on right edge, and group brackets/arcs", () => {
    it("removes outside TableInfoCard and Khách quầy bar block completely", () => {
      const tA2 = realTables.find((t) => t.code === "A2")!
      const barSeat = realTables.find((t) => t.kind === "BAR_SEAT")!
      const states = new Map<number, FloorTableState>([
        [
          tA2.id,
          {
            tableId: tA2.id,
            state: "reserved",
            claim: {
              reservationId: 101,
              displayName: "Anh Hưng",
              partySize: 4,
              startsAt: new Date("2026-11-09T15:30:00Z"),
              tableIds: [tA2.id],
            },
          } as any,
        ],
        [
          barSeat.id,
          {
            tableId: barSeat.id,
            state: "seated",
            claim: {
              visitId: 103,
              displayName: "Khách Bar",
              partySize: 1,
              startsAt: new Date("2026-11-09T14:00:00Z"),
              tableIds: [barSeat.id],
            },
          } as any,
        ],
      ])

      const html = renderCanvas({
        tables: [tA2, barSeat],
        mode: "live",
        states,
        selectedIds: [],
      })

      expect(html).not.toContain('data-testid="table-info-card"')
      expect(html).not.toContain('data-testid="bar-khu-c-block"')
      expect(html).not.toContain("Khách quầy bar:")
    })

    it("shows code + booked time for booked tables and code + truncated guest name for checked-in tables", () => {
      const tB21 = realTables.find((t) => t.code === "B21")!
      const tB3 = realTables.find((t) => t.code === "B3")!
      const tA3 = realTables.find((t) => t.code === "A3")!
      const states = new Map<number, FloorTableState>([
        [
          tB21.id,
          {
            tableId: tB21.id,
            state: "reserved",
            claim: {
              reservationId: 201,
              displayName: "Chị Lan",
              partySize: 4,
              startsAt: new Date("2026-11-09T15:30:00Z"), // 22:30 ICT
              tableIds: [tB21.id],
            },
          } as any,
        ],
        [
          tB3.id,
          {
            tableId: tB3.id,
            state: "seated",
            claim: {
              visitId: 202,
              displayName: "Anh Nam",
              partySize: 4,
              startsAt: new Date("2026-11-09T13:30:00Z"),
              tableIds: [tB3.id],
            },
          } as any,
        ],
        [
          tA3.id,
          {
            tableId: tA3.id,
            state: "seated",
            claim: {
              visitId: 203,
              displayName: "Khách Walk-in",
              partySize: 2,
              startsAt: new Date("2026-11-09T13:45:00Z"),
              tableIds: [tA3.id],
            },
          } as any,
        ],
      ])

      const html = renderCanvas({
        tables: [tB21, tB3, tA3],
        mode: "live",
        states,
        selectedIds: [],
      })

      expect(html).toContain(">B21<")
      expect(html).toContain(">22:30<")
      expect(html).toContain(">B3<")
      expect(html).toContain(">Anh Nam<")
      // Walk-in without a real name shows "Khách lẻ", never fake name or "N khách"
      expect(html).toContain(">Khách lẻ<")
      expect(html).not.toContain("4 khách<")
      expect(html).not.toContain("2 khách<")

      // Long name truncation helper check
      expect(formatCellGuestName("Nguyễn Hoàng Bảo Trâm", 10)).toBe("Nguyễn Ho…")
    })

    it("BR-03: shows seat number plus booked time in cell for booked Bar seat (e.g. Bar16 at 22:15)", () => {
      const bar16 = realTables.find((t) => t.kind === "BAR_SEAT" && t.seqNo === 16)!
      const states = new Map<number, FloorTableState>([
        [
          bar16.id,
          {
            tableId: bar16.id,
            state: "reserved",
            claim: {
              reservationId: 401,
              displayName: "Anh Tuấn",
              partySize: 2,
              startsAt: new Date("2026-11-09T15:15:00Z"), // 22:15 ICT
              tableIds: [bar16.id],
            },
          } as any,
        ],
      ])

      const html = renderCanvas({
        tables: [bar16],
        mode: "live",
        states,
        selectedIds: [],
      })

      expect(html).toContain(">16<")
      expect(html).toContain(">22:15<")
    })

    it("BR-04: empty table (e.g. B5, C1) shows its code only and no capacity text in cell", () => {
      const tB5 = realTables.find((t) => t.code === "B5")!
      const tC1 = realTables.find((t) => t.code === "C1")!
      const states = new Map<number, FloorTableState>([
        [tB5.id, { tableId: tB5.id, state: "free", claim: null } as any],
        [tC1.id, { tableId: tC1.id, state: "free", claim: null } as any],
      ])

      const html = renderCanvas({
        tables: [tB5, tC1],
        mode: "live",
        states,
        selectedIds: [],
      })

      expect(html).toContain(">B5<")
      expect(html).toContain(">C1<")
      expect(html).not.toContain("4 chỗ")
      expect(html).not.toContain("chỗ")
    })

    it("places cake at top-right, regular/new at bottom-left (never both), VIP/pin at bottom-right, and TurnBadge at middle of right edge", () => {
      const tA3 = realTables.find((t) => t.code === "A3")!
      const hw = tA3.w / 2
      const hh = tA3.h / 2
      const states = new Map<number, FloorTableState>([
        [
          tA3.id,
          {
            tableId: tA3.id,
            state: "seated",
            seatedTurnCount: 2,
            claim: {
              visitId: 105,
              displayName: "Sếp Tuấn",
              partySize: 4,
              flags: ["BIRTHDAY", "RETURNING", "NEW"],
              iconKeys: ["star", "pin"],
              tableIds: [tA3.id],
            },
          } as any,
        ],
      ])

      const resolved = resolveCellCornerIcons(states.get(tA3.id)!.claim)
      expect(resolved.topRight).toEqual(["cake"])
      expect(resolved.bottomLeft).toEqual(["fire"]) // RETURNING wins over NEW, never both
      expect(resolved.bottomRight).toEqual(["star", "pin"])

      const html = renderCanvas({
        tables: [tA3],
        mode: "live",
        states,
        selectedIds: [],
      })

      // Top-left count badge: number only (4)
      expect(html).toContain('data-testid="guest-count-badge"')
      expect(html).toContain(">4<")

      // Top-right cake icon
      expect(html).toContain("🎂")
      // Bottom-left fire icon (and not 🆕)
      expect(html).toContain("🔥")
      expect(html).not.toContain("🆕")
      // Bottom-right star and pin icons
      expect(html).toContain("⭐")
      expect(html).toContain("📌")

      // TurnBadge at middle of right edge (x = hw, y = 0)
      expect(html).toContain('data-testid="turn-badge"')
      expect(html).toContain(`transform="translate(${hw} 0)"`)
      expect(html).not.toContain(`transform="translate(${-hw} ${hh})"`)
      expect(html).toContain(">2<")
    })

    it("removes all connectors, brackets, arcs, and link icons (K1 Section 2), showing relation via 3px border, single guest count badge and dashed rings", () => {
      const tB21 = realTables.find((t) => t.code === "B21")!
      const tB22 = realTables.find((t) => t.code === "B22")!
      const bar7 = realTables.find((t) => t.code === "BAR07")!
      const bar8 = realTables.find((t) => t.code === "BAR08")!
      const tA0 = realTables.find((t) => t.code === "A0")!
      const tC1 = realTables.find((t) => t.code === "C1")!

      expect(findGroupRepresentativeId([tB21, tB22])).toBe(tB21.id)
      expect(findGroupRepresentativeId([bar7, bar8])).toBe(bar7.id)
      expect(findGroupRepresentativeId([tA0, tC1])).toBe(tA0.id)

      const states = new Map<number, FloorTableState>([
        [
          tA0.id,
          {
            tableId: tA0.id,
            state: "seated",
            claim: {
              visitId: 301,
              displayName: "Anh Khoa",
              partySize: 6,
              flags: ["NEW"],
              tableIds: [tA0.id, tC1.id],
              groupId: 3,
            },
          } as any,
        ],
        [
          tC1.id,
          {
            tableId: tC1.id,
            state: "seated",
            claim: {
              visitId: 301,
              displayName: "Anh Khoa",
              partySize: 6,
              flags: ["NEW"],
              tableIds: [tA0.id, tC1.id],
              groupId: 3,
            },
          } as any,
        ],
      ])

      const htmlFar = renderCanvas({
        tables: [tA0, tC1],
        mode: "live",
        groups: [{ id: 3, symbolNo: 1, tableIds: [tA0.id, tC1.id] }],
        states,
        selectedIds: [tA0.id],
      })

      // K1 Section 2: No connector, curve, SVG path, long bracket or standalone link icon
      expect(htmlFar).not.toContain("data-group-bracket")
      expect(htmlFar).not.toContain("data-group-arc")
      expect(htmlFar).not.toContain("data-testid=\"group-link-icon\"")
      expect(htmlFar).not.toContain("data-link-placement")

      // K1 Section 7: One guest count badge on the representative table, number only
      const badges = (htmlFar.match(/data-testid="guest-count-badge"/g) || []).length
      expect(badges).toBe(1)
      expect(htmlFar).toContain(">6<")

      // Both members get dashed selection ring when group member is tapped (K1 Section 4)
      const rings = (htmlFar.match(/data-selection-ring="1"/g) || []).length
      expect(rings).toBe(2)
      expect(htmlFar).toContain('stroke="#64748B"')

      // Corner flags still present
      expect(htmlFar).toContain("🆕")
    })
  })
})

import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { FloorTableState, TableView, ZoneView } from "@/domain/models"
import { BAR_SEATS, FIXTURES, FLOOR_H, FLOOR_W, TABLES, ZONES } from "@/domain/venue-layout"
import { STATE_META } from "@/components/status-meta"
import { FloorCanvas } from "./floor-canvas"
import {
  activeGroupForSelection,
  calculateStatusCounts,
  computeZoneBounds,
  connectorIsSafe,
  formatGroupCode,
  formatOccupiedLabel,
  glyphLevel,
  groupCode,
  pickPrimaryGuestFlag,
  supportedFlags,
  tableCanActivate,
  GUEST_ICON_PRIORITY,
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

describe("floor camera fit bounds (Item 2 & 8)", () => {
  const sampleTables: TableView[] = [
    createTable(1, 100, 200, 40, 30, "A"),
    createTable(2, 120, 260, 40, 30, "A"),
    createTable(3, 300, 400, 50, 40, "B"),
    createTable(4, 320, 450, 50, 40, "B"),
  ]

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

  it("calculates ALL bounds containing the floor frame, every fixture and the doors", () => {
    const allBounds = computeZoneBounds(realTables, "ALL", 0)
    expect(allBounds).not.toBeNull()

    // 1. Contains the floor frame rect (x:20, y:20, w:FLOOR_W-40, h:FLOOR_H-20)
    const frame = { x: 20, y: 20, w: FLOOR_W - 40, h: FLOOR_H - 20 }
    expect(allBounds!.x).toBeLessThanOrEqual(frame.x)
    expect(allBounds!.y).toBeLessThanOrEqual(frame.y)
    expect(allBounds!.x + allBounds!.w).toBeGreaterThanOrEqual(frame.x + frame.w)
    expect(allBounds!.y + allBounds!.h).toBeGreaterThanOrEqual(frame.y + frame.h)

    // 2. Contains every fixture (including wall stroke and entrance)
    for (const f of FIXTURES) {
      if (f.kind === "wall") {
        expect(allBounds!.x).toBeLessThanOrEqual(32 - 1.2)
        expect(allBounds!.x + allBounds!.w).toBeGreaterThanOrEqual(560 + 1.2)
        expect(allBounds!.y).toBeLessThanOrEqual(32 - 1.2)
        expect(allBounds!.y + allBounds!.h).toBeGreaterThanOrEqual(738 + 1.2)
      } else if (f.kind === "entrance") {
        expect(allBounds!.x).toBeLessThanOrEqual(268)
        expect(allBounds!.x + allBounds!.w).toBeGreaterThanOrEqual(328)
        expect(allBounds!.y + allBounds!.h).toBeGreaterThanOrEqual(751)
      } else if (f.kind === "bar-counter") {
        expect(allBounds!.x).toBeLessThanOrEqual(396)
        expect(allBounds!.x + allBounds!.w).toBeGreaterThanOrEqual(552)
      } else if (f.kind === "back-bar") {
        expect(allBounds!.x).toBeLessThanOrEqual(488)
        expect(allBounds!.x + allBounds!.w).toBeGreaterThanOrEqual(552)
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

  it("ensures zone Bar bounds contains bar counter and back-bar fixtures", () => {
    const barBounds = computeZoneBounds(realTables, "BAR", 12)
    expect(barBounds).not.toBeNull()

    // Must contain QUẬY BAR (396..552, 404..722)
    expect(barBounds!.x).toBeLessThanOrEqual(396 - 0.6)
    expect(barBounds!.x + barBounds!.w).toBeGreaterThanOrEqual(552 + 0.6)
    expect(barBounds!.y).toBeLessThanOrEqual(404 - 0.6)
    expect(barBounds!.y + barBounds!.h).toBeGreaterThanOrEqual(722 + 0.6)

    // Must contain KHU PHA CHẾ (back bar)
    expect(barBounds!.x + barBounds!.w).toBeGreaterThanOrEqual(552)
    expect(barBounds!.y).toBeLessThanOrEqual(444)
    expect(barBounds!.y + barBounds!.h).toBeGreaterThanOrEqual(716)

    // Must contain all 21 bar seats
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
        const padH = 16
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

      // On phones, horizontal padding is exactly 16px
      if (vp.isPhone) {
        expect(Math.round(frameLeft)).toBe(16)
        expect(Math.round(vp.w - frameRight)).toBe(16)
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
      w: 549,
      h: 734,
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

describe("occupied table label format (Item 4 & 8)", () => {
  it("formats occupied guest count as '{n} khách' and never elapsed time", () => {
    expect(formatOccupiedLabel(7)).toBe("7 khách")
    expect(formatOccupiedLabel(2)).toBe("2 khách")
    expect(formatOccupiedLabel(10)).toBe("10 khách")
    expect(formatOccupiedLabel(7)).not.toMatch(/:|'/)
  })
})

describe("guest-type icon priority (Item 5)", () => {
  it("defines full approved priority order: ⭐ VIP > 📌 Chỉ định > 🎂 Sinh nhật > 🔥 Khách quen > 🆕 Khách mới", () => {
    expect(GUEST_ICON_PRIORITY).toEqual(["VIP", "DESIGNATED", "BIRTHDAY", "RETURNING", "NEW"])
  })

  it("picks the single highest priority flag according to approved order", () => {
    // 🎂 > 🔥
    expect(pickPrimaryGuestFlag(["RETURNING", "BIRTHDAY"])).toBe("BIRTHDAY")
    // ⭐ > 🎂
    expect(pickPrimaryGuestFlag(["VIP", "BIRTHDAY"])).toBe("VIP")
    // 📌 > 🎂
    expect(pickPrimaryGuestFlag(["DESIGNATED", "BIRTHDAY"])).toBe("DESIGNATED")
    // 🔥 > 🆕
    expect(pickPrimaryGuestFlag(["NEW", "RETURNING"])).toBe("RETURNING")
    // None
    expect(pickPrimaryGuestFlag([])).toBeNull()
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
    expect(STATE_META.late.label).toBe("Không đến")
    expect(STATE_META.late_confirmed.label).toBe("Không đến")
    expect(STATE_META.noshow.label).toBe("Không đến")

    expect(STATE_META.late.short).toBe("Không đến")
    expect(STATE_META.late_confirmed.short).toBe("Không đến")
    expect(STATE_META.noshow.short).toBe("Không đến")

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

  it("maps late, late_confirmed, and noshow into the combined Không đến (noshow) chip", () => {
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

  it("counts hold_overdue under the combined Không đến (noshow) chip while preserving its business state", () => {
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
      createTable(11, 284, 80, 34, 34, "C", true),  // C4 spare
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
  it("selects a glyph level from geometry without changing geometry", () => {
    expect(glyphLevel({ kind: "BAR_SEAT", w: 21, h: 21 })).toBe("compact")
    expect(glyphLevel({ kind: "TABLE", w: 48, h: 30 })).toBe("standard")
    expect(glyphLevel({ kind: "TABLE", w: 80, h: 42 })).toBe("expanded")
  })

  it("renders only verified, supported customer flags", () => {
    expect(supportedFlags(["RETURNING", "NEW", "RETURNING"])).toEqual(["RETURNING", "NEW"])
  })

  it("suppresses a connector that crosses an unrelated table", () => {
    const a = createTable(1, 0, 0)
    const b = createTable(2, 100, 0)
    expect(connectorIsSafe([a, b], [a, b])).toBe(true)
    expect(connectorIsSafe([a, b], [a, b, createTable(3, 50, 2)])).toBe(false)
  })

  it("suppresses overly long connectors and leaves halo highlighting as fallback", () => {
    const a = createTable(1, 0, 0)
    const b = createTable(2, 200, 0)
    expect(connectorIsSafe([a, b], [a, b])).toBe(false)
  })

  it("shows group visuals only for the one selected live group and clears them on deselect", () => {
    const groups = [
      { id: 1, symbolNo: 1, displayCode: "G01", tableIds: [7, 8] },
      { id: 2, symbolNo: 2, displayCode: "G02", tableIds: [10, 11] },
    ]
    expect(activeGroupForSelection(groups, [7], true)?.displayCode).toBe("G01")
    expect(activeGroupForSelection(groups, [10], true)?.displayCode).toBe("G02")
    expect(activeGroupForSelection(groups, [], true)).toBeNull()
    expect(activeGroupForSelection(groups, [7], false)).toBeNull()
  })

  it("allows a remotely unavailable selected table to be activated for deselection", () => {
    const pickable = new Set([8])
    expect(tableCanActivate(7, pickable, new Set([7]))).toBe(true)
    expect(tableCanActivate(9, pickable, new Set([7]))).toBe(false)
  })
})

describe("waitlist marker display per zone mode (Section MARKER)", () => {
  const dummyZones: ZoneView[] = ZONES.map((z, i) => ({
    id: i + 1,
    version: 1,
    code: z.code,
    name: z.name,
    isBookable: true,
    isWaitingArea: false,
    displayOrder: i + 1,
  }))

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
      // No SVG foreignObject marker
      expect(html).not.toContain("<foreignObject")
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

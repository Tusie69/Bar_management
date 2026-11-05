import { describe, expect, it } from "vitest"
import type { FloorTableState, TableView } from "@/domain/models"
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
  const tables: TableView[] = [
    createTable(1, 100, 200, 40, 30, "A"),
    createTable(2, 120, 260, 40, 30, "A"),
    createTable(3, 300, 400, 50, 40, "B"),
    createTable(4, 320, 450, 50, 40, "B"),
  ]

  it("calculates camera fit bounds from real table coordinates for a specific zone", () => {
    // Zone A:
    // table 1: x=100 (hw=20 => minX=80, maxX=120), y=200 (hh=15 => minY=185, maxY=215)
    // table 2: x=120 (hw=20 => minX=100, maxX=140), y=260 (hh=15 => minY=245, maxY=275)
    // Zone A minX=80, maxX=140 (w=60), minY=185, maxY=275 (h=90)
    // padding=24: x=80-24=56, y=185-24=161, w=60+48=108, h=90+48=138
    const bounds = computeZoneBounds(tables, "A", 24)
    expect(bounds).toEqual({
      x: 56,
      y: 161,
      w: 108,
      h: 138,
    })
  })

  it("calculates camera fit bounds for ALL from all tables", () => {
    // Overall: minX=80 (t1), maxX=345 (t4: 320+25), minY=185 (t1), maxY=470 (t4: 450+20)
    // w = 345 - 80 = 265, h = 470 - 185 = 285
    // padding=20: x=60, y=165, w=305, h=325
    const bounds = computeZoneBounds(tables, "ALL", 20)
    expect(bounds).toEqual({
      x: 60,
      y: 165,
      w: 305,
      h: 325,
    })
  })

  it("returns null for an empty zone to allow fallback handling", () => {
    const bounds = computeZoneBounds(tables, "C", 24)
    expect(bounds).toBeNull()
  })

  it("returns full default floor bounds for ALL when table list is empty", () => {
    const bounds = computeZoneBounds([], "ALL", 24)
    expect(bounds).toEqual({
      x: 20,
      y: 20,
      w: 549,
      h: 714,
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

  it("maps late_confirmed to Quá giờ (late)", () => {
    const tables: TableView[] = [
      createTable(1, 100, 100, 40, 30, "A"),
      createTable(2, 100, 150, 40, 30, "A"),
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
    ])

    const counts = calculateStatusCounts(tables, states)
    // Both late and late_confirmed map into Quá giờ (late)
    expect(counts.late).toBe(2)
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

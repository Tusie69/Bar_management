import { describe, expect, it } from "vitest"
import type { FloorTableState, TableView } from "@/domain/models"
import {
  activeGroupForSelection,
  connectorIsSafe,
  glyphLevel,
  groupCode,
  supportedFlags,
  tableCanActivate,
  countFloorStates,
  wholeFloorBounds,
} from "./floor-visual-rules"

const table = (id: number, x: number, y: number, w = 40, h = 30) => ({ id, x, y, w, h, kind: "TABLE" }) as TableView

describe("adaptive floor visual rules", () => {
  it("fits the full frame and any table beyond it", () => {
    expect(wholeFloorBounds([], 589, 754)).toEqual({ x: 20, y: 20, w: 549, h: 734 })
    expect(wholeFloorBounds([table(1, 580, 748)], 589, 754)).toEqual({ x: 20, y: 20, w: 580, h: 743 })
  })

  it("keeps late, no-show and overdue hold distinct in the legend", () => {
    const tables = [table(1, 0, 0), table(2, 10, 10), table(3, 20, 20)]
    const states = new Map([
      [1, { state: "late" }], [2, { state: "noshow" }], [3, { state: "hold_overdue" }],
    ] as [number, FloorTableState][])
    expect([...countFloorStates(tables, states)]).toEqual([["late", 1], ["noshow", 1], ["hold_overdue", 1]])
  })

  it("keeps group display codes deterministic beyond Z", () => {
    expect(groupCode(1)).toBe("◆A")
    expect(groupCode(26)).toBe("◆Z")
    expect(groupCode(27)).toBe("◆AA")
    expect(groupCode(null)).toBeNull()
  })

  it("selects a glyph level from geometry without changing geometry", () => {
    expect(glyphLevel({ kind: "BAR_SEAT", w: 21, h: 21 })).toBe("compact")
    expect(glyphLevel({ kind: "TABLE", w: 48, h: 30 })).toBe("standard")
    expect(glyphLevel({ kind: "TABLE", w: 80, h: 42 })).toBe("expanded")
  })

  it("renders only verified, supported customer flags", () => {
    expect(supportedFlags(["RETURNING", "NEW", "RETURNING"])).toEqual(["RETURNING", "NEW"])
  })

  it("suppresses a connector that crosses an unrelated table", () => {
    const a = table(1, 0, 0)
    const b = table(2, 100, 0)
    expect(connectorIsSafe([a, b], [a, b])).toBe(true)
    expect(connectorIsSafe([a, b], [a, b, table(3, 50, 2)])).toBe(false)
  })

  it("suppresses overly long connectors and leaves halo highlighting as fallback", () => {
    const a = table(1, 0, 0)
    const b = table(2, 200, 0)
    expect(connectorIsSafe([a, b], [a, b])).toBe(false)
  })

  it("shows group visuals only for the one selected live group and clears them on deselect", () => {
    const groups = [
      { id: 1, symbolNo: 1, displayCode: "◆A", tableIds: [7, 8] },
      { id: 2, symbolNo: 2, displayCode: "◆B", tableIds: [10, 11] },
    ]
    expect(activeGroupForSelection(groups, [7], true)?.displayCode).toBe("◆A")
    expect(activeGroupForSelection(groups, [10], true)?.displayCode).toBe("◆B")
    expect(activeGroupForSelection(groups, [], true)).toBeNull()
    expect(activeGroupForSelection(groups, [7], false)).toBeNull()
  })

  it("allows a remotely unavailable selected table to be activated for deselection", () => {
    const pickable = new Set([8])
    expect(tableCanActivate(7, pickable, new Set([7]))).toBe(true)
    expect(tableCanActivate(9, pickable, new Set([7]))).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import type { FloorTableState, TableView } from "@/domain/models"
import { selectedCapacity, walkInBlockReason, walkInPickableIds, walkInSelectionIssues } from "./walk-in-selection"

const table = (patch: Partial<TableView> & Pick<TableView, "id" | "code">): TableView =>
  ({
    version: 1,
    displayName: patch.code,
    zoneId: 1,
    zoneCode: "A",
    kind: "TABLE",
    capacity: 2,
    seqNo: null,
    isSpare: false,
    status: "ACTIVE",
    x: 0,
    y: 0,
    w: 40,
    h: 30,
    seating: "four-sides",
    ...patch,
  }) as TableView

const state = (value: FloorTableState["state"]): FloorTableState =>
  ({ tableId: 1, state: value, claim: null, staleFromPreviousDay: false }) as FloorTableState

describe("mobile walk-in map selection", () => {
  it("allows only active, non-spare, free tables in a bookable zone", () => {
    const free = table({ id: 1, code: "A1" })
    const spare = table({ id: 2, code: "A2", isSpare: true })
    const occupied = table({ id: 3, code: "A3" })
    const waitingArea = table({ id: 4, code: "W1", zoneId: 9 })
    const pickable = walkInPickableIds(
      [free, spare, occupied, waitingArea],
      new Map([
        [1, state("free")],
        [2, state("spare")],
        [3, state("seated")],
        [4, state("free")],
      ]),
      new Set([1]),
      [],
    )
    expect([...pickable]).toEqual([1])
  })

  it("keeps multi-seat selection in the same zone and table kind", () => {
    const first = table({ id: 1, code: "BAR11", kind: "BAR_SEAT", seqNo: 11, capacity: 1, zoneId: 4 })
    const same = table({ id: 2, code: "BAR12", kind: "BAR_SEAT", seqNo: 12, capacity: 1, zoneId: 4 })
    const otherZone = table({ id: 3, code: "BAR13", kind: "BAR_SEAT", seqNo: 13, capacity: 1, zoneId: 5 })
    const normalTable = table({ id: 4, code: "B1", zoneId: 4 })
    const states = new Map([first, same, otherZone, normalTable].map((item) => [item.id, state("free")]))
    const pickable = walkInPickableIds([first, same, otherZone, normalTable], states, new Set([4, 5]), [first.id])
    expect([...pickable]).toEqual([1, 2])
    expect(walkInBlockReason(normalTable, states.get(4), new Set([4, 5]), first)).toMatch(/ghế Bar/)
  })

  it("reports stale selections and sums capacity for the footer", () => {
    const a = table({ id: 1, code: "A1", capacity: 2 })
    const b = table({ id: 2, code: "A2", capacity: 4 })
    const byId = new Map([
      [a.id, a],
      [b.id, b],
    ])
    const states = new Map([
      [a.id, state("free")],
      [b.id, state("hold")],
    ])
    expect(selectedCapacity([1, 2], byId)).toBe(6)
    expect(walkInSelectionIssues([1, 2], byId, states, new Set([1]))).toEqual(["Bàn A2 đang được giữ."])
  })
})

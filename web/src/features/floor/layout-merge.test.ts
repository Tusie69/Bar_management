import { describe, expect, it, vi } from "vitest"
vi.mock("@/services", () => ({ api: { mode: "http" }, clock: { now: () => new Date("2026-11-09T12:00:00Z") } }))
import { layoutSelection } from "./layout-merge"
import type { FloorModel } from "./use-floor-model"

const model = {
  byId: new Map(
    [1, 2, 3].map((id) => [id, { id, zoneId: 1, kind: "TABLE", status: "ACTIVE", isSpare: false, capacity: 4 }]),
  ),
  states: new Map([1, 2, 3].map((id) => [id, { tableId: id, state: "free", claim: null }])),
} as unknown as FloorModel

describe("P1 merge eligibility on HTTP", () => {
  // C1 shipped: an idle triple is exactly what POST /tables/groups is for, so the
  // client no longer blocks it and no longer invents a local group either.
  it("allows an idle triple now that the layout-cluster endpoints exist", () => {
    const selection = layoutSelection(model, [1, 2, 3])
    expect(selection.reason).toBe("")
    expect(selection.owner).toBeUndefined()
  })
  it("allows a triple for one existing owner even above the catalog capacity and cross-zone", () => {
    const m = { ...model, states: new Map(model.states) }
    m.states.set(1, { tableId: 1, state: "seated", claim: { visitId: 9, tableIds: [1], partySize: 20 } } as never)
    expect(layoutSelection(m, [1, 2, 3]).reason).toBe("")
    // K1 Section 5: Cross-zone and table+bar combinations are not blocked on the client in merge mode
    m.byId = new Map(model.byId)
    m.byId.set(3, { ...m.byId.get(3)!, zoneId: 2, kind: "BAR_SEAT" })
    expect(layoutSelection(m, [1, 2, 3]).reason).toBe("")
  })
  it("does not route a waitlist offer through the booking merge endpoint", () => {
    const m = { ...model, states: new Map(model.states) }
    m.states.set(1, {
      tableId: 1,
      state: "hold",
      claim: { kind: "waitlist_hold", reservationId: 9, tableIds: [1] },
    } as never)
    expect(layoutSelection(m, [1, 2]).reason).toContain("Bàn chờ")
  })
})

import { describe, expect, it } from "vitest"
import { mockTableTurns, mockTableTurnSummary, seedTableTurns } from "./table-turns"

describe("table turn mock ledger", () => {
  const rows = seedTableTurns(new Date("2030-10-24T14:00:00Z"))
  const range = { from: "2030-10-24", to: "2030-10-24" }
  it.each(["TABLE", "GROUP"] as const)("uses the highest matching turn ID for a backdated %s snapshot", (scope) => {
    const original = rows.find((row) => row.scope === scope && row.counted && row.businessDate === range.from)!
    const history = [
      { ...original, turnId: 10, guestCount: 2 },
      {
        ...original,
        turnId: 20,
        businessDate: "2030-10-23",
        tableCodes: ["B-NEW", "B-MORE"],
        groupCode: scope === "GROUP" ? "C-NEW" : null,
        guestCount: 5,
      },
    ]
    const filters = { from: "2030-10-23", to: range.to }
    const list = mockTableTurns(history, filters)
    const summary = mockTableTurnSummary(history, filters)
    expect(list).toMatchObject({ total: 2, completedTotal: 2, guestTotal: 7 })
    expect(list.turns.map((row) => row.turnId)).toEqual([10, 20])
    expect(summary).toMatchObject({ completedTotal: 2, guestTotal: 7 })
    expect(summary.byScope).toEqual([
      {
        scope,
        tableId: original.tableId,
        groupId: original.groupId,
        label: scope === "GROUP" ? "C-NEW" : "B-NEW + B-MORE",
        turns: 2,
        guests: 7,
      },
    ])
    expect(mockTableTurns(history, filters)).toEqual(list)
  })
  it("counts a group once and totals the full filter before pagination", () => {
    const list = mockTableTurns(rows, { ...range, pageSize: 1, page: 2 })
    const summary = mockTableTurnSummary(rows, range)
    expect(list).toMatchObject({ total: 3, completedTotal: 3, guestTotal: 13 })
    expect(list.turns).toHaveLength(1)
    expect(summary).toMatchObject({ completedTotal: 3, guestTotal: 13 })
    expect(summary.byScope.find((row) => row.scope === "GROUP")).toMatchObject({ turns: 1, guests: 8 })
    expect(summary.byBusinessDate).toEqual([{ businessDate: range.from, turns: 3, guests: 13 }])
  })
  it("includes corrections/system closes only with the flag and filters by closing user", () => {
    const list = mockTableTurns(rows, { ...range, includeUncounted: true })
    expect(list.total).toBe(5)
    expect(list.completedTotal).toBe(3)
    expect(list.turns.map((row) => row.endReason)).toEqual(expect.arrayContaining(["ENTRY_ERROR", "BUSINESS_DAY_END"]))
    const all = mockTableTurnSummary(rows, { ...range, includeUncounted: true })
    expect(all.byStaff.find((row) => row.closedByUserId === null)).toEqual({
      closedByUserId: null,
      closedByDisplayName: null,
      turns: 1,
      guests: 6,
    })
    const filtered = { ...range, closedByUserId: 2, includeUncounted: true }
    expect(mockTableTurns(rows, filtered)).toMatchObject({ total: 2, completedTotal: 1, guestTotal: 3 })
    expect(mockTableTurnSummary(rows, filtered).byStaff).toHaveLength(1)
    expect(mockTableTurnSummary(rows, { from: "2020-01-01", to: "2020-01-01" })).toMatchObject({
      completedTotal: 0,
      guestTotal: 0,
      byBusinessDate: [],
      byStaff: [],
      byScope: [],
    })
  })
})

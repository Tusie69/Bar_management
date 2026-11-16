import { describe, expect, it } from "vitest"
import { mockTableTurns, mockTableTurnSummary, seedTableTurns } from "./table-turns"
import { projectTableTurns } from "./derive"
import { seedDb } from "./seed"

describe("table turn mock ledger", () => {
  const rows = seedTableTurns(new Date("2030-10-24T14:00:00Z"))
  const range = { from: "2030-10-24", to: "2030-10-24" }
  it("splits OPEN turns from counted and uncounted CLOSED turns with the same staff filters", () => {
    const closed = rows.find((row) => row.counted && row.businessDate === range.from)!
    const open = {
      ...closed,
      status: "OPEN" as const,
      turnId: null,
      releasedAt: null,
      endReason: null,
      closedByUserId: null,
      closedByDisplayName: null,
    }
    const mixed = [
      { ...open, visitId: 80, guestCount: 2 },
      { ...closed, visitId: 81, guestCount: 3, closedByUserId: 2 },
      { ...closed, visitId: 82, guestCount: 4, counted: false, endReason: "ENTRY_ERROR", closedByUserId: 2 },
      { ...open, visitId: 83, guestCount: 5, checkedInByUserId: 2 },
    ]
    for (const includeUncounted of [false, true]) {
      for (const [filters, expected] of [
        [{}, { completedTotal: 3, openTotal: 2, guestTotal: 10 }],
        [{ checkedInByUserId: 1 }, { completedTotal: 2, openTotal: 1, guestTotal: 5 }],
        [{ checkedInByUserId: 2 }, { completedTotal: 1, openTotal: 1, guestTotal: 5 }],
        [{ closedByUserId: 2 }, { completedTotal: 1, openTotal: 0, guestTotal: 3 }],
        [{ checkedInByUserId: 999999 }, { completedTotal: 0, openTotal: 0, guestTotal: 0 }],
      ] as const) {
        const summary = mockTableTurnSummary(mixed, { ...range, includeUncounted, ...filters })
        expect(summary).toMatchObject(expected)
        expect(summary.openTotal).toBeGreaterThanOrEqual(0)
        expect(summary.openTotal).toBeLessThanOrEqual(summary.completedTotal)
      }
    }
  })
  it.each(["MOVED", "REGROUPED", "SPLIT"] as const)(
    "excludes %s history from a closed visit's final tables",
    (reason) => {
      const db = seedDb(new Date("2030-10-24T14:00:00Z"))
      const visit = [...db.visits.values()].find((row) => !row.endedAt)!
      const allocations = [...db.allocations.values()].filter((row) => row.visitId === visit.id)
      const finalTable = [...db.tables.values()].find((row) => row.code === "C4")!
      const previousTable = [...db.tables.values()].find((row) => row.code === "C5")!
      for (const allocation of allocations) db.allocations.delete(allocation.id)
      const endedAt = new Date("2030-10-24T15:00:00Z")
      const finalAllocation = {
        ...allocations[0]!,
        tableId: finalTable.id,
        groupId: null,
        releasedAt: new Date(endedAt.getTime() - 1),
        releaseReason: "GUEST_LEFT" as const,
      }
      db.allocations.set(finalAllocation.id, finalAllocation)
      const historyId = Math.max(...db.allocations.keys()) + 1
      db.allocations.set(historyId, {
        ...finalAllocation,
        id: historyId,
        tableId: previousTable.id,
        releasedAt: new Date(endedAt.getTime() - 2),
        releaseReason: reason,
      })
      visit.endedAt = endedAt
      visit.endReason = "GUEST_LEFT"
      expect(projectTableTurns(db).filter((row) => row.visitId === visit.id)).toMatchObject([
        {
          status: "CLOSED",
          counted: true,
          tableId: finalTable.id,
          tableCodes: ["C4"],
          memberTableIds: [finalTable.id],
        },
      ])
    },
  )
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
  it("includes corrections/system closes only with the flag and attributes them to check-in staff", () => {
    const list = mockTableTurns(rows, { ...range, includeUncounted: true })
    expect(list.total).toBe(5)
    expect(list.completedTotal).toBe(3)
    expect(list.turns.map((row) => row.endReason)).toEqual(expect.arrayContaining(["ENTRY_ERROR", "BUSINESS_DAY_END"]))
    const all = mockTableTurnSummary(rows, { ...range, includeUncounted: true })
    expect(all.byStaff.find((row) => row.checkedInByUserId === 1)).toEqual({
      checkedInByUserId: 1,
      checkedInByDisplayName: "Lễ tân 1",
      turns: 3,
      guests: 16,
    })
    const filtered = { ...range, checkedInByUserId: 2, includeUncounted: true }
    expect(mockTableTurns(rows, filtered)).toMatchObject({ total: 2, completedTotal: 1, guestTotal: 3 })
    expect(mockTableTurnSummary(rows, filtered).byStaff).toHaveLength(1)
    expect(mockTableTurnSummary(rows, { from: "2020-01-01", to: "2020-01-01" })).toMatchObject({
      completedTotal: 0,
      openTotal: 0,
      guestTotal: 0,
      byBusinessDate: [],
      byStaff: [],
      byScope: [],
    })
  })

  it("counts OPEN turns and groups by check-in staff when another person releases", () => {
    const closed = {
      ...rows[0]!,
      businessDate: range.from,
      visitId: 80,
      closedByUserId: 2,
      closedByDisplayName: "Closer",
    }
    const open = {
      ...closed,
      visitId: 81,
      turnId: null,
      status: "OPEN" as const,
      releasedAt: null,
      endReason: null,
      closedByUserId: null,
      closedByDisplayName: null,
    }
    const filters = { ...range, checkedInByUserId: 1 }
    expect(mockTableTurns([closed, open], { ...filters, pageSize: 1 })).toMatchObject({
      total: 2,
      completedTotal: 2,
      guestTotal: 4,
    })
    expect(mockTableTurnSummary([closed, open], filters).byStaff).toEqual([
      {
        checkedInByUserId: 1,
        checkedInByDisplayName: "Lễ tân 1",
        turns: 2,
        guests: 4,
      },
    ])
  })
})

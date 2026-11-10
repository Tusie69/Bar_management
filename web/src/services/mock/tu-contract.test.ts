import { beforeEach, describe, expect, it, vi } from "vitest"
import { addDays, atBusinessTime, businessDateOf } from "@/lib/time"
import { clock } from "../clock"
import { DEMO_USERS } from "./seed"
import { MockGamApi } from "./server"

describe("Tu contract mock preview", () => {
  let api: MockGamApi
  let bd: string
  let ids: (codes: string[]) => number[]
  beforeEach(async () => {
    clock.resetToScenario()
    api = new MockGamApi()
    vi.spyOn(api as unknown as { latency: () => Promise<void> }, "latency").mockResolvedValue()
    bd = businessDateOf(clock.now())
    const catalog = await api.getCatalog()
    ids = (codes) => codes.map((code) => catalog.tables.find((t) => t.code === code)!.id)
  })
  const booking = (expectedAt: Date, tableIds: number[] = [], partySize = 12) => ({
    contactName: "Contract guest",
    expectedAt,
    tableIds,
    partySize,
    sourceCode: "HOTLINE" as const,
  })

  it.each([false, true])(
    "projects saved birthday %s with classification and icons before and after check-in",
    async (isBirthday) => {
      const created = await api.createReservation({
        ...booking(atBusinessTime(bd, "23:00"), ids(["C4"]), 2),
        isBirthday,
        classification: "RETURNING",
        iconKeys: ["star", "pin"],
      })
      const row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === created.reservationId)!
      expect(row.isBirthday).toBe(isBirthday)
      const expected = {
        reservationId: row.id,
        flags: isBirthday ? ["RETURNING", "BIRTHDAY"] : ["RETURNING"],
        iconKeys: ["star", "pin"],
      }
      const claim = async () =>
        (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === ids(["C4"])[0])!.claim!
      expect(await claim()).toMatchObject(expected)
      await api.checkIn({ reservationId: row.id, version: row.version, guestCount: 2 })
      expect(await claim()).toMatchObject({ ...expected, visitId: expect.any(Number) })
    },
  )

  it.each(["20:00", "20:05", "20:10", "00:05", "01:00"])("accepts the 5-minute slot %s", async (time) => {
    await expect(api.createReservation(booking(atBusinessTime(addDays(bd, 1), time)))).resolves.toHaveProperty(
      "reservationId",
    )
  })
  it("rejects 20:03 on create and update without changing the booking", async () => {
    const invalid = atBusinessTime(addDays(bd, 1), "20:03")
    await expect(api.createReservation(booking(invalid))).rejects.toMatchObject({
      status: 400,
      code: "EXPECTED_AT_OFF_SLOT",
    })
    const created = await api.createReservation(booking(atBusinessTime(addDays(bd, 1), "20:05")))
    const before = (await api.listReservations({ businessDate: addDays(bd, 1) })).find(
      (r) => r.id === created.reservationId,
    )!
    await expect(
      api.updateReservation({ id: before.id, version: before.version, expectedAt: invalid }),
    ).rejects.toMatchObject({ code: "EXPECTED_AT_OFF_SLOT" })
    expect((await api.listReservations({ businessDate: addDays(bd, 1) })).find((r) => r.id === before.id)).toEqual(
      before,
    )
  })
  it("creates, assigns, moves and checks in 12 guests without capacity rejection", async () => {
    const created = await api.createReservation(booking(atBusinessTime(bd, "23:05"), ids(["C4"])))
    let row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === created.reservationId)!
    await api.assignTables(row.id, row.version, ids(["C5"]))
    row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === row.id)!
    await api.moveClaim({ claim: { reservationId: row.id, version: row.version }, tableIds: ids(["C1"]) })
    row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === row.id)!
    await api.checkIn({ reservationId: row.id, version: row.version, guestCount: 12 })
    const claim = (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === ids(["C1"])[0])!.claim!
    expect(claim.partySize).toBe(12)
    await api.moveClaim({ claim: { visitId: claim.visitId!, version: claim.version }, tableIds: ids(["C2"]) })
    await expect(api.seatWalkIn({ tableIds: ids(["BAR18"]), guestCount: 12 })).resolves.toHaveProperty("visitId")
    expect(
      (await api.getAvailability(atBusinessTime(addDays(bd, 1), "23:05"), 12)).tables.find(
        (t) => t.tableId === ids(["C4"])[0],
      )?.status,
    ).toBe("available")
  })
  it.each([0, -1, 1.5, NaN, Infinity])("keeps invalid guest count %s rejected on every guest write", async (count) => {
    const invalid = { code: "VALIDATION_FAILED" }
    await expect(api.createReservation(booking(atBusinessTime(bd, "23:05"), [], count))).rejects.toMatchObject(invalid)
    await expect(api.seatWalkIn({ tableIds: ids(["C1"]), guestCount: count })).rejects.toMatchObject(invalid)
    const created = await api.createReservation(booking(atBusinessTime(bd, "23:05"), ids(["C4"])))
    const row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === created.reservationId)!
    await expect(api.updateReservation({ id: row.id, version: row.version, partySize: count })).rejects.toMatchObject(
      invalid,
    )
    await expect(api.checkIn({ reservationId: row.id, version: row.version, guestCount: count })).rejects.toMatchObject(
      invalid,
    )
  })
  it("uses the claim version when merging an occupied party with an empty table", async () => {
    const walk = await api.seatWalkIn({ tableIds: ids(["C1"]), guestCount: 12 })
    const claim = (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === ids(["C1"])[0])!.claim!
    await expect(
      api.combineTables({ claim: { visitId: walk.visitId, version: claim.version + 1 }, addTableIds: ids(["C2"]) }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" })
    await api.combineTables({ claim: { visitId: walk.visitId, version: claim.version }, addTableIds: ids(["C2"]) })
    expect(
      (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === ids(["C2"])[0])?.claim?.visitId,
    ).toBe(walk.visitId)
  })
  it("uses group versions for add and idle split, preserving the layout after rejected versions", async () => {
    await api.createTableGroup({ tableIds: ids(["C1", "C2"]), name: "Khu C" })
    let group = (await api.getFloorState(clock.now())).groups.find((g) => g.name === "Khu C")!
    expect(group).toMatchObject({ version: 1, claim: null, seatedTurnCount: 0, totalSeats: expect.any(Number) })
    await api.addTableGroupMembers({ groupId: group.id, version: group.version!, tableIds: ids(["C4"]) })
    const conflict = {
      code: "TABLE_GROUP_VERSION_CONFLICT",
      details: { currentVersion: 2, changeSeq: expect.any(String) },
    }
    await expect(
      api.addTableGroupMembers({ groupId: group.id, version: 1, tableIds: ids(["C5"]) }),
    ).rejects.toMatchObject(conflict)
    await expect(api.splitGroup({ groupId: group.id, version: 1, mode: "ALL_TO_SINGLE" })).rejects.toMatchObject(
      conflict,
    )
    group = (await api.getFloorState(clock.now())).groups.find((g) => g.id === group.id)!
    expect(group.tableIds).toEqual(ids(["C1", "C2", "C4"]))
    await api.splitGroup({ groupId: group.id, version: group.version!, mode: "ALL_TO_SINGLE" })
    expect((await api.getFloorState(clock.now())).groups.find((g) => g.id === group.id)).toBeUndefined()
  })
  it.each(["booking", "assignment", "check-in", "walk-in", "move"])(
    "expands a single group member for %s without accepting a group version",
    async (operation) => {
      const members = ids(["C4", "C5"])
      await api.createTableGroup({ tableIds: members })
      const group = (await api.getFloorState(clock.now())).groups.find((g) => g.tableIds.includes(members[0]))!
      if (operation === "booking") {
        await api.createReservation(booking(atBusinessTime(bd, "23:05"), [members[0]]))
      } else if (operation === "assignment" || operation === "check-in") {
        const created = await api.createReservation(booking(atBusinessTime(bd, "23:05")))
        const row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === created.reservationId)!
        if (operation === "assignment") await api.assignTables(row.id, row.version, [members[0]])
        else await api.checkIn({ reservationId: row.id, version: row.version, guestCount: 12, tableIds: [members[0]] })
      } else if (operation === "walk-in") {
        await api.seatWalkIn({ tableIds: [members[0]], guestCount: 12 })
      } else {
        const walk = await api.seatWalkIn({ tableIds: ids(["C1"]), guestCount: 12 })
        const visit = (await api.listVisits(bd)).find((v) => v.id === walk.visitId)!
        await api.moveClaim({ claim: { visitId: visit.id, version: visit.version }, tableIds: [members[0]] })
      }
      const floor = await api.getFloorState(clock.now())
      expect(floor.groups.find((g) => g.id === group.id)?.version).toBe(group.version)
      for (const tableId of members) {
        expect(floor.tables.find((t) => t.tableId === tableId)).toMatchObject({
          claimOwner: "GROUP",
          claim: { groupId: group.id, tableIds: members, partySize: 12 },
        })
      }
    },
  )
  it.each([
    { codes: ["C1"], code: "MERGE_REQUIRES_MULTIPLE_TABLES" },
    { codes: ["A0", "A2"], code: "SPARE_TABLE_NOT_BOOKABLE" },
  ])("rejects group $codes with $code", async ({ codes, code }) => {
    await expect(api.createTableGroup({ tableIds: ids(codes) })).rejects.toMatchObject({ code })
  })
  // K1 Section 5: In mock mode pending Tu, cross-kind and cross-zone groups are permitted for UI review.
  it.each([{ codes: ["C1", "BAR18"] }, { codes: ["C1", "B5"] }])(
    "allows cross-kind and cross-zone group $codes in mock preview",
    async ({ codes }) => {
      const res = await api.createTableGroup({ tableIds: ids(codes) })
      expect(res.operationId).toBeGreaterThan(0)
      const created = await api.createReservation(booking(atBusinessTime(bd, "23:00"), ids(codes), 2))
      const floor = await api.getFloorState(clock.now())
      for (const tableId of ids(codes)) {
        expect(floor.tables.find((t) => t.tableId === tableId)?.claim).toMatchObject({
          reservationId: created.reservationId,
          tableIds: ids(codes),
        })
      }
    },
  )
  it("rejects already grouped and unknown tables", async () => {
    await api.createTableGroup({ tableIds: ids(["C1", "C2"]) })
    await expect(api.createTableGroup({ tableIds: ids(["C1", "C4"]) })).rejects.toMatchObject({
      code: "TABLE_ALREADY_GROUPED",
    })
    await expect(api.createTableGroup({ tableIds: [99999, ...ids(["C4"])] })).rejects.toMatchObject({
      code: "TABLE_NOT_FOUND",
    })
  })
  it("returns the mixed-state and multiple-claim codes with affected tables", async () => {
    await api.createReservation(booking(atBusinessTime(bd, "23:05"), ids(["C1"])))
    await expect(api.createTableGroup({ tableIds: ids(["C1", "C2"]) })).rejects.toMatchObject({
      code: "TABLE_GROUP_MIXED_STATE",
      details: { conflictingTableIds: ids(["C1", "C2"]) },
    })
    await api.createReservation(booking(atBusinessTime(bd, "23:05"), ids(["C2"])))
    await expect(api.createTableGroup({ tableIds: ids(["C1", "C2"]) })).rejects.toMatchObject({
      code: "TABLE_GROUP_MULTIPLE_CLAIMS",
      details: { conflictingTableIds: ids(["C1", "C2"]) },
    })
    await api.createTableGroup({ tableIds: ids(["C4", "C5"]) })
    const group = (await api.getFloorState(clock.now())).groups.find((g) => g.tableIds.includes(ids(["C4"])[0]))!
    await expect(
      api.addTableGroupMembers({ groupId: group.id, version: group.version!, tableIds: ids(["C1"]) }),
    ).rejects.toMatchObject({ code: "TABLE_GROUP_MIXED_STATE" })
  })
  it.each(["CASHIER", "CUSTOMER_CARE"])("denies every layout command to %s", async (role) => {
    await api.createTableGroup({ tableIds: ids(["C1", "C2"]) })
    const group = (await api.getFloorState(clock.now())).groups.find((g) => g.tableIds.includes(ids(["C1"])[0]))!
    api.setSession(DEMO_USERS.find((u) => u.role === role)!)
    const denied = { status: 403, code: "PERMISSION_DENIED", details: { permission: "table.group.manage" } }
    await expect(api.createTableGroup({ tableIds: ids(["C4", "C5"]) })).rejects.toMatchObject(denied)
    await expect(
      api.addTableGroupMembers({ groupId: group.id, version: group.version!, tableIds: ids(["C4"]) }),
    ).rejects.toMatchObject(denied)
    await expect(
      api.splitGroup({ groupId: group.id, version: group.version!, mode: "ALL_TO_SINGLE" }),
    ).rejects.toMatchObject(denied)
  })
  it("counts seated visits once per day and group, including the current visit and retaining checkout", async () => {
    const tableIds = ids(["C4", "C5"])
    await api.createTableGroup({ tableIds })
    const gid = (await api.getFloorState(clock.now())).groups.find((g) => g.tableIds.includes(tableIds[0]))!.id
    for (let turn = 1; turn <= 2; turn++) {
      const created = await api.createReservation(booking(atBusinessTime(bd, "23:05"), tableIds))
      expect((await api.getFloorState(clock.now())).groups.find((g) => g.id === gid)?.seatedTurnCount).toBe(turn - 1)
      const row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === created.reservationId)!
      await api.checkIn({ reservationId: row.id, version: row.version, guestCount: 12 })
      const floor = await api.getFloorState(clock.now())
      expect(floor.groups.find((g) => g.id === gid)).toMatchObject({
        seatedTurnCount: turn,
        claim: { partySize: 12, reservedExpectedAt: row.expectedAt },
      })
      expect(
        floor.tables
          .filter((t) => tableIds.includes(t.tableId))
          .every((t) => t.seatedTurnCount === turn && t.claimOwner === "GROUP"),
      ).toBe(true)
      const group = floor.groups.find((g) => g.id === gid)!
      await expect(
        api.splitGroup({ groupId: gid, version: group.version!, mode: "ALL_TO_SINGLE" }),
      ).rejects.toMatchObject({ code: "TABLE_GROUP_MIXED_STATE" })
      const claim = group.claim!
      await api.endVisit(claim.visitId!, claim.version)
      expect((await api.getFloorState(clock.now())).groups.find((g) => g.id === gid)).toMatchObject({
        seatedTurnCount: turn,
        claim: null,
      })
    }
    expect(
      (await api.getFloorState(atBusinessTime(addDays(bd, 1), "19:00"), addDays(bd, 1))).groups.find(
        (g) => g.id === gid,
      )?.seatedTurnCount,
    ).toBe(0)
    const single = await api.seatWalkIn({ tableIds: ids(["C1"]), guestCount: 12 })
    let table = (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === ids(["C1"])[0])!
    expect(table).toMatchObject({ seatedTurnCount: 1, claimOwner: "TABLE" })
    await api.endVisit(single.visitId, table.claim!.version)
    table = (await api.getFloorState(clock.now())).tables.find((t) => t.tableId === table.tableId)!
    expect(table).toMatchObject({ seatedTurnCount: 1, claim: null, claimOwner: null })
  })
})

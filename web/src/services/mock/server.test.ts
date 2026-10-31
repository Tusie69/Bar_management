import { beforeEach, describe, expect, it, vi } from "vitest"
import { BAR_SEATS, POSITION_COUNT, TABLES } from "@/domain/venue-layout"
import { addDays, atBusinessTime, businessDateOf, fromVenueLocal } from "@/lib/time"
import { clock } from "../clock"
import { ApiError } from "../contracts"
import { DEMO_USERS } from "./seed"
import { MockGamApi } from "./server"

const receptionist = DEMO_USERS[0]
const owner = DEMO_USERS.find((u) => u.role === "OWNER_ADMIN")!

async function expectApiError(p: Promise<unknown>, code: string) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).code).toBe(code)
    return e as ApiError
  }
  throw new Error(`expected ApiError ${code}`)
}

describe("venue layout", () => {
  it("has exactly 44 positions: 23 tables + 21 bar seats in order", () => {
    expect(TABLES).toHaveLength(23)
    expect(BAR_SEATS).toHaveLength(21)
    expect(POSITION_COUNT).toBe(44)
    expect(BAR_SEATS.map((s) => s.no)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1))
  })
})

describe("business date", () => {
  it("assigns 01:30 to the previous business day (17:00-05:00)", () => {
    expect(businessDateOf(fromVenueLocal("2026-10-21", "01:30"))).toBe("2026-10-20")
    expect(businessDateOf(fromVenueLocal("2026-10-21", "17:00"))).toBe("2026-10-21")
    expect(businessDateOf(fromVenueLocal("2026-10-21", "04:59"))).toBe("2026-10-20")
  })

  it("keeps the existing closed-hours default stable through 17:00", () => {
    expect(businessDateOf(fromVenueLocal("2026-10-21", "05:00"))).toBe("2026-10-21")
    expect(businessDateOf(fromVenueLocal("2026-10-21", "16:59"))).toBe("2026-10-21")
    expect(businessDateOf(fromVenueLocal("2026-10-21", "17:00"))).toBe("2026-10-21")
  })
})

describe("MockGamApi", () => {
  let api: MockGamApi
  let bd: string

  beforeEach(() => {
    clock.resetToScenario()
    api = new MockGamApi()
    api.setSession(receptionist)
    bd = businessDateOf(clock.now())
  })

  it("keeps classification in mock writes and exports privacy-filtered statistics", async () => {
    const created = await api.createReservation({
      contactName: "Export guest",
      phone: "0901234567",
      partySize: 3,
      expectedAt: atBusinessTime(bd, "23:00"),
      sourceCode: "HOTLINE",
      classification: "RETURNING",
    })
    let row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === created.reservationId)!
    expect(row.classification).toBe("RETURNING")
    await api.updateReservation({ id: row.id, version: row.version, classification: "NEW" })
    row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === row.id)!
    expect(row.classification).toBe("NEW")
    const exported = await api.exportDailyBookingText(bd)
    expect(exported).toContain("Export guest")
    expect(exported).toContain("THỐNG KÊ")
    expect(exported).toContain("Bàn khách mới N: 1")
    expect(exported).not.toContain("0901234567")
  })

  it("assigns waitlist groups to a reservation hold without seating the party", async () => {
    const cat = await api.getCatalog()
    const ids = ["B5", "B7"].map((code) => cat.tables.find((table) => table.code === code)!.id)
    const created = await api.addWaitlist({
      kind: "WALK_IN",
      contactName: "Waiting group",
      phone: "0901234567",
      partySize: 4,
      channel: "IN_PERSON",
      preferenceMode: "ANY",
      preferences: [],
    })
    const entry = (await api.listWaitlist(bd)).find((row) => row.id === created.entryId)!
    expect(entry.phoneLast3).toBe("567")
    const assigned = await api.seatWaitlist({ entryId: entry.id, version: entry.version, guestCount: 4, tableIds: ids })
    expect(assigned.reservationId).toBeGreaterThan(0)
    expect(assigned.groupId).toBeGreaterThan(0)
    const reservation = (await api.listReservations({ businessDate: bd })).find(
      (row) => row.id === assigned.reservationId,
    )!
    expect(reservation).toMatchObject({ status: "BOOKED", tableIds: ids, visitId: null })
    expect((await api.listWaitlist(bd)).find((row) => row.id === entry.id)).toMatchObject({
      status: "HOLD_ACTIVE",
      reservationId: reservation.id,
    })
    const floor = await api.getFloorState(clock.now(), bd)
    expect(floor.groups.find((group) => group.id === assigned.groupId)?.tableIds.sort()).toEqual(ids.sort())
    await expect(
      api.seatWaitlist({ entryId: entry.id, version: entry.version, guestCount: 4, tableIds: ids }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" })
    await api.checkIn({ reservationId: reservation.id, version: reservation.version, guestCount: 4 })
    expect((await api.listWaitlist(bd)).find((row) => row.id === entry.id)?.status).toBe("SEATED")
    const seated = await api.getFloorState(clock.now(), bd)
    expect(seated.groups.find((group) => group.id === assigned.groupId)?.tableIds.sort()).toEqual(ids.sort())
  })

  it("rolls back a direct booking and its customer when table assignment conflicts", async () => {
    const table = (await api.getCatalog()).tables.find((row) => row.code === "B3")!
    const before = await api.listReservations({ businessDate: bd })
    const allocations = await api.listAllocations(bd)
    const operations = await api.listOperations(100)
    await expect(
      api.createReservation({
        contactName: "Atomic conflict guest",
        phone: "0901112233",
        partySize: 2,
        expectedAt: atBusinessTime(bd, "23:00"),
        sourceCode: "HOTLINE",
        tableIds: [table.id],
      }),
    ).rejects.toMatchObject({ code: "TABLE_CONFLICT" })
    expect(await api.listReservations({ businessDate: bd })).toEqual(before)
    expect(await api.listAllocations(bd)).toEqual(allocations)
    expect(await api.listOperations(100)).toEqual(operations)
    expect(await api.searchCustomers("Atomic conflict guest")).toEqual([])
  })

  it("moves a visit to a complete destination set with version checks and stable group identity", async () => {
    const catalog = await api.getCatalog()
    const floor = await api.getFloorState(clock.now())
    const free = catalog.tables
      .filter(
        (table) =>
          table.kind === "TABLE" &&
          catalog.zones.find((zone) => zone.id === table.zoneId)?.isBookable &&
          !table.isSpare &&
          floor.tables.find((row) => row.tableId === table.id)?.state === "free",
      )
      .slice(0, 2)
    expect(free).toHaveLength(2)
    const seated = await api.seatWalkIn({ tableIds: [free[0].id], guestCount: 2 })
    const before = (await api.listVisits(bd)).find((row) => row.id === seated.visitId)!
    const targetIds = free.map((table) => table.id)
    await expect(
      api.moveClaim({ claim: { visitId: before.id, version: before.version - 1 }, tableIds: targetIds }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" })
    await api.moveClaim({ claim: { visitId: before.id, version: before.version }, tableIds: targetIds })
    const moved = await api.getFloorState(clock.now())
    const claim = moved.tables.find((row) => row.tableId === targetIds[0])!.claim!
    expect(claim).toMatchObject({ visitId: before.id, tableIds: targetIds, version: before.version + 1 })
    expect(moved.groups.find((row) => row.id === claim.groupId)?.tableIds).toEqual(targetIds)
    await api.moveClaim({ claim: { visitId: before.id, version: claim.version }, tableIds: [targetIds[0]] })
    const single = await api.getFloorState(clock.now())
    expect(single.groups.some((row) => row.id === claim.groupId)).toBe(false)
    expect(single.tables.find((row) => row.tableId === targetIds[0])?.claim).toMatchObject({
      visitId: before.id,
      groupId: null,
    })
    expect(single.tables.find((row) => row.tableId === targetIds[1])?.claim).toBeNull()
  })

  it("assigns an advance waitlist entry without creating a duplicate reservation", async () => {
    const created = await api.createReservation({
      contactName: "Advance group",
      partySize: 2,
      expectedAt: atBusinessTime(bd, "23:00"),
      sourceCode: "HOTLINE",
    })
    const before = await api.listReservations({ businessDate: bd })
    const queued = await api.addWaitlist({
      kind: "ADVANCE_RESERVATION",
      reservationId: created.reservationId,
      channel: "IN_PERSON",
      preferenceMode: "ANY",
      preferences: [],
    })
    const entry = (await api.listWaitlist(bd)).find((row) => row.id === queued.entryId)!
    const table = (await api.getCatalog()).tables.find((row) => row.code === "B5")!
    const assigned = await api.seatWaitlist({
      entryId: entry.id,
      version: entry.version,
      guestCount: 2,
      tableIds: [table.id],
    })
    expect(assigned).toMatchObject({ reservationId: created.reservationId, groupId: null })
    const after = await api.listReservations({ businessDate: bd })
    expect(after).toHaveLength(before.length)
    expect(after.find((row) => row.id === created.reservationId)?.tableIds).toEqual([table.id])
  })

  it.each(["WALK_IN", "ADVANCE_RESERVATION"] as const)(
    "converts an accepted %s offer into a reservation hold before normal check-in",
    async (kind) => {
      const catalog = await api.getCatalog()
      const ids = ["B5", "B7"].map((code) => catalog.tables.find((table) => table.code === code)!.id)
      const linked =
        kind === "ADVANCE_RESERVATION"
          ? await api.createReservation({
              contactName: "Accepted advance",
              partySize: 4,
              expectedAt: atBusinessTime(bd, "23:00"),
              sourceCode: "HOTLINE",
            })
          : null
      const queued = await api.addWaitlist({
        kind,
        reservationId: linked?.reservationId,
        contactName: "Accepted party",
        partySize: 4,
        channel: "IN_PERSON",
        preferenceMode: "ANY",
        preferences: [],
      })
      const entry = async () => (await api.listWaitlist(bd)).find((row) => row.id === queued.entryId)!
      await api.claimWaitlist(queued.entryId, (await entry()).version)
      await api.recordContact({
        entryId: queued.entryId,
        version: (await entry()).version,
        channel: "IN_PERSON",
        outcome: "ACCEPTED",
        offeredTableIds: ids,
      })
      const accepted = await entry()
      expect(accepted.status).toBe("HOLD_ACTIVE")
      const offerFloor = await api.getFloorState(clock.now(), bd)
      const offerGroup = offerFloor.groups.find((group) => group.tableIds.includes(ids[0]))!
      const reservationsBefore = await api.listReservations({ businessDate: bd })
      const visitsBefore = await api.listVisits(bd)
      await expect(
        api.seatWaitlist({ entryId: accepted.id, version: accepted.version - 1, guestCount: 4 }),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" })
      const assigned = await api.seatWaitlist({
        entryId: accepted.id,
        version: accepted.version,
        guestCount: 4,
        tableIds: linked ? ids : undefined,
      })
      expect(assigned.groupId).toBe(offerGroup.id)
      if (linked) expect(assigned.reservationId).toBe(linked.reservationId)
      const reservations = await api.listReservations({ businessDate: bd })
      expect(reservations).toHaveLength(reservationsBefore.length + (linked ? 0 : 1))
      const reservation = reservations.find((row) => row.id === assigned.reservationId)!
      expect(reservation).toMatchObject({ status: "BOOKED", tableIds: ids, visitId: null })
      expect(await api.listVisits(bd)).toEqual(visitsBefore)
      expect(await entry()).toMatchObject({
        status: "HOLD_ACTIVE",
        reservationId: reservation.id,
        claimedBy: null,
        claimExpiresAt: null,
      })
      const allocations = (await api.listAllocations(bd)).filter((row) => ids.includes(row.tableId) && !row.releasedAt)
      expect(allocations).toHaveLength(ids.length)
      expect(
        allocations.every(
          (row) => row.kind === "HOLD" && row.holdKind === "RESERVATION" && row.reservationId === reservation.id,
        ),
      ).toBe(true)
      await api.checkIn({ reservationId: reservation.id, version: reservation.version, guestCount: 4 })
      expect((await entry()).status).toBe("SEATED")
      const floor = await api.getFloorState(clock.now(), bd)
      expect(floor.groups.find((group) => group.id === assigned.groupId)?.tableIds).toEqual(ids)
      expect(floor.tables.filter((row) => ids.includes(row.tableId)).every((row) => row.state === "seated")).toBe(true)
      expect(
        (await api.listAllocations(bd)).filter((row) => ids.includes(row.tableId) && !row.releasedAt),
      ).toHaveLength(ids.length)
    },
  )

  it("retains an accepted offer on conflict and releases replaced tables without leaking allocations", async () => {
    const catalog = await api.getCatalog()
    const id = (code: string) => catalog.tables.find((table) => table.code === code)!.id
    const ids = [id("B5"), id("B7")]
    const queued = await api.addWaitlist({
      kind: "WALK_IN",
      contactName: "Replacement party",
      partySize: 2,
      channel: "IN_PERSON",
      preferenceMode: "ANY",
      preferences: [],
    })
    const entry = async () => (await api.listWaitlist(bd)).find((row) => row.id === queued.entryId)!
    await api.claimWaitlist(queued.entryId, (await entry()).version)
    await api.recordContact({
      entryId: queued.entryId,
      version: (await entry()).version,
      channel: "IN_PERSON",
      outcome: "ACCEPTED",
      offeredTableIds: ids,
    })
    const accepted = await entry()
    const before = await api.listAllocations(bd)
    const reservationsBefore = await api.listReservations({ businessDate: bd })
    await expect(
      api.seatWaitlist({
        entryId: accepted.id,
        version: accepted.version,
        guestCount: 2,
        tableIds: [ids[0], id("B3")],
      }),
    ).rejects.toMatchObject({ code: "TABLE_CONFLICT" })
    expect(await api.listAllocations(bd)).toEqual(before)
    expect(await api.listReservations({ businessDate: bd })).toEqual(reservationsBefore)
    expect(await entry()).toEqual(accepted)
    const assigned = await api.seatWaitlist({
      entryId: accepted.id,
      version: accepted.version,
      guestCount: 2,
      tableIds: [ids[0]],
    })
    expect(assigned.groupId).toBeNull()
    const floor = await api.getFloorState(clock.now(), bd)
    expect(floor.tables.find((row) => row.tableId === ids[0])).toMatchObject({
      state: "reserved",
      claim: { reservationId: assigned.reservationId },
    })
    expect(floor.tables.find((row) => row.tableId === ids[1])).toMatchObject({ state: "free", claim: null })
    expect(floor.groups.some((row) => row.tableIds.some((tableId) => ids.includes(tableId)))).toBe(false)
    const active = (await api.listAllocations(bd)).filter((row) => ids.includes(row.tableId) && !row.releasedAt)
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ tableId: ids[0], holdKind: "RESERVATION", reservationId: assigned.reservationId })
  })

  it("rejects reception-window changes while allowing legacy times to remain unchanged", async () => {
    await expect(
      api.createReservation({
        contactName: "Outside window",
        partySize: 2,
        expectedAt: atBusinessTime(bd, "01:30"),
        sourceCode: "HOTLINE",
      }),
    ).rejects.toMatchObject({ code: "EXPECTED_AT_OUTSIDE_BOOKING_WINDOW" })
    const created = await api.createReservation({
      contactName: "Allowed",
      partySize: 2,
      expectedAt: atBusinessTime(bd, "00:30"),
      sourceCode: "HOTLINE",
    })
    const row = (await api.listReservations({ businessDate: bd })).find((r) => r.id === created.reservationId)!
    await expect(
      api.updateReservation({ id: row.id, version: row.version, expectedAt: atBusinessTime(bd, "01:30") }),
    ).rejects.toMatchObject({ code: "EXPECTED_AT_OUTSIDE_BOOKING_WINDOW" })
    expect((await api.listReservations({ businessDate: bd })).find((r) => r.id === row.id)?.expectedAt).toEqual(
      row.expectedAt,
    )
  })

  it("derives every live state from the seed", async () => {
    const floor = await api.getFloorState(clock.now())
    const cat = await api.getCatalog()
    const stateOf = (code: string) =>
      floor.tables.find((t) => t.tableId === cat.tables.find((x) => x.code === code)!.id)!.state
    expect(stateOf("A3")).toBe("seated")
    expect(stateOf("B3")).toBe("late")
    expect(stateOf("A6")).toBe("noshow")
    expect(stateOf("A5")).toBe("reserved")
    expect(stateOf("A4")).toBe("hold")
    expect(stateOf("A1")).toBe("hold_overdue")
    expect(stateOf("A10")).toBe("spare")
    expect(stateOf("BAR21")).toBe("oos")
    expect(stateOf("B5")).toBe("free")
    // Distinct symbols for concurrent groups
    const symbols = floor.groups.map((g) => g.symbolNo)
    expect(new Set(symbols).size).toBe(symbols.length)
  })

  it("does not mix an allocation into the next business date and keeps history queryable", async () => {
    const catalog = await api.getCatalog()
    const tableId = catalog.tables.find((table) => table.code === "B5")!.id
    const otherId = catalog.tables.find((table) => table.code === "B7")!.id
    await api.seatWalkIn({ tableIds: [tableId, otherId], guestCount: 2 })
    const current = await api.getFloorState(clock.now(), bd)
    const group = current.groups.find((row) => row.tableIds.includes(tableId))!
    const nextBusinessDate = addDays(bd, 1)
    const next = await api.getFloorState(atBusinessTime(nextBusinessDate, "19:00"), nextBusinessDate)
    const history = await api.getFloorState(clock.now(), bd)
    expect(current.tables.find((table) => table.tableId === tableId)?.state).toBe("seated")
    expect(next.tables.find((table) => table.tableId === tableId)?.state).toBe("free")
    expect(next.tables.find((table) => table.tableId === otherId)).toMatchObject({
      state: "free",
      staleFromPreviousDay: false,
      claim: null,
    })
    expect(next.groups.some((row) => row.id === group.id)).toBe(false)
    expect(history.tables.find((table) => table.tableId === tableId)?.state).toBe("seated")
  })

  it("auto-closes grouped visits at the cutoff while preserving history and selected-date isolation", async () => {
    const catalog = await api.getCatalog()
    const ids = ["B5", "B7"].map((code) => catalog.tables.find((table) => table.code === code)!.id)
    const seated = await api.seatWalkIn({ tableIds: ids, guestCount: 4 })
    const original = await api.getFloorState(clock.now(), bd)
    const group = original.groups.find((row) => row.tableIds.includes(ids[0]))!
    const visit = (await api.listVisits(bd)).find((row) => row.id === seated.visitId)!
    const cutoff = atBusinessTime(bd, "05:00")
    const observed = vi.spyOn(clock, "now").mockReturnValue(new Date(cutoff.getTime() - 1))
    try {
      clock.advance(0)
      expect((await api.getFloorState(clock.now(), bd)).groups.find((row) => row.id === group.id)).toEqual(group)
      expect((await api.listVisits(bd)).find((row) => row.id === visit.id)?.endedAt).toBeNull()
      observed.mockReturnValue(cutoff)
      clock.advance(0)
      const nextDate = addDays(bd, 1)
      const floor = await api.getFloorState(clock.now(), nextDate)
      expect(floor.tables.filter((row) => ids.includes(row.tableId))).toEqual(
        expect.arrayContaining(
          ids.map((tableId) => ({ tableId, state: "free", staleFromPreviousDay: false, claim: null })),
        ),
      )
      expect(floor.groups.some((row) => row.id === group.id)).toBe(false)
      const closed = (await api.listVisits(bd)).find((row) => row.id === visit.id)!
      expect(closed).toMatchObject({ endedAt: cutoff, endReason: "BUSINESS_DAY_END", version: visit.version + 1 })
      expect((await api.listVisits(nextDate)).some((row) => row.id === visit.id)).toBe(false)
      expect(
        (await api.listReservations({ businessDate: nextDate })).every((row) => row.businessDate === nextDate),
      ).toBe(true)
      expect((await api.listWaitlist(nextDate)).every((row) => row.businessDate === nextDate)).toBe(true)
      const allocations = (await api.listAllocations(bd)).filter((row) => row.visitId === visit.id)
      expect(allocations).toHaveLength(2)
      expect(
        allocations.every(
          (row) => row.releasedAt?.getTime() === cutoff.getTime() && row.releaseReason === "BUSINESS_DAY_END",
        ),
      ).toBe(true)
      const operations = (await api.listOperations(100)).filter(
        (row) => row.action === "VISIT_AUTO_CLOSED_BUSINESS_DAY",
      )
      expect(operations.find((row) => row.entityId === visit.id)).toMatchObject({
        actorKind: "SYSTEM",
        actorName: "H\u1ec7 th\u1ed1ng",
        isUndoable: false,
      })
      clock.advance(0)
      expect((await api.listOperations(100)).filter((row) => row.action === "VISIT_AUTO_CLOSED_BUSINESS_DAY")).toEqual(
        operations,
      )
      await expect(api.endVisit(visit.id, visit.version)).rejects.toMatchObject({ code: "VERSION_CONFLICT" })
      await expect(api.undo(operations.find((row) => row.entityId === visit.id)!.id)).rejects.toMatchObject({
        code: "NOT_UNDOABLE",
      })
    } finally {
      observed.mockRestore()
    }
  })

  it("retains carry-over claims and groups when the business-day worker is disabled", async () => {
    const disabled = new MockGamApi({ businessDayWorkerEnabled: false })
    const catalog = await disabled.getCatalog()
    const ids = ["B5", "B7"].map((code) => catalog.tables.find((table) => table.code === code)!.id)
    const seated = await disabled.seatWalkIn({ tableIds: ids, guestCount: 2 })
    const original = await disabled.getFloorState(clock.now(), bd)
    const group = original.groups.find((row) => row.tableIds.includes(ids[0]))!
    const next = addDays(bd, 1)
    const preview = await disabled.getFloorState(atBusinessTime(next, "19:00"), next)
    expect(preview.tables.filter((row) => ids.includes(row.tableId)).every((row) => row.claim === null)).toBe(true)
    clock.advance(24 * 60)
    const floor = await disabled.getFloorState(clock.now(), next)
    for (const id of ids) {
      expect(floor.tables.find((row) => row.tableId === id)).toMatchObject({
        state: "seated",
        staleFromPreviousDay: true,
        claim: { visitId: seated.visitId, groupId: group.id, tableIds: ids },
      })
    }
    expect(floor.groups.find((row) => row.id === group.id)).toEqual(group)
    expect((await disabled.listVisits(bd)).find((row) => row.id === seated.visitId)?.endedAt).toBeNull()
    const claim = floor.tables.find((row) => row.tableId === ids[0])!.claim!
    await disabled.endVisit(seated.visitId, claim.version!)
    const closed = await disabled.getFloorState(clock.now(), next)
    expect(closed.tables.filter((row) => ids.includes(row.tableId)).every((row) => row.claim === null)).toBe(true)
    expect(closed.groups.some((row) => row.id === group.id)).toBe(false)
  })

  it("preserves checked-in reservations and seated waitlist history on automatic close", async () => {
    const table = (await api.getCatalog()).tables.find((row) => row.code === "B5")!
    const queued = await api.addWaitlist({
      kind: "WALK_IN",
      contactName: "Closing history",
      partySize: 2,
      channel: "IN_PERSON",
      preferenceMode: "ANY",
      preferences: [],
    })
    const entry = (await api.listWaitlist(bd)).find((row) => row.id === queued.entryId)!
    const held = await api.seatWaitlist({
      entryId: entry.id,
      version: entry.version,
      guestCount: 2,
      tableIds: [table.id],
    })
    const reservation = (await api.listReservations({ businessDate: bd })).find((row) => row.id === held.reservationId)!
    await api.checkIn({ reservationId: reservation.id, version: reservation.version, guestCount: 2 })
    const before = (await api.listReservations({ businessDate: bd })).find((row) => row.id === reservation.id)!
    const seated = (await api.listWaitlist(bd)).find((row) => row.id === entry.id)!
    expect(before.status).toBe("CHECKED_IN")
    expect(seated.status).toBe("SEATED")
    clock.advance(24 * 60)
    expect((await api.listReservations({ businessDate: bd })).find((row) => row.id === before.id)).toMatchObject({
      id: before.id,
      version: before.version,
      status: "CHECKED_IN",
      checkedInAt: before.checkedInAt,
      visitId: before.visitId,
      tableIds: [],
    })
    expect((await api.listWaitlist(bd)).find((row) => row.id === entry.id)).toEqual(seated)
    expect((await api.listVisits(bd)).find((row) => row.id === before.visitId)?.endReason).toBe("BUSINESS_DAY_END")
    expect((await api.getFloorState(clock.now())).tables.find((row) => row.tableId === table.id)?.claim).toBeNull()
  })

  it("never auto-cancels after the 30' warning", async () => {
    clock.advance(120)
    const list = await api.listReservations({ businessDate: bd })
    const stillBooked = list.filter((r) => r.status === "BOOKED" && r.warning === "noshow")
    expect(stillBooked.length).toBeGreaterThan(0)
    expect(list.some((r) => r.status === "NO_SHOW")).toBe(false)
    clock.resetToScenario()
  })

  it("availability for tomorrow ignores tonight's occupancy", async () => {
    const cat = await api.getCatalog()
    const a3 = cat.tables.find((t) => t.code === "A3")!.id
    const b3 = cat.tables.find((t) => t.code === "B3")!.id
    const tonight = await api.getAvailability(atBusinessTime(bd, "23:00"), 2)
    expect(tonight.tables.find((t) => t.tableId === a3)!.status).toBe("occupied_unknown_end")
    const tomorrow = await api.getAvailability(atBusinessTime(addDays(bd, 1), "19:00"), 2)
    expect(tomorrow.tables.find((t) => t.tableId === a3)!.status).toBe("available")
    expect(tomorrow.tables.find((t) => t.tableId === b3)!.status).toBe("reserved")
  })

  it("requires a name or phone for advance bookings", async () => {
    await expectApiError(
      api.createReservation({ partySize: 2, expectedAt: atBusinessTime(bd, "23:30"), sourceCode: "HOTLINE" }),
      "VALIDATION_FAILED",
    )
  })

  it("rejects phone numbers inside notes", async () => {
    await expectApiError(
      api.createReservation({
        contactName: "Khách test",
        partySize: 2,
        expectedAt: atBusinessTime(bd, "23:30"),
        sourceCode: "HOTLINE",
        note: "gọi 0901234567",
      }),
      "VALIDATION_FAILED",
    )
  })

  it("never returns the raw phone to the receptionist", async () => {
    const res = await api.createReservation({
      contactName: "Khách test",
      phone: "0901234567",
      partySize: 2,
      expectedAt: atBusinessTime(bd, "23:30"),
      sourceCode: "HOTLINE",
    })
    const list = await api.listReservations({ businessDate: bd })
    const created = list.find((r) => r.id === res.reservationId)!
    expect(JSON.stringify(created)).not.toContain("901234567")
    expect(created.phoneLast3).toBe("567")
    const customers = await api.searchCustomers("567")
    expect(JSON.stringify(customers)).not.toContain("0901234567")
    await expectApiError(api.revealPhone(customers[0].id, "CALLBACK", {}), "PERMISSION_DENIED")
    api.setSession(owner)
    const reveal = await api.revealPhone(customers[0].id, "CALLBACK", {})
    expect(reveal.phoneE164).toBe("+84901234567")
  })

  it("blocks a walk-in on a table held for a later booking (SEQUENTIAL)", async () => {
    const cat = await api.getCatalog()
    const b4 = cat.tables.find((t) => t.code === "B4")!.id
    await expectApiError(api.seatWalkIn({ tableIds: [b4], guestCount: 2 }), "TABLE_CONFLICT")
  })

  it("needs owner override for spare tables", async () => {
    const cat = await api.getCatalog()
    const a10 = cat.tables.find((t) => t.code === "A10")!.id
    await expectApiError(api.seatWalkIn({ tableIds: [a10], guestCount: 2 }), "PERMISSION_DENIED")
    api.setSession(owner)
    await expectApiError(api.seatWalkIn({ tableIds: [a10], guestCount: 2 }), "OVERRIDE_REQUIRED")
    const ok = await api.seatWalkIn({ tableIds: [a10], guestCount: 2, overrideReason: "Cuối tuần đông" })
    expect(ok.visitId).toBeGreaterThan(0)
  })

  it("check-in converts the hold into usage and keeps history", async () => {
    const list = await api.listReservations({ businessDate: bd })
    const r = list.find((x) => x.status === "BOOKED" && x.tableIds.length === 1 && x.warning === null)!
    await api.checkIn({ reservationId: r.id, version: r.version, guestCount: r.partySize })
    const after = (await api.listReservations({ businessDate: bd })).find((x) => x.id === r.id)!
    expect(after.status).toBe("CHECKED_IN")
    const floor = await api.getFloorState(clock.now())
    expect(floor.tables.find((t) => t.tableId === r.tableIds[0])!.state).toBe("seated")
  })

  it("combine assigns the smallest free symbol and split releases detached tables", async () => {
    const cat = await api.getCatalog()
    const id = (code: string) => cat.tables.find((t) => t.code === code)!.id
    const walk = await api.seatWalkIn({ tableIds: [id("B5")], guestCount: 4 })
    await api.combineTables({ claim: { visitId: walk.visitId }, addTableIds: [id("B7")] })
    let floor = await api.getFloorState(clock.now())
    const group = floor.groups.find((g) => g.tableIds.includes(id("B5")))!
    expect(group.tableIds.sort()).toEqual([id("B5"), id("B7")].sort())
    expect(floor.groups.filter((g) => g.symbolNo === group.symbolNo)).toHaveLength(1)
    await api.splitGroup({ groupId: group.id, keepTableIds: [id("B5")] })
    floor = await api.getFloorState(clock.now())
    expect(floor.tables.find((t) => t.tableId === id("B7"))!.state).toBe("free")
    expect(floor.tables.find((t) => t.tableId === id("B5"))!.state).toBe("seated")
  })

  it("undo is blocked when another device changed the data", async () => {
    const cat = await api.getCatalog()
    const b5 = cat.tables.find((t) => t.code === "B5")!.id
    const walk = await api.seatWalkIn({ tableIds: [b5], guestCount: 2 })
    const msg = await api.simulateRemoteActivity()
    expect(msg).toContain("iPad cửa")
    await expectApiError(api.undo(walk.operationId!), "UNDO_CONFLICT_MODIFIED")
  })

  it("undo and redo round-trip", async () => {
    const cat = await api.getCatalog()
    const b5 = cat.tables.find((t) => t.code === "B5")!.id
    const walk = await api.seatWalkIn({ tableIds: [b5], guestCount: 2 })
    const undo = await api.undo(walk.operationId!)
    let floor = await api.getFloorState(clock.now())
    expect(floor.tables.find((t) => t.tableId === b5)!.state).toBe("free")
    await api.redo(undo.operationId!)
    floor = await api.getFloorState(clock.now())
    expect(floor.tables.find((t) => t.tableId === b5)!.state).toBe("seated")
  })

  it("no-show confirmation only after 30 minutes", async () => {
    const list = await api.listReservations({ businessDate: bd })
    const notYet = list.find((r) => r.status === "BOOKED" && r.warning === "late")!
    await expectApiError(api.markNoShow(notYet.id, notYet.version), "INVALID_STATE")
    const ready = list.find((r) => r.status === "BOOKED" && r.warning === "noshow")!
    await api.markNoShow(ready.id, ready.version)
  })

  it("waitlist claim is exclusive per lease", async () => {
    const entries = await api.listWaitlist(bd)
    const claimedByOther = entries.find((e) => e.status === "CONTACTING")!
    await expectApiError(api.claimWaitlist(claimedByOther.id, claimedByOther.version), "ENTRY_ALREADY_CLAIMED")
    const waiting = entries.find((e) => e.status === "WAITING" && e.kind === "WALK_IN")!
    await api.claimWaitlist(waiting.id, waiting.version)
  })

  it("reports count one visit per party across several tables", async () => {
    api.setSession(owner)
    const r = await api.getReport({ from: addDays(bd, -30), to: addDays(bd, -1), zone: "ALL" })
    expect(r.visits).toBeGreaterThan(0)
    expect(r.tableTurns).toBeGreaterThanOrEqual(r.visits)
    const sumGuests = r.byDate.reduce((s, d) => s + d.guests, 0)
    expect(sumGuests).toBe(r.guests)
  })
})

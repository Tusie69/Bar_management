import { beforeEach, describe, expect, it } from "vitest"
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
    await api.seatWalkIn({ tableIds: [tableId], guestCount: 2 })
    const current = await api.getFloorState(clock.now(), bd)
    const nextBusinessDate = addDays(bd, 1)
    const next = await api.getFloorState(atBusinessTime(nextBusinessDate, "19:00"), nextBusinessDate)
    const history = await api.getFloorState(clock.now(), bd)
    expect(current.tables.find((table) => table.tableId === tableId)?.state).toBe("seated")
    expect(next.tables.find((table) => table.tableId === tableId)?.state).toBe("free")
    expect(history.tables.find((table) => table.tableId === tableId)?.state).toBe("seated")
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

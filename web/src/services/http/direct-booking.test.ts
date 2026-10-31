import { describe, expect, it, vi } from "vitest"
import type { BookingWriteFields, HttpBooking } from "./booking-adapter"
import type { TableView } from "@/domain/models"
import { createAndAssignDirectBooking, directBookingSelection } from "./direct-booking"

const fields: BookingWriteFields = {
  guestName: "Khách layout",
  partySize: 2,
  expectedAt: new Date("2030-10-24T12:00:00Z"),
  businessDate: "2030-10-24",
  sourceCode: "HOTLINE",
}
const created: HttpBooking = {
  id: 71,
  guestName: fields.guestName,
  phoneLast3: null,
  partySize: fields.partySize,
  expectedAt: fields.expectedAt,
  businessDate: fields.businessDate,
  classification: "UNCLASSIFIED",
  status: "BOOKED",
  source: "Hotline",
  sourceCode: fields.sourceCode,
  tableCodes: [],
  note: null,
  version: 1,
  displayStatus: "UPCOMING",
  minutesLate: 0,
  autoNoShowDue: false,
}

describe("direct layout booking flow", () => {
  const table = (id: number, code: string, zoneId: number, kind: TableView["kind"] = "BAR_SEAT"): TableView => ({
    id,
    version: 1,
    code,
    displayName: code,
    zoneId,
    zoneCode: "BAR",
    kind,
    capacity: kind === "BAR_SEAT" ? 1 : 4,
    seqNo: kind === "BAR_SEAT" ? id : null,
    isSpare: false,
    status: "ACTIVE",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
  })

  it("requires another compatible Bar seat for a two-person direct booking", () => {
    const bar11 = table(11, "BAR11", 4)
    const bar12 = table(12, "BAR12", 4)
    const otherZone = table(13, "BAR13", 5)
    const regularTable = table(14, "A1", 4, "TABLE")
    const states = [bar11, bar12, otherZone, regularTable].map(({ id, code }) => ({
      id, code, state: "AVAILABLE" as const, isSpare: false,
    }))
    const oneSeat = directBookingSelection([bar11, bar12, otherZone, regularTable], states, bar12, [bar12.id])
    expect(oneSeat.capacity).toBe(1)
    expect(oneSeat.compatibleTables.map(({ code }) => code)).toEqual(["BAR11", "BAR12"])
    const pair = directBookingSelection([bar11, bar12, otherZone, regularTable], states, bar12, [bar12.id, bar11.id])
    expect(pair.capacity).toBe(2)
    expect(pair.allAvailable).toBe(true)
  })

  it("does not treat a reserved selected seat as available", () => {
    const bar12 = table(12, "BAR12", 4)
    const selection = directBookingSelection(
      [bar12],
      [{ id: 12, code: "BAR12", state: "RESERVED", isSpare: false }],
      bar12,
      [12],
    )
    expect(selection.allAvailable).toBe(false)
  })

  it("creates and assigns through exactly one atomic request", async () => {
    const api = {
      createAndAssign: vi.fn(async () => ({ ...created, tableCodes: ["A7", "A8"] })),
    }
    const result = await createAndAssignDirectBooking(api, fields, [7, 8])
    expect(api.createAndAssign).toHaveBeenCalledOnce()
    expect(api.createAndAssign).toHaveBeenCalledWith(fields, [7, 8])
    expect(result.tableCodes).toEqual(["A7", "A8"])
  })

  it("propagates an atomic failure without issuing a fallback create", async () => {
    const conflict = new Error("TABLE_CONFLICT")
    const api = {
      createAndAssign: vi.fn(async () => {
        throw conflict
      }),
    }
    await expect(createAndAssignDirectBooking(api, fields, [7])).rejects.toBe(conflict)
    expect(api.createAndAssign).toHaveBeenCalledOnce()
  })
})

import { describe, expect, it, vi } from "vitest"
import type { BookingWriteFields, HttpBooking } from "./booking-adapter"
import { createAndAssignDirectBooking } from "./direct-booking"

const fields: BookingWriteFields = {
  guestName: "Khách layout",
  partySize: 2,
  expectedAt: new Date("2030-10-24T12:00:00Z"),
  businessDate: "2030-10-24",
  sourceCode: "HOTLINE",
}
const created: HttpBooking = {
  id: 71,
  guestName: "Khách layout",
  phoneLast3: null,
  partySize: fields.partySize,
  expectedAt: fields.expectedAt,
  businessDate: fields.businessDate,
  classification: "UNCLASSIFIED",
  guestType: null,
  isBirthday: false,
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
  it("creates and assigns through exactly one atomic request", async () => {
    const api = {
      createAndAssign: vi.fn(async () => ({ ...created, tableCodes: ["A7", "A8"] })),
    }
    const result = await createAndAssignDirectBooking(api, fields, [7, 8], "form-key-0001")
    expect(api.createAndAssign).toHaveBeenCalledOnce()
    expect(api.createAndAssign).toHaveBeenCalledWith(fields, [7, 8], "form-key-0001")
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

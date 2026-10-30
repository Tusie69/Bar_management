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
  it("assigns only after create succeeds and returns the authoritative booking", async () => {
    const api = {
      create: vi.fn(async () => created),
      assign: vi.fn(async () => ({ ...created, tableCodes: ["A7"], version: 2 })),
    }
    const result = await createAndAssignDirectBooking(api, fields, 7)
    expect(api.assign).toHaveBeenCalledWith(created, [7])
    expect(result).toMatchObject({ outcome: "assigned", booking: { tableCodes: ["A7"], version: 2 } })
  })

  it("preserves the created booking when assignment fails without retrying or cancelling", async () => {
    const conflict = new Error("TABLE_CONFLICT")
    const api = {
      create: vi.fn(async () => created),
      assign: vi.fn(async () => {
        throw conflict
      }),
    }
    const result = await createAndAssignDirectBooking(api, fields, 7)
    expect(result).toEqual({ outcome: "created-unassigned", booking: created, assignmentError: conflict })
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.assign).toHaveBeenCalledTimes(1)
  })

  it("does not attempt assignment when create fails", async () => {
    const api = {
      create: vi.fn(async () => {
        throw new Error("CREATE_FAILED")
      }),
      assign: vi.fn(),
    }
    await expect(createAndAssignDirectBooking(api, fields, 7)).rejects.toThrow("CREATE_FAILED")
    expect(api.assign).not.toHaveBeenCalled()
  })
})

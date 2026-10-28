import { describe, expect, it } from "vitest"
import { ApiError } from "../contracts"
import {
  cancelBookingPayload,
  createBookingPayload,
  fullUpdateBookingPayload,
  mapBooking,
  type BackendBookingPayload,
} from "./booking-adapter"

const backendBooking = (patch: Partial<BackendBookingPayload> = {}): BackendBookingPayload => ({
  id: 42,
  guestName: "Khách backend",
  phoneLast3: "789",
  partySize: 4,
  expectedAt: new Date("2030-10-24T14:00:00.000Z"),
  businessDate: "2030-10-24",
  status: "BOOKED",
  source: "Hotline",
  sourceCode: "HOTLINE",
  tableCodes: ["A1"],
  note: "Ghi chú gốc",
  version: 3,
  displayStatus: "UPCOMING",
  minutesLate: 0,
  autoNoShowDue: false,
  ...patch,
})

describe("booking contract adapter", () => {
  it("maps only fields present in the backend booking view", () => {
    const result = mapBooking(backendBooking())
    expect(result).toMatchObject({ id: 42, guestName: "Khách backend", tableCodes: ["A1"], version: 3 })
    expect(result.expectedAt).toBeInstanceOf(Date)
    expect(result).not.toHaveProperty("customerId")
    expect(result).not.toHaveProperty("holdId")
  })

  it("rejects unknown backend status instead of inventing a mapping", () => {
    expect(() => mapBooking(backendBooking({ status: "PENDING_APPROVAL" }))).toThrowError(ApiError)
  })

  it("builds the supported create payload without phone or table assignment", () => {
    expect(
      createBookingPayload({
        guestName: "  Anh Minh  ",
        partySize: 3,
        expectedAt: new Date("2030-10-24T14:30:00.000Z"),
        businessDate: "2030-10-24",
        sourceCode: "HOTLINE",
        note: "  Sinh nhật  ",
      }),
    ).toEqual({
      guestName: "Anh Minh",
      partySize: 3,
      expectedAt: "2030-10-24T21:30:00+07:00",
      businessDate: "2030-10-24",
      sourceCode: "HOTLINE",
      note: "Sinh nhật",
    })
  })

  it("builds a full update and preserves fields the edit did not change", () => {
    const current = mapBooking(backendBooking())
    expect(fullUpdateBookingPayload(current, { partySize: 5 })).toEqual({
      guestName: "Khách backend",
      partySize: 5,
      expectedAt: "2030-10-24T21:00:00+07:00",
      businessDate: "2030-10-24",
      sourceCode: "HOTLINE",
      note: "Ghi chú gốc",
      version: 3,
    })
  })

  it("sends only version and the backend-supported reasonNote when cancelling", () => {
    expect(cancelBookingPayload(3, "  Khách gọi hủy  ")).toEqual({ version: 3, reasonNote: "Khách gọi hủy" })
  })
})

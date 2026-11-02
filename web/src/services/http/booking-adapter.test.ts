import { describe, expect, it } from "vitest"
import { ApiError } from "../contracts"
import {
  assignmentPayload,
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
  classification: "UNCLASSIFIED",
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
  it("preserves NA-14 metadata and leaves late confirmation out of edit requests", () => {
    const confirmedAt = new Date("2030-10-24T14:05:00.123Z")
    const current = mapBooking(
      backendBooking({
        classification: "RETURNING",
        guestType: "REGULAR",
        isBirthday: true,
        lateConfirmedAt: confirmedAt,
      }),
    )
    expect(current).toMatchObject({ guestType: "REGULAR", isBirthday: true, lateConfirmedAt: confirmedAt })
    const unchanged = fullUpdateBookingPayload(current, { partySize: 6 })
    expect(unchanged).toMatchObject({ classification: "RETURNING", isBirthday: true })
    expect(unchanged).not.toHaveProperty("lateConfirmedAt")
    expect(fullUpdateBookingPayload(current, { guestType: "NEW", isBirthday: false })).toMatchObject({
      guestType: "NEW",
      isBirthday: false,
    })
    expect(fullUpdateBookingPayload(current, { guestType: "NEW" })).not.toHaveProperty("classification")
    expect(() => mapBooking(backendBooking({ classification: "RETURNING", guestType: "NEW" }))).toThrowError(ApiError)
    expect(() => mapBooking(backendBooking({ lateConfirmedAt: new Date("invalid") }))).toThrowError(ApiError)
  })
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

  it("builds create phone input without adding table assignment", () => {
    expect(
      createBookingPayload({
        guestName: "  Anh Minh  ",
        partySize: 3,
        expectedAt: new Date("2030-10-24T14:30:00.000Z"),
        businessDate: "2030-10-24",
        sourceCode: "HOTLINE",
        classification: "RETURNING",
        note: "  Sinh nhật  ",
        phoneNumber: " 0987 654 321 ",
      }),
    ).toEqual({
      guestName: "Anh Minh",
      partySize: 3,
      expectedAt: "2030-10-24T21:30:00+07:00",
      businessDate: "2030-10-24",
      sourceCode: "HOTLINE",
      classification: "RETURNING",
      note: "Sinh nhật",
      phoneNumber: "0987 654 321",
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
      classification: "UNCLASSIFIED",
      isBirthday: false,
      version: 3,
    })
  })

  it.each(["+84987654321", "0084987654321", "1234567890", "09876543210"])(
    "rejects invalid booking phone input %s",
    (phoneNumber) => {
      expect(() =>
        createBookingPayload({
          guestName: "Anh Minh",
          partySize: 3,
          expectedAt: new Date("2030-10-24T14:30:00.000Z"),
          businessDate: "2030-10-24",
          sourceCode: "HOTLINE",
          phoneNumber,
        }),
      ).toThrowError(ApiError)
    },
  )

  it("distinguishes omitted phone from an explicit delete", () => {
    const current = mapBooking(backendBooking())
    expect(fullUpdateBookingPayload(current, { partySize: 5 })).not.toHaveProperty("phoneNumber")
    expect(fullUpdateBookingPayload(current, { phoneNumber: null })).toMatchObject({ phoneNumber: null })
  })

  it("does not write a redacted historical note unless the user intentionally changes it", () => {
    const current = mapBooking(backendBooking({ note: "Gọi •••• ••• 321" }))
    expect(fullUpdateBookingPayload(current, { partySize: 5 })).not.toHaveProperty("note")
    expect(fullUpdateBookingPayload(current, { note: "Ghi chú mới" })).toMatchObject({ note: "Ghi chú mới" })
    expect(fullUpdateBookingPayload(current, { note: null })).not.toHaveProperty("note")
    expect(fullUpdateBookingPayload(current, { note: "" })).toMatchObject({ note: "" })
  })

  it("sends only version and the backend-supported reasonNote when cancelling", () => {
    expect(cancelBookingPayload(3, "  Khách gọi hủy  ")).toEqual({ version: 3, reasonNote: "Khách gọi hủy" })
  })

  it("builds the assign payload with version and unique table IDs", () => {
    expect(assignmentPayload(3, [12, 12, 14])).toEqual({ version: 3, tableIds: [12, 14] })
    expect(() => assignmentPayload(3, [])).toThrowError(ApiError)
  })
})

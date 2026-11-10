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
  it("maps only fields present in the backend booking view", () => {
    const result = mapBooking(backendBooking({ socialPlatform: "FB" }))
    expect(result).toMatchObject({ id: 42, guestName: "Khách backend", tableCodes: ["A1"], version: 3, socialPlatform: "FB" })
    expect(result.expectedAt).toBeInstanceOf(Date)
    expect(result).not.toHaveProperty("customerId")
    expect(result).not.toHaveProperty("holdId")
  })

  it("includes socialPlatform only when sourceCode is SOCIAL", () => {
    const socialPayload = createBookingPayload({
      guestName: "Khách Social",
      partySize: 2,
      expectedAt: new Date("2030-10-24T14:30:00.000Z"),
      businessDate: "2030-10-24",
      sourceCode: "SOCIAL",
      socialPlatform: "IG",
    })
    expect(socialPayload).toMatchObject({ sourceCode: "SOCIAL", socialPlatform: "IG" })

    const hotlinePayload = createBookingPayload({
      guestName: "Khách Hotline",
      partySize: 2,
      expectedAt: new Date("2030-10-24T14:30:00.000Z"),
      businessDate: "2030-10-24",
      sourceCode: "HOTLINE",
      socialPlatform: "FB",
    })
    expect(hotlinePayload).not.toHaveProperty("socialPlatform")

    const noPlatformSocial = createBookingPayload({
      guestName: "Khách Social",
      partySize: 2,
      expectedAt: new Date("2030-10-24T14:30:00.000Z"),
      businessDate: "2030-10-24",
      sourceCode: "SOCIAL",
    })
    expect(noPlatformSocial).not.toHaveProperty("socialPlatform")
  })

  it("updates socialPlatform in fullUpdateBookingPayload only when source is SOCIAL", () => {
    const current = mapBooking(backendBooking({ sourceCode: "SOCIAL", socialPlatform: "FB" }))
    const updated = fullUpdateBookingPayload(current, { socialPlatform: "TIKTOK" })
    expect(updated).toMatchObject({ sourceCode: "SOCIAL", socialPlatform: "TIKTOK" })

    const switchedToHotline = fullUpdateBookingPayload(current, { sourceCode: "HOTLINE", socialPlatform: "FB" })
    expect(switchedToHotline).toMatchObject({ sourceCode: "HOTLINE" })
    expect(switchedToHotline).not.toHaveProperty("socialPlatform")
  })

  it("handles iconKeys in create, update, and mapBooking", () => {
    const created = createBookingPayload({
      guestName: "Khách VIP",
      partySize: 4,
      expectedAt: new Date("2030-10-24T14:30:00.000Z"),
      businessDate: "2030-10-24",
      sourceCode: "HOTLINE",
      iconKeys: ["star", "pin"],
    })
    expect(created).toMatchObject({ iconKeys: ["star", "pin"] })

    const createdEmpty = createBookingPayload({
      guestName: "Khách thường",
      partySize: 4,
      expectedAt: new Date("2030-10-24T14:30:00.000Z"),
      businessDate: "2030-10-24",
      sourceCode: "HOTLINE",
      iconKeys: [],
    })
    expect(createdEmpty).not.toHaveProperty("iconKeys")

    const current = mapBooking(backendBooking({ iconKeys: ["star"] }))
    expect(current.iconKeys).toEqual(["star"])

    const updated = fullUpdateBookingPayload(current, { iconKeys: ["pin"] })
    expect(updated).toMatchObject({ iconKeys: ["pin"] })

    // Clearing all icons on update must send iconKeys: [] when capability is on
    const cleared = fullUpdateBookingPayload(current, { iconKeys: [] })
    expect(cleared.iconKeys).toEqual([])

    // When capability is off, iconKeys is omitted
    const unsupported = fullUpdateBookingPayload(current, { iconKeys: [] }, { iconKeysSupported: false })
    expect(unsupported).not.toHaveProperty("iconKeys")
  })

  it("handles honorific in create, update, and mapBooking", () => {
    const createdWithMr = createBookingPayload({
      guestName: "Nam",
      partySize: 2,
      expectedAt: new Date("2030-10-24T14:30:00.000Z"),
      businessDate: "2030-10-24",
      sourceCode: "HOTLINE",
      honorific: "MR",
    })
    expect(createdWithMr).toMatchObject({ honorific: "MR" })

    const createdWithoutHonorific = createBookingPayload({
      guestName: "Nam",
      partySize: 2,
      expectedAt: new Date("2030-10-24T14:30:00.000Z"),
      businessDate: "2030-10-24",
      sourceCode: "HOTLINE",
    })
    expect(createdWithoutHonorific).not.toHaveProperty("honorific")

    const mapped = mapBooking(backendBooking({ honorific: "MS" }))
    expect(mapped.honorific).toBe("MS")

    const mappedNull = mapBooking(backendBooking({ honorific: null }))
    expect(mappedNull.honorific).toBeNull()

    expect(() => mapBooking(backendBooking({ honorific: "INVALID" as unknown as "MR" }))).toThrowError(ApiError)

    const current = mapBooking(backendBooking({ honorific: "MR" }))
    const updatedToMs = fullUpdateBookingPayload(current, { honorific: "MS" })
    expect(updatedToMs.honorific).toBe("MS")

    // On update, send null when cleared
    const clearedHonorific = fullUpdateBookingPayload(current, { honorific: null })
    expect(clearedHonorific.honorific).toBeNull()

    // When not edited, preserve existing honorific
    const preserved = fullUpdateBookingPayload(current, { partySize: 3 })
    expect(preserved.honorific).toBe("MR")
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
      guestType: null,
      isBirthday: false,
      iconKeys: [],
      honorific: null,
      version: 3,
    })
  })

  it.each(["+84987654321", "0084987654321", "1234567890", "09876543210"])(
    "rejects invalid booking phone input %s",
    (phoneNumber) => {
      expect(() => createBookingPayload({
        guestName: "Anh Minh",
        partySize: 3,
        expectedAt: new Date("2030-10-24T14:30:00.000Z"),
        businessDate: "2030-10-24",
        sourceCode: "HOTLINE",
        phoneNumber,
      })).toThrowError(ApiError)
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

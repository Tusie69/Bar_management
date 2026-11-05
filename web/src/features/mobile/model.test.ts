import { describe, expect, it } from "vitest"
import type { ReservationView } from "@/domain/models"
import { chipOf, toneOf } from "./model"

const createReservation = (patch: Partial<ReservationView>): ReservationView =>
  ({
    id: 1,
    version: 1,
    customerId: null,
    displayName: "Nguyễn Văn A",
    phoneLast3: "123",
    partySize: 2,
    expectedAt: new Date("2026-11-04T20:00:00Z"),
    businessDate: "2026-11-04",
    classification: "UNCLASSIFIED",
    guestType: null,
    isBirthday: false,
    status: "BOOKED",
    sourceCode: "HOTLINE",
    note: null,
    tableIds: [1],
    holdId: null,
    symbolNo: null,
    subState: null,
    warning: null,
    minutesLate: 0,
    waitlistEntryId: null,
    visitId: null,
    checkedInAt: null,
    closedAt: null,
    closeReasonCode: null,
    closeReasonNote: null,
    createdAt: null,
    createdByName: "Staff",
    lateConfirmedAt: null,
    ...patch,
  }) as ReservationView

describe("Mobile model pure helpers (A-F01 fix)", () => {
  const baseTime = new Date("2026-11-04T20:00:00Z")

  it("returns 'Đã nhận bàn' for CHECKED_IN with seated tone", () => {
    const r = createReservation({ status: "CHECKED_IN" })
    expect(chipOf(r, baseTime)).toBe("Đã nhận bàn")
    expect(toneOf(r)).toBe("seated")
  })

  it("returns 'Không tới' for NO_SHOW with noshow tone", () => {
    const r = createReservation({ status: "NO_SHOW" })
    expect(chipOf(r, baseTime)).toBe("Không tới")
    expect(toneOf(r)).toBe("noshow")
  })

  it("returns 'Đã hủy' for CANCELLED with null tone", () => {
    const r = createReservation({ status: "CANCELLED" })
    expect(chipOf(r, baseTime)).toBe("Đã hủy")
    expect(toneOf(r)).toBeNull()
  })

  it("returns 'Sắp đến' for future/on-time booking with reserved tone", () => {
    const r = createReservation({ status: "BOOKED", expectedAt: new Date("2026-11-04T20:30:00Z") })
    expect(chipOf(r, baseTime)).toBe("Sắp đến")
    expect(toneOf(r)).toBe("reserved")
  })

  it("returns 'Không tới · 15 phút' for 15-minute late booking with noshow tone", () => {
    const now = new Date("2026-11-04T20:15:00Z")
    const r = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "late",
      minutesLate: 15,
    })
    expect(chipOf(r, now)).toBe("Không tới · 15 phút")
    expect(toneOf(r)).toBe("noshow")
  })

  it("returns 'Không tới · đã báo muộn · 15 phút' when late confirmed", () => {
    const now = new Date("2026-11-04T20:15:00Z")
    const r = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "late",
      minutesLate: 15,
      lateConfirmedAt: new Date("2026-11-04T20:05:00Z"),
    })
    expect(chipOf(r, now)).toBe("Không tới · đã báo muộn · 15 phút")
    expect(toneOf(r)).toBe("noshow")
  })

  it("returns 'Không tới · 30 phút' for 30-minute late booking with noshow tone", () => {
    const now = new Date("2026-11-04T20:30:00Z")
    const r = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "noshow",
      minutesLate: 30,
    })
    expect(chipOf(r, now)).toBe("Không tới · 30 phút")
    expect(toneOf(r)).toBe("noshow")
  })
})

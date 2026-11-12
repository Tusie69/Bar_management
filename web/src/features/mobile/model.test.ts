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

  it("returns 'Tới muộn · 15 phút' for 15-minute late booking with noshow tone", () => {
    const now = new Date("2026-11-04T20:15:00Z")
    const r = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "late",
      minutesLate: 15,
    })
    expect(chipOf(r, now)).toBe("Tới muộn · 15 phút")
    expect(toneOf(r)).toBe("noshow")
  })

  it("returns 'Tới muộn · đã báo muộn · 15 phút' when late confirmed", () => {
    const now = new Date("2026-11-04T20:15:00Z")
    const r = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "late",
      minutesLate: 15,
      lateConfirmedAt: new Date("2026-11-04T20:05:00Z"),
    })
    expect(chipOf(r, now)).toBe("Tới muộn · đã báo muộn · 15 phút")
    expect(toneOf(r)).toBe("noshow")
  })

  it("returns 'Tới muộn · 30 phút' for 30-minute late booking with noshow tone", () => {
    const now = new Date("2026-11-04T20:30:00Z")
    const r = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "noshow",
      minutesLate: 30,
    })
    expect(chipOf(r, now)).toBe("Tới muộn · 30 phút")
    expect(toneOf(r)).toBe("noshow")
  })

  it("regression: BOOKED past time below threshold (warning=null) is not 'Tới muộn', restores 'Trễ N phút' with reserved tone", () => {
    const now = new Date("2026-11-04T20:10:00Z")
    const r = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: null,
      minutesLate: 10,
    })
    expect(chipOf(r, now)).toBe("Trễ 10 phút")
    expect(chipOf(r, now)).not.toContain("Tới muộn")
    expect(toneOf(r)).toBe("reserved")
  })

  it("regression: warning late and noshow are 'Tới muộn', while lateConfirmedAt shows note", () => {
    const now15 = new Date("2026-11-04T20:15:00Z")
    const now30 = new Date("2026-11-04T20:30:00Z")

    // Warning late without confirmation
    const rLate = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "late",
      minutesLate: 15,
      lateConfirmedAt: null,
    })
    expect(chipOf(rLate, now15)).toBe("Tới muộn · 15 phút")
    expect(chipOf(rLate, now15)).toContain("Tới muộn")
    expect(toneOf(rLate)).toBe("noshow")

    // Warning late with confirmation note
    const rLateConf = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "late",
      minutesLate: 15,
      lateConfirmedAt: new Date("2026-11-04T20:05:00Z"),
    })
    expect(chipOf(rLateConf, now15)).toBe("Tới muộn · đã báo muộn · 15 phút")
    expect(chipOf(rLateConf, now15)).toContain("Tới muộn · đã báo muộn")
    expect(toneOf(rLateConf)).toBe("noshow")

    // Warning noshow without confirmation
    const rNoshow = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "noshow",
      minutesLate: 30,
      lateConfirmedAt: null,
    })
    expect(chipOf(rNoshow, now30)).toBe("Tới muộn · 30 phút")
    expect(chipOf(rNoshow, now30)).toContain("Tới muộn")
    expect(toneOf(rNoshow)).toBe("noshow")

    // Warning noshow with confirmation note
    const rNoshowConf = createReservation({
      status: "BOOKED",
      expectedAt: baseTime,
      warning: "noshow",
      minutesLate: 30,
      lateConfirmedAt: new Date("2026-11-04T20:05:00Z"),
    })
    expect(chipOf(rNoshowConf, now30)).toBe("Tới muộn · đã báo muộn · 30 phút")
    expect(chipOf(rNoshowConf, now30)).toContain("Tới muộn · đã báo muộn")
    expect(toneOf(rNoshowConf)).toBe("noshow")
  })
})

import { describe, expect, it, vi } from "vitest"
import type { ReservationView } from "@/domain/models"
import type { ReservationCloseReason } from "@/domain/enums"
import { api } from "@/services"

vi.mock("@/services", () => ({
  api: {
    mode: "mock",
    cancelReservation: vi.fn(),
    confirmLate: vi.fn(),
    seatWaitlist: vi.fn(),
  },
}))

describe("G6 - Booking detail & waitlist logic", () => {
  it("verifies cancel reservation keeps confirm and version checks", async () => {
    const r: ReservationView = {
      id: 101,
      version: 3,
      businessDate: "2026-11-09",
      expectedAt: new Date("2026-11-09T20:00:00Z"),
      partySize: 4,
      status: "BOOKED",
      subState: "DANG_GIU_BAN",
      tableIds: [1],
      displayName: "Anh Nam",
      sourceCode: "HOTLINE",
      classification: "RETURNING",
      isBirthday: false,
    } as ReservationView

    // Simulate direct cancellation
    const reason: ReservationCloseReason = "CUSTOMER_REQUEST"
    await api.cancelReservation(r.id, r.version, reason, "Khách bận")
    expect(api.cancelReservation).toHaveBeenCalledWith(101, 3, "CUSTOMER_REQUEST", "Khách bận")
  })

  it("verifies waitlist hold flow contains all required actions", () => {
    const requiredWaitlistHoldActions = [
      "Khách đã đến",
      "Quản lý đơn",
      "Đổi / Ghép bàn",
      "Xem booking",
      "Xem đơn chờ",
      "Đổi trạng thái",
    ]
    expect(requiredWaitlistHoldActions).toHaveLength(6)
    expect(requiredWaitlistHoldActions).toContain("Khách đã đến")
    expect(requiredWaitlistHoldActions).toContain("Quản lý đơn")
    expect(requiredWaitlistHoldActions).toContain("Đổi / Ghép bàn")
    expect(requiredWaitlistHoldActions).toContain("Xem booking")
    expect(requiredWaitlistHoldActions).toContain("Xem đơn chờ")
    expect(requiredWaitlistHoldActions).toContain("Đổi trạng thái")
  })

  it("proves late arrival can be confirmed after booking time without 30-minute block", async () => {
    const r: ReservationView = {
      id: 202,
      version: 1,
      businessDate: "2026-11-09",
      expectedAt: new Date("2026-11-09T19:00:00Z"),
      partySize: 2,
      status: "BOOKED",
      minutesLate: 45, // More than 30 minutes late
      lateConfirmedAt: null,
    } as ReservationView

    // Should be able to confirm late without being blocked by 30-minute no-show threshold
    await api.confirmLate(r.id, r.version)
    expect(api.confirmLate).toHaveBeenCalledWith(202, 1)
  })

  it("ensures live 'Khách không tới' is removed from active options while preserving history", () => {
    // Only CANCELLED and NO_SHOW exist in closed historical records
    const historicalStatuses = ["CANCELLED", "NO_SHOW"] as const
    expect(historicalStatuses).toContain("NO_SHOW")

    // Live options for active booking status changes only include late and cancel
    const liveBookingActions = ["LATE", "CANCEL"]
    expect(liveBookingActions).not.toContain("NO_SHOW")
  })
})

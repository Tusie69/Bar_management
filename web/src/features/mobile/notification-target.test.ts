import { describe, expect, it } from "vitest"
import { notificationTarget } from "./notification-target"

describe("notificationTarget", () => {
  it("opens the assigned table before booking detail for a late-arrival notification", () => {
    expect(notificationTarget(25, 101, "2026-11-19")).toEqual({ kind: "table", tableId: 25 })
  })

  it("falls back to booking detail when the late booking has no assigned table", () => {
    expect(notificationTarget(null, 101, "2026-11-19")).toEqual({
      kind: "reservation",
      reservationId: 101,
      businessDate: "2026-11-19",
    })
  })
})

import { describe, expect, it, vi } from "vitest"
import { SimClock } from "./clock"
import { devClockAvailable, vnParts } from "./dev-clock-api"

describe("TU-42 đồng hồ Dev phía trình duyệt", () => {
  it("chỉ bật ở bản Dev chạy HTTP", () => {
    expect(devClockAvailable("dev", "http")).toBe(true)
    expect(devClockAvailable("dev", "mock")).toBe(false)
    expect(devClockAvailable("production", "http")).toBe(false)
  })

  it("chép độ lệch server và chỉ báo khi độ lệch đổi", () => {
    const clock = new SimClock(false, null)
    const listener = vi.fn()
    clock.subscribe(listener)
    clock.applyServerOffset(3_600_000)
    expect(clock.isSimulated).toBe(true)
    expect(Math.abs(clock.now().getTime() - Date.now() - 3_600_000)).toBeLessThan(1000)
    clock.applyServerOffset(3_600_000)
    expect(listener).toHaveBeenCalledTimes(1)
    clock.applyServerOffset(0)
    expect(clock.isSimulated).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("hiển thị giờ Việt Nam", () => {
    expect(vnParts(new Date("2026-11-25T16:30:00Z"))).toEqual({
      time: "23:30",
      day: "25/11",
      input: "2026-11-25T23:30",
    })
  })
})

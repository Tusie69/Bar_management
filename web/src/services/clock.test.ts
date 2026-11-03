import { describe, expect, it } from "vitest"
import { venueParts } from "@/lib/time"
import { SimClock } from "./clock"

describe("venue clock mode", () => {
  it("uses the real instant when simulation is disabled", () => {
    const before = Date.now()
    const clock = new SimClock(false)
    const observed = clock.now().getTime()
    const after = Date.now()
    expect(clock.isSimulated).toBe(false)
    expect(observed).toBeGreaterThanOrEqual(before)
    expect(observed).toBeLessThanOrEqual(after)
  })

  it("freezes at an explicitly supplied E2E instant", () => {
    const fixed = new Date("2030-10-24T11:00:00.000Z")
    const clock = new SimClock(false, fixed)
    expect(clock.now().toISOString()).toBe(fixed.toISOString())
    expect(clock.isSimulated).toBe(true)
    clock.advance(30)
    expect(clock.now().toISOString()).toBe("2030-10-24T11:30:00.000Z")
  })

  it("keeps the 21:30 scenario available for mock mode", () => {
    const clock = new SimClock(true)
    const parts = venueParts(clock.now())
    expect(clock.isSimulated).toBe(true)
    expect([parts.hour, parts.minute]).toEqual([21, 30])
  })
})

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

  it("keeps the 21:30 scenario available for mock mode", () => {
    const clock = new SimClock(true)
    const parts = venueParts(clock.now())
    expect(clock.isSimulated).toBe(true)
    expect([parts.hour, parts.minute]).toEqual([21, 30])
  })
})

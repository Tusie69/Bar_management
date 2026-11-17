import { describe, expect, it } from "vitest"
import { createSpringEase, EASE, MOTION, registerMotion } from "./motion"

describe("21GAM motion system", () => {
  it("registers GSAP plugins idempotently", () => {
    expect(() => {
      registerMotion()
      registerMotion()
    }).not.toThrow()
  })

  it("exposes coherent duration and damping tokens", () => {
    expect(MOTION.duration.press).toBeGreaterThanOrEqual(0.08)
    expect(MOTION.duration.press).toBeLessThanOrEqual(0.14)
    expect(MOTION.duration.hover).toBeGreaterThanOrEqual(0.12)
    expect(MOTION.duration.hover).toBeLessThanOrEqual(0.2)
    expect(MOTION.duration.dialog).toBeGreaterThanOrEqual(0.18)
    expect(MOTION.duration.dialog).toBeLessThanOrEqual(0.28)
    expect(MOTION.duration.sheet).toBeGreaterThanOrEqual(0.22)
    expect(MOTION.duration.sheet).toBeLessThanOrEqual(0.34)
    expect(MOTION.damping.default).toBe(1.0)
    expect(MOTION.damping.sheet).toBe(0.8)
  })

  it("produces a critically damped spring with boundary clamping and zero overshoot", () => {
    const ease = EASE.springDefault
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(-0.2)).toBe(0)
    expect(ease(1.2)).toBe(1)

    let prev = 0
    for (let i = 1; i <= 40; i++) {
      const val = ease(i / 40)
      expect(val).toBeGreaterThanOrEqual(prev - 1e-6)
      expect(val).toBeLessThanOrEqual(1 + 1e-6)
      prev = val
    }
  })

  it("produces an under-damped drawer/sheet spring with subtle (~1.5%) settle overshoot", () => {
    const ease = EASE.springSheet
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)

    let maxVal = 0
    for (let i = 1; i < 100; i++) {
      maxVal = Math.max(maxVal, ease(i / 100))
    }
    expect(maxVal).toBeGreaterThan(1.005)
    expect(maxVal).toBeLessThan(1.03)
  })

  it("clamps degenerate inputs safely in createSpringEase", () => {
    const custom = createSpringEase(0, 0, 0)
    expect(custom(0)).toBe(0)
    expect(custom(1)).toBe(1)
    expect(Number.isFinite(custom(0.5))).toBe(true)
  })
})

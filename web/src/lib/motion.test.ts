import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

type MediaListener = (event: { matches: boolean; media: string }) => void

const mockHost = vi.hoisted(() => {
  const state = {
    handler: null as ((query: string) => MediaQueryList) | null,
    hadWindow: typeof (globalThis as { window?: unknown }).window !== "undefined",
    prevWindow: (globalThis as { window?: unknown }).window,
    hadDocument: typeof (globalThis as { document?: unknown }).document !== "undefined",
    prevDocument: (globalThis as { document?: unknown }).document,
    hadGetComputedStyle: typeof (globalThis as { getComputedStyle?: unknown }).getComputedStyle !== "undefined",
    prevGetComputedStyle: (globalThis as { getComputedStyle?: unknown }).getComputedStyle,
  }
  const fakeComputedStyle = () =>
    ({
      opacity: "1",
      visibility: "visible",
      transform: "none",
      transformOrigin: "50% 50%",
      getPropertyValue: () => "",
    }) as unknown as CSSStyleDeclaration
  if (!state.hadGetComputedStyle) {
    ;(globalThis as { getComputedStyle?: unknown }).getComputedStyle = fakeComputedStyle
  }
  const makeStyle = () => {
    const s: Record<string, unknown> = {}
    s.setProperty = (k: string, v: string) => {
      s[k] = v
    }
    s.removeProperty = (k: string) => {
      delete s[k]
    }
    s.removeAttribute = (k: string) => {
      delete s[k]
    }
    return s
  }
  if (!state.hadDocument) {
    const docEl = { appendChild: () => {}, removeChild: () => {}, insertBefore: () => {}, style: makeStyle() }
    const makeEl = () => ({ style: makeStyle(), setAttribute: () => {}, getElementsByTagName: () => [] })
    ;(globalThis as { document?: unknown }).document = {
      documentElement: docEl,
      body: docEl,
      createElement: makeEl,
      createElementNS: makeEl,
      querySelectorAll: () => [],
    }
  }
  if (!state.hadWindow) {
    ;(globalThis as { window?: unknown }).window = {
      getComputedStyle: fakeComputedStyle,
      matchMedia: (query: string) =>
        state.handler
          ? state.handler(query)
          : ({
              matches: false,
              media: query,
              addListener: () => {},
              removeListener: () => {},
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => true,
            } as unknown as MediaQueryList),
    }
  }
  return state
})

import gsap from "gsap"
import { setupRevealMatchMedia } from "@/features/admin/admin-motion"
import { createSpringEase, EASE, MOTION, MOTION_MEDIA_QUERIES } from "./motion"
import { registerMotion, buildDialogTimeline, buildSheetTimeline, setupOverlayMatchMedia } from "./motion-matchmedia"
import motionSource from "./motion.ts?raw"

function createFakeElement() {
  const style: Record<string, unknown> = {}
  style.setProperty = (k: string, v: string) => {
    style[k] = v
  }
  style.removeProperty = (k: string) => {
    delete style[k]
  }
  style.removeAttribute = (k: string) => {
    delete style[k]
  }
  const parent = { insertBefore: () => {}, appendChild: () => {}, removeChild: () => {} }
  return {
    nodeType: 1,
    tagName: "DIV",
    style,
    parentNode: parent,
    offsetWidth: 232,
    offsetHeight: 400,
    getBoundingClientRect: () => ({ width: 232, height: 400, top: 0, left: 0, right: 232, bottom: 400 }),
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    querySelectorAll: () => [],
    children: [],
  } as unknown as HTMLElement
}

function installMatchMediaMock(initialReduced: boolean) {
  let reduced = initialReduced
  let activeListeners = 0
  const mqlEntries: Array<{ query: string; listeners: Set<MediaListener> }> = []

  const getMatches = (query: string) => {
    if (query === "all") return true
    if (query.includes("prefers-reduced-motion: reduce")) return reduced
    return false
  }

  const matchMedia = vi.fn((query: string) => {
    const listeners = new Set<MediaListener>()
    mqlEntries.push({ query, listeners })
    return {
      media: query,
      get matches() {
        return getMatches(query)
      },
      addListener(fn: MediaListener) {
        if (!listeners.has(fn)) {
          listeners.add(fn)
          activeListeners++
        }
      },
      removeListener(fn: MediaListener) {
        if (listeners.delete(fn)) activeListeners--
      },
      addEventListener(_type: string, fn: MediaListener) {
        if (!listeners.has(fn)) {
          listeners.add(fn)
          activeListeners++
        }
      },
      removeEventListener(_type: string, fn: MediaListener) {
        if (listeners.delete(fn)) activeListeners--
      },
      dispatchEvent: () => true,
    }
  })

  mockHost.handler = matchMedia as unknown as (query: string) => MediaQueryList

  const dispatchChange = () => {
    for (const { query, listeners } of mqlEntries) {
      const matches = getMatches(query)
      for (const fn of [...listeners]) {
        fn({ matches, media: query })
      }
    }
  }

  return {
    get activeListeners() {
      return activeListeners
    },
    setReducedStateOnly(next: boolean) {
      reduced = next
    },
    dispatchChange,
    setReduced(next: boolean) {
      reduced = next
      dispatchChange()
    },
    restore() {
      mockHost.handler = null
    },
  }
}

describe("21GAM motion system", () => {
  let cleanupMock: (() => void) | undefined

  afterAll(() => {
    if (!mockHost.hadWindow) {
      ;(globalThis as { window?: unknown }).window = mockHost.prevWindow
    }
    if (!mockHost.hadDocument) {
      ;(globalThis as { document?: unknown }).document = mockHost.prevDocument
    }
    if (!mockHost.hadGetComputedStyle) {
      ;(globalThis as { getComputedStyle?: unknown }).getComputedStyle = mockHost.prevGetComputedStyle
    }
  })

  afterEach(() => {
    cleanupMock?.()
    cleanupMock = undefined
    gsap.globalTimeline.clear()
  })

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
    expect(MOTION_MEDIA_QUERIES.always).toBe("all")
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

  it("P1-01: initializes normal (non-reduced) overlay and admin reveal timelines via always-matching `all` query", () => {
    const mock = installMatchMediaMock(false)
    cleanupMock = () => mock.restore()

    const overlay = createFakeElement()
    const content = createFakeElement()
    const animState = { x: -100, opacity: 0 }
    const openRef = { current: true }
    const onExitRef = { current: vi.fn() }
    const tlRef: { current: gsap.core.Timeline | null } = { current: null }
    const calls: boolean[] = []

    const mm = setupOverlayMatchMedia({
      overlay,
      content,
      openRef,
      onExitRef,
      tlRef,
      buildTimeline: ({ tl, reduceMotion }) => {
        calls.push(reduceMotion)
        tl.fromTo(animState, { x: -100 }, { x: 0, duration: 0.28 }, 0)
      },
    })

    expect(calls).toEqual([false])
    expect(tlRef.current).not.toBeNull()
    expect(onExitRef.current).not.toHaveBeenCalled()
    mm.revert()

    const fromToSpy = vi.spyOn(gsap, "fromTo").mockImplementation(() => ({}) as unknown as gsap.core.Tween)
    const revealEl = createFakeElement()
    const revealMm = setupRevealMatchMedia([revealEl])
    expect(revealEl.style.willChange).toBe("transform, opacity")
    expect(fromToSpy).toHaveBeenCalledWith(
      [revealEl],
      { autoAlpha: 0, y: 10 },
      expect.objectContaining({ autoAlpha: 1, y: 0, duration: MOTION.duration.section }),
    )
    fromToSpy.mockRestore()
    revealMm.revert()
    expect(mock.activeListeners).toBe(0)
  })

  it("P1-01/P1-02: handles reduced-motion mode and settles/reverses when exit completes", () => {
    const mock = installMatchMediaMock(true)
    cleanupMock = () => mock.restore()

    const overlay = createFakeElement()
    const content = createFakeElement()
    const animState = { opacity: 0 }
    const openRef = { current: true }
    const onExit = vi.fn()
    const onExitRef = { current: onExit }
    const tlRef: { current: gsap.core.Timeline | null } = { current: null }
    const calls: boolean[] = []

    const mm = setupOverlayMatchMedia({
      overlay,
      content,
      openRef,
      onExitRef,
      tlRef,
      buildTimeline: ({ tl, reduceMotion }) => {
        calls.push(reduceMotion)
        tl.fromTo(animState, { opacity: 0 }, { opacity: 1, duration: 0.14 }, 0)
      },
    })

    expect(calls).toEqual([true])
    expect(tlRef.current).not.toBeNull()

    // Simulate open -> settle -> reverse close completion.
    tlRef.current!.progress(1)
    expect(animState.opacity).toBe(1)
    openRef.current = false
    tlRef.current!.reverse()
    tlRef.current!.progress(0)
    expect(onExit).toHaveBeenCalledTimes(1)

    mm.revert()
    expect(mock.activeListeners).toBe(0)
  })

  it("P1-03: cleans up all matchMedia listeners over 20 cycles and handles live preference toggles without stale exits", () => {
    const mock = installMatchMediaMock(false)
    cleanupMock = () => mock.restore()

    for (let i = 0; i < 20; i++) {
      const overlay = createFakeElement()
      const content = createFakeElement()
      const animState = { opacity: 0 }
      const openRef = { current: true }
      const onExit = vi.fn()
      const tlRef: { current: gsap.core.Timeline | null } = { current: null }

      const mm = setupOverlayMatchMedia({
        overlay,
        content,
        openRef,
        onExitRef: { current: onExit },
        tlRef,
        buildTimeline: ({ tl }) => {
          tl.fromTo(animState, { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0)
        },
      })
      expect(mock.activeListeners).toBeGreaterThan(0)
      mm.revert()
      expect(mock.activeListeners).toBe(0)
    }

    // Preference toggle while open settles cleanly without invoking exit or dropping the timeline.
    const overlay = createFakeElement()
    const content = createFakeElement()
    const animState = { opacity: 0 }
    const openRef = { current: true }
    const onExit = vi.fn()
    const tlRef: { current: gsap.core.Timeline | null } = { current: null }
    const modes: boolean[] = []

    const mm = setupOverlayMatchMedia({
      overlay,
      content,
      openRef,
      onExitRef: { current: onExit },
      tlRef,
      buildTimeline: ({ tl, reduceMotion }) => {
        modes.push(reduceMotion)
        tl.fromTo(animState, { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0)
      },
    })
    expect(modes).toEqual([false])

    mock.setReduced(true)
    expect(modes).toEqual([false, true])
    expect(tlRef.current?.progress()).toBe(1)
    expect(onExit).not.toHaveBeenCalled()

    // After closing and reverting, subsequent preference toggles must not trigger callbacks.
    mm.revert()
    expect(mock.activeListeners).toBe(0)
    mock.setReduced(false)
    expect(modes).toEqual([false, true])
  })

  it("does not falsely revert/snap a reduced-motion overlay when an earlier matchMedia listener delivers an async change event", () => {
    const mock = installMatchMediaMock(false)
    cleanupMock = () => mock.restore()

    const fromToSpy = vi.spyOn(gsap, "fromTo").mockImplementation(() => ({}) as unknown as gsap.core.Tween)
    const revealEl = createFakeElement()
    const revealMm = setupRevealMatchMedia([revealEl])
    fromToSpy.mockRestore()

    // Simulate OS/CDP switching prefers-reduced-motion before the async MediaQueryList change event fires.
    mock.setReducedStateOnly(true)

    const overlay = createFakeElement()
    const content = createFakeElement()
    const animState = { opacity: 0 }
    const openRef = { current: true }
    const onExit = vi.fn()
    const tlRef: { current: gsap.core.Timeline | null } = { current: null }
    const modes: boolean[] = []

    const overlayMm = setupOverlayMatchMedia({
      overlay,
      content,
      openRef,
      onExitRef: { current: onExit },
      tlRef,
      buildTimeline: ({ tl, reduceMotion }) => {
        modes.push(reduceMotion)
        tl.fromTo(animState, { opacity: 0 }, { opacity: 1, duration: 0.14 }, 0)
      },
    })

    expect(modes).toEqual([true])
    const initialTl = tlRef.current
    expect(initialTl).not.toBeNull()
    expect(initialTl!.progress()).toBe(0)

    // Deliver the pending MediaQueryList change event from revealMm past GSAP's 2 ms _onMediaChange debounce.
    const setSpy = vi.spyOn(gsap, "set").mockImplementation(() => ({}) as unknown as gsap.core.Tween)
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10)
    try {
      mock.dispatchChange()
    } finally {
      nowSpy.mockRestore()
      setSpy.mockRestore()
    }

    // Overlay timeline must remain intact and in-flight (not reverted or snapped to progress(1)).
    expect(modes).toEqual([true])
    expect(tlRef.current).toBe(initialTl)
    expect(tlRef.current!.progress()).toBe(0)
    expect(onExit).not.toHaveBeenCalled()

    overlayMm.revert()
    revealMm.revert()
    expect(mock.activeListeners).toBe(0)
  })

  it("P1-11: settles immediately at open endpoint without replaying when skipInitialEnterRef is true", () => {
    const mock = installMatchMediaMock(false)
    cleanupMock = () => mock.restore()

    const overlay = createFakeElement()
    const content = createFakeElement()
    const animState = { opacity: 0, y: 10 }
    const openRef = { current: true }
    const onExit = vi.fn()
    const tlRef: { current: gsap.core.Timeline | null } = { current: null }
    const skipInitialEnterRef = { current: true }

    const mm = setupOverlayMatchMedia({
      overlay,
      content,
      openRef,
      onExitRef: { current: onExit },
      tlRef,
      skipInitialEnterRef,
      buildTimeline: ({ tl }) => {
        tl.fromTo(animState, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.24 }, 0)
      },
    })

    expect(tlRef.current).not.toBeNull()
    expect(tlRef.current!.progress()).toBe(1)
    expect(tlRef.current!.paused()).toBe(true)
    expect(animState.opacity).toBe(1)
    expect(animState.y).toBe(0)
    expect(overlay.style.willChange).toBe("auto")
    expect(content.style.willChange).toBe("auto")

    // Closing still reverses from 1 -> 0 and calls onExit upon completion.
    openRef.current = false
    tlRef.current!.reverse()
    tlRef.current!.progress(0)
    expect(onExit).toHaveBeenCalledTimes(1)

    mm.revert()
    expect(mock.activeListeners).toBe(0)
  })

  it("P1-13: keeps overlay content focusable (no visibility: hidden) during dialog and sheet timelines", () => {
    for (const reduceMotion of [false, true]) {
      const overlay = createFakeElement()
      const content = createFakeElement()
      const calls: Array<{ target: unknown; from: Record<string, unknown>; to: Record<string, unknown> }> = []
      const fakeTl = {
        fromTo(target: unknown, from: Record<string, unknown>, to: Record<string, unknown>) {
          calls.push({ target, from, to })
          return fakeTl
        },
      } as unknown as gsap.core.Timeline
      buildDialogTimeline({ tl: fakeTl, overlay, content, reduceMotion })
      const contentCall = calls.find((c) => c.target === content)
      expect(contentCall).toBeDefined()
      expect(contentCall!.from).not.toHaveProperty("autoAlpha")
      expect(contentCall!.to).not.toHaveProperty("autoAlpha")
      expect(contentCall!.from.opacity).toBe(0)
      expect(contentCall!.to.opacity).toBe(1)
    }

    for (const reduceMotion of [false, true]) {
      const overlay = createFakeElement()
      const content = createFakeElement()
      const calls: Array<{ target: unknown; from: Record<string, unknown>; to: Record<string, unknown> }> = []
      const fakeTl = {
        fromTo(target: unknown, from: Record<string, unknown>, to: Record<string, unknown>) {
          calls.push({ target, from, to })
          return fakeTl
        },
      } as unknown as gsap.core.Timeline
      buildSheetTimeline({ tl: fakeTl, overlay, content, reduceMotion, side: "right", duration: MOTION.duration.sheet })
      const contentCall = calls.find((c) => c.target === content)
      expect(contentCall).toBeDefined()
      expect(contentCall!.from).not.toHaveProperty("autoAlpha")
      expect(contentCall!.to).not.toHaveProperty("autoAlpha")
      expect(contentCall!.from.opacity).toBe(reduceMotion ? 0 : 1)
      expect(contentCall!.to.opacity).toBe(1)
    }
  })

  it("P1-07: keeps GSAP and @gsap/react out of static imports in motion.ts", () => {
    expect(motionSource).not.toMatch(/^\s*import\b.*["']gsap["']/m)
    expect(motionSource).not.toMatch(/^\s*import\b.*["']@gsap\/react["']/m)
    expect(motionSource).toMatch(/import\(["']\.\/motion-controller["']\)/)
  })
})

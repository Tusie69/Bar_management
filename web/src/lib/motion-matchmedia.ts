/**
 * GSAP `matchMedia()` and plugin setup helpers used by `motion-controller.tsx`
 * and `features/admin/admin-motion.ts` (never imported on Reception's critical path).
 */
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { EASE, MOTION, MOTION_MEDIA_QUERIES, type SheetSide } from "./motion"

let motionRegistered = false

function ensureMonotonicTicker(): void {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return
  const startDate = Date.now()
  const startPerf = performance.now()
  let frozenMode = false

  const step = () => {
    const nowPerf = performance.now()
    if (Date.now() !== startDate) {
      // Wall clock advances normally; GSAP's native ticker drives timelines with zero extra rAF.
      return
    }
    if (!frozenMode && nowPerf - startPerf > 30) {
      frozenMode = true
    }
    if (frozenMode) {
      gsap.updateRoot((nowPerf - startPerf) / 1000)
    }
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** Idempotent one-time GSAP plugin registration. Safe to call repeatedly. */
export function registerMotion(): void {
  if (motionRegistered) return
  gsap.registerPlugin(useGSAP)
  motionRegistered = true
  ensureMonotonicTicker()
}

registerMotion()

export function setMotionWillChange(els: Array<HTMLElement | null>, value: string): void {
  for (const el of els) {
    if (el) el.style.willChange = value
  }
}

function sheetOffsetVars(side: SheetSide): { xPercent?: number; yPercent?: number } {
  switch (side) {
    case "left":
      return { xPercent: -100 }
    case "right":
      return { xPercent: 100 }
    case "top":
      return { yPercent: -100 }
    case "bottom":
      return { yPercent: 100 }
  }
}

export interface TimelineBuilderParams {
  tl: gsap.core.Timeline
  overlay: HTMLElement
  content: HTMLElement
  reduceMotion: boolean
}

/**
 * Creates a `gsap.matchMedia()` context with an always-matching `all` query and
 * `prefers-reduced-motion: reduce`. Extracted so unit tests can verify normal/reduced
 * initialization, listener cleanup, and preference-toggle behavior directly.
 */
export function setupOverlayMatchMedia({
  overlay,
  content,
  openRef,
  onExitRef,
  tlRef,
  skipInitialEnterRef,
  buildTimeline,
}: {
  overlay: HTMLElement
  content: HTMLElement
  openRef: { current: boolean }
  onExitRef: { current: () => void }
  tlRef: { current: gsap.core.Timeline | null }
  skipInitialEnterRef?: { current: boolean }
  buildTimeline: (params: TimelineBuilderParams) => void
}): gsap.MatchMedia {
  let hasInitialized = false
  const mm = gsap.matchMedia()

  mm.add(
    MOTION_MEDIA_QUERIES,
    (context) => {
      const reduceMotion = Boolean(context.conditions?.reduceMotion)
      const isMediaUpdate = hasInitialized
      hasInitialized = true

      const tl = gsap.timeline({
        paused: true,
        onStart: () => setMotionWillChange([overlay, content], "transform, opacity"),
        onComplete: () => setMotionWillChange([overlay, content], "auto"),
        onReverseComplete: () => {
          setMotionWillChange([overlay, content], "auto")
          if (!openRef.current) onExitRef.current()
        },
      })

      buildTimeline({ tl, overlay, content, reduceMotion })
      tlRef.current = tl

      if (isMediaUpdate) {
        // Preference changed while mounted: settle cleanly without replaying or jumping.
        if (openRef.current) {
          tl.progress(1).pause()
          setMotionWillChange([overlay, content], "auto")
        } else {
          tl.progress(0).pause()
          setMotionWillChange([overlay, content], "auto")
          onExitRef.current()
        }
      } else if (openRef.current) {
        if (skipInitialEnterRef?.current) {
          // Visible fallback was already displayed: land at open endpoint without replaying entrance.
          tl.progress(1).pause()
          setMotionWillChange([overlay, content], "auto")
        } else {
          tl.timeScale(1).play()
        }
      } else {
        onExitRef.current()
      }

      return () => {
        tlRef.current = null
      }
    },
    content,
  )

  return mm
}

export function buildDialogTimeline({ tl, overlay, content, reduceMotion }: TimelineBuilderParams): void {
  if (reduceMotion) {
    tl.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: MOTION.duration.reduced, ease: EASE.reduced }, 0).fromTo(
      content,
      { opacity: 0 },
      { opacity: 1, duration: MOTION.duration.reduced, ease: EASE.reduced },
      0,
    )
    return
  }
  tl.fromTo(
    overlay,
    { opacity: 0 },
    { opacity: 1, duration: MOTION.duration.dialog * 0.9, ease: EASE.fadeIn },
    0,
  ).fromTo(
    content,
    { opacity: 0, y: 10, scale: 0.965 },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: MOTION.duration.dialog,
      ease: EASE.springDefault,
    },
    0,
  )
}

export function buildSheetTimeline({
  tl,
  overlay,
  content,
  reduceMotion,
  side,
  duration,
}: TimelineBuilderParams & { side: SheetSide; duration: number }): void {
  if (reduceMotion) {
    tl.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: MOTION.duration.reduced, ease: EASE.reduced }, 0).fromTo(
      content,
      { opacity: 0 },
      { opacity: 1, duration: MOTION.duration.reduced, ease: EASE.reduced },
      0,
    )
    return
  }
  const offset = sheetOffsetVars(side)
  tl.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: duration * 0.8, ease: EASE.fadeIn }, 0).fromTo(
    content,
    { opacity: 1, ...offset },
    {
      opacity: 1,
      xPercent: 0,
      yPercent: 0,
      duration,
      ease: EASE.springSheet,
    },
    0,
  )
}

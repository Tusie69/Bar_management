/**
 * 21GAM Motion System — GSAP + Apple HIG spring physics.
 *
 * Centralizes plugin registration, shared timing/easing constants mirroring
 * `src/styles/tokens.css`, `prefers-reduced-motion` handling via
 * `gsap.matchMedia()`, and interruptible presence timelines for overlays.
 */
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useCallback, useRef, useState } from "react"

let motionRegistered = false

/** Idempotent one-time GSAP plugin registration. Safe to call repeatedly. */
export function registerMotion(): void {
  if (motionRegistered) return
  gsap.registerPlugin(useGSAP)
  motionRegistered = true
}

registerMotion()

/** Shared motion tokens (seconds), mirrored in `src/styles/tokens.css`. */
export const MOTION = {
  duration: {
    press: 0.1,
    hover: 0.16,
    section: 0.22,
    dialog: 0.24,
    sheet: 0.3,
    drawer: 0.28,
    exit: 0.18,
    reduced: 0.14,
  },
  damping: {
    default: 1.0,
    sheet: 0.8,
  },
  response: {
    default: 0.35,
    sheet: 0.3,
  },
} as const

/**
 * Analytical second-order spring ease mapped to Apple's (damping, response) pair.
 * - damping >= 1.0: critically damped, monotonic settle with zero overshoot.
 * - damping < 1.0: under-damped, gentle momentum overshoot (~1.5% at damping=0.8).
 */
export function createSpringEase(
  damping: number,
  response: number,
  settleSeconds: number,
): (progress: number) => number {
  const safeDamping = Math.max(0.2, damping)
  const safeResponse = Math.max(0.05, response)
  const safeSettle = Math.max(0.1, settleSeconds)
  const omega = (2 * Math.PI) / safeResponse

  const evaluate = (t: number): number => {
    if (safeDamping >= 1) {
      const x = omega * t
      return 1 - (1 + x) * Math.exp(-x)
    }
    const sq = Math.sqrt(1 - safeDamping * safeDamping)
    const omegaD = omega * sq
    const decay = Math.exp(-safeDamping * omega * t)
    const k = safeDamping / sq
    return 1 - decay * (Math.cos(omegaD * t) + k * Math.sin(omegaD * t))
  }

  const endValue = evaluate(safeSettle) || 1
  return (progress: number): number => {
    if (progress <= 0) return 0
    if (progress >= 1) return 1
    return evaluate(progress * safeSettle) / endValue
  }
}

export const EASE = {
  springDefault: createSpringEase(MOTION.damping.default, MOTION.response.default, 0.45),
  springSheet: createSpringEase(MOTION.damping.sheet, MOTION.response.sheet, 0.42),
  fadeIn: "power2.out",
  fadeOut: "power2.in",
  reduced: "power1.out",
} as const

export type SheetSide = "top" | "right" | "bottom" | "left"

/** Combines multiple React refs into one callback ref without duplicating logic across overlays. */
export function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === "function") {
        ref(node)
      } else {
        ;(ref as React.MutableRefObject<T | null>).current = node
      }
    }
  }
}

/**
 * Presence state controller that keeps an overlay mounted through its exit
 * animation while supporting both controlled and uncontrolled `open` props.
 */
export function usePresenceController({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = openProp !== undefined ? openProp : internalOpen
  const [present, setPresent] = useState(isOpen)

  // Adjust state during render when opening so mounting happens synchronously
  // without triggering set-state-in-effect warnings.
  if (isOpen && !present) {
    setPresent(true)
  }

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!isOpen && !next) return
      if (openProp === undefined) {
        setInternalOpen(next)
      }
      onOpenChange?.(next)
    },
    [isOpen, onOpenChange, openProp],
  )

  const markExited = useCallback(() => {
    setPresent(false)
  }, [])

  return { isOpen, present, handleOpenChange, markExited }
}

function setWillChange(els: Array<HTMLElement | null>, value: string) {
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

/** Shared interruptible overlay timeline builder used by dialogs, alert dialogs, and sheets. */
function useOverlayPresenceTimeline({
  open,
  present,
  overlayRef,
  contentRef,
  onExitComplete,
  buildTimeline,
  deps,
}: {
  open: boolean
  present: boolean
  overlayRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLElement | null>
  onExitComplete: () => void
  buildTimeline: (params: {
    tl: gsap.core.Timeline
    overlay: HTMLElement
    content: HTMLElement
    reduceMotion: boolean
  }) => void
  deps: readonly unknown[]
}) {
  const tlRef = useRef<gsap.core.Timeline | null>(null)
  const openRef = useRef(open)
  const onExitRef = useRef(onExitComplete)
  const buildRef = useRef(buildTimeline)

  useGSAP(
    () => {
      buildRef.current = buildTimeline
      if (!present) {
        tlRef.current = null
        return
      }
      const overlay = overlayRef.current
      const content = contentRef.current
      if (!overlay || !content) return

      const mm = gsap.matchMedia()
      mm.add(
        {
          reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const reduceMotion = Boolean(context.conditions?.reduceMotion)
          const tl = gsap.timeline({
            paused: true,
            onStart: () => setWillChange([overlay, content], "transform, opacity"),
            onComplete: () => setWillChange([overlay, content], "auto"),
            onReverseComplete: () => {
              setWillChange([overlay, content], "auto")
              if (!openRef.current) onExitRef.current()
            },
          })

          buildRef.current({ tl, overlay, content, reduceMotion })
          tlRef.current = tl
          if (openRef.current) {
            tl.timeScale(1).play()
          }
          return () => {
            tlRef.current = null
          }
        },
      )

      return () => {
        mm.revert()
      }
    },
    { scope: contentRef, dependencies: [present, ...deps] },
  )

  useGSAP(
    () => {
      openRef.current = open
      onExitRef.current = onExitComplete
      const tl = tlRef.current
      if (!present) return
      if (open) {
        tl?.timeScale(1).play()
      } else if (!tl || tl.progress() === 0) {
        onExitRef.current()
      } else {
        tl.timeScale(1.25).reverse()
      }
    },
    { scope: contentRef, dependencies: [open, present, onExitComplete] },
  )
}

/** Interruptible GSAP presence timeline for centered dialogs and alert dialogs. */
export function useDialogPresenceMotion({
  open,
  present,
  overlayRef,
  contentRef,
  onExitComplete,
}: {
  open: boolean
  present: boolean
  overlayRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLElement | null>
  onExitComplete: () => void
}) {
  useOverlayPresenceTimeline({
    open,
    present,
    overlayRef,
    contentRef,
    onExitComplete,
    deps: [],
    buildTimeline: ({ tl, overlay, content, reduceMotion }) => {
      if (reduceMotion) {
        tl.fromTo(
          overlay,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: MOTION.duration.reduced, ease: EASE.reduced },
          0,
        ).fromTo(content, { autoAlpha: 0 }, { autoAlpha: 1, duration: MOTION.duration.reduced, ease: EASE.reduced }, 0)
        return
      }
      tl.fromTo(
        overlay,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: MOTION.duration.dialog * 0.9, ease: EASE.fadeIn },
        0,
      ).fromTo(
        content,
        { autoAlpha: 0, y: 10, scale: 0.965 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: MOTION.duration.dialog,
          ease: EASE.springDefault,
        },
        0,
      )
    },
  })
}

/**
 * Interruptible GSAP presence timeline for edge-anchored sheets and drawers.
 * Enters and exits along the exact same edge (`side`) with `EASE.springSheet`,
 * or cross-fades in place under `prefers-reduced-motion: reduce`.
 */
export function useSheetPresenceMotion({
  open,
  present,
  side,
  overlayRef,
  contentRef,
  onExitComplete,
  duration = MOTION.duration.sheet,
}: {
  open: boolean
  present: boolean
  side: SheetSide
  overlayRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLElement | null>
  onExitComplete: () => void
  duration?: number
}) {
  useOverlayPresenceTimeline({
    open,
    present,
    overlayRef,
    contentRef,
    onExitComplete,
    deps: [side, duration],
    buildTimeline: ({ tl, overlay, content, reduceMotion }) => {
      if (reduceMotion) {
        tl.fromTo(
          overlay,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: MOTION.duration.reduced, ease: EASE.reduced },
          0,
        ).fromTo(
          content,
          { autoAlpha: 0, xPercent: 0, yPercent: 0 },
          { autoAlpha: 1, xPercent: 0, yPercent: 0, duration: MOTION.duration.reduced, ease: EASE.reduced },
          0,
        )
        return
      }
      const offset = sheetOffsetVars(side)
      tl.fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: duration * 0.8, ease: EASE.fadeIn }, 0).fromTo(
        content,
        { autoAlpha: 1, ...offset },
        {
          autoAlpha: 1,
          xPercent: 0,
          yPercent: 0,
          duration,
          ease: EASE.springSheet,
        },
        0,
      )
    },
  })
}

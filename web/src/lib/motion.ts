/**
 * 21GAM Motion System — lightweight tokens, spring math, presence state, and
 * lazy GSAP controller loader.
 *
 * Keeps GSAP and `@gsap/react` out of Reception's initial `/floor` bundle; the
 * runtime controller in `./motion-controller` loads on first overlay intent or open.
 */
import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

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
 * Always-matching `all` condition paired with `prefers-reduced-motion: reduce`
 * so `gsap.matchMedia()` initializes both normal and reduced motion paths.
 */
export const MOTION_MEDIA_QUERIES = {
  all: "all",
  reduceMotion: "(prefers-reduced-motion: reduce)",
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
 * Stable callback ref that exposes the mounted DOM node in state (triggering
 * setup only when the node actually mounts/unmounts) while forwarding `externalRef`.
 */
export function useStableNodeRef<T>(externalRef?: React.Ref<T>): [T | null, React.RefCallback<T>] {
  const [node, setNode] = useState<T | null>(null)
  const externalRefHolder = useRef(externalRef)

  useLayoutEffect(() => {
    externalRefHolder.current = externalRef
  })

  const callbackRef = useCallback((el: T | null) => {
    setNode((prev) => (prev === el ? prev : el))
    const ext = externalRefHolder.current
    if (!ext) return
    if (typeof ext === "function") {
      ext(el)
    } else {
      ;(ext as React.MutableRefObject<T | null>).current = el
    }
  }, [])

  return [node, callbackRef]
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

type MotionControllerModule = typeof import("./motion-controller")

let cachedController: MotionControllerModule | null = null
let pendingLoad: Promise<MotionControllerModule> | null = null

/** Preloads the lazy GSAP controller on trigger hover/focus/pointer-down intent. */
export function prewarmMotionController(): Promise<MotionControllerModule> {
  if (cachedController) return Promise.resolve(cachedController)
  if (!pendingLoad) {
    pendingLoad = import("./motion-controller").then((mod) => {
      cachedController = mod
      return mod
    })
  }
  return pendingLoad
}

/** Returns the cached GSAP controller synchronously once loaded, or fetches it when active. */
export function useMotionController(active: boolean): MotionControllerModule | null {
  const [loaded, setLoaded] = useState<MotionControllerModule | null>(() => cachedController)
  const resolved = loaded ?? cachedController

  useEffect(() => {
    if (!active || resolved) return
    let cancelled = false
    void prewarmMotionController().then((mod) => {
      if (!cancelled) setLoaded(mod)
    })
    return () => {
      cancelled = true
    }
  }, [active, resolved])

  return resolved
}

/**
 * Hides first-open overlay opacity briefly while the lazy GSAP controller
 * arrives on cold programmatic opens so there is no visible 1->0->1 flash,
 * while keeping the modal focusable and interactive (falls back after 250ms).
 */
export function useAwaitingMotionController(present: boolean, isOpen: boolean): boolean {
  const controller = useMotionController(present)
  const [timedOut, setTimedOut] = useState(false)

  if ((!present || controller) && timedOut) {
    setTimedOut(false)
  }

  useEffect(() => {
    if (!present || !isOpen || controller) return
    const id = window.setTimeout(() => setTimedOut(true), 250)
    return () => window.clearTimeout(id)
  }, [controller, isOpen, present])

  return present && isOpen && !controller && !timedOut
}

/**
 * Renders the lazy GSAP presence controller alongside already-mounted portal
 * nodes without adding any DOM elements or replacing Radix focus scopes.
 */
export function OverlayMotionMount({
  kind,
  open,
  side = "right",
  duration,
  overlay,
  content,
  onExitComplete,
}: {
  kind: "dialog" | "sheet"
  open: boolean
  side?: SheetSide
  duration?: number
  overlay: HTMLElement
  content: HTMLElement
  onExitComplete: () => void
}) {
  const controller = useMotionController(true)

  useEffect(() => {
    if (!open && !controller) {
      onExitComplete()
    }
  }, [controller, onExitComplete, open])

  if (!controller) return null

  if (kind === "dialog") {
    return createElement(controller.DialogPresenceController, {
      open,
      overlay,
      content,
      onExitComplete,
    })
  }

  return createElement(controller.SheetPresenceController, {
    open,
    side,
    duration,
    overlay,
    content,
    onExitComplete,
  })
}

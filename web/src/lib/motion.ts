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
 * Always-matching `"all"` media query paired with `prefers-reduced-motion: reduce`
 * so `gsap.matchMedia()` initializes both normal and reduced motion paths.
 * Uses key `always` instead of `"all"` because GSAP's `MatchMedia.add()` skips
 * populating `conditions["all"]`, which causes `_onMediaChange()` to falsely
 * treat unrelated media events as a toggle (`true !== undefined`).
 */
export const MOTION_MEDIA_QUERIES = {
  always: "all",
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

interface AppliedRefState<T> {
  ref: React.Ref<T> | undefined
  node: T | null
  cleanup?: () => void
}

function detachExternalRef<T>(applied: AppliedRefState<T>): void {
  if (applied.node === null) return
  if (applied.cleanup) {
    applied.cleanup()
  } else if (typeof applied.ref === "function") {
    applied.ref(null)
  } else if (applied.ref) {
    ;(applied.ref as React.MutableRefObject<T | null>).current = null
  }
  applied.node = null
  applied.cleanup = undefined
}

function attachExternalRef<T>(applied: AppliedRefState<T>, ref: React.Ref<T> | undefined, node: T | null): void {
  applied.ref = ref
  if (node === null || !ref) {
    applied.node = null
    applied.cleanup = undefined
    return
  }
  applied.node = node
  if (typeof ref === "function") {
    const cleanup = ref(node)
    applied.cleanup = typeof cleanup === "function" ? cleanup : undefined
  } else {
    ;(ref as React.MutableRefObject<T | null>).current = node
    applied.cleanup = undefined
  }
}

/**
 * Stable callback ref that exposes the mounted DOM node in state (triggering
 * setup only when the node actually mounts/unmounts) while synchronizing
 * `externalRef` changes independently of internal node readiness.
 */
export function useStableNodeRef<T>(externalRef?: React.Ref<T>): [T | null, React.RefCallback<T>] {
  const [node, setNode] = useState<T | null>(null)
  const nodeRef = useRef<T | null>(null)
  const latestExternalRef = useRef(externalRef)
  const appliedRef = useRef<AppliedRefState<T>>({ ref: externalRef, node: null })

  useLayoutEffect(() => {
    latestExternalRef.current = externalRef
    if (appliedRef.current.ref !== externalRef || appliedRef.current.node !== nodeRef.current) {
      detachExternalRef(appliedRef.current)
      attachExternalRef(appliedRef.current, externalRef, nodeRef.current)
    }
  }, [externalRef])

  useLayoutEffect(() => {
    const applied = appliedRef.current
    return () => {
      detachExternalRef(applied)
    }
  }, [])

  const callbackRef = useCallback((el: T | null) => {
    nodeRef.current = el
    setNode((prev) => (prev === el ? prev : el))
    if (appliedRef.current.node === el && appliedRef.current.ref === latestExternalRef.current) {
      return
    }
    detachExternalRef(appliedRef.current)
    attachExternalRef(appliedRef.current, latestExternalRef.current, el)
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
 * Tracks cold-load fallback state for an overlay presence:
 * - `awaitingMotion`: hides first-open overlay opacity briefly (up to 250ms) while
 *   the lazy GSAP controller arrives so there is no visible 1->0->1 flash.
 * - `fallbackShown`: remembers whether this presence already revealed its visible
 *   fallback after 250ms so a late-arriving controller settles at the open endpoint
 *   without resetting to 0 or replaying entrance.
 */
export function useAwaitingMotionController(
  present: boolean,
  isOpen: boolean,
): { awaitingMotion: boolean; fallbackShown: boolean } {
  const controller = useMotionController(present)
  const [fallbackShown, setFallbackShown] = useState(false)

  // Reset once the presence exits completely so subsequent opens animate normally.
  if (!present && fallbackShown) {
    setFallbackShown(false)
  }

  useEffect(() => {
    if (!present || !isOpen || controller || fallbackShown) return
    const id = window.setTimeout(() => setFallbackShown(true), 250)
    return () => window.clearTimeout(id)
  }, [controller, fallbackShown, isOpen, present])

  return {
    awaitingMotion: present && isOpen && !controller && !fallbackShown,
    fallbackShown,
  }
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
  skipInitialEnter = false,
  overlay,
  content,
  onExitComplete,
}: {
  kind: "dialog" | "sheet"
  open: boolean
  side?: SheetSide
  duration?: number
  skipInitialEnter?: boolean
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
      skipInitialEnter,
      overlay,
      content,
      onExitComplete,
    })
  }

  return createElement(controller.SheetPresenceController, {
    open,
    side,
    duration,
    skipInitialEnter,
    overlay,
    content,
    onExitComplete,
  })
}

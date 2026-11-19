/**
 * Lazy-loaded React GSAP presence controller components for 21GAM overlays.
 */
import { useGSAP } from "@gsap/react"
import { useLayoutEffect, useRef } from "react"
import { MOTION, type SheetSide } from "./motion"
import {
  buildDialogTimeline,
  buildSheetTimeline,
  registerMotion,
  setupOverlayMatchMedia,
  type TimelineBuilderParams,
} from "./motion-matchmedia"

registerMotion()

function useOverlayPresenceTimeline({
  open,
  overlay,
  content,
  onExitComplete,
  buildTimeline,
  skipInitialEnter = false,
  deps,
}: {
  open: boolean
  overlay: HTMLElement
  content: HTMLElement
  onExitComplete: () => void
  buildTimeline: (params: TimelineBuilderParams) => void
  skipInitialEnter?: boolean
  deps: readonly unknown[]
}) {
  const tlRef = useRef<gsap.core.Timeline | null>(null)
  const openRef = useRef(open)
  const onExitRef = useRef(onExitComplete)
  const buildRef = useRef(buildTimeline)
  const skipInitialEnterRef = useRef(skipInitialEnter)

  useLayoutEffect(() => {
    openRef.current = open
    onExitRef.current = onExitComplete
    buildRef.current = buildTimeline
    skipInitialEnterRef.current = skipInitialEnter
  })

  useGSAP(
    () => {
      const mm = setupOverlayMatchMedia({
        overlay,
        content,
        openRef,
        onExitRef,
        tlRef,
        skipInitialEnterRef,
        buildTimeline: (params) => buildRef.current(params),
      })
      return () => {
        mm.revert()
      }
    },
    { scope: content, dependencies: [overlay, content, ...deps], revertOnUpdate: true },
  )

  useGSAP(
    () => {
      openRef.current = open
      const tl = tlRef.current
      if (open) {
        if (tl && tl.progress() < 1) {
          tl.timeScale(1).play()
        }
      } else if (!tl || tl.progress() === 0) {
        onExitRef.current()
      } else {
        tl.timeScale(1.25).reverse()
      }
    },
    { scope: content, dependencies: [open] },
  )
}

/** Non-UI GSAP presence controller mounted inside portaled dialogs when DOM nodes exist. */
export function DialogPresenceController({
  open,
  skipInitialEnter = false,
  overlay,
  content,
  onExitComplete,
}: {
  open: boolean
  skipInitialEnter?: boolean
  overlay: HTMLElement
  content: HTMLElement
  onExitComplete: () => void
}): null {
  useOverlayPresenceTimeline({
    open,
    overlay,
    content,
    onExitComplete,
    skipInitialEnter,
    deps: [],
    buildTimeline: buildDialogTimeline,
  })
  return null
}

/** Non-UI GSAP presence controller mounted inside sheets/drawers when DOM nodes exist. */
export function SheetPresenceController({
  open,
  side,
  duration = MOTION.duration.sheet,
  skipInitialEnter = false,
  overlay,
  content,
  onExitComplete,
}: {
  open: boolean
  side: SheetSide
  duration?: number
  skipInitialEnter?: boolean
  overlay: HTMLElement
  content: HTMLElement
  onExitComplete: () => void
}): null {
  useOverlayPresenceTimeline({
    open,
    overlay,
    content,
    onExitComplete,
    skipInitialEnter,
    deps: [side, duration],
    buildTimeline: (params) => buildSheetTimeline({ ...params, side, duration }),
  })
  return null
}

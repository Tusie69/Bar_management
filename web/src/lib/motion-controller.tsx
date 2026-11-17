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
  deps,
}: {
  open: boolean
  overlay: HTMLElement
  content: HTMLElement
  onExitComplete: () => void
  buildTimeline: (params: TimelineBuilderParams) => void
  deps: readonly unknown[]
}) {
  const tlRef = useRef<gsap.core.Timeline | null>(null)
  const openRef = useRef(open)
  const onExitRef = useRef(onExitComplete)
  const buildRef = useRef(buildTimeline)

  useLayoutEffect(() => {
    openRef.current = open
    onExitRef.current = onExitComplete
    buildRef.current = buildTimeline
  })

  useGSAP(
    () => {
      const mm = setupOverlayMatchMedia({
        overlay,
        content,
        openRef,
        onExitRef,
        tlRef,
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
        tl?.timeScale(1).play()
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
  overlay,
  content,
  onExitComplete,
}: {
  open: boolean
  overlay: HTMLElement
  content: HTMLElement
  onExitComplete: () => void
}): null {
  useOverlayPresenceTimeline({
    open,
    overlay,
    content,
    onExitComplete,
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
  overlay,
  content,
  onExitComplete,
}: {
  open: boolean
  side: SheetSide
  duration?: number
  overlay: HTMLElement
  content: HTMLElement
  onExitComplete: () => void
}): null {
  useOverlayPresenceTimeline({
    open,
    overlay,
    content,
    onExitComplete,
    deps: [side, duration],
    buildTimeline: (params) => buildSheetTimeline({ ...params, side, duration }),
  })
  return null
}

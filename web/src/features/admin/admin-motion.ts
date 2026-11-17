/**
 * Admin-only GSAP choreography — bundled exclusively in the lazy-loaded `/admin`
 * chunk so Reception's critical path pays zero extra bytes for admin animations.
 */
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useRef } from "react"
import { EASE, MOTION, MOTION_MEDIA_QUERIES } from "@/lib/motion"
import { registerMotion } from "@/lib/motion-matchmedia"

registerMotion()

/**
 * Creates a `gsap.matchMedia()` reveal context with an always-matching `all`
 * condition so both normal and reduced-motion profiles initialize reliably.
 */
export function setupRevealMatchMedia(targets: HTMLElement[]): gsap.MatchMedia {
  let hasPlayed = false
  const mm = gsap.matchMedia()
  mm.add(MOTION_MEDIA_QUERIES, (context) => {
    const reduceMotion = Boolean(context.conditions?.reduceMotion)
    if (hasPlayed) {
      gsap.set(targets, { clearProps: "transform,opacity,visibility,willChange" })
      return
    }
    hasPlayed = true
    for (const el of targets) {
      el.style.willChange = "transform, opacity"
    }
    gsap.fromTo(targets, reduceMotion ? { autoAlpha: 0 } : { autoAlpha: 0, y: 10 }, {
      autoAlpha: 1,
      y: 0,
      duration: reduceMotion ? MOTION.duration.reduced : MOTION.duration.section,
      ease: reduceMotion ? EASE.reduced : EASE.springDefault,
      stagger: reduceMotion ? 0 : 0.04,
      overwrite: "auto",
      clearProps: "transform,opacity,visibility,willChange",
    })
  })
  return mm
}

/**
 * Staggered first reveal of `[data-adm-reveal]` card groups once per route visit.
 * Reverts its matchMedia context when navigating away (`revertOnUpdate: true`)
 * and never re-runs on realtime data refreshes inside the same route.
 */
export function useAdminCardReveal(containerRef: React.RefObject<HTMLElement | null>, routeKey: string): void {
  const revealedRoutesRef = useRef<Set<string>>(new Set())

  useGSAP(
    () => {
      const root = containerRef.current
      if (!root || revealedRoutesRef.current.has(routeKey)) return

      const targets = gsap.utils.toArray<HTMLElement>("[data-adm-reveal]", root)
      if (targets.length === 0) return

      revealedRoutesRef.current.add(routeKey)
      const mm = setupRevealMatchMedia(targets)

      return () => {
        mm.revert()
      }
    },
    { scope: containerRef, dependencies: [routeKey], revertOnUpdate: true },
  )
}

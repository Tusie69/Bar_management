/**
 * Admin-only GSAP choreography — bundled exclusively in the lazy-loaded `/admin`
 * chunk so Reception's critical path pays zero extra bytes for admin animations.
 */
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useRef } from "react"
import { EASE, MOTION } from "@/lib/motion"

/**
 * Staggered first reveal of `[data-adm-reveal]` card groups once per route visit.
 * Never re-runs on realtime data refreshes inside the same route.
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

      const mm = gsap.matchMedia()
      mm.add(
        {
          reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const reduceMotion = Boolean(context.conditions?.reduceMotion)
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
        },
      )

      return () => {
        mm.revert()
      }
    },
    { scope: containerRef, dependencies: [routeKey] },
  )
}

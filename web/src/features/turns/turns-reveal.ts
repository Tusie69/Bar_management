import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useRef } from "react"
import { setupRevealMatchMedia } from "@/features/admin/admin-motion"

/** Runs one short staggered entrance via `lib/motion.ts` tokens inside scoped `useGSAP` once on first load; never on refresh or filter change. */
export function useTurnsFirstReveal(rootRef: React.RefObject<HTMLDivElement | null>, ready: boolean): void {
  const revealedRef = useRef(false)

  useGSAP(
    () => {
      if (!ready || revealedRef.current) return
      const root = rootRef.current
      if (!root) return

      const targets = gsap.utils.toArray<HTMLElement>("[data-turns-reveal]", root)
      if (targets.length === 0) return

      revealedRef.current = true
      const mm = setupRevealMatchMedia(targets)
      return () => {
        mm.revert()
      }
    },
    { scope: rootRef, dependencies: [ready] },
  )
}

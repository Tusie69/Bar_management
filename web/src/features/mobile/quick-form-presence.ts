/**
 * Coordinates QuickForm's GSAP exit lifetime with `useUi.draft` inside the
 * mobile map screen without modifying the shared `QuickForm` or `useUi`
 * contracts owned by P4.
 *
 * `QuickForm` reads `useUi().draft!` unconditionally during render, so
 * clearing `ui.draft` immediately on close would crash during the bottom-sheet
 * exit animation. This hook keeps `ui.draft` valid until `onExitComplete`
 * unmounts `QuickForm`, while immediately marking the mobile map draft inactive.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { usePresenceController } from "@/lib/motion"
import { useUi, type QuickDraft } from "@/state/ui"

const useSafeLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

type ClosingKind = "booking" | "walkin" | null

interface OriginalUiActions {
  openBooking: ReturnType<typeof useUi.getState>["openBooking"]
  closeBooking: ReturnType<typeof useUi.getState>["closeBooking"]
  openWalkIn: ReturnType<typeof useUi.getState>["openWalkIn"]
  closeWalkIn: ReturnType<typeof useUi.getState>["closeWalkIn"]
}

export function useQuickFormPresence(): {
  activeDraft: QuickDraft | null
  storeDraft: QuickDraft | null
  isOpen: boolean
  present: boolean
  sessionKey: number
  onExitComplete: () => void
} {
  const storeDraft = useUi((s) => s.draft)
  const storeOpen = useUi((s) => s.bookingOpen || s.walkInOpen)
  const [exitingKind, setExitingKind] = useState<ClosingKind>(null)
  const [sessionKey, setSessionKey] = useState(0)
  const exitingKindRef = useRef<ClosingKind>(null)
  const origRef = useRef<OriginalUiActions | null>(null)

  useSafeLayoutEffect(() => {
    const current = useUi.getState()
    const orig: OriginalUiActions = {
      openBooking: current.openBooking,
      closeBooking: current.closeBooking,
      openWalkIn: current.openWalkIn,
      closeWalkIn: current.closeWalkIn,
    }
    origRef.current = orig

    useUi.setState({
      openBooking: (prefill) => {
        exitingKindRef.current = null
        setExitingKind(null)
        setSessionKey((k) => k + 1)
        orig.openBooking(prefill)
      },
      openWalkIn: (prefill) => {
        exitingKindRef.current = null
        setExitingKind(null)
        setSessionKey((k) => k + 1)
        orig.openWalkIn(prefill)
      },
      closeBooking: () => {
        const cur = useUi.getState().draft
        if (!cur) {
          orig.closeBooking()
          return
        }
        exitingKindRef.current = "booking"
        setExitingKind("booking")
        useUi.setState({ bookingOpen: false, walkInOpen: false })
      },
      closeWalkIn: () => {
        const cur = useUi.getState().draft
        if (!cur) {
          orig.closeWalkIn()
          return
        }
        exitingKindRef.current = "walkin"
        setExitingKind("walkin")
        useUi.setState({ walkInOpen: false, bookingOpen: false })
      },
    })

    return () => {
      useUi.setState({
        openBooking: orig.openBooking,
        closeBooking: orig.closeBooking,
        openWalkIn: orig.openWalkIn,
        closeWalkIn: orig.closeWalkIn,
      })
      const pending = exitingKindRef.current
      exitingKindRef.current = null
      origRef.current = null
      if (pending === "walkin") orig.closeWalkIn()
      else if (pending === "booking") orig.closeBooking()
    }
  }, [])

  // Handle direct `useUi.setState({ bookingOpen: true, ... })` calls that bypass `openBooking`.
  if (storeOpen && exitingKind !== null) {
    setExitingKind(null)
    setSessionKey((k) => k + 1)
  }

  useSafeLayoutEffect(() => {
    exitingKindRef.current = exitingKind
  }, [exitingKind])

  const activeDraft = exitingKind === null ? storeDraft : null
  const { isOpen, present, markExited } = usePresenceController({ open: Boolean(activeDraft) })

  const onExitComplete = useCallback(() => {
    markExited()
    const pending = exitingKindRef.current
    if (!pending) return
    exitingKindRef.current = null
    setExitingKind(null)
    const orig = origRef.current
    if (!orig) return
    if (pending === "walkin") orig.closeWalkIn()
    else orig.closeBooking()
  }, [markExited])

  return {
    activeDraft,
    storeDraft,
    isOpen,
    present,
    sessionKey,
    onExitComplete,
  }
}

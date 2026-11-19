import type { AvailabilityResult } from "@/domain/models"
import type { QuickDraft } from "@/state/ui"
import type { AvailabilityStatus } from "./quick-form"

export type BottomPanelSnapshot =
  | {
      kind: "draft"
      sessionId: number
      draft: QuickDraft
      availability: AvailabilityResult | undefined
      availabilityStatus: AvailabilityStatus
    }
  | { kind: "table"; tableId: number }
  | { kind: "availability"; selection: number[] }

export interface BottomPanelState {
  wasOpen: boolean
  nextSessionId: number
  snapshot: BottomPanelSnapshot | null
}

export interface BottomPanelInputs {
  open: boolean
  present: boolean
  live: boolean
  draft: QuickDraft | null
  draftAvailability: AvailabilityResult | undefined
  draftAvailabilityStatus: AvailabilityStatus
  selectedTableId: number | null
  availSelection: number[]
}

export const INITIAL_BOTTOM_PANEL_STATE: BottomPanelState = {
  wasOpen: false,
  nextSessionId: 0,
  snapshot: null,
}

/**
 * Retains the active bottom-sheet panel kind, draft session key, and display
 * data while the P1 presence controller is still running its exit animation,
 * and increments the draft session id on every fresh open (including mid-exit
 * reopens) so form inputs never leak across sessions.
 */
export function nextBottomPanelState(prev: BottomPanelState, input: BottomPanelInputs): BottomPanelState {
  const { open, present, live, draft, draftAvailability, draftAvailabilityStatus, selectedTableId, availSelection } =
    input

  if (open) {
    if (draft) {
      const prevDraft = prev.snapshot?.kind === "draft" ? prev.snapshot : null
      const freshOpen = !prev.wasOpen || !prevDraft
      const sessionId = freshOpen ? prev.nextSessionId + 1 : prevDraft.sessionId
      if (
        prev.wasOpen &&
        prevDraft &&
        prevDraft.sessionId === sessionId &&
        prevDraft.draft === draft &&
        prevDraft.availability === draftAvailability &&
        prevDraft.availabilityStatus === draftAvailabilityStatus
      ) {
        return prev
      }
      return {
        wasOpen: true,
        nextSessionId: Math.max(prev.nextSessionId, sessionId),
        snapshot: {
          kind: "draft",
          sessionId,
          draft,
          availability: draftAvailability,
          availabilityStatus: draftAvailabilityStatus,
        },
      }
    }

    if (!live && availSelection.length > 0) {
      if (prev.wasOpen && prev.snapshot?.kind === "availability" && prev.snapshot.selection === availSelection) {
        return prev
      }
      return {
        wasOpen: true,
        nextSessionId: prev.nextSessionId,
        snapshot: { kind: "availability", selection: availSelection },
      }
    }

    if (live && selectedTableId !== null) {
      if (prev.wasOpen && prev.snapshot?.kind === "table" && prev.snapshot.tableId === selectedTableId) {
        return prev
      }
      return {
        wasOpen: true,
        nextSessionId: prev.nextSessionId,
        snapshot: { kind: "table", tableId: selectedTableId },
      }
    }
  }

  if (present) {
    if (!prev.wasOpen) return prev
    return { ...prev, wasOpen: false }
  }

  if (!prev.wasOpen && prev.snapshot === null) return prev
  return { ...prev, wasOpen: false, snapshot: null }
}

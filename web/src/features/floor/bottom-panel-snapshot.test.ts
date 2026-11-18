import { describe, expect, it } from "vitest"
import type { AvailabilityResult } from "@/domain/models"
import type { QuickDraft } from "@/state/ui"
import { INITIAL_BOTTOM_PANEL_STATE, nextBottomPanelState } from "./bottom-panel-snapshot"

const bookingDraft: QuickDraft = {
  kind: "booking",
  date: "2026-11-17",
  time: "20:00",
  party: 4,
  tableIds: [10],
}

const walkInDraft: QuickDraft = {
  kind: "walkin",
  date: "2026-11-17",
  time: "21:30",
  party: 2,
  tableIds: [],
}

const availabilityResult: AvailabilityResult = {
  at: new Date("2026-11-17T13:00:00.000Z"),
  businessDate: "2026-11-17",
  partySize: 4,
  policy: "SEQUENTIAL",
  tables: [],
  combinations: [],
}

describe("nextBottomPanelState (P4-02)", () => {
  it("retains quick-form draft, sessionId, and availability through exit until markExited", () => {
    const opened = nextBottomPanelState(INITIAL_BOTTOM_PANEL_STATE, {
      open: true,
      present: true,
      live: true,
      draft: bookingDraft,
      draftAvailability: availabilityResult,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    expect(opened.wasOpen).toBe(true)
    expect(opened.snapshot).toEqual({
      kind: "draft",
      sessionId: 1,
      draft: bookingDraft,
      availability: availabilityResult,
      availabilityStatus: "ready",
    })

    // Operational draft clears on close, but presence remains true while exiting.
    const exiting = nextBottomPanelState(opened, {
      open: false,
      present: true,
      live: true,
      draft: null,
      draftAvailability: undefined,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    expect(exiting.wasOpen).toBe(false)
    expect(exiting.snapshot).toEqual(opened.snapshot)

    // Detaches once presence finishes exiting.
    const exited = nextBottomPanelState(exiting, {
      open: false,
      present: false,
      live: true,
      draft: null,
      draftAvailability: undefined,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    expect(exited.wasOpen).toBe(false)
    expect(exited.snapshot).toBeNull()
  })

  it("increments sessionId on rapid reopen mid-exit so stale inputs never leak", () => {
    const opened = nextBottomPanelState(INITIAL_BOTTOM_PANEL_STATE, {
      open: true,
      present: true,
      live: true,
      draft: bookingDraft,
      draftAvailability: availabilityResult,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    const exiting = nextBottomPanelState(opened, {
      open: false,
      present: true,
      live: true,
      draft: null,
      draftAvailability: undefined,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    // Reopen before exit completes.
    const reopened = nextBottomPanelState(exiting, {
      open: true,
      present: true,
      live: true,
      draft: walkInDraft,
      draftAvailability: undefined,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    expect(reopened.wasOpen).toBe(true)
    expect(reopened.snapshot).toMatchObject({
      kind: "draft",
      sessionId: 2,
      draft: walkInDraft,
    })
  })

  it("keeps the same sessionId when updating draft tables while open", () => {
    const opened = nextBottomPanelState(INITIAL_BOTTOM_PANEL_STATE, {
      open: true,
      present: true,
      live: true,
      draft: bookingDraft,
      draftAvailability: availabilityResult,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    const updatedDraft: QuickDraft = { ...bookingDraft, tableIds: [10, 11] }
    const updated = nextBottomPanelState(opened, {
      open: true,
      present: true,
      live: true,
      draft: updatedDraft,
      draftAvailability: availabilityResult,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    expect(updated.snapshot).toMatchObject({
      kind: "draft",
      sessionId: 1,
      draft: updatedDraft,
    })
  })

  it("retains quick-form instead of falling back to an earlier selected table on close", () => {
    const tableOpened = nextBottomPanelState(INITIAL_BOTTOM_PANEL_STATE, {
      open: true,
      present: true,
      live: true,
      draft: null,
      draftAvailability: undefined,
      draftAvailabilityStatus: "ready",
      selectedTableId: 4,
      availSelection: [],
    })

    const draftOpened = nextBottomPanelState(tableOpened, {
      open: true,
      present: true,
      live: true,
      draft: bookingDraft,
      draftAvailability: availabilityResult,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    const draftExiting = nextBottomPanelState(draftOpened, {
      open: false,
      present: true,
      live: true,
      draft: null,
      draftAvailability: undefined,
      draftAvailabilityStatus: "ready",
      selectedTableId: null,
      availSelection: [],
    })

    expect(draftExiting.snapshot).toMatchObject({ kind: "draft", sessionId: 1, draft: bookingDraft })
  })
})

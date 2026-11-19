import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/services", () => ({
  clock: { now: () => new Date("2026-11-18T12:00:00Z") },
}))

import { useUi } from "./ui"

describe("useUi quick-form draft party sync (P4-07)", () => {
  beforeEach(() => {
    useUi.setState({
      floorMode: "live",
      availDate: "2026-11-18",
      availTime: "19:00",
      availParty: 2,
      selectedTableId: null,
      pick: null,
      pickSelection: [],
      bookingOpen: false,
      bookingPrefill: {},
      walkInOpen: false,
      walkInPrefill: [],
      draft: null,
    })
  })

  it("starts a brand-new session from the existing defaults (4 for booking, 2 for walk-in)", () => {
    useUi.getState().openBooking()
    expect(useUi.getState().draft).toMatchObject({ kind: "booking", party: 4, tableIds: [] })

    useUi.getState().closeBooking()
    expect(useUi.getState().draft).toBeNull()

    useUi.getState().openWalkIn()
    expect(useUi.getState().draft).toMatchObject({ kind: "walkin", party: 2, tableIds: [] })
  })

  it("preserves the chosen draft party across Đặt bàn -> Walk-in -> Đặt bàn switches while open", () => {
    useUi.getState().openBooking()
    useUi.getState().setDraft({ party: 6 })
    expect(useUi.getState().draft?.party).toBe(6)

    useUi.getState().openWalkIn()
    expect(useUi.getState().walkInOpen).toBe(true)
    expect(useUi.getState().bookingOpen).toBe(false)
    expect(useUi.getState().draft).toMatchObject({ kind: "walkin", party: 6, tableIds: [] })

    useUi.getState().openBooking()
    expect(useUi.getState().bookingOpen).toBe(true)
    expect(useUi.getState().walkInOpen).toBe(false)
    expect(useUi.getState().draft).toMatchObject({ kind: "booking", party: 6, tableIds: [] })
  })

  it("preserves the chosen draft party across Walk-in -> Đặt bàn -> Walk-in switches while open", () => {
    useUi.getState().openWalkIn([10])
    useUi.getState().setDraft({ party: 8 })

    useUi.getState().openBooking()
    expect(useUi.getState().draft).toMatchObject({ kind: "booking", party: 8, tableIds: [] })

    useUi.getState().openWalkIn()
    expect(useUi.getState().draft).toMatchObject({ kind: "walkin", party: 8, tableIds: [] })
  })

  it("resets to default party when reopening after close or during mid-exit close state", () => {
    useUi.getState().openBooking()
    useUi.getState().setDraft({ party: 6 })
    useUi.getState().closeBooking()

    useUi.getState().openBooking()
    expect(useUi.getState().draft?.party).toBe(4)

    // Simulate mobile presence exit: open flags are false while draft stays mounted until exit finishes.
    useUi.getState().setDraft({ party: 7 })
    useUi.setState({ bookingOpen: false, walkInOpen: false })

    useUi.getState().openWalkIn()
    expect(useUi.getState().draft?.party).toBe(2)

    useUi.getState().setDraft({ party: 7 })
    useUi.setState({ bookingOpen: false, walkInOpen: false })

    useUi.getState().openBooking()
    expect(useUi.getState().draft?.party).toBe(4)
  })
})

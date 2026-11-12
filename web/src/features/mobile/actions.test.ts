import { describe, expect, it, vi } from "vitest"
import type { ReservationView, WaitlistEntryView } from "@/domain/models"
import type { Permission } from "@/domain/access"
vi.mock("@/services", () => ({ api: { mode: "http" }, clock: { now: () => new Date() } }))
vi.mock("@/state/session", () => ({ useSession: { getState: () => ({ permissions: [] }) } }))
import { bookingOrderPolicy, classifyHeldOrder, heldOrderPolicy } from "./actions"

const booking = { id: 10, status: "BOOKED", tableIds: [2], waitlistEntryId: null } as ReservationView
const entry = { id: 3, status: "HOLD_ACTIVE", reservationId: 10, hold: null } as WaitlistEntryView
const offer = { ...entry, hold: { id: 7, version: 4, tableIds: [2] } } as WaitlistEntryView
const pure = { ...offer, reservationId: null }
const owner = () => true

describe("held order policy", () => {
  it("proves loaded-empty before enabling direct booking actions and keeps cached links on error", () => {
    for (const query of [undefined, { status: "pending" }, { status: "error" }, { status: "success", fetchStatus: "fetching", data: [] }, { status: "error", data: [offer] }]) {
      const policy = bookingOrderPolicy(booking, query, owner, "mock")
      expect(policy.kind).toBe("unsupported")
      expect([policy.canArrival, policy.canReassign, policy.canBookingStatus, policy.canLate]).toEqual([false, false, false, false])
      expect(policy.reason).toBeTruthy()
    }
    expect(bookingOrderPolicy(booking, { status: "error", data: [offer] }, owner, "mock").entry).toBe(offer)
    expect(bookingOrderPolicy(booking, { status: "success", data: [] }, owner, "http").kind).toBe("direct")
    expect(bookingOrderPolicy({ ...booking, waitlistEntryId: 3 }, { status: "success", data: [] }, owner, "http").canReassign).toBe(false)
    expect(bookingOrderPolicy({ ...booking, waitlistEntryId: 3 }, { status: "success", data: [{ ...entry, status: "WAITING" }] }, owner, "http").kind).toBe("direct")
    expect(bookingOrderPolicy(booking, { status: "success", data: [offer] }, owner, "http").canReassign).toBe(false)
    const recovered = bookingOrderPolicy(booking, { status: "success", data: [offer] }, owner, "mock")
    expect(recovered.canBookingStatus).toBe(true)
    expect(recovered.canLate).toBe(false)
  })
  it("requires booking allocations instead of inferring canonical HTTP hold from null", () => {
    expect(classifyHeldOrder(entry, booking)).toBe("reservation")
    const unassigned = { ...booking, tableIds: [] }
    expect(classifyHeldOrder(entry, unassigned)).toBe("unsupported")
    expect(heldOrderPolicy(entry, unassigned, owner, "http").canArrival).toBe(false)
    expect(heldOrderPolicy(entry, unassigned, owner, "http").canReassign).toBe(false)
    expect(classifyHeldOrder(entry, { ...booking, id: 11 })).toBe("unsupported")
  })
  it("keeps offer mutation separate and disables unsupported HTTP actions", () => {
    expect(classifyHeldOrder(offer, booking)).toBe("offer")
    expect(classifyHeldOrder(offer, undefined)).toBe("unsupported")
    expect(heldOrderPolicy(offer, booking, owner, "mock").canReassign).toBe(true)
    for (const [e, r] of [[offer, booking], [pure, null]] as const) {
      const policy = heldOrderPolicy(e, r, owner, "http")
      expect(policy.canArrival).toBe(false)
      expect(policy.canReassign).toBe(false)
      expect(policy.canLate).toBe(false)
    }
  })
  it.each<Permission>(["visit.checkin", "waitlist.accept_offer", "reservation.create", "table.assign"])("requires %s before pure arrival", (revoked) => {
    expect(heldOrderPolicy(pure, null, (permission) => permission !== revoked, "mock").canArrival).toBe(false)
    expect(heldOrderPolicy(pure, null, owner, "mock").canArrival).toBe(true)
  })
  it("does not offer arrival for closed bookings or seated entries", () => {
    expect(classifyHeldOrder(offer, { ...booking, status: "CANCELLED" })).toBe("unsupported")
    expect(heldOrderPolicy({ ...entry, status: "SEATED" }, { ...booking, status: "CHECKED_IN" }, owner, "http").canArrival).toBe(false)
    expect(classifyHeldOrder(undefined, booking)).toBe("direct")
  })
})

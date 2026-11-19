import { describe, expect, it, vi } from "vitest"
import type { MutationResult, ReservationView, WaitlistEntryView } from "@/domain/models"
import { roleCan, type Permission } from "@/domain/access"
import type { RoleCode } from "@/domain/enums"
vi.mock("@/services", () => ({ api: { mode: "http" }, clock: { now: () => new Date() } }))
vi.mock("@/state/session", () => ({ useSession: { getState: () => ({ permissions: [] }) } }))
import { bookingOrderPolicy, classifyHeldOrder, heldOrderPolicy, triggerMobileCancel } from "./actions"

const booking = { id: 10, status: "BOOKED", tableIds: [2], waitlistEntryId: null } as ReservationView
const entry = { id: 3, status: "HOLD_ACTIVE", reservationId: 10, hold: null } as WaitlistEntryView
const offer = { ...entry, hold: { id: 7, version: 4, tableIds: [2] } } as WaitlistEntryView
const pure = { ...offer, reservationId: null }
const owner = () => true

describe("held order policy", () => {
  it("proves loaded-empty before enabling direct booking actions and keeps cached links on error", () => {
    for (const query of [
      undefined,
      { status: "pending" },
      { status: "error" },
      { status: "success", fetchStatus: "fetching", data: [] },
      { status: "error", data: [offer] },
    ]) {
      const policy = bookingOrderPolicy(booking, query, owner, "mock")
      expect(policy.kind).toBe("unsupported")
      expect([policy.canArrival, policy.canReassign, policy.canBookingStatus, policy.canLate]).toEqual([
        false,
        false,
        false,
        false,
      ])
      expect(policy.reason).toBeTruthy()
    }
    expect(bookingOrderPolicy(booking, { status: "error", data: [offer] }, owner, "mock").entry).toBe(offer)
    expect(bookingOrderPolicy(booking, { status: "success", data: [] }, owner, "http").kind).toBe("direct")
    expect(
      bookingOrderPolicy({ ...booking, waitlistEntryId: 3 }, { status: "success", data: [] }, owner, "http")
        .canReassign,
    ).toBe(false)
    expect(
      bookingOrderPolicy(
        { ...booking, waitlistEntryId: 3 },
        { status: "success", data: [{ ...entry, status: "WAITING" }] },
        owner,
        "http",
      ).kind,
    ).toBe("direct")
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
    for (const [e, r] of [
      [offer, booking],
      [pure, null],
    ] as const) {
      const policy = heldOrderPolicy(e, r, owner, "http")
      expect(policy.canArrival).toBe(false)
      expect(policy.canReassign).toBe(false)
      expect(policy.canLate).toBe(false)
    }
  })
  it.each<Permission>(["visit.checkin", "waitlist.accept_offer", "reservation.create", "table.assign"])(
    "requires %s before pure arrival",
    (revoked) => {
      expect(heldOrderPolicy(pure, null, (permission) => permission !== revoked, "mock").canArrival).toBe(false)
      expect(heldOrderPolicy(pure, null, owner, "mock").canArrival).toBe(true)
    },
  )
  it("does not offer arrival for closed bookings or seated entries", () => {
    expect(classifyHeldOrder(offer, { ...booking, status: "CANCELLED" })).toBe("unsupported")
    expect(
      heldOrderPolicy({ ...entry, status: "SEATED" }, { ...booking, status: "CHECKED_IN" }, owner, "http").canArrival,
    ).toBe(false)
    expect(classifyHeldOrder(undefined, booking)).toBe("direct")
  })
})

describe("triggerMobileCancel role gating", () => {
  const sampleReservation = {
    id: 42,
    version: 3,
    displayName: "Anh Minh",
    status: "BOOKED",
    tableIds: [2],
    waitlistEntryId: null,
  } as ReservationView

  const okResult: MutationResult = { operationId: 9, changeSeq: 1, summary: "Đã hủy", undoable: true }

  function makeDeps(role: RoleCode, canCancel: boolean) {
    const ask = vi.fn()
    const askCancel = vi.fn()
    const cancelReservation = vi.fn(async () => okResult)
    const verifyCanCancel = vi.fn(async () => true)
    const run = vi.fn(async (fn: () => Promise<MutationResult>) => fn())
    return {
      deps: {
        role,
        canCancel: () => canCancel,
        verifyCanCancel,
        run,
        ask,
        askCancel,
        cancelReservation,
      },
      ask,
      askCancel,
      cancelReservation,
      verifyCanCancel,
      run,
    }
  }

  it("routes RECEPTIONIST to askCancel and forwards validated reason and trimmed note", async () => {
    const { deps, ask, askCancel, cancelReservation, verifyCanCancel } = makeDeps(
      "RECEPTIONIST",
      roleCan("RECEPTIONIST", "reservation.cancel"),
    )

    triggerMobileCancel(sampleReservation, deps)

    expect(ask).not.toHaveBeenCalled()
    expect(askCancel).toHaveBeenCalledTimes(1)
    const req = askCancel.mock.calls[0][0]
    expect(req.reservation).toBe(sampleReservation)

    await req.run("DUPLICATE", "  Đặt nhầm bàn  ")

    expect(verifyCanCancel).toHaveBeenCalledWith(sampleReservation)
    expect(cancelReservation).toHaveBeenCalledTimes(1)
    expect(cancelReservation).toHaveBeenCalledWith(42, 3, "DUPLICATE", "Đặt nhầm bàn")
  })

  it.each<RoleCode>(["OWNER", "ADMIN"])(
    "keeps legacy ConfirmDialog and fixed CUSTOMER_REQUEST payload for %s with write access",
    async (role) => {
      const { deps, ask, askCancel, cancelReservation, verifyCanCancel } = makeDeps(
        role,
        roleCan(role, "reservation.cancel"),
      )

      triggerMobileCancel(sampleReservation, deps)

      expect(askCancel).not.toHaveBeenCalled()
      expect(ask).toHaveBeenCalledTimes(1)
      const confirm = ask.mock.calls[0][0]
      expect(confirm.title).toBe("Hủy booking của Anh Minh?")
      expect(confirm.body).toBe("Booking bị hủy và bàn được nhả. Thao tác được ghi vào nhật ký.")
      expect(confirm.label).toBe("Hủy booking")

      await confirm.run()

      expect(verifyCanCancel).toHaveBeenCalledWith(sampleReservation)
      expect(cancelReservation).toHaveBeenCalledTimes(1)
      expect(cancelReservation).toHaveBeenCalledWith(42, 3, "CUSTOMER_REQUEST")
    },
  )

  it("blocks READ_ONLY ADMIN (missing reservation.cancel) from opening either dialog or cancelling", () => {
    const { deps, ask, askCancel, cancelReservation } = makeDeps("ADMIN", false)

    triggerMobileCancel(sampleReservation, deps)

    expect(ask).not.toHaveBeenCalled()
    expect(askCancel).not.toHaveBeenCalled()
    expect(cancelReservation).not.toHaveBeenCalled()
  })

  it.each<RoleCode>(["CUSTOMER_CARE", "CASHIER", "WAITER"])(
    "blocks %s without reservation.cancel permission",
    (role) => {
      const { deps, ask, askCancel, cancelReservation } = makeDeps(role, roleCan(role, "reservation.cancel"))

      triggerMobileCancel(sampleReservation, deps)

      expect(ask).not.toHaveBeenCalled()
      expect(askCancel).not.toHaveBeenCalled()
      expect(cancelReservation).not.toHaveBeenCalled()
    },
  )

  it("rechecks permission and verifyCanCancel at submit time for both RECEPTIONIST and OWNER", async () => {
    for (const role of ["RECEPTIONIST", "OWNER"] as const) {
      let allowed = true
      const ask = vi.fn()
      const askCancel = vi.fn()
      const cancelReservation = vi.fn(async () => okResult)
      triggerMobileCancel(sampleReservation, {
        role,
        canCancel: () => allowed,
        verifyCanCancel: async () => false,
        run: (fn) => fn(),
        ask,
        askCancel,
        cancelReservation,
      })

      const submit =
        role === "RECEPTIONIST"
          ? () => askCancel.mock.calls[0][0].run("CUSTOMER_REQUEST", "")
          : ask.mock.calls[0][0].run
      await expect(submit()).rejects.toThrow("Chưa hỗ trợ hoặc thiếu quyền hủy booking.")

      allowed = false
      await expect(submit()).rejects.toThrow("Chưa hỗ trợ hoặc thiếu quyền hủy booking.")
      expect(cancelReservation).not.toHaveBeenCalled()
    }
  })
})

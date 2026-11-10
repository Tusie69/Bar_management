import type { ClaimView, ReservationView, WaitlistEntryView } from "@/domain/models"
import { validateBookingCheckInDate } from "@/domain/booking-rules"
import { useAction } from "@/hooks/use-action"
import { fmtTime } from "@/lib/time"
import { api, clock } from "@/services"
import { toast } from "sonner"
import { useM, type TablePick } from "./context"
import { roleCan, type Permission } from "@/domain/access"
import { useSession } from "@/state/session"
import type { FloorModel } from "../floor/use-floor-model"
import { codesOf, tableText } from "./model"
import { useIsFetching, useQueryClient } from "@tanstack/react-query"
import { qk } from "@/hooks/use-data"

/** A null HTTP entry.hold says nothing; booking allocations must prove the link. */
export function classifyHeldOrder(entry?: WaitlistEntryView | null, reservation?: ReservationView | null) {
  if (reservation?.status === "CHECKED_IN" || entry?.status === "SEATED") return "visit"
  if (entry?.status !== "HOLD_ACTIVE") return entry ? "unsupported" : "direct"
  if (entry.reservationId && !reservation) return "unsupported"
  if (reservation && entry.reservationId !== reservation.id && reservation.waitlistEntryId !== entry.id)
    return "unsupported"
  if (reservation && reservation.status !== "BOOKED") return "unsupported"
  if (entry.hold) return reservation ? "offer" : "pure"
  if (reservation?.status === "BOOKED" && reservation.tableIds.length) return "reservation"
  return "unsupported"
}

function canNow(permission: Permission) {
  const session = useSession.getState()
  return api.mode === "http" ? session.permissions.includes(permission) : roleCan(session.user.role, permission)
}

export function heldOrderPolicy(
  entry?: WaitlistEntryView | null,
  reservation?: ReservationView | null,
  can = canNow,
  mode = api.mode,
) {
  const kind = classifyHeldOrder(entry, reservation)
  const supported = kind === "reservation" || (mode === "mock" && (kind === "offer" || kind === "pure"))
  return {
    kind,
    supported,
    canArrival:
      supported &&
      can("visit.checkin") &&
      (kind !== "pure" || (can("waitlist.accept_offer") && can("reservation.create") && can("table.assign"))),
    canReassign: supported && can("table.assign"),
    canLate: kind === "reservation",
    canBookingStatus: kind === "reservation" || (mode === "mock" && kind === "offer"),
  }
}

export function bookingOrderPolicy(
  r: ReservationView,
  query?: { data?: WaitlistEntryView[]; status: string; fetchStatus?: string },
  can = canNow,
  mode = api.mode,
) {
  const linked = query?.data?.find((e) => e.reservationId === r.id || e.id === r.waitlistEntryId)
  const entry = linked?.status === "HOLD_ACTIVE" ? linked : undefined
  const ready = query?.status === "success" && query.data !== undefined && query.fetchStatus !== "fetching"
  const policy = heldOrderPolicy(entry, r, can, mode)
  const direct = ready && !entry && (!r.waitlistEntryId || !!linked)
  return {
    ...policy,
    entry,
    kind: ready ? (direct ? "direct" : entry ? policy.kind : "unsupported") : "unsupported",
    reason: !ready ? (query?.status === "error" ? "Không tải được đơn chờ" : "Đang tải đơn chờ") : undefined,
    canArrival: ready && (direct ? can("visit.checkin") : !!entry && policy.canArrival),
    canReassign: ready && (direct ? can("table.assign") : !!entry && policy.canReassign),
    canBookingStatus: ready && (direct || (!!entry && policy.canBookingStatus)),
    canLate: ready && (direct || (!!entry && policy.canLate)),
  }
}

/** Shared by mobile, desktop cards, floor and the booking sheet; useAction owns locking/errors. */
export function useHeldOrderActions(model: FloorModel) {
  const queries = useQueryClient()
  // Refetch completion must update guards even when cached entry data is unchanged.
  useIsFetching({ queryKey: ["waitlist"] })
  useSession((s) => s)
  const { run, pending } = useAction()
  const bookingPolicy = (r: ReservationView) =>
    bookingOrderPolicy(r, queries.getQueryState<WaitlistEntryView[]>(qk.waitlist(r.businessDate)))
  const verifyBooking = async (r: ReservationView) => {
    try {
      await queries.fetchQuery({
        queryKey: qk.waitlist(r.businessDate),
        queryFn: () => api.listWaitlist(r.businessDate),
        staleTime: 0,
        retry: false,
      })
    } catch {
      throw new Error("Không tải được đơn chờ. Vui lòng thử lại.")
    }
    return bookingPolicy(r)
  }
  const policy = (entry?: WaitlistEntryView | null, reservation?: ReservationView | null) => {
    const state = heldOrderPolicy(entry, reservation)
    const query = queries.getQueryState(qk.waitlist(reservation?.businessDate ?? entry?.businessDate ?? ""))
    if (query?.status === "success" && query.fetchStatus !== "fetching") return state
    return { ...state, canArrival: false, canReassign: false, canBookingStatus: false, canLate: false }
  }
  const arrive = (
    entry: WaitlistEntryView | null | undefined,
    reservation: ReservationView | null | undefined,
    party: number,
  ) =>
    run(async (overrideReason) => {
      if (!policy(entry, reservation).canArrival) throw new Error("Chưa hỗ trợ hoặc thiếu quyền nhận khách.")
      const current = reservation ? await verifyBooking(reservation) : null
      if (current && (!current.canArrival || current.kind !== policy(entry, reservation).kind))
        throw new Error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
      const dateError = validateBookingCheckInDate(reservation?.businessDate ?? entry!.businessDate, clock.now())
      if (dateError) throw new Error(dateError)
      let booking = reservation
      if (!booking) {
        const assigned = await api.seatWaitlist({
          entryId: entry!.id,
          version: entry!.version,
          guestCount: party,
          tableIds: entry!.hold!.tableIds,
          overrideReason,
        })
        booking = (await api.listReservations({ businessDate: entry!.businessDate })).find(
          (r) => r.id === assigned.reservationId,
        )
      }
      if (!booking) throw new Error("Không tìm thấy thông tin đặt bàn liên kết.")
      if (!canNow("visit.checkin")) throw new Error("Thiếu quyền nhận khách.")
      return api.checkIn({ reservationId: booking.id, version: booking.version, guestCount: party, overrideReason })
    })
  const picker = (
    entry: WaitlistEntryView | null | undefined,
    reservation: ReservationView | null | undefined,
  ): TablePick | null => {
    const state = policy(entry, reservation)
    if (!state.canReassign) return null
    const own = entry?.hold?.tableIds ?? reservation?.tableIds ?? []
    const party = reservation?.partySize ?? entry!.partySize
    const expected = reservation?.expectedAt ?? entry?.reservationExpectedAt
    return {
      title: `Đổi / Ghép bàn cho ${reservation?.displayName ?? entry!.displayName}`,
      hint: `Chạm bàn khả dụng cho ${party} khách. Chạm lại để bỏ chọn.`,
      multi: true,
      preselected: own,
      targetDate: reservation?.businessDate ?? entry!.businessDate,
      ...(expected ? { targetTime: fmtTime(expected), targetExpectedAt: expected } : {}),
      targetParty: party,
      confirmLabel: "Đổi bàn",
      onConfirm: async (ids) =>
        !!(await run(async (overrideReason) => {
          if (!policy(entry, reservation).canReassign) throw new Error("Chưa hỗ trợ hoặc thiếu quyền xếp bàn.")
          const current = reservation ? await verifyBooking(reservation) : null
          if (current && (!current.canReassign || current.kind !== state.kind))
            throw new Error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
          const tables = ids.map((id) => model.byId.get(id))
          if (
            !ids.length ||
            tables.some((t) => !t) ||
            new Set(tables.map((t) => t!.kind)).size > 1 ||
            new Set(tables.map((t) => t!.zoneId)).size > 1
          )
            throw new Error("Chọn bàn cùng khu, cùng loại.")
          return state.kind === "reservation"
            ? api.assignTables(reservation!.id, reservation!.version, ids, overrideReason)
            : api.moveClaim({
                claim: { waitlistEntryId: entry!.id, version: entry!.hold!.version },
                tableIds: ids,
                overrideReason,
              })
        })),
    }
  }
  return { policy, bookingPolicy, verifyBooking, arrive, picker, pending, can: canNow }
}

/** Booking and table actions shared by cards, detail, status dialog and the table sheet. */
export function useMobileActions() {
  const m = useM()
  const { run, pending } = useAction()
  const held = useHeldOrderActions(m.model)

  const visitClaim = (r: ReservationView): ClaimView | null => {
    for (const id of r.tableIds) {
      const c = m.model.states.get(id)?.claim
      if (c?.visitId && c.visitId === r.visitId) return c
    }
    return null
  }

  const assign = (r: ReservationView) => {
    const state = held.bookingPolicy(r)
    if (!state.canReassign) return
    const entry = state.entry
    if (entry) {
      const pick = held.picker(entry, r)
      if (pick) m.startPick(pick)
      return
    }
    m.startPick({
      title: `${r.tableIds.length ? "Đổi bàn" : "Xếp bàn"} cho ${r.displayName}`,
      hint: `Chạm bàn khả dụng cho ${r.partySize} khách. Chạm lại để bỏ chọn.`,
      multi: true,
      preselected: r.tableIds,
      targetDate: r.businessDate,
      targetTime: fmtTime(r.expectedAt),
      targetExpectedAt: r.expectedAt,
      targetParty: r.partySize,
      confirmLabel: r.tableIds.length ? "Đổi bàn" : "Xếp bàn",
      onConfirm: async (ids) => {
        const kinds = new Set(ids.map((id) => m.model.byId.get(id)?.kind).filter(Boolean))
        if (kinds.size > 1) {
          toast.error("Không thể ghép bàn thường với ghế Bar.")
          return false
        }
        return !!(await run(async (o) => {
          const current = await held.verifyBooking(r)
          if (!current.canReassign || current.kind !== "direct")
            throw new Error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
          return api.assignTables(r.id, r.version, ids, o)
        }))
      },
    })
  }

  const moveVisit = (claim: ClaimView, _fromTableId: number) =>
    m.startPick({
      title: `Đổi ${codesOf(claim.tableIds, m.model)} sang bàn mới`,
      hint: `Chạm một hoặc nhiều bàn trống cho đoàn ${claim.partySize} khách. Lịch sử bàn cũ được giữ nguyên.`,
      multi: true,
      exclude: claim.tableIds,
      confirmLabel: "Đổi bàn",
      onConfirm: async (toIds) => {
        return !!(await run((o) =>
          api.moveClaim({
            claim: { visitId: claim.visitId!, version: claim.version },
            tableIds: toIds,
            overrideReason: o,
          }),
        ))
      },
    })

  const endVisit = (claim: ClaimView) =>
    m.ask({
      title: `Nhả ${tableText(claim.tableIds, m.model)}?`,
      body: "Lượt ghé kết thúc, bàn chuyển sang trống.",
      label: "Nhả bàn",
      run: () => run(() => api.endVisit(claim.visitId!, claim.version)),
    })

  const arrival = ({
    entry,
    reservation,
    partySize,
    tableCodes,
  }: {
    entry?: WaitlistEntryView | null
    reservation?: ReservationView | null
    partySize?: number
    tableCodes?: string
  }) => {
    const party = reservation?.partySize ?? partySize ?? entry?.partySize ?? 1
    if (reservation && !held.bookingPolicy(reservation).canArrival) return
    if (entry && !held.policy(entry, reservation).canArrival) return
    if (!entry && (!canNow("visit.checkin") || reservation?.status !== "BOOKED")) return
    m.ask({
      title: "Xác nhận khách đã đến",
      body: `Khách: ${reservation?.displayName ?? entry?.displayName} · Bàn: ${tableCodes || "Chưa có"} · Số khách: ${party} khách. Xác nhận khách nhận bàn và hoàn tất mục chờ.`,
      label: "Khách đã đến",
      run: () =>
        entry
          ? held.arrive(entry, reservation, party)
          : run(async () => {
              if (!canNow("visit.checkin")) throw new Error("Thiếu quyền nhận khách.")
              const current = await held.verifyBooking(reservation!)
              if (!current.canArrival || current.kind !== "direct")
                throw new Error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
              const error = validateBookingCheckInDate(reservation!.businessDate, m.now)
              if (error) throw new Error(error)
              return api.checkIn({ reservationId: reservation!.id, version: reservation!.version, guestCount: party })
            }),
    })
  }

  return {
    pending: pending || held.pending,
    assign,
    moveVisit,
    endVisit,
    checkIn: (r: ReservationView) => {
      const state = held.bookingPolicy(r)
      if (!state.canArrival) return
      const entry = state.entry
      if (entry) return arrival({ entry, reservation: r, tableCodes: codesOf(r.tableIds, m.model) })
      const error = validateBookingCheckInDate(r.businessDate, m.now)
      if (error) {
        toast.error(error)
        return Promise.resolve(null)
      }
      return run(async () => {
        const current = await held.verifyBooking(r)
        if (!current.canArrival || current.kind !== "direct") throw new Error("Đơn chờ đã thay đổi. Vui lòng mở lại.")
        return api.checkIn({ reservationId: r.id, version: r.version, guestCount: r.partySize })
      })
    },
    cancelEntry: (entry: WaitlistEntryView) => {
      if (!canNow("waitlist.cancel")) return
      m.ask({
        title: `Hủy mục chờ của ${entry.displayName}?`,
        body: "Khách rời khỏi danh sách chờ. Thao tác được ghi vào nhật ký.",
        label: "Hủy mục chờ",
        run: () =>
          run(() => {
            if (!canNow("waitlist.cancel")) throw new Error("Thiếu quyền hủy mục chờ.")
            return api.cancelWaitlist(entry.id, entry.version, "CUSTOMER_WITHDREW")
          }),
      })
    },
    heldPolicy: held.policy,
    bookingPolicy: held.bookingPolicy,
    reassignHold: (entry: WaitlistEntryView | null | undefined, reservation?: ReservationView | null) => {
      const pick = held.picker(entry, reservation)
      if (pick) m.startPick(pick)
    },
    arrival,
    move: (r: ReservationView) => {
      const c = r.status === "CHECKED_IN" ? visitClaim(r) : null
      return c ? moveVisit(c, r.tableIds[0]) : assign(r)
    },
    release: (r: ReservationView) => {
      const c = visitClaim(r)
      if (c) endVisit(c)
    },
    confirmLate: (r: ReservationView) =>
      canNow("reservation.update") &&
      m.ask({
        title: `Ghi nhận ${r.displayName} sẽ tới muộn?`,
        body: "Booking và bàn vẫn được giữ. Thao tác này không phải check-in.",
        label: "Tới muộn",
        run: () =>
          run(async () => {
            if (
              !canNow("reservation.update") ||
              !(await held.verifyBooking(r)).canLate ||
              r.status !== "BOOKED" ||
              r.lateConfirmedAt ||
              r.businessDate !== m.today ||
              m.now < r.expectedAt ||
              r.minutesLate >= m.th.noshow
            )
              throw new Error("Chưa đủ điều kiện ghi nhận tới muộn.")
            return api.confirmLate(r.id, r.version)
          }),
      }),
    cancel: (r: ReservationView) =>
      canNow("reservation.cancel") &&
      m.ask({
        title: `Hủy booking của ${r.displayName}?`,
        body: "Booking bị hủy và bàn được nhả. Thao tác được ghi vào nhật ký.",
        label: "Hủy booking",
        run: () =>
          run(async () => {
            if (!canNow("reservation.cancel") || !(await held.verifyBooking(r)).canBookingStatus)
              throw new Error("Chưa hỗ trợ hoặc thiếu quyền hủy booking.")
            return api.cancelReservation(r.id, r.version, "CUSTOMER_REQUEST")
          }),
      }),
  }
}

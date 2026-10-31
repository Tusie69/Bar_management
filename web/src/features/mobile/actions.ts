import type { ClaimView, ReservationView } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { api } from "@/services"
import { toast } from "sonner"
import { useM } from "./context"
import { codesOf, tableText } from "./model"

/** Booking and table actions shared by cards, detail, status dialog and the table sheet. */
export function useMobileActions() {
  const m = useM()
  const { run, pending } = useAction()

  const visitClaim = (r: ReservationView): ClaimView | null => {
    for (const id of r.tableIds) {
      const c = m.model.states.get(id)?.claim
      if (c?.visitId && c.visitId === r.visitId) return c
    }
    return null
  }

  const assign = (r: ReservationView) =>
    m.startPick({
      title: `${r.tableIds.length ? "Đổi bàn" : "Xếp bàn"} cho ${r.displayName}`,
      hint: `Chạm bàn trống cho ${r.partySize} khách. Chạm lại để bỏ chọn.`,
      multi: true,
      preselected: r.tableIds,
      confirmLabel: r.tableIds.length ? "Đổi bàn" : "Xếp bàn",
      onConfirm: async (ids) => {
        const totalCapacity = ids.reduce((sum, id) => sum + (m.model.byId.get(id)?.capacity ?? 0), 0)
        if (totalCapacity < r.partySize) {
          toast.error(
            `Tổng sức chứa (${totalCapacity}) thấp hơn số khách (${r.partySize}). Chọn thêm bàn cùng khu, cùng loại trước khi xác nhận.`,
          )
          return false
        }
        return !!(await run((o) => api.assignTables(r.id, r.version, ids, o)))
      },
    })

  const moveVisit = (claim: ClaimView, _fromTableId: number) =>
    m.startPick({
      title: `Đổi ${codesOf(claim.tableIds, m.model)} sang bàn mới`,
      hint: `Chạm một hoặc nhiều bàn trống cho đoàn ${claim.partySize} khách. Lịch sử bàn cũ được giữ nguyên.`,
      multi: true,
      exclude: claim.tableIds,
      confirmLabel: "Đổi bàn",
      onConfirm: async (toIds) => {
        const targetCapacity = toIds.reduce((sum, id) => sum + (m.model.byId.get(id)?.capacity ?? 0), 0)
        if (targetCapacity < claim.partySize) {
          toast.error(
            `Các bàn đã chọn chỉ có ${targetCapacity} chỗ cho đoàn ${claim.partySize} khách. Chọn thêm bàn trước khi xác nhận.`,
          )
          return false
        }
        return !!(await run((o) =>
          api.moveClaim({
            claim: { visitId: claim.visitId!, version: claim.version },
            tableIds: toIds,
            overrideReason: o,
          }),
        ))
      },
    })

  const combine = (claim: ClaimView) =>
    m.startPick({
      title: `Ghép thêm bàn cho ${codesOf(claim.tableIds, m.model)}`,
      hint: "Chạm các bàn trống liền kề. Cả nhóm dùng chung một ký hiệu.",
      multi: true,
      exclude: claim.tableIds,
      confirmLabel: "Ghép bàn",
      onConfirm: async (ids) =>
        !!(await run((o) =>
          api.combineTables({
            claim: claim.visitId
              ? { visitId: claim.visitId, version: claim.version }
              : { reservationId: claim.reservationId!, version: claim.version },
            addTableIds: ids,
            overrideReason: o,
          }),
        )),
    })

  const split = (claim: ClaimView, keep: number) =>
    m.startPick({
      title: `Tách nhóm ${codesOf(claim.tableIds, m.model)}`,
      hint: "Chọn các vị trí khách giữ lại. Vị trí còn lại được nhả.",
      multi: true,
      only: claim.tableIds,
      preselected: [keep],
      confirmLabel: "Tách bàn",
      onConfirm: async (ids) => !!(await run(() => api.splitGroup({ groupId: claim.groupId!, keepTableIds: ids }))),
    })

  const endVisit = (claim: ClaimView) =>
    m.ask({
      title: `Nhả ${tableText(claim.tableIds, m.model)}?`,
      body: "Lượt ghé kết thúc, bàn chuyển sang trống.",
      label: "Nhả bàn",
      run: () => run(() => api.endVisit(claim.visitId!, claim.version)),
    })

  return {
    pending,
    assign,
    moveVisit,
    combine,
    split,
    endVisit,
    checkIn: (r: ReservationView) =>
      run(() => api.checkIn({ reservationId: r.id, version: r.version, guestCount: r.partySize })),
    move: (r: ReservationView) => {
      const c = r.status === "CHECKED_IN" ? visitClaim(r) : null
      return c ? moveVisit(c, r.tableIds[0]) : assign(r)
    },
    release: (r: ReservationView) => {
      const c = visitClaim(r)
      if (c) endVisit(c)
    },
    noShow: (r: ReservationView) =>
      m.ask({
        title: `Xác nhận ${r.displayName} không đến?`,
        body: "Booking chuyển sang Không đến và bàn được nhả. Thao tác được ghi vào nhật ký và có thể hoàn tác.",
        label: "Không đến",
        run: () => run(() => api.markNoShow(r.id, r.version)),
      }),
    cancel: (r: ReservationView) =>
      m.ask({
        title: `Hủy booking của ${r.displayName}?`,
        body: "Booking bị hủy và bàn được nhả. Thao tác được ghi vào nhật ký.",
        label: "Hủy booking",
        run: () => run(() => api.cancelReservation(r.id, r.version, "CUSTOMER_REQUEST")),
      }),
  }
}

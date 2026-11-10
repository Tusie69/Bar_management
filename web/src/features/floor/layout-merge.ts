import type { ClaimView } from "@/domain/models"
import { useUi } from "@/state/ui"
import type { FloorModel } from "./use-floor-model"

/**
 * C1 shipped: POST /tables/groups, /members and /dissolve exist on the server, so
 * an empty cluster is a real layout entity on HTTP as well as in the mock.
 */
export const independentLayoutEnabled = true

export function layoutMembers(model: FloorModel, id: number) {
  return model.floor?.groups.find((g) => g.tableIds.includes(id))?.tableIds ?? [id]
}

export function startLayoutMerge(model: FloorModel, tableId?: number) {
  useUi.setState({ draft: null, bookingOpen: false, walkInOpen: false, selectedTableId: null })
  useUi.getState().startPick({
    intent: "layout",
    title: "Ghép bàn",
    hint: "Chọn các vị trí muốn ghép trên sơ đồ.",
    multi: true,
    preselected: tableId ? layoutMembers(model, tableId) : [],
    confirmLabel: "Xác nhận ghép",
    onConfirm: () => false,
  })
}

export function toggleLayoutTable(model: FloorModel, id: number) {
  const selection = useUi.getState().pickSelection
  const members = layoutMembers(model, id)
  useUi.setState({
    pickSelection: members.every((i) => selection.includes(i))
      ? selection.filter((i) => !members.includes(i))
      : [...new Set([...selection, ...members])],
  })
}

export function layoutSelection(model: FloorModel, ids: number[]) {
  const claims = ids.map((id) => model.states.get(id)?.claim).filter((c): c is ClaimView => !!c)
  const owner = claims[0]
  const ownerKey = (c: ClaimView) =>
    c.visitId ? `v${c.visitId}` : c.reservationId ? `r${c.reservationId}` : `h${c.waitlistEntryId}`
  let reason = ids.length < 2 ? "Chọn ít nhất hai bàn để ghép." : ""
  if (ids.some((id) => !model.byId.has(id) || !model.states.has(id)))
    reason = "Trạng thái bàn chưa sẵn sàng. Vui lòng tải lại."
  // K1 Section 5: Client zone and kind blocks removed. Server still limits on HTTP.
  else if (
    ids.some((id) => {
      const t = model.byId.get(id)!
      return t.status !== "ACTIVE" || t.isSpare
    })
  )
    reason = "Không ghép bàn ngưng phục vụ hoặc bàn sơ cua."
  else if (
    claims.some((c) => !owner || ownerKey(c) !== ownerKey(owner)) ||
    (owner && !owner.visitId && !owner.reservationId)
  )
    reason = "Chỉ ghép thêm bàn trống cho một booking hoặc một đoàn khách."
  else if (owner?.kind === "waitlist_hold")
    reason = "Lượt giữ từ Bàn chờ chưa hỗ trợ ghép ở đây. Mở Quản lý đơn để xử lý."
  else if (owner && ids.every((id) => owner.tableIds.includes(id)))
    reason = "Chọn thêm ít nhất một bàn trống ngoài nhóm hiện tại."
  return { reason, owner }
}

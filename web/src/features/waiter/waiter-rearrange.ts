/**
 * Module Phục vụ 1 — luật của Đổi / Ghép / Tách bàn, tách khỏi component.
 *
 * Ba thao tác này đổi dữ liệu thật, nên phần quyết định phải test được bằng
 * một assert thay vì bằng mắt trên một bottom sheet. Hàm ở đây chỉ dựng YÊU
 * CẦU; máy chủ vẫn là nơi kiểm Phiên còn mở, sức chứa, bàn có trống, venue và
 * version. Những gì chặn ở đây chỉ để Phục vụ không gửi một yêu cầu mà họ đã
 * biết trước là sai.
 */
import type { FloorTableState, TableView } from "@/domain/models"
import type { WaiterVisitTablesInput } from "@/services"

export type WaiterRearrangeMode = "MOVE" | "MERGE" | "SPLIT"

export const WAITER_REARRANGE_LABEL: Record<WaiterRearrangeMode, string> = {
  MOVE: "Đổi bàn",
  MERGE: "Ghép bàn",
  SPLIT: "Tách bàn",
}

export const WAITER_REARRANGE_HINT: Record<WaiterRearrangeMode, string> = {
  MOVE: "Chọn bàn trống để chuyển cả đoàn khách sang. Phiên và đơn đi theo khách.",
  MERGE: "Chọn thêm bàn trống để ghép vào Phiên đang phục vụ.",
  SPLIT: "Chọn những bàn khách tiếp tục dùng. Các bàn còn lại được nhả về trống.",
}

/**
 * Bàn mà Phục vụ được chọn làm đích cho Đổi / Ghép.
 *
 * Chỉ bàn đang TRỐNG và đang hoạt động. Bàn sơ cua bị loại: dùng bàn sơ cua là
 * một quyết định mặt bằng cần người xác nhận, và biên bản không cấp việc đó
 * cho Phục vụ. Bàn đang có khách cũng bị loại — ghép hai đoàn khách khác nhau
 * là nghiệp vụ của Lễ tân, không phải của Phục vụ.
 */
export function waiterTargetTables(
  tables: TableView[],
  states: Map<number, FloorTableState>,
  exclude: readonly number[] = [],
): TableView[] {
  const skip = new Set(exclude)
  return tables.filter((table) => {
    if (skip.has(table.id)) return false
    if (table.status !== "ACTIVE" || table.isSpare) return false
    return states.get(table.id)?.state === "free"
  })
}

/** Bàn mà một Phiên đang dùng, đã sắp xếp. */
export function waiterCurrentTables(state: FloorTableState | undefined): number[] {
  if (!state) return []
  const ids = state.claim?.tableIds ?? []
  return (ids.length ? [...ids] : [state.tableId]).sort((left, right) => left - right)
}

export interface WaiterRearrangePlan {
  /** `null` khi lựa chọn hiện tại chưa gửi được; `reason` nói vì sao. */
  request: WaiterVisitTablesInput | { groupId: number; keepTableIds: number[] } | null
  reason: string | null
  /** Câu xác nhận hiện trên nút, bằng mã bàn. */
  summary: string
}

function codes(ids: readonly number[], byId: Map<number, TableView>): string {
  return ids.map((id) => byId.get(id)?.code ?? `#${id}`).join(", ")
}

/**
 * Dựng yêu cầu cho một lựa chọn cụ thể.
 *
 * MOVE và MERGE gửi BỘ BÀN CUỐI CÙNG của Phiên, đúng hợp đồng của
 * `POST /visits/:id/move` và `/merge`. SPLIT gửi danh sách bàn GIỮ LẠI, đúng
 * hợp đồng của `POST /tables/groups/:id/split`.
 */
export function waiterRearrangePlan(input: {
  mode: WaiterRearrangeMode
  visitId: number | null
  version: number | null
  groupId: number | null
  currentTableIds: readonly number[]
  selectedTableIds: readonly number[]
  byId: Map<number, TableView>
}): WaiterRearrangePlan {
  const { mode, visitId, version, groupId, currentTableIds, selectedTableIds, byId } = input
  const selected = [...new Set(selectedTableIds)].sort((left, right) => left - right)

  if (mode === "SPLIT") {
    if (groupId === null) {
      return { request: null, reason: "Phiên này chỉ dùng một bàn, không có gì để tách.", summary: "" }
    }
    if (!selected.length) {
      return { request: null, reason: "Chọn ít nhất một bàn để khách tiếp tục dùng.", summary: "" }
    }
    const released = currentTableIds.filter((id) => !selected.includes(id))
    if (!released.length) {
      return { request: null, reason: "Tách bàn phải nhả ít nhất một bàn.", summary: "" }
    }
    if (selected.some((id) => !currentTableIds.includes(id))) {
      return { request: null, reason: "Chỉ chọn được bàn đang thuộc cụm này.", summary: "" }
    }
    return {
      request: { groupId, keepTableIds: selected },
      reason: null,
      summary: `Giữ ${codes(selected, byId)}, nhả ${codes(released, byId)}`,
    }
  }

  if (visitId === null || version === null) {
    return { request: null, reason: "Phiên không còn mở. Hãy tải lại sơ đồ.", summary: "" }
  }
  if (!selected.length) {
    return {
      request: null,
      reason: mode === "MOVE" ? "Chọn một bàn trống để chuyển sang." : "Chọn thêm ít nhất một bàn trống.",
      summary: "",
    }
  }
  if (mode === "MOVE") {
    const tableIds = selected
    return {
      request: { visitId, version, mode: "MOVE", tableIds },
      reason: null,
      summary: `Chuyển sang ${codes(tableIds, byId)}`,
    }
  }
  const tableIds = [...new Set([...currentTableIds, ...selected])].sort((left, right) => left - right)
  return {
    request: { visitId, version, mode: "MERGE", tableIds },
    reason: null,
    summary: `Ghép thành ${codes(tableIds, byId)}`,
  }
}

/** Phân biệt hai loại yêu cầu mà `waiterRearrangePlan` trả về. */
export function isSplitRequest(
  request: WaiterRearrangePlan["request"],
): request is { groupId: number; keepTableIds: number[] } {
  return request !== null && "keepTableIds" in request
}

/**
 * AC05/AC08 on the client: touching one member selects the whole cluster, and a
 * server confirmation request turns into one dialog and one retry carrying the
 * flag — never a silent retry, and never a success the server did not give.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/services", () => ({
  api: { mode: "http" },
  clock: { now: () => new Date("2026-11-10T12:00:00Z") },
}))

import { ApiError } from "@/services/contracts"
import { useUi } from "@/state/ui"
import { clusterMembersForDisplay, layoutMembers, toggleLayoutTable } from "./layout-merge"
import type { FloorModel } from "./use-floor-model"

const model = {
  byId: new Map(
    [1, 2, 3, 4].map((id) => [id, { id, zoneId: 1, kind: "TABLE", status: "ACTIVE", isSpare: false, capacity: 4 }]),
  ),
  states: new Map([1, 2, 3, 4].map((id) => [id, { tableId: id, state: "free", claim: null }])),
  floor: { groups: [{ id: 11, symbolNo: 1, displayCode: "G01", version: 3, tableIds: [1, 2, 3] }] },
} as unknown as FloorModel

describe("layout cluster selection (AC08)", () => {
  beforeEach(() => useUi.setState({ pickSelection: [] }))

  it("identifies the whole cluster from any one of its members", () => {
    expect(layoutMembers(model, 2)).toEqual([1, 2, 3])
    expect(layoutMembers(model, 3)).toEqual([1, 2, 3])
    // A table outside every cluster is just itself.
    expect(layoutMembers(model, 4)).toEqual([4])
  })

  it("selects and deselects the cluster as one unit", () => {
    toggleLayoutTable(model, 2)
    expect(useUi.getState().pickSelection).toEqual([1, 2, 3])
    toggleLayoutTable(model, 3)
    expect(useUi.getState().pickSelection).toEqual([])
  })

  it("adds a loose table to a selected cluster without dropping the cluster", () => {
    toggleLayoutTable(model, 1)
    toggleLayoutTable(model, 4)
    expect(useUi.getState().pickSelection).toEqual([1, 2, 3, 4])
  })
})

describe("server confirmation requests (AC04/AC05)", () => {
  beforeEach(() => useUi.setState({ confirmRequest: null }))

  it("asks once and resolves true, so the caller can retry with the flag", async () => {
    const pending = useUi.getState().askConfirm({
      title: "Vượt sức chứa đề xuất",
      message: "Bàn B3 có sức chứa đề xuất 4 người. Bạn đang đặt 6 khách.",
    })
    const request = useUi.getState().confirmRequest
    expect(request?.title).toBe("Vượt sức chứa đề xuất")
    expect(request?.confirmLabel).toBe("Xác nhận và tiếp tục")

    useUi.getState().resolveConfirm(true)
    await expect(pending).resolves.toBe(true)
    expect(useUi.getState().confirmRequest).toBeNull()
  })

  it("resolves false when the operator declines, so nothing is retried", async () => {
    const pending = useUi.getState().askConfirm({ title: "Bàn sơ cua", message: "SP1 là bàn sơ cua." })
    useUi.getState().resolveConfirm(false)
    await expect(pending).resolves.toBe(false)
  })

  it("keeps the server's own wording and details on the refusal", () => {
    const error = new ApiError(
      409,
      "CAPACITY_OVERRIDE_REQUIRED",
      "Bàn B3 có sức chứa đề xuất 4 người. Bạn đang đặt 6 khách. Xác nhận để tiếp tục.",
      { requestedGuests: 6, totalCapacity: 4, tableCodes: ["B3"] },
    )
    expect(error.status).toBe(409)
    expect(error.details.totalCapacity).toBe(4)
    expect(error.message).toContain("6 khách")
  })
})

describe("cụm to ra khi ghép thêm bàn cho khách", () => {
  // Cụm LAYOUT là bàn 1+2+3. Lễ tân ghép thêm bàn 4 cho chính tốp khách đang
  // ngồi: máy chủ dùng lại `group_id` nhưng không thêm thành viên vào cụm.
  it("tính cả bàn ghép thêm, giữ thứ tự cụm trước", () => {
    expect(clusterMembersForDisplay(model, 2, [1, 2, 3, 4])).toEqual([1, 2, 3, 4])
  })

  it("khách trả bàn thì về nguyên vẹn như lễ tân đã dựng", () => {
    // Không có claim thì không có gì để cộng thêm. Cụm chưa từng to ra trong
    // database nên không cần cơ chế nào kéo nó co lại.
    expect(clusterMembersForDisplay(model, 2, null)).toEqual([1, 2, 3])
    expect(clusterMembersForDisplay(model, 2, [])).toEqual([1, 2, 3])
    expect(clusterMembersForDisplay(model, 2, undefined)).toEqual([1, 2, 3])
  })

  it("khách chỉ chiếm một phần cụm thì cụm KHÔNG nhỏ đi", () => {
    // Cụm là bàn kê sát nhau, nó vẫn là ba bàn dù khách ngồi mấy bàn.
    expect(clusterMembersForDisplay(model, 2, [2])).toEqual([1, 2, 3])
  })

  it("bàn lẻ có khách ghép thì vẫn ra đúng nhóm của khách", () => {
    expect(clusterMembersForDisplay(model, 4, [4])).toEqual([4])
  })

  it("danh sách trùng nhau thì không nhân đôi bàn", () => {
    expect(clusterMembersForDisplay(model, 2, [3, 2, 1])).toEqual([1, 2, 3])
  })
})

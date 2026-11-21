import { describe, expect, it } from "vitest"
import type { CancellationQueueEntry } from "@/features/waiter-menu/waiter-order-api"
import { groupCancellationEntries, type CancellationGroupItem } from "./cancellation-grouping"

function entry(overrides: Partial<CancellationQueueEntry> = {}): CancellationQueueEntry {
  return {
    cancellationId: 1,
    groupId: null,
    status: "PENDING",
    policy: "STANDARD",
    version: 1,
    visitId: 42,
    tableCodes: ["A3"],
    orderId: 55,
    visitSequence: 2,
    lineNo: 1,
    itemName: "VỎ ỐC THÌ THẦM",
    variantDisplayName: "Ly",
    station: "BAR",
    ticketStatusAtRequest: "SUBMITTED",
    quantity: 2,
    unitPriceVnd: 280_000,
    amountVnd: 560_000,
    reason: "Khách đổi ý",
    requestedByUserId: 6,
    requestedByDisplayName: "Phục vụ Minh",
    requestedAt: "2026-11-22T14:42:00.000Z",
    decidedByUserId: null,
    decidedByDisplayName: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}

describe("groupCancellationEntries", () => {
  it("yêu cầu lẻ giữ nguyên một thẻ mỗi dòng", () => {
    const items = groupCancellationEntries([entry({ cancellationId: 1 }), entry({ cancellationId: 2 })])
    expect(items).toHaveLength(2)
    expect(items.every((item) => item.kind === "line")).toBe(true)
  })

  /**
   * Một lần bấm "Hủy đơn?" sinh ra một hàng cho mỗi dòng món. Bốn thẻ rời là
   * bốn lần bấm cho MỘT quyết định.
   */
  it("các dòng cùng nhóm gom vào một thẻ và cộng đúng số", () => {
    const items = groupCancellationEntries([
      entry({ cancellationId: 10, groupId: 10, quantity: 2, amountVnd: 560_000 }),
      entry({ cancellationId: 11, groupId: 10, quantity: 1, amountVnd: 120_000, itemName: "KHOAI TÂY CHIÊN" }),
    ])
    expect(items).toHaveLength(1)
    const group = items[0] as CancellationGroupItem
    expect(group.kind).toBe("order")
    expect(group.groupId).toBe(10)
    expect(group.entryCount).toBe(2)
    expect(group.totalQuantity).toBe(3)
    expect(group.amountVnd).toBe(680_000)
  })

  /** Phần ghi hao là thứ duy nhất làm quán mất tiền thật; nó phải tách riêng. */
  it("cộng riêng phần phải ghi hao", () => {
    const items = groupCancellationEntries([
      entry({ cancellationId: 10, groupId: 10, quantity: 2 }),
      entry({ cancellationId: 11, groupId: 10, quantity: 1, policy: "READY_WASTE", ticketStatusAtRequest: "READY" }),
    ])
    const group = items[0] as CancellationGroupItem
    expect(group.wasteQuantity).toBe(1)
    expect(group.totalQuantity).toBe(3)
  })

  it("không có món nào đã làm xong thì phần ghi hao bằng 0", () => {
    const items = groupCancellationEntries([entry({ cancellationId: 10, groupId: 10 })])
    expect((items[0] as CancellationGroupItem).wasteQuantity).toBe(0)
  })

  /**
   * Hàng chờ sắp theo giờ gửi giảm dần. Sắp lại theo mã nhóm sẽ đẩy một yêu
   * cầu cũ lên đầu chỉ vì nó có id nhỏ.
   */
  it("giữ nguyên thứ tự máy chủ trả về", () => {
    const items = groupCancellationEntries([
      entry({ cancellationId: 30 }),
      entry({ cancellationId: 10, groupId: 10 }),
      entry({ cancellationId: 11, groupId: 10 }),
      entry({ cancellationId: 40 }),
    ])
    expect(items.map((item) => item.key)).toEqual(["line:30", "group:10", "line:40"])
  })

  it("hai nhóm khác nhau là hai thẻ khác nhau", () => {
    const items = groupCancellationEntries([
      entry({ cancellationId: 10, groupId: 10 }),
      entry({ cancellationId: 20, groupId: 20 }),
      entry({ cancellationId: 11, groupId: 10 }),
    ])
    expect(items).toHaveLength(2)
    expect((items[0] as CancellationGroupItem).entryCount).toBe(2)
    expect((items[1] as CancellationGroupItem).entryCount).toBe(1)
  })
})

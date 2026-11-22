import { describe, expect, it } from "vitest"
import {
  preparationGroupedCancellationDetail,
  preparationGroupedCancellationTitle,
  summarizePreparationGroupedCancellation,
} from "./preparation-cancellation-summary"
import type { PreparationTicket } from "./preparation-queue-data"

type PreparationLine = PreparationTicket["lines"][number]

function line(overrides: Partial<PreparationLine> = {}): PreparationLine {
  return {
    lineNo: 1,
    itemName: "Negroni",
    variantDisplayName: "Ly",
    menuItemVariantId: 101,
    unitCode: "GLASS",
    quantity: 2,
    cancelledQuantity: 0,
    originalQuantity: 2,
    doneQuantity: 0,
    progressVersion: 0,
    note: null,
    pendingCancellation: null,
    ...overrides,
  }
}

describe("BT-09 — tóm tắt yêu cầu hủy theo đơn", () => {
  it("không tạo banner khi không có pending hoặc chỉ có yêu cầu hủy riêng", () => {
    expect(summarizePreparationGroupedCancellation([line()])).toBeNull()
    expect(
      summarizePreparationGroupedCancellation([
        line({ pendingCancellation: { cancellationId: 1, quantity: 1, groupId: null } }),
      ]),
    ).toBeNull()
  })

  it("một group phủ toàn bộ active lines", () => {
    const summary = summarizePreparationGroupedCancellation([
      line({ pendingCancellation: { cancellationId: 1, quantity: 1, groupId: 9 } }),
      line({
        lineNo: 2,
        quantity: 3,
        pendingCancellation: { cancellationId: 2, quantity: 2, groupId: 9 },
      }),
    ])!
    expect(summary).toEqual({
      groupedLineCount: 2,
      groupedQuantity: 3,
      activeLineCount: 2,
      coversAllActiveLines: true,
      hasSingleLinePendingAlongsideGroup: false,
      groupCount: 1,
    })
    expect(preparationGroupedCancellationTitle("BAR", summary)).toBe(
      "Toàn bộ phần Bar của phiếu đang chờ duyệt hủy theo đơn.",
    )
    expect(preparationGroupedCancellationTitle("KITCHEN", summary)).toBe(
      "Toàn bộ phần Bếp của phiếu đang chờ duyệt hủy theo đơn.",
    )
    expect(preparationGroupedCancellationDetail(summary)).toBe("2 dòng · 3 phần đang chờ duyệt.")
  })

  it("line active không pending làm coverage chỉ còn một phần", () => {
    const summary = summarizePreparationGroupedCancellation([
      line({ pendingCancellation: { cancellationId: 1, quantity: 1, groupId: 9 } }),
      line({ lineNo: 2 }),
    ])!
    expect(summary.coversAllActiveLines).toBe(false)
    expect(preparationGroupedCancellationTitle("BAR", summary)).toBe(
      "Một phần phiếu Bar thuộc yêu cầu hủy theo đơn đang chờ duyệt.",
    )
  })

  it("pending riêng song song và nhiều group được báo phòng thủ", () => {
    const summary = summarizePreparationGroupedCancellation([
      line({ pendingCancellation: { cancellationId: 1, quantity: 1, groupId: 7 } }),
      line({
        lineNo: 2,
        pendingCancellation: { cancellationId: 2, quantity: 1, groupId: null },
      }),
      line({
        lineNo: 3,
        pendingCancellation: { cancellationId: 3, quantity: 2, groupId: 8 },
      }),
    ])!
    expect(summary).toMatchObject({
      coversAllActiveLines: false,
      hasSingleLinePendingAlongsideGroup: true,
      groupCount: 2,
      groupedLineCount: 2,
      groupedQuantity: 3,
    })
  })

  it("bỏ line quantity 0 và không coi groupId 0 là null", () => {
    const summary = summarizePreparationGroupedCancellation([
      line({ quantity: 0, pendingCancellation: { cancellationId: 1, quantity: 5, groupId: 9 } }),
      line({ lineNo: 2, pendingCancellation: { cancellationId: 2, quantity: 1, groupId: 0 } }),
    ])!
    expect(summary).toMatchObject({
      activeLineCount: 1,
      groupedLineCount: 1,
      groupedQuantity: 1,
      coversAllActiveLines: true,
      groupCount: 1,
    })
  })

  it("không mutate input đã deep-freeze", () => {
    const value = Object.freeze([
      Object.freeze({
        ...line(),
        pendingCancellation: Object.freeze({ cancellationId: 1, quantity: 1, groupId: 9 }),
      }),
    ])
    expect(() => summarizePreparationGroupedCancellation(value)).not.toThrow()
    expect(value[0]!.pendingCancellation!.groupId).toBe(9)
  })
})

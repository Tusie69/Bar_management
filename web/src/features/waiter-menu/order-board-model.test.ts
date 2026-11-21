import { describe, expect, it } from "vitest"
import {
  PREPARATION_LABEL,
  lineCapability,
  lineNetLabel,
  orderBoardTotals,
  readyBadgeCount,
  readyNotificationsForVisit,
} from "./order-board-model"
import type { PreparationStatus, ReadyNotification, WaiterOrderLine } from "./waiter-order-api"

function line(overrides: Partial<WaiterOrderLine> = {}): WaiterOrderLine {
  return {
    lineNo: 1,
    menuItemId: 7,
    variantId: 1,
    itemCode: "MACALLAN_12",
    itemName: "MACALLAN 12",
    variantDisplayName: "Ly",
    unitCode: "GLASS",
    preparationStation: "BAR",
    unitPriceVnd: 380_000,
    priceId: 11,
    priceVersion: 1,
    quantity: 3,
    lineTotalVnd: 1_140_000,
    note: null,
    lineVersion: 1,
    cancelledQuantity: 0,
    netQuantity: 3,
    netTotalVnd: 1_140_000,
    preparationStatus: "SUBMITTED",
    canAdjustQuantity: true,
    pendingCancellation: null,
    lastRejection: null,
    ...overrides,
  }
}

const pending = {
  cancellationId: 9,
  quantity: 2,
  reason: "Khách đổi ý",
  policy: "STANDARD" as const,
  version: 1,
  requestedByUserId: 6,
  requestedByDisplayName: "Phục vụ",
  requestedAt: "2030-01-01T14:00:00.000Z",
}

describe("quyền thao tác trên một dòng món", () => {
  it("quầy chưa nhận phiếu: sửa được số lượng và xin hủy được", () => {
    expect(lineCapability(line())).toEqual({
      canAdjust: true,
      canRequestCancel: true,
      needsWasteAcknowledgement: false,
      notice: null,
    })
  })

  it("quầy đã nhận phiếu: khóa sửa số lượng, chỉ còn đường xin hủy", () => {
    const capability = lineCapability(line({ preparationStatus: "ACCEPTED", canAdjustQuantity: false }))
    expect(capability.canAdjust).toBe(false)
    expect(capability.canRequestCancel).toBe(true)
    expect(capability.needsWasteAcknowledgement).toBe(false)
    expect(capability.notice).toContain("Quầy đã nhận phiếu")
  })

  it.each(["READY", "COLLECTED"] as const)("món đã làm xong (%s): xin hủy là ghi hao", (status) => {
    const capability = lineCapability(line({ preparationStatus: status, canAdjustQuantity: false }))
    expect(capability.canAdjust).toBe(false)
    expect(capability.needsWasteAcknowledgement).toBe(true)
    expect(capability.notice).toContain("ghi hao")
  })

  it("đang chờ phê duyệt: khóa cả hai thao tác và nói rõ đang chờ bao nhiêu", () => {
    const capability = lineCapability(line({ pendingCancellation: pending }))
    expect(capability).toMatchObject({ canAdjust: false, canRequestCancel: false })
    expect(capability.notice).toBe("Đang chờ phê duyệt hủy 2 phần.")
  })

  it("đã hủy hết thì không còn thao tác nào", () => {
    const capability = lineCapability(line({ quantity: 2, cancelledQuantity: 2, netQuantity: 0 }))
    expect(capability).toMatchObject({ canAdjust: false, canRequestCancel: false })
    expect(capability.notice).toContain("đã bị hủy toàn bộ")
  })

  it("nhãn số lượng nói cả phần đã hủy", () => {
    expect(lineNetLabel(line())).toBe("3")
    expect(lineNetLabel(line({ cancelledQuantity: 1, netQuantity: 2 }))).toBe("2")

  })

  it("không nói quầy đã nhận khi trạng thái thật vẫn là SUBMITTED", () => {
    const capability = lineCapability(line({ preparationStatus: "SUBMITTED", canAdjustQuantity: false }))
    expect(capability.notice).toContain("chờ quầy nhận")
    expect(capability.notice).not.toContain("Quầy đã nhận phiếu")
  })

  it("mọi trạng thái chế biến đều có nhãn tiếng Việt", () => {
    for (const status of ["SUBMITTED", "ACCEPTED", "PREPARING", "READY", "COLLECTED"] as PreparationStatus[]) {
      expect(PREPARATION_LABEL[status].length).toBeGreaterThan(0)
    }
  })
})

describe("tổng tiền của màn đơn", () => {
  it("tách phần đã hủy khỏi tổng lúc gửi đơn", () => {
    expect(
      orderBoardTotals({
        visitId: 5,
        tableCodes: ["A1"],
        orderCount: 2,
        totalAmountVnd: 1_500_000,
        cancelledAmountVnd: 380_000,
        netAmountVnd: 1_120_000,
        orders: [],
      }),
    ).toEqual({
      orderCount: 2,
      totalAmountVnd: 1_500_000,
      cancelledAmountVnd: 380_000,
      netAmountVnd: 1_120_000,
      hasCancellation: true,
    })
  })

  it("chưa tải xong thì mọi con số là 0, không phải NaN", () => {
    expect(orderBoardTotals(undefined)).toEqual({
      orderCount: 0,
      totalAmountVnd: 0,
      cancelledAmountVnd: 0,
      netAmountVnd: 0,
      hasCancellation: false,
    })
  })
})

describe("badge thông báo món đã xong", () => {
  const notification = (overrides: Partial<ReadyNotification> = {}): ReadyNotification => ({
    eventId: 1,
    ticketId: 10,
    visitId: 42,
    orderedByUserId: 6,
    station: "BAR",
    audience: "ORDERED_BY_USER",
    createdAt: "2030-01-01T14:00:00.000Z",
    acknowledgedAt: null,
    ...overrides,
  })

  it("chỉ đếm thông báo chưa xác nhận", () => {
    expect(readyBadgeCount([notification(), notification({ eventId: 2 })])).toBe(2)
    expect(
      readyBadgeCount([notification(), notification({ eventId: 2, acknowledgedAt: "2030-01-01T14:05:00.000Z" })]),
    ).toBe(1)
    expect(readyBadgeCount([])).toBe(0)
    expect(readyBadgeCount(undefined)).toBe(0)
  })

  it("lọc theo Phiên để màn đơn nói đúng bàn nào vừa có món", () => {
    const list = [notification(), notification({ eventId: 2, visitId: 43 })]
    expect(readyNotificationsForVisit(list, 42).map((entry) => entry.eventId)).toEqual([1])
    expect(readyNotificationsForVisit(list, 99)).toEqual([])
    expect(readyNotificationsForVisit(undefined, 42)).toEqual([])
  })
})

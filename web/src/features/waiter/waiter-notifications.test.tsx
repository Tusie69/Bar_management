import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { readyBadgeCount } from "@/features/waiter-menu/order-board-model"
import type { ReadyNotification, StaffNotification } from "@/features/waiter-menu/waiter-order-api"
import { CancellationDecisionCard, ReadyTicketCard } from "./waiter-notifications"
import { waiterOrdersViewPath } from "./waiter-access"

function notification(overrides: Partial<StaffNotification> = {}): StaffNotification {
  return {
    notificationId: 5,
    kind: "CANCELLATION_DECIDED",
    visitId: 77,
    orderId: 55,
    cancellationGroupId: null,
    cancellationId: 9,
    decision: "APPROVED",
    lineCount: 1,
    quantity: 2,
    wasteQuantity: 0,
    amountVnd: 760_000,
    reason: "Khách đổi ý",
    decisionNote: "Chưa pha",
    decidedByUserId: 2,
    decidedByDisplayName: "Thu ngân Lan",
    decidedAt: "2030-10-24T12:10:00.000Z",
    tableCodes: ["B2"],
    visitSequence: 2,
    createdAt: "2030-10-24T12:10:00.000Z",
    acknowledgedAt: null,
    ...overrides,
  }
}

function card(value: StaffNotification): string {
  return renderToStaticMarkup(
    createElement(CancellationDecisionCard, {
      notification: value,
      onOpen: () => undefined,
      onAcknowledge: () => undefined,
      busy: false,
    }),
  )
}

/**
 * Giai đoạn 3 đổi màn hàng đợi chứ không đổi chuông. Thẻ duyệt hủy là nguồn
 * thứ hai của CÙNG một chuông: nếu nó mất chữ hoặc mất nút, Phục vụ không biết
 * phải quay lại bàn nói gì với khách, và màn hàng đợi mới sẽ không hé lộ điều
 * đó ở bất kỳ test nào của nó.
 */
describe("thẻ kết quả duyệt hủy trong chuông Phục vụ", () => {
  it("thẻ được duyệt nói đủ đơn, bàn, số phần, tiền, người duyệt và ghi chú", () => {
    const html = card(notification())
    expect(html).toContain("Đã duyệt hủy món")
    expect(html).toContain("Đơn 2")
    expect(html).toContain("B2")
    expect(html).toContain("2 phần")
    expect(html).toContain("Thu ngân Lan")
    expect(html).toContain("Lý do đã gửi: Khách đổi ý")
    expect(html).toContain("Ghi chú duyệt: Chưa pha")
  })

  it("thẻ bị từ chối dùng tông destructive và dặn báo lại khách", () => {
    const html = card(notification({ decision: "REJECTED", decisionNote: null }))
    expect(html).toContain("Từ chối hủy món")
    expect(html).toContain("text-destructive")
    expect(html).toContain("Hãy báo lại khách rằng yêu cầu hủy không được duyệt.")
    expect(html).toContain("Ghi chú duyệt: Không có ghi chú.")
  })

  it("hủy cả đơn và hủy một món đọc khác nhau", () => {
    expect(card(notification({ cancellationGroupId: 3 }))).toContain("Đã duyệt hủy cả đơn")
    expect(card(notification({ cancellationGroupId: null }))).toContain("Đã duyệt hủy món")
  })

  it("nút Mở bàn chỉ có khi tin còn gắn với một Phiên", () => {
    expect(card(notification())).toContain("Mở bàn")
    expect(card(notification({ visitId: null }))).not.toContain("Mở bàn")
  })

  it("thời điểm duyệt hỏng hiện — chứ không phải Invalid Date", () => {
    const html = card(notification({ decidedAt: "không-phải-ngày", decidedByDisplayName: null }))
    expect(html).not.toContain("Invalid Date")
    expect(html).not.toContain("NaN")
    expect(html).toContain("—")
  })
})

/**
 * Badge của chuông là TỔNG hai nguồn. Một chuông chỉ đếm một nguồn là một
 * chuông nói dối: Phục vụ thấy số 1, mở ra thấy hai tin, và lần sau không mở
 * nữa.
 */
describe("số trên chuông Phục vụ", () => {
  const ready = [
    {
      eventId: 1,
      ticketId: 9,
      visitId: 77,
      orderedByUserId: 41,
      station: "BAR",
      audience: "ORDERED_BY_USER",
      createdAt: "x",
      acknowledgedAt: null,
    },
    {
      eventId: 2,
      ticketId: 10,
      visitId: 78,
      orderedByUserId: 41,
      station: "BAR",
      audience: "ORDERED_BY_USER",
      createdAt: "x",
      acknowledgedAt: "x",
    },
  ] as const

  it("chỉ đếm phiếu READY chưa xác nhận, cộng với tin duyệt hủy", () => {
    expect(readyBadgeCount(ready)).toBe(1)
    expect(readyBadgeCount(ready) + [notification()].length).toBe(2)
  })

  it("Mở bàn đi tới đúng màn đơn của Phiên", () => {
    expect(waiterOrdersViewPath(77)).toBe("/phucvu/orders/77")
  })
})

/**
 * Tin "món đã xong" trước đây gộp thành một dòng "3 phiếu món đã xong" với nút
 * "Mở bàn mới nhất" — đọc xong vẫn không biết bàn nào, đơn nào, quầy nào.
 */
describe("thẻ món đã xong trong chuông Phục vụ", () => {
  function readyNotification(overrides: Partial<ReadyNotification> = {}): ReadyNotification {
    return {
      eventId: 1,
      ticketId: 9,
      visitId: 77,
      orderedByUserId: 41,
      station: "BAR",
      audience: "ORDERED_BY_USER",
      createdAt: "2030-10-24T06:37:00.000Z",
      acknowledgedAt: null,
      visitSequence: 1,
      tableCodes: ["A3"],
      itemCount: 4,
      ...overrides,
    }
  }
  const readyCard = (value: ReadyNotification): string =>
    renderToStaticMarkup(createElement(ReadyTicketCard, { notification: value, onOpen: () => undefined }))

  it("nói rõ quầy nào, bàn nào, đơn nào và bao nhiêu món", () => {
    const html = readyCard(readyNotification())
    expect(html).toContain("Quầy bar đã xong món cho bàn A3")
    expect(html).toContain("Đơn 1")
    expect(html).toContain("4 món")
    expect(html).toContain("Mở bàn")
    expect(html).not.toContain("phiếu món đã xong")
  })

  it("bếp và nhiều bàn đọc đúng tên", () => {
    const html = readyCard(readyNotification({ station: "KITCHEN", tableCodes: ["A3", "A4"] }))
    expect(html).toContain("Bếp đã xong món cho bàn A3 + A4")
  })

  it("thiếu bàn, thiếu đơn thì bỏ qua chứ không hiện chỗ trống hay NaN", () => {
    const html = readyCard(readyNotification({ tableCodes: [], visitSequence: null, itemCount: 0 }))
    expect(html).toContain("Quầy bar đã xong món")
    expect(html).not.toContain("Đơn ")
    expect(html).not.toContain("NaN")
    expect(html).not.toContain("undefined")
  })

  it("giờ hỏng hiện — chứ không phải Invalid Date", () => {
    const html = readyCard(readyNotification({ createdAt: "không-phải-ngày" }))
    expect(html).not.toContain("Invalid Date")
    expect(html).toContain("—")
  })
})

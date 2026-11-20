import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CancellationCard } from "@/features/orders/cancellation-card"
import { OrderLineRow, PreparationBadge, ReadyBanner } from "./order-board"
import type { CancellationQueueEntry, WaiterOrderLine } from "./waiter-order-api"

const noop = () => undefined

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
    ...overrides,
  }
}

function row(target: WaiterOrderLine, options: { canAdjust?: boolean; canRequestCancel?: boolean } = {}): string {
  return renderToStaticMarkup(
    <OrderLineRow
      line={target}
      canAdjust={options.canAdjust ?? true}
      canRequestCancel={options.canRequestCancel ?? true}
      onAdjust={noop}
      onRequestCancel={noop}
    />,
  )
}

describe("dòng món trên màn Đơn của bàn", () => {
  it("quầy chưa nhận phiếu: có stepper sửa số lượng và nút xin hủy", () => {
    const html = row(line())
    expect(html).toContain("Chờ quầy nhận")
    expect(html).toContain("Quầy bar")
    expect(html).toContain("Tăng số lượng MACALLAN 12 Ly")
    expect(html).toContain("Xin hủy món")
    expect(html).toContain("1.140.000đ")
  })

  it("quầy đã nhận phiếu: mất stepper, còn nút xin hủy và một câu giải thích", () => {
    const html = row(line({ preparationStatus: "ACCEPTED", canAdjustQuantity: false }))
    expect(html).toContain("Quầy đã nhận")
    expect(html).not.toContain("Tăng số lượng")
    expect(html).toContain("Xin hủy món")
    expect(html).toContain("Quầy đã nhận phiếu")
  })

  it("món đã xong: nút đổi thành xin ghi hao và nói rõ lý do", () => {
    const html = row(line({ preparationStatus: "READY", canAdjustQuantity: false }))
    expect(html).toContain("Món đã xong")
    expect(html).toContain("Xin ghi hao")
    expect(html).toContain("ghi hao")
    expect(html).not.toContain("Tăng số lượng")
  })

  it("đang chờ phê duyệt: không còn thao tác nào, chỉ còn trạng thái", () => {
    const html = row(
      line({
        pendingCancellation: {
          cancellationId: 9,
          quantity: 2,
          reason: "Khách đổi ý",
          policy: "STANDARD",
          version: 1,
          requestedByUserId: 6,
          requestedByDisplayName: "Phục vụ",
          requestedAt: "2030-01-01T14:00:00.000Z",
        },
      }),
    )
    expect(html).toContain("Đang chờ phê duyệt hủy 2 phần")
    expect(html).not.toContain("Xin hủy món")
    expect(html).not.toContain("Tăng số lượng")
  })

  it("phần đã hủy hiện cùng tổng cũ bị gạch, dòng không biến mất", () => {
    const html = row(line({ quantity: 3, cancelledQuantity: 1, netQuantity: 2, netTotalVnd: 760_000 }))
    expect(html).toContain("2 (đã hủy 1/3)")
    expect(html).toContain("760.000đ")
    expect(html).toContain("<s")
    expect(html).toContain("1.140.000đ")
  })

  it("hủy hết thì dòng vẫn còn trên màn, gạch ngang và không còn thao tác", () => {
    const html = row(line({ quantity: 2, cancelledQuantity: 2, netQuantity: 0, netTotalVnd: 0 }))
    expect(html).toContain("line-through")
    expect(html).toContain("đã bị hủy toàn bộ")
    expect(html).not.toContain("Xin hủy món")
  })

  it("thiếu quyền thì không hiện thao tác tương ứng", () => {
    expect(row(line(), { canAdjust: false })).not.toContain("Tăng số lượng")
    expect(row(line(), { canRequestCancel: false })).not.toContain("Xin hủy món")
  })

  it("badge trạng thái không vẽ gì khi chưa có phiếu", () => {
    expect(renderToStaticMarkup(<PreparationBadge line={line({ preparationStatus: null })} />)).toBe("")
  })

  it("dải thông báo chỉ hiện khi có phiếu món đã xong", () => {
    expect(renderToStaticMarkup(<ReadyBanner count={0} />)).toBe("")
    expect(renderToStaticMarkup(<ReadyBanner count={2} />)).toContain("2")
  })
})

function entry(overrides: Partial<CancellationQueueEntry> = {}): CancellationQueueEntry {
  return {
    cancellationId: 9,
    status: "PENDING",
    policy: "STANDARD",
    version: 1,
    visitId: 42,
    tableCodes: ["A1", "A2"],
    orderId: 55,
    visitSequence: 1,
    lineNo: 1,
    itemName: "MACALLAN 12",
    variantDisplayName: "Ly",
    station: "BAR",
    ticketStatusAtRequest: "SUBMITTED",
    quantity: 2,
    unitPriceVnd: 380_000,
    amountVnd: 760_000,
    reason: "Khách đổi ý",
    requestedByUserId: 6,
    requestedByDisplayName: "Phục vụ UI",
    requestedAt: "2030-01-01T14:00:00.000Z",
    decidedByUserId: null,
    decidedByDisplayName: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}

describe("thẻ yêu cầu trên hàng chờ phê duyệt", () => {
  it("nói đủ bàn, đơn, dòng, lý do, người xin và số tiền", () => {
    const html = renderToStaticMarkup(
      <CancellationCard entry={entry()} note="" busy={false} onNoteChange={noop} onDecide={noop} />,
    )
    expect(html).toContain("MACALLAN 12")
    expect(html).toContain("Bàn A1 + A2")
    expect(html).toContain("760.000đ")
    expect(html).toContain("Khách đổi ý")
    expect(html).toContain("Phục vụ UI")
    expect(html).toContain("Chờ quầy nhận khi xin hủy")
    expect(html).toContain("Duyệt hủy")
    expect(html).toContain("Từ chối")
  })

  it("yêu cầu ghi hao nói thẳng rằng món đã làm xong", () => {
    const html = renderToStaticMarkup(
      <CancellationCard
        entry={entry({ policy: "READY_WASTE", ticketStatusAtRequest: "READY" })}
        note=""
        busy={false}
        onNoteChange={noop}
        onDecide={noop}
      />,
    )
    expect(html).toContain("Ghi hao món đã làm")
    expect(html).toContain("Món đã xong khi xin hủy")
    expect(html).toContain("Duyệt ghi hao")
  })

  it("yêu cầu đã quyết định không còn nút duyệt", () => {
    const html = renderToStaticMarkup(
      <CancellationCard
        entry={entry({
          status: "APPROVED",
          decidedByUserId: 2,
          decidedByDisplayName: "Thu ngân",
          decidedAt: "2030-01-01T14:10:00.000Z",
          decisionNote: "Đã xác nhận với khách",
        })}
        note=""
        busy={false}
        onNoteChange={noop}
        onDecide={noop}
      />,
    )
    expect(html).toContain("Đã duyệt")
    expect(html).toContain("Thu ngân")
    expect(html).toContain("Đã xác nhận với khách")
    expect(html).not.toContain("Từ chối<")
  })
})

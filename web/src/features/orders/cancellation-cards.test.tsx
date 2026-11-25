import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CancellationApproveSendingStatus, CancellationApproveSummary } from "./cancellation-approve-dialog"
import { CancellationCard } from "./cancellation-card"
import { CancellationGroupCard } from "./cancellation-group-card"
import type { CancellationGroupItem } from "./cancellation-grouping"

const noop = () => undefined

function groupItem(overrides: Partial<CancellationGroupItem> = {}): CancellationGroupItem {
  return {
    kind: "order",
    key: "group:90",
    groupId: 90,
    orderId: 57,
    visitSequence: 2,
    tableCodes: ["BAR01"],
    reason: "Khách có việc gấp phải về",
    requestedByDisplayName: "Phục vụ 1",
    requestedAt: "2026-11-25T13:23:00.000Z",
    totalQuantity: 2,
    amountVnd: 470_000,
    wasteQuantity: 0,
    entryCount: 2,
    entries: [
      {
        cancellationId: 3,
        groupId: 90,
        status: "PENDING",
        policy: "STANDARD",
        version: 1,
        visitId: 3,
        tableCodes: ["BAR01"],
        orderId: 57,
        visitSequence: 2,
        lineNo: 1,
        itemName: "Old Fashioned",
        variantDisplayName: "Ly",
        station: "BAR",
        ticketStatusAtRequest: "SUBMITTED",
        quantity: 1,
        unitPriceVnd: 250_000,
        amountVnd: 250_000,
        reason: "Khách có việc gấp phải về",
        requestedByUserId: 6,
        requestedByDisplayName: "Phục vụ 1",
        requestedAt: "2026-11-25T13:23:00.000Z",
        decidedByUserId: null,
        decidedByDisplayName: null,
        decidedAt: null,
        decisionNote: null,
      },
      {
        cancellationId: 4,
        groupId: 90,
        status: "PENDING",
        policy: "STANDARD",
        version: 1,
        visitId: 3,
        tableCodes: ["BAR01"],
        orderId: 57,
        visitSequence: 2,
        lineNo: 2,
        itemName: "21GAM Negroni Khói Quế",
        variantDisplayName: "Ly",
        station: "BAR",
        ticketStatusAtRequest: "SUBMITTED",
        quantity: 1,
        unitPriceVnd: 220_000,
        amountVnd: 220_000,
        reason: "Khách có việc gấp phải về",
        requestedByUserId: 6,
        requestedByDisplayName: "Phục vụ 1",
        requestedAt: "2026-11-25T13:23:00.000Z",
        decidedByUserId: null,
        decidedByDisplayName: null,
        decidedAt: null,
        decisionNote: null,
      },
    ],
    ...overrides,
  }
}

describe("thẻ hủy cả đơn và hộp xác nhận duyệt", () => {
  it("thẻ hủy cả đơn không có ghi hao dùng nút default và không vẽ dialog khi đóng", () => {
    const html = renderToStaticMarkup(
      <CancellationGroupCard
        group={groupItem()}
        note=""
        busy={false}
        decided={false}
        onNoteChange={noop}
        onDecide={noop}
      />,
    )
    expect(html).toContain("Duyệt cả đơn")
    expect(html).toContain('data-variant="default"')
    expect(html).not.toContain("Huỷ bỏ")
  })

  it("thẻ hủy cả đơn có ghi hao dùng nút destructive", () => {
    const html = renderToStaticMarkup(
      <CancellationGroupCard
        group={groupItem({ wasteQuantity: 1 })}
        note=""
        busy={false}
        decided={false}
        onNoteChange={noop}
        onDecide={noop}
      />,
    )
    expect(html).toContain('data-variant="destructive"')
  })

  it("nội dung hộp xác nhận hủy thường hiển thị đủ món, số lượng, bàn/đơn và số tiền", () => {
    const bodyHtml = renderToStaticMarkup(
      <CancellationApproveSummary
        waste={false}
        tableOrderLabel="Bàn A1 + A2 · đơn 1"
        quantityLabel="1 phần"
        amountVnd={145_000}
        items={[{ key: 1, quantity: 1, itemName: "Khoai tây chiên sốt Truffle", variantDisplayName: "Đĩa" }]}
      />,
    )
    expect(bodyHtml).toContain("Khoai tây chiên sốt Truffle")
    expect(bodyHtml).toContain("1 phần")
    expect(bodyHtml).toContain("Bàn A1 + A2 · đơn 1")
    expect(bodyHtml).toContain("145.000đ")
    expect(bodyHtml).not.toContain("Ghi hao món đã làm - tính vào hao hụt")
  })

  it("nội dung hộp xác nhận ghi hao nói rõ hao hụt và liệt kê các món khi duyệt cả đơn", () => {
    const bodyHtml = renderToStaticMarkup(
      <CancellationApproveSummary
        waste
        tableOrderLabel="Đơn 2 · Bàn BAR01"
        quantityLabel="2 phần (2 dòng món)"
        amountVnd={470_000}
        items={groupItem().entries.map((e) => ({
          key: e.cancellationId,
          quantity: e.quantity,
          itemName: e.itemName,
          variantDisplayName: e.variantDisplayName,
          amountVnd: e.amountVnd,
        }))}
        wasteNoticeDetail="1 phần đã làm xong trong đơn này."
      />,
    )
    expect(bodyHtml).toContain("Ghi hao món đã làm - tính vào hao hụt")
    expect(bodyHtml).toContain("Old Fashioned")
    expect(bodyHtml).toContain("21GAM Negroni Khói Quế")
    expect(bodyHtml).toContain("Đơn 2 · Bàn BAR01")
    expect(bodyHtml).toContain("470.000đ")
  })

  it("thẻ đơn dùng nút default/destructive theo chính sách và chưa vẽ hộp xác nhận khi đóng", () => {
    const standardEntry = groupItem().entries[0]!
    const wasteEntry = { ...standardEntry, policy: "READY_WASTE" as const, ticketStatusAtRequest: "READY" as const }
    const standardHtml = renderToStaticMarkup(
      <CancellationCard entry={standardEntry} note="" busy={false} onNoteChange={noop} onDecide={noop} />,
    )
    const wasteHtml = renderToStaticMarkup(
      <CancellationCard entry={wasteEntry} note="" busy={false} onNoteChange={noop} onDecide={noop} />,
    )
    expect(standardHtml).toContain("Duyệt hủy")
    expect(standardHtml).toContain('data-variant="default"')
    expect(standardHtml).not.toContain("Huỷ bỏ")
    expect(wasteHtml).toContain("Duyệt ghi hao")
    expect(wasteHtml).toContain('data-variant="destructive"')
  })

  it("trạng thái đang gửi có role=status, tên truy cập và tabIndex=0 để giữ focus trong hộp", () => {
    const statusHtml = renderToStaticMarkup(<CancellationApproveSendingStatus />)
    expect(statusHtml).toContain('role="status"')
    expect(statusHtml).toContain('aria-live="polite"')
    expect(statusHtml).toContain('aria-label="Đang duyệt..."')
    expect(statusHtml).toContain('tabindex="0"')
    expect(statusHtml).toContain("Đang duyệt yêu cầu, vui lòng chờ...")
  })
})

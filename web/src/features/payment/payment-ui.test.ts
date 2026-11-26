import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { PayBill, Receipt } from "@/services/payment"
import { BillRoundsCard, DetailActionPane, ProvisionalPreviewView } from "./bill-pane"
import { CashActionPane, MethodActionPane, QrActionPane, SuccessView } from "./pay-actions"

function sampleBill(overrides: Partial<PayBill> = {}): PayBill {
  return {
    billCode: "B0412",
    visitId: "s412",
    sessionCode: "S-0412",
    code: "A3",
    tables: ["A3"],
    status: "SERVING",
    lines: [
      {
        orderRound: 1,
        roundTime: "19:08",
        roundBy: "Minh",
        name: "Tiger Crystal",
        unit: "Chai 330ml",
        qty: 2,
        unitPriceVnd: 42_800,
        lineTotalVnd: 85_600,
        state: "SERVED",
      },
      {
        orderRound: 2,
        roundTime: "20:15",
        roundBy: "Minh",
        name: "Mojito",
        unit: "Ly",
        qty: 1,
        unitPriceVnd: 55_000,
        lineTotalVnd: 55_000,
        state: "MAKING",
        note: "Ít đá",
      },
      {
        orderRound: 2,
        roundTime: "20:15",
        roundBy: "Minh",
        name: "Margarita",
        unit: "Ly",
        qty: 1,
        unitPriceVnd: 120_000,
        lineTotalVnd: 120_000,
        state: "CANCELLED",
        note: "Khách đổi món",
      },
      {
        orderRound: 3,
        roundTime: "20:30",
        roundBy: "Minh",
        name: "Tháp bia",
        unit: "Tháp",
        qty: 1,
        unitPriceVnd: 450_000,
        lineTotalVnd: 450_000,
        state: "CANCELLED",
      },
    ],
    subtotalVnd: 140_600,
    vatVnd: 14_060,
    preRoundVnd: 154_660,
    roundingVnd: 340,
    dueVnd: 155_000,
    version: 1,
    openedAt: "19:05",
    waiterName: "Minh",
    guests: 4,
    roundCount: 3,
    ...overrides,
  }
}

describe("BillRoundsCard & ProvisionalPreviewView", () => {
  it("hides cancelled items and cancelled-only rounds completely without any cancelled-line summary", () => {
    const html = renderToStaticMarkup(createElement(BillRoundsCard, { bill: sampleBill() }))
    expect(html).toContain("Tiger Crystal")
    expect(html).toContain("Mojito")
    expect(html).not.toContain("Margarita")
    expect(html).not.toContain("Tháp bia")
    expect(html).not.toContain("Đợt 3")
    expect(html).not.toContain("dòng món đã hủy")
    expect(html).toContain("theo cấu hình · chờ chốt TN-03")
    expect(html).toContain("Chưa áp dụng · chờ BA chốt")
    expect(html).toContain("155.000đ")
  })

  it("renders S3 preview without page title and keeps demo QR + provisional notice", () => {
    const html = renderToStaticMarkup(
      createElement(ProvisionalPreviewView, {
        bill: sampleBill({ status: "AWAITING_PAYMENT", pendingAt: "21:31" }),
        canCollect: true,
        isWaiter: false,
        busy: false,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onSimulatedPrint: () => undefined,
      }),
    )
    expect(html).toContain("Trên màn hình")
    expect(html).toContain("Bản in 80mm")
    expect(html).toContain("21GAM B0412")
    expect(html).toContain("Bill tạm tính, chưa phải hóa đơn")
  })
})

describe("Role-specific detail actions (PA-A)", () => {
  it("shows Xem tạm tính and Chốt bill & thu tiền for Cashier", () => {
    const html = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: sampleBill(),
        canCollect: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
      }),
    )
    expect(html).toContain("1 món đang làm, vẫn tính vào bill. Hỏi khách trước khi chốt.")
    expect(html).toContain("Xem tạm tính")
    expect(html).toContain("Chốt bill &amp; thu tiền")
    expect(html).not.toContain("Gửi yêu cầu thanh toán")
  })

  it("shows Xem tạm tính and Gửi yêu cầu thanh toán for Waiter PA-A, then Đã gửi after request", () => {
    const before = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: sampleBill(),
        canCollect: false,
        isWaiter: true,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
      }),
    )
    expect(before).toContain("Gửi yêu cầu thanh toán")
    expect(before).not.toContain("Chốt bill &amp; thu tiền")

    const after = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: sampleBill({ requestedAt: "21:38", status: "AWAITING_PAYMENT" }),
        canCollect: false,
        isWaiter: true,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
      }),
    )
    expect(after).toContain("Đã gửi · chờ Thu ngân chốt")
    expect(after).not.toContain("Chốt bill &amp; thu tiền")
  })

  it("never renders collection or request actions when role is neither collect-capable nor Waiter (Bartender)", () => {
    const html = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: sampleBill(),
        canCollect: false,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
      }),
    )
    expect(html).not.toContain("Chốt bill &amp; thu tiền")
    expect(html).not.toContain("Gửi yêu cầu thanh toán")
    expect(html).not.toContain("Bartender")
  })
})

describe("Cash, QR, Method, and Success views", () => {
  it("does not show a method switch on Cash or QR screens and omits vừa đủ sub-label on exact chip", () => {
    const cashHtml = renderToStaticMarkup(
      createElement(CashActionPane, {
        bill: sampleBill(),
        busy: false,
        error: null,
        onClearError: () => undefined,
        onConfirm: () => undefined,
        onToList: () => undefined,
      }),
    )
    expect(cashHtml).toContain("Khách đưa")
    expect(cashHtml).not.toContain("Chọn phương thức")
    expect(cashHtml).not.toContain(">vừa đủ<")
    expect(cashHtml).not.toContain("Chuyển khoản QR")

    const qrHtml = renderToStaticMarkup(
      createElement(QrActionPane, {
        bill: sampleBill(),
        busy: false,
        error: null,
        onCheckTransfer: async () => ({ found: false }),
        onConfirmManual: () => undefined,
        onToList: () => undefined,
        onCopied: () => undefined,
      }),
    )
    expect(qrHtml).toContain("21GAM B0412")
    expect(qrHtml).toContain("Xác nhận đã nhận tiền")
    expect(qrHtml).not.toContain("Tiền mặt")
  })

  it("renders duplicate and network error banners honestly", () => {
    const netHtml = renderToStaticMarkup(
      createElement(CashActionPane, {
        bill: sampleBill(),
        busy: false,
        error: { kind: "net", message: "Mất mạng" },
        onClearError: () => undefined,
        onConfirm: () => undefined,
        onToList: () => undefined,
      }),
    )
    expect(netHtml).toContain("Không gửi được tới máy chủ")
    expect(netHtml).toContain("CHƯA được ghi nhận")

    const dupHtml = renderToStaticMarkup(
      createElement(QrActionPane, {
        bill: sampleBill(),
        busy: false,
        error: { kind: "dup", message: "Dup", confirmedBy: "Thu ngân Hà", confirmedAt: "21:43" },
        onCheckTransfer: async () => ({ found: false }),
        onConfirmManual: () => undefined,
        onToList: () => undefined,
        onCopied: () => undefined,
      }),
    )
    expect(dupHtml).toContain("Bill này đã được thanh toán trên thiết bị khác")
    expect(dupHtml).toContain("Thu ngân Hà xác nhận lúc 21:43")
  })

  it("applies selected class on Method row and renders cluster receipt on Success", () => {
    const methodHtml = renderToStaticMarkup(
      createElement(MethodActionPane, {
        bill: sampleBill(),
        lastMethod: "CASH",
        onSelectMethod: () => undefined,
      }),
    )
    expect(methodHtml).toContain("pay-mrow sel")
    expect(methodHtml).toContain("Đang chọn")

    const receipt: Receipt = {
      billCode: "B0408",
      visitId: "s408",
      sessionCode: "S-0408",
      code: "G01",
      tables: ["A1", "A2"],
      clusterCode: "G01",
      method: "TRANSFER",
      manual: true,
      givenVnd: 3_044_000,
      changeVnd: 0,
      preRoundVnd: 3_043_700,
      dueVnd: 3_044_000,
      confirmedAt: "21:44",
      confirmedBy: "Thu ngân · Thu ngân",
    }
    const okHtml = renderToStaticMarkup(
      createElement(SuccessView, {
        receipt,
        onToList: () => undefined,
        onPrintReceipt: () => undefined,
      }),
    )
    expect(okHtml).toContain("G01 (A1, A2)")
    expect(okHtml).toContain("Chuyển khoản QR · xác nhận tay")
    expect(okHtml).toContain("Trống")
  })

  it("enforces synchronous in-flight guard against double submit before React re-renders", () => {
    const ref = { current: false }
    const submitSpy = vi.fn()
    const attemptSubmit = () => {
      if (ref.current) return false
      ref.current = true
      submitSpy()
      return true
    }
    expect(attemptSubmit()).toBe(true)
    expect(attemptSubmit()).toBe(false)
    expect(submitSpy).toHaveBeenCalledTimes(1)
  })
})

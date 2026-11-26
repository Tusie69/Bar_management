// @vitest-environment node
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type {
  CancelRequest,
  PayBill,
  PayBillSummary,
  PaymentApi,
  PaymentNotification,
  PreviewBill,
  Receipt,
  SessionBills,
} from "@/services/payment"
import { BillRoundsCard, DetailActionPane, ProvisionalPreviewView } from "./bill-pane"
import {
  CashActionPane,
  ENABLE_BANK_TRANSFER_CHECK,
  MethodActionPane,
  QrActionPane,
  SuccessView,
} from "./pay-actions"
import { PaymentNotificationBell } from "./payment-notifications"
import { PaymentFlowWorkspace, partitionOpenSessions } from "./payment-page"
import { submitPaymentConfirm, type IdempotencySlot } from "./payment-submit"

function makeBill(overrides: Partial<PayBill> = {}): PayBill {
  return {
    billCode: "B0412",
    visitId: "1283",
    sessionCode: "S-1283",
    code: "A3",
    tables: ["A3"],
    status: "AWAITING_PAYMENT",
    billStatus: "UNPAID",
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
      },
    ],
    subtotalVnd: 140_600,
    vatVnd: 14_060,
    preRoundVnd: 154_660,
    roundingVnd: 340,
    dueVnd: 155_000,
    version: 1,
    openedAt: "19:05",
    issuedAt: "21:31",
    issuedBy: "Minh",
    waiterName: "Minh",
    guests: 4,
    roundCount: 2,
    ...overrides,
  }
}

function makeFakeApi(overrides: Partial<PaymentApi> = {}): PaymentApi {
  const bill = makeBill()
  const preview: PreviewBill = {
    visitId: bill.visitId,
    sessionCode: bill.sessionCode,
    code: bill.code,
    tables: bill.tables,
    lines: bill.lines,
    subtotalVnd: bill.subtotalVnd,
    vatVnd: bill.vatVnd,
    preRoundVnd: bill.preRoundVnd,
    roundingVnd: bill.roundingVnd,
    dueVnd: bill.dueVnd,
    version: bill.version,
  }
  const sessionBills: SessionBills = {
    visitId: bill.visitId,
    sessionCode: bill.sessionCode,
    code: bill.code,
    tables: bill.tables,
    status: "AWAITING_PAYMENT",
    unbilledLineCount: 0,
    bills: [bill],
    version: bill.version,
  }
  const receipt: Receipt = {
    billCode: bill.billCode,
    visitId: bill.visitId,
    sessionCode: bill.sessionCode,
    code: bill.code,
    tables: bill.tables,
    method: "CASH",
    manual: false,
    givenVnd: 200_000,
    changeVnd: 45_000,
    preRoundVnd: bill.preRoundVnd,
    dueVnd: bill.dueVnd,
    confirmedAt: "21:45",
    confirmedBy: "Thu ngân",
  }
  return {
    listOpen: async () => [],
    getBill: async () => bill,
    createPrebill: async () => bill,
    requestPayment: async () => undefined,
    confirmCash: async (_v, _g, _ver, _k, billCode) => ({ ...receipt, billCode: billCode ?? receipt.billCode }),
    confirmTransfer: async (_v, _m, _ver, _k, billCode) => ({
      ...receipt,
      method: "TRANSFER",
      manual: true,
      billCode: billCode ?? receipt.billCode,
    }),
    listNotifications: async () => [],
    checkTransfer: async () => ({ found: false }),
    previewBill: async () => preview,
    issueInvoice: async () => bill,
    getSessionBills: async () => sessionBills,
    requestCancel: async (billCode, reason) => ({
      id: "cr-1",
      billCode,
      visitId: bill.visitId,
      code: bill.code,
      dueVnd: bill.dueVnd,
      reason,
      requestedBy: "Thu ngân",
      requestedAt: "21:50",
      status: "PENDING",
    }),
    listCancelRequests: async () => [],
    decideCancel: async () => {
      throw new Error("not used in W3")
    },
    cancelPaid: async () => {
      throw new Error("forbidden for W3 cashier")
    },
    listAudit: async () => [],
    ...overrides,
  }
}

describe("W3 TN-01: S1 Cần thu grouping, invoice-issued tag, and INVOICE_ISSUED bell", () => {
  it("partitions AWAITING_PAYMENT and multi-bill unpaid sessions into Cần thu", () => {
    const sessions: PayBillSummary[] = [
      {
        visitId: "1",
        billCode: "B1",
        sessionCode: "S-1",
        code: "A1",
        tables: ["A1"],
        status: "SERVING",
        openedAt: "19:00",
        waiterName: "Minh",
        guests: 2,
        dueVnd: 100_000,
        version: 1,
      },
      {
        visitId: "2",
        billCode: "B2",
        sessionCode: "S-2",
        code: "A3",
        tables: ["A3"],
        status: "AWAITING_PAYMENT",
        openedAt: "19:05",
        waiterName: "Minh",
        issuedBy: "Lan",
        issuedAt: "21:31",
        guests: 4,
        dueVnd: 155_000,
        unpaidBillCount: 1,
        version: 2,
      },
      {
        visitId: "3",
        billCode: "B3",
        sessionCode: "S-3",
        code: "B5",
        tables: ["B5"],
        status: "SERVING",
        openedAt: "20:00",
        waiterName: "Hà",
        guests: 2,
        dueVnd: 80_000,
        unpaidBillCount: 1,
        version: 2,
      },
    ]
    const { pending, serving } = partitionOpenSessions(sessions)
    expect(pending.map((s) => s.code)).toEqual(["A3", "B5"])
    expect(serving.map((s) => s.code)).toEqual(["A1"])
  })

  it("renders INVOICE_ISSUED notification in PaymentNotificationBell", () => {
    const ntfs: PaymentNotification[] = [
      {
        id: "inv-1",
        type: "INVOICE_ISSUED",
        title: "Đã đưa hóa đơn",
        text: "A3 · Lan · 21:31",
        time: "21:31",
        visitId: "1283",
      },
    ]
    const html = renderToStaticMarkup(
      createElement(PaymentNotificationBell, {
        notifications: ntfs,
        unread: true,
        defaultOpen: true,
        onOpen: () => undefined,
      }),
    )
    expect(html).toContain("pay-ntf-req")
    expect(html).toContain("Đã đưa hóa đơn")
    expect(html).toContain("A3 · Lan · 21:31")
  })
})

describe("W3 VM-06 / VM-07 / VM-03 / VM-05: BillPane & Preview", () => {
  it("drops chờ chốt TN-03 tag and renders service/surcharge line as Đang phát triển / 0đ", () => {
    const html = renderToStaticMarkup(createElement(BillRoundsCard, { bill: makeBill() }))
    expect(html).not.toContain("chờ chốt TN-03")
    expect(html).not.toContain("Chưa áp dụng · chờ BA chốt")
    expect(html).toContain("Phí phục vụ · phụ thu")
    expect(html).toContain("Đang phát triển")
    expect(html).toContain("0đ")
  })

  it("renders state-free provisional preview without QR and issued invoice with QR", () => {
    const previewHtml = renderToStaticMarkup(
      createElement(ProvisionalPreviewView, {
        bill: makeBill({ billCode: "", status: "SERVING" }),
        isProvisional: true,
        canCollect: true,
        isWaiter: false,
        busy: false,
        onIssueInvoice: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onSimulatedPrint: () => undefined,
      }),
    )
    expect(previewHtml).toContain("TẠM TÍNH")
    expect(previewHtml).toContain("Tạm tính – chưa phải hóa đơn")
    expect(previewHtml).toContain("In tạm tính")
    expect(previewHtml).toContain("Xuất hóa đơn")
    expect(previewHtml).not.toContain("DEMO – KHÔNG CHUYỂN TIỀN")

    const invoiceHtml = renderToStaticMarkup(
      createElement(ProvisionalPreviewView, {
        bill: makeBill({ billCode: "B0412", status: "AWAITING_PAYMENT" }),
        isProvisional: false,
        canCollect: true,
        isWaiter: false,
        busy: false,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onSimulatedPrint: () => undefined,
      }),
    )
    expect(invoiceHtml).toContain("HÓA ĐƠN")
    expect(invoiceHtml).toContain("In hóa đơn")
    expect(invoiceHtml).toContain("21GAM B0412")
    expect(invoiceHtml).toContain("DEMO – KHÔNG CHUYỂN TIỀN")
  })
})

describe("W3 VM-08 / V12: Multi-bill S2, issueInvoice, billCode confirm, and S7 open session", () => {
  it("lists PAID and UNPAID bills on S2, shows unbilled lines + Xuất hóa đơn, and collects chosen UNPAID bill", () => {
    const bill1 = makeBill({ billCode: "B0411", billStatus: "PAID", status: "AWAITING_PAYMENT", dueVnd: 100_000 })
    const bill2 = makeBill({ billCode: "B0412", billStatus: "UNPAID", status: "AWAITING_PAYMENT", dueVnd: 155_000 })

    const html = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: bill2,
        bills: [bill1, bill2],
        selectedBillCode: "B0412",
        onSelectBill: () => undefined,
        unbilledLineCount: 2,
        canCollect: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onIssueInvoice: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
      }),
    )
    expect(html).toContain("Hóa đơn trong phiên (2)")
    expect(html).toContain("B0411")
    expect(html).toContain("Đã thu")
    expect(html).toContain("B0412")
    expect(html).toContain("Chưa thu")
    expect(html).toContain("Còn 2 dòng món chưa xuất hóa đơn")
    expect(html).toContain("Xuất hóa đơn")
    expect(html).toContain("Thu tiền · B0412")
  })

  it("passes chosen billCode to confirmCash and confirmTransfer on fake PaymentApi", async () => {
    const confirmCash = vi.fn(makeFakeApi().confirmCash)
    const confirmTransfer = vi.fn(makeFakeApi().confirmTransfer)
    const api = makeFakeApi({ confirmCash, confirmTransfer })
    const bill2 = makeBill({ billCode: "B0419", version: 3 })
    const inFlightRef = { current: false }
    const idempotencyKeyRef: { current: IdempotencySlot | null } = { current: null }

    const rcCash = await submitPaymentConfirm({
      api,
      bill: bill2,
      canCollect: true,
      method: "CASH",
      givenVnd: 200_000,
      busy: false,
      inFlightRef,
      idempotencyKeyRef,
      setBusy: () => undefined,
      setPayError: () => undefined,
      setReceipt: () => undefined,
      invalidate: async () => undefined,
      onSuccess: () => undefined,
    })
    expect(confirmCash).toHaveBeenCalledWith("1283", 200_000, 3, expect.any(String), "B0419")
    expect(rcCash?.billCode).toBe("B0419")

    const rcQr = await submitPaymentConfirm({
      api,
      bill: bill2,
      canCollect: true,
      method: "TRANSFER",
      busy: false,
      inFlightRef,
      idempotencyKeyRef,
      setBusy: () => undefined,
      setPayError: () => undefined,
      setReceipt: () => undefined,
      invalidate: async () => undefined,
      onSuccess: () => undefined,
    })
    expect(confirmTransfer).toHaveBeenCalledWith("1283", true, 3, expect.any(String), "B0419")
    expect(rcQr?.billCode).toBe("B0419")
  })

  it("keeps session open on SuccessView when sessionRemainingOpen is true", () => {
    const html = renderToStaticMarkup(
      createElement(SuccessView, {
        receipt: {
          billCode: "B0411",
          visitId: "1283",
          sessionCode: "S-1283",
          code: "A3",
          tables: ["A3"],
          method: "CASH",
          manual: false,
          givenVnd: 100_000,
          changeVnd: 0,
          preRoundVnd: 100_000,
          dueVnd: 100_000,
          confirmedAt: "21:40",
          confirmedBy: "Thu ngân",
        },
        sessionRemainingOpen: true,
        onToList: () => undefined,
        onBackToSession: () => undefined,
      }),
    )
    expect(html).toContain("vẫn đang mở")
    expect(html).toContain("Về chi tiết Phiên")
    expect(html).toContain('data-testid="pay-receipt-print-status"')
  })
})

describe("W3 VM-09 / VM-10 / VM-11 / VM-12 / TN-09-K4: Method, QR, Offline & NA45C-04 slots", () => {
  it("replaces Giai đoạn sau with Đang phát triển and locks Ghi nợ, Thẻ, Tách bill, Giảm giá, Voucher, Hóa đơn điện tử", () => {
    const html = renderToStaticMarkup(
      createElement(MethodActionPane, {
        bill: makeBill(),
        lastMethod: null,
        onSelectMethod: () => undefined,
      }),
    )
    expect(html).not.toContain("Giai đoạn sau")
    expect(html).toContain("Đang phát triển")
    for (const label of ["Ghi nợ", "Thẻ", "Tách bill", "Giảm giá", "Voucher", "Hóa đơn điện tử"]) {
      expect(html).toContain(label)
    }
  })

  it("locks Chuyển khoản QR with reason when offline while keeping Tiền mặt active (TN-09-K4)", () => {
    const methodHtml = renderToStaticMarkup(
      createElement(MethodActionPane, {
        bill: makeBill(),
        lastMethod: null,
        isOffline: true,
        onSelectMethod: () => undefined,
      }),
    )
    expect(methodHtml).toContain("Mất kết nối mạng, không tạo được QR. Hãy thu Tiền mặt.")
    expect(methodHtml).toMatch(/disabled=""[^>]*class="pay-mrow"/)

    const cashHtml = renderToStaticMarkup(
      createElement(CashActionPane, {
        bill: makeBill(),
        busy: false,
        error: null,
        onClearError: () => undefined,
        onConfirm: () => undefined,
        onToList: () => undefined,
      }),
    )
    expect(cashHtml).not.toContain("Mất kết nối mạng")

    const qrOfflineHtml = renderToStaticMarkup(
      createElement(QrActionPane, {
        bill: makeBill(),
        busy: false,
        error: null,
        isOffline: true,
        onCheckTransfer: async () => ({ found: false }),
        onConfirmManual: () => undefined,
        onSwitchToCash: () => undefined,
        onToList: () => undefined,
      }),
    )
    expect(qrOfflineHtml).toContain("Mất kết nối mạng")
    expect(qrOfflineHtml).toContain("Chuyển sang Tiền mặt")
  })

  it("shows Techcombank without account number, locks Kiểm tra giao dịch as Đang phát triển, and includes inline copy slot", () => {
    expect(ENABLE_BANK_TRANSFER_CHECK).toBe(false)
    const html = renderToStaticMarkup(
      createElement(QrActionPane, {
        bill: makeBill(),
        busy: false,
        error: null,
        onCheckTransfer: async () => ({ found: false }),
        onConfirmManual: () => undefined,
        onToList: () => undefined,
      }),
    )
    expect(html).toContain("Techcombank")
    expect(html).not.toContain("Số tài khoản")
    expect(html).not.toContain("[Chờ quán cung cấp]")
    expect(html).toContain('data-testid="pay-qr-copy-status"')
    expect(html).toContain("Đang phát triển")
    expect(html).toContain('aria-label="Kiểm tra giao dịch · Đang phát triển"')
  })
})

describe("W3 TN-14: PAID bill cancel request (cashier side only)", () => {
  it("shows Gửi yêu cầu huỷ on a PAID bill and never shows direct cancel", () => {
    const paidBill = makeBill({ billCode: "B0412", billStatus: "PAID", status: "PAID", paidAt: "21:40" })
    const html = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: paidBill,
        bills: [paidBill],
        selectedBillCode: "B0412",
        canCollect: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(html).toContain("Gửi yêu cầu huỷ")
    expect(html).not.toContain("Huỷ thanh toán")
    expect(html).not.toContain("Thu tiền")
  })

  it.each<{ status: CancelRequest["status"]; expectedText: string }>([
    { status: "PENDING", expectedText: "Đang chờ duyệt (PENDING)" },
    { status: "APPROVED", expectedText: "Đã duyệt huỷ (APPROVED)" },
    { status: "REJECTED", expectedText: "Bị từ chối (REJECTED)" },
  ])("renders $status cancel request state accurately", ({ status, expectedText }) => {
    const paidBill = makeBill({ billCode: "B0412", billStatus: "PAID", status: "PAID", paidAt: "21:40" })
    const req: CancelRequest = {
      id: "cr-1",
      billCode: "B0412",
      visitId: "1283",
      code: "A3",
      dueVnd: 155_000,
      reason: "Thu nhầm phương thức",
      requestedBy: "Thu ngân",
      requestedAt: "21:42",
      status,
      ...(status !== "PENDING" ? { decidedBy: "Admin Edit", decidedAt: "21:44", decisionNote: "Đã kiểm tra" } : {}),
    }
    const html = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: paidBill,
        bills: [paidBill],
        selectedBillCode: "B0412",
        cancelRequests: [req],
        canCollect: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(html).toContain(expectedText)
    expect(html).toContain("Thu nhầm phương thức")
    if (status === "PENDING" || status === "APPROVED") {
      expect(html).not.toContain("Gửi yêu cầu huỷ")
    } else {
      expect(html).toContain("Gửi yêu cầu huỷ")
    }
  })

  it("mounts PaymentFlowWorkspace with a fake PaymentApi without throwing", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const api = makeFakeApi()
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          MemoryRouter,
          { initialEntries: ["/payment"] },
          createElement(PaymentFlowWorkspace, { api }),
        ),
      ),
    )
    expect(html).toContain("pay-root")
  })
})

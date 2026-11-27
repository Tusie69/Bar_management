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
import { buildNotificationTargetPath, resolveNotificationBillCode } from "./payment-notification-target"
import {
  PaymentFlowWorkspace,
  buildSuccessFeedbackText,
  isSessionConfirmedClosed,
  partitionOpenSessions,
  previewToPayBill,
  type PaymentAccessOverride,
} from "./payment-page"
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
    listMyCancelRequests: async () => [],
    listPaidBills: async () => [],
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

const CASHIER_ACCESS: PaymentAccessOverride = {
  role: "CASHIER",
  canCollect: true,
  canAuditRead: false,
  canReadOrders: false,
}

describe("W3 TN-01: S1 Cần thu grouping, invoice-issued tag, and INVOICE_ISSUED bell", () => {
  it("groups AWAITING_PAYMENT into Cần thu while keeping SERVING with unpaid bills in Đang phục vụ with a badge", () => {
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
    expect(pending.map((s) => s.code)).toEqual(["A3"])
    expect(serving.map((s) => s.code)).toEqual(["A1", "B5"])

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData<PayBillSummary[]>(["payment-open"], sessions)
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          MemoryRouter,
          { initialEntries: ["/payment"] },
          createElement(PaymentFlowWorkspace, {
            api: makeFakeApi({ listOpen: async () => sessions }),
            accessOverride: CASHIER_ACCESS,
          }),
        ),
      ),
    )
    expect(html).toContain("1 bill chờ thu")
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

  it.each<{
    status: CancelRequest["status"]
    billOverrides?: Partial<PayBill>
    expectedText: string
    expectRequestButton: boolean
  }>([
    { status: "PENDING", expectedText: "Đang chờ duyệt (PENDING)", expectRequestButton: false },
    {
      status: "APPROVED",
      billOverrides: { billStatus: "UNPAID", status: "AWAITING_PAYMENT", paidAt: undefined },
      expectedText: "Đã duyệt huỷ (APPROVED)",
      expectRequestButton: false,
    },
    { status: "REJECTED", expectedText: "Bị từ chối (REJECTED)", expectRequestButton: true },
  ])("renders $status cancel request state accurately", ({ status, billOverrides, expectedText, expectRequestButton }) => {
    const targetBill = makeBill({
      billCode: "B0412",
      billStatus: "PAID",
      status: "PAID",
      paidAt: "21:40",
      ...billOverrides,
    })
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
        bill: targetBill,
        bills: [targetBill],
        selectedBillCode: "B0412",
        cancelRequests: [req],
        canCollect: true,
        canRequestCancel: true,
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
    if (status !== "PENDING") {
      expect(html).toContain("Admin Edit")
      expect(html).toContain("Đã kiểm tra")
    }
    if (expectRequestButton) {
      expect(html).toContain("Gửi yêu cầu huỷ")
    } else {
      expect(html).not.toContain("Gửi yêu cầu huỷ")
    }
  })

  it("keeps cancel approval history alongside re-collection and still allows a new cancel request (NA45H-11)", () => {
    const recollectedPaidBill = makeBill({
      billCode: "B0412",
      billStatus: "PAID",
      status: "PAID",
      paidAt: "21:55",
      paidBy: "Thu ngân",
    })
    const priorApprovedReq: CancelRequest = {
      id: "cr-old",
      billCode: "B0412",
      visitId: "1283",
      code: "A3",
      dueVnd: 155_000,
      reason: "Thu nhầm lần 1",
      requestedBy: "Thu ngân",
      requestedAt: "21:42",
      status: "APPROVED",
      decidedBy: "Admin Edit",
      decidedAt: "21:44",
      decisionNote: "Duyệt huỷ lần 1",
    }

    const cashierHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: recollectedPaidBill,
        bills: [recollectedPaidBill],
        selectedBillCode: "B0412",
        cancelRequests: [priorApprovedReq],
        canCollect: true,
        canRequestCancel: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(cashierHtml).toContain("Gửi yêu cầu huỷ")
    expect(cashierHtml).toContain("Lần thanh toán sau")
    expect(cashierHtml).toContain("Đã thu lại lúc 21:55")
    expect(cashierHtml).toContain("Lịch sử huỷ thanh toán")
    expect(cashierHtml).toContain("Đã duyệt huỷ (APPROVED)")
    expect(cashierHtml).toContain("Thu nhầm lần 1")
    expect(cashierHtml).toContain("Admin Edit")
    expect(cashierHtml).toContain("Duyệt huỷ lần 1")

    const pendingFollowupReq: CancelRequest = {
      id: "cr-new",
      billCode: "B0412",
      visitId: "1283",
      code: "A3",
      dueVnd: 155_000,
      reason: "Huỷ lần 2 sau thu lại",
      requestedBy: "Thu ngân",
      requestedAt: "22:00",
      status: "PENDING",
    }
    const withNewPendingHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: recollectedPaidBill,
        bills: [recollectedPaidBill],
        selectedBillCode: "B0412",
        cancelRequests: [pendingFollowupReq, priorApprovedReq],
        canCollect: true,
        canRequestCancel: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(withNewPendingHtml).toContain("Đang chờ duyệt (PENDING)")
    expect(withNewPendingHtml).toContain("Huỷ lần 2 sau thu lại")
    expect(withNewPendingHtml).toContain("Đã duyệt huỷ (APPROVED)")
    expect(withNewPendingHtml).toContain("Thu nhầm lần 1")
    expect(withNewPendingHtml).not.toContain("Gửi yêu cầu huỷ")

    const adminHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: recollectedPaidBill,
        bills: [recollectedPaidBill],
        selectedBillCode: "B0412",
        cancelRequests: [
          {
            ...priorApprovedReq,
            status: "REJECTED",
          },
        ],
        canCollect: true,
        canRequestCancel: false,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(adminHtml).toContain("Bị từ chối (REJECTED)")
    expect(adminHtml).not.toContain("Gửi yêu cầu huỷ")
  })

  it("shows direct-cancel history, re-collection milestone, deduplication, and allows a new request from PayBill.cancelHistory (NA45H-11)", () => {
    const unpaidAfterDirectCancel = makeBill({
      billCode: "B1279",
      billStatus: "UNPAID",
      status: "AWAITING_PAYMENT",
      cancelHistory: [
        {
          kind: "DIRECT",
          reason: "Khách đổi sang chuyển khoản",
          actor: "Linh · Lễ tân",
          at: "21:44",
        },
      ],
    })

    const unpaidHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: unpaidAfterDirectCancel,
        bills: [unpaidAfterDirectCancel],
        selectedBillCode: "B1279",
        cancelRequests: [],
        canCollect: true,
        canRequestCancel: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(unpaidHtml).toContain("Lịch sử huỷ thanh toán")
    expect(unpaidHtml).toContain("Đã huỷ trực tiếp (DIRECT)")
    expect(unpaidHtml).toContain("Khách đổi sang chuyển khoản")
    expect(unpaidHtml).toContain("Người huỷ: Linh · Lễ tân")
    expect(unpaidHtml).not.toContain("Lần thanh toán sau")
    expect(unpaidHtml).toContain("Thu tiền")

    const recollectedAfterDirectCancel = makeBill({
      billCode: "B1279",
      billStatus: "PAID",
      status: "PAID",
      paidAt: "21:55",
      paidBy: "Thu ngân",
      cancelHistory: [
        {
          kind: "DIRECT",
          reason: "Khách đổi sang chuyển khoản",
          actor: "Linh · Lễ tân",
          at: "21:44",
          recollectedAt: "21:55",
        },
      ],
    })

    const recollectedHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: recollectedAfterDirectCancel,
        bills: [recollectedAfterDirectCancel],
        selectedBillCode: "B1279",
        cancelRequests: [],
        canCollect: true,
        canRequestCancel: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(recollectedHtml).toContain("Lần thanh toán sau")
    expect(recollectedHtml).toContain("Đã thu lại lúc 21:55")
    expect(recollectedHtml).toContain("Lịch sử huỷ thanh toán")
    expect(recollectedHtml).toContain("Đã huỷ trực tiếp (DIRECT)")
    expect(recollectedHtml).toContain("Khách đổi sang chuyển khoản")
    expect(recollectedHtml).toContain("Người huỷ: Linh · Lễ tân")
    expect(recollectedHtml).toContain("Gửi yêu cầu huỷ")

    // Deduplicates APPROVED history ONLY by requestId when present in both PayBill.cancelHistory and cancelRequests
    const approvedBillWithBothSources = makeBill({
      billCode: "B1279",
      billStatus: "PAID",
      status: "PAID",
      paidAt: "22:05",
      paidBy: "Thu ngân",
      cancelHistory: [
        {
          kind: "APPROVED",
          requestId: "cr-dup",
          reason: "Thu nhầm tiền mặt",
          actor: "Thu ngân",
          approver: "Admin Edit",
          decisionNote: "Đã kiểm tra quỹ",
          at: "22:00",
          recollectedAt: "22:05",
        } as NonNullable<PayBill["cancelHistory"]>[number],
      ],
    })
    const matchingApprovedReq: CancelRequest = {
      id: "cr-dup",
      billCode: "B1279",
      visitId: "1283",
      code: "A3",
      dueVnd: 155_000,
      reason: "Thu nhầm tiền mặt",
      requestedBy: "Thu ngân",
      requestedAt: "21:58",
      status: "APPROVED",
      decidedBy: "Admin Edit",
      decidedAt: "22:00",
      decisionNote: "Đã kiểm tra quỹ",
    }
    const dedupHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: approvedBillWithBothSources,
        bills: [approvedBillWithBothSources],
        selectedBillCode: "B1279",
        cancelRequests: [matchingApprovedReq],
        canCollect: true,
        canRequestCancel: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(dedupHtml.match(/Thu nhầm tiền mặt/g)?.length).toBe(1)
    expect(dedupHtml).toContain("Lần thanh toán sau")
    expect(dedupHtml).toContain("Gửi yêu cầu huỷ")
  })

  it("shows both original request reason/requester and direct-cancel reason/canceller plus re-collect mark via requestId, and renders separately without requestId (NA45H-18)", () => {
    const directOverPendingReq: CancelRequest = {
      id: "cr-direct-over-pending",
      billCode: "B1279",
      visitId: "1283",
      code: "A3",
      dueVnd: 155_000,
      reason: "Boss cashier original reason",
      requestedBy: "Thu ngân · Thu ngân",
      requestedAt: "21:42",
      status: "APPROVED",
      decidedBy: "Linh · Lễ tân",
      decidedAt: "21:44",
      decisionNote: "Lễ tân huỷ trực tiếp lý do B",
    }
    const recollectedDirectOverPendingBill = makeBill({
      billCode: "B1279",
      billStatus: "PAID",
      status: "PAID",
      paidAt: "21:55",
      paidBy: "Thu ngân",
      cancelHistory: [
        {
          kind: "DIRECT",
          requestId: "cr-direct-over-pending",
          reason: "Lễ tân huỷ trực tiếp lý do B",
          actor: "Linh · Lễ tân",
          at: "21:44",
          recollectedAt: "21:55",
        } as NonNullable<PayBill["cancelHistory"]>[number],
      ],
    })

    const linkedHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: recollectedDirectOverPendingBill,
        bills: [recollectedDirectOverPendingBill],
        selectedBillCode: "B1279",
        cancelRequests: [directOverPendingReq],
        canCollect: true,
        canRequestCancel: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(linkedHtml).toContain("Lần thanh toán sau")
    expect(linkedHtml).toContain("Đã thu lại lúc 21:55")
    expect(linkedHtml).toContain("Đã huỷ trực tiếp (DIRECT)")
    expect(linkedHtml).toContain("Boss cashier original reason")
    expect(linkedHtml).toContain("Thu ngân · Thu ngân")
    expect(linkedHtml).toContain("Lễ tân huỷ trực tiếp lý do B")
    expect(linkedHtml).toContain("Linh · Lễ tân")
    expect(linkedHtml.match(/Lễ tân huỷ trực tiếp lý do B/g)?.length).toBe(1)
    expect(linkedHtml).toContain("Gửi yêu cầu huỷ")

    // Without requestId, never dedupe by reason text: request and history entry appear separately
    const unlinkedBill = makeBill({
      billCode: "B1279",
      billStatus: "PAID",
      status: "PAID",
      paidAt: "21:55",
      paidBy: "Thu ngân",
      cancelHistory: [
        {
          kind: "DIRECT",
          reason: "Lễ tân huỷ trực tiếp lý do B",
          actor: "Linh · Lễ tân",
          at: "21:44",
          recollectedAt: "21:55",
        },
      ],
    })
    const unlinkedHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: unlinkedBill,
        bills: [unlinkedBill],
        selectedBillCode: "B1279",
        cancelRequests: [directOverPendingReq],
        canCollect: true,
        canRequestCancel: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(unlinkedHtml).toContain("Boss cashier original reason")
    expect(unlinkedHtml).toContain("Thu ngân · Thu ngân")
    expect(unlinkedHtml).toContain("Đã huỷ trực tiếp (DIRECT)")
    expect(unlinkedHtml).toContain("Đã duyệt huỷ (APPROVED)")
    expect(unlinkedHtml).toContain("Lễ tân huỷ trực tiếp lý do B")
    expect(unlinkedHtml).toContain("Gửi yêu cầu huỷ")
  })

  it("keeps two requests with identical reason text across two collections distinct (NA45H-18)", () => {
    const sameReason = "Thu nhầm tiền mặt"
    const req1: CancelRequest = {
      id: "cr-col-1",
      billCode: "B1279",
      visitId: "1283",
      code: "A3",
      dueVnd: 155_000,
      reason: sameReason,
      requestedBy: "Thu ngân",
      requestedAt: "2026-11-27T21:10:00.000Z",
      status: "APPROVED",
      decidedBy: "Admin Edit",
      decidedAt: "2026-11-27T21:12:00.000Z",
      decisionNote: "Duyệt lần 1",
    }
    const req2: CancelRequest = {
      id: "cr-col-2",
      billCode: "B1279",
      visitId: "1283",
      code: "A3",
      dueVnd: 155_000,
      reason: sameReason,
      requestedBy: "Thu ngân",
      requestedAt: "2026-11-27T21:20:00.000Z",
      status: "APPROVED",
      decidedBy: "Linh · Lễ tân",
      decidedAt: "2026-11-27T21:22:00.000Z",
      decisionNote: "Huỷ trực tiếp lần 2",
    }
    const billTwoCollections = makeBill({
      billCode: "B1279",
      billStatus: "PAID",
      status: "PAID",
      paidAt: "21:25",
      paidBy: "Thu ngân",
      cancelHistory: [
        {
          kind: "DIRECT",
          requestId: "cr-col-2",
          reason: "Huỷ trực tiếp lần 2",
          actor: "Linh · Lễ tân",
          at: "2026-11-27T21:22:00.000Z",
          recollectedAt: "2026-11-27T21:25:00.000Z",
        } as NonNullable<PayBill["cancelHistory"]>[number],
        {
          kind: "APPROVED",
          requestId: "cr-col-1",
          reason: sameReason,
          actor: "Thu ngân",
          approver: "Admin Edit",
          decisionNote: "Duyệt lần 1",
          at: "2026-11-27T21:12:00.000Z",
          recollectedAt: "2026-11-27T21:15:00.000Z",
        } as NonNullable<PayBill["cancelHistory"]>[number],
      ],
    })

    const twoHistHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: billTwoCollections,
        bills: [billTwoCollections],
        selectedBillCode: "B1279",
        cancelRequests: [req2, req1],
        canCollect: true,
        canRequestCancel: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onRequestCancel: async () => undefined,
      }),
    )
    expect(twoHistHtml.match(/Thu nhầm tiền mặt/g)?.length).toBe(2)
    expect(twoHistHtml).toContain("Đã huỷ trực tiếp (DIRECT)")
    expect(twoHistHtml).toContain("Đã duyệt huỷ (APPROVED)")
    expect(twoHistHtml).toContain("Duyệt lần 1")
    expect(twoHistHtml).toContain("Huỷ trực tiếp lần 2")
    expect(twoHistHtml).toContain("Thu lại: 2026-11-27T21:15:00.000Z")
    expect(twoHistHtml).toContain("Thu lại: 2026-11-27T21:25:00.000Z")
    expect(twoHistHtml).toContain("Gửi yêu cầu huỷ")
  })

  it("resolves target billCode from notifications and opens exact bill on multi-bill closed session (NA45H-13)", () => {
    const ntfDirect: PaymentNotification = {
      id: "paid-1",
      type: "PAID",
      title: "Đã thanh toán",
      text: "A3 · 155.000đ",
      time: "21:45",
      visitId: "1283",
      billCode: "B1283-2",
    }
    expect(resolveNotificationBillCode(ntfDirect)).toBe("B1283-2")
    expect(buildNotificationTargetPath("1283", ntfDirect)).toBe("/payment/1283?bill=B1283-2")

    const ntfPaidFallback: PaymentNotification = {
      id: "paid-B1283-2-14-1",
      type: "PAID",
      title: "Đã thanh toán",
      text: "A3 · 155.000đ · Tiền mặt",
      time: "21:45",
      visitId: "1283",
    }
    expect(resolveNotificationBillCode(ntfPaidFallback)).toBe("B1283-2")
    expect(buildNotificationTargetPath("1283", ntfPaidFallback)).toBe("/payment/1283?bill=B1283-2")

    const ntfDecidedFallback: PaymentNotification = {
      id: "cdec-15-1",
      type: "CANCEL_DECIDED",
      title: "Từ chối hủy thanh toán",
      text: "A3 (B1283-2) · giữ Đã thanh toán",
      time: "21:48",
      visitId: "1283",
    }
    expect(resolveNotificationBillCode(ntfDecidedFallback)).toBe("B1283-2")
    expect(buildNotificationTargetPath("1283", ntfDecidedFallback)).toBe("/payment/1283?bill=B1283-2")

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const bill1 = makeBill({ billCode: "B1283", billStatus: "PAID", status: "PAID", paidAt: "21:40", dueVnd: 100_000 })
    const bill2 = makeBill({ billCode: "B1283-2", billStatus: "PAID", status: "PAID", paidAt: "21:50", dueVnd: 155_000 })
    qc.setQueryData<SessionBills>(["payment-session-bills", "1283"], {
      visitId: "1283",
      sessionCode: "S-1283",
      code: "A3",
      tables: ["A3"],
      status: "PAID",
      unbilledLineCount: 0,
      bills: [bill1, bill2],
      version: 4,
    })
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          MemoryRouter,
          { initialEntries: ["/payment/1283?bill=B1283-2"] },
          createElement(PaymentFlowWorkspace, {
            visitIdParam: "1283",
            stepParam: "detail",
            api: makeFakeApi(),
            accessOverride: CASHIER_ACCESS,
          }),
        ),
      ),
    )
    expect(html).toContain("Bill B1283-2 đã thu lúc 21:50")
    expect(html).toContain("Gửi yêu cầu huỷ")
  })

  it("reads cashier cancel-request decisions via listMyCancelRequests without calling listCancelRequests (NA45H-03)", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const paidBill = makeBill({ billCode: "B0412", billStatus: "PAID", status: "PAID", paidAt: "21:40" })
    qc.setQueryData<SessionBills>(["payment-session-bills", "1283"], {
      visitId: "1283",
      sessionCode: "S-1283",
      code: "A3",
      tables: ["A3"],
      status: "PAID",
      unbilledLineCount: 0,
      bills: [paidBill],
      version: 2,
    })
    const rejectedReq: CancelRequest = {
      id: "cr-2",
      billCode: "B0412",
      visitId: "1283",
      code: "A3",
      dueVnd: 155_000,
      reason: "Sai tiền",
      requestedBy: "Thu ngân",
      requestedAt: "21:42",
      status: "REJECTED",
      decidedBy: "Admin Edit",
      decidedAt: "21:44",
      decisionNote: "Kiểm lại quỹ",
    }
    qc.setQueryData<CancelRequest[]>(["payment-cancel-requests", "CASHIER", "B0412"], [rejectedReq])
    const listCancelRequests = vi.fn(async () => [])
    const listMyCancelRequests = vi.fn(async () => [rejectedReq])
    const api = makeFakeApi({ listCancelRequests, listMyCancelRequests })

    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          MemoryRouter,
          { initialEntries: ["/payment/1283"] },
          createElement(PaymentFlowWorkspace, {
            visitIdParam: "1283",
            stepParam: "detail",
            api,
            accessOverride: CASHIER_ACCESS,
          }),
        ),
      ),
    )
    expect(listCancelRequests).not.toHaveBeenCalled()
    expect(html).toContain("Bị từ chối (REJECTED)")
    expect(html).toContain("Admin Edit")
    expect(html).toContain("Kiểm lại quỹ")
    expect(html).toContain("Gửi yêu cầu huỷ")
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

describe("W3 NA45H-07 / NA45H-08 / NA45H-09: S7 closure banner, preview error isolation, and S2/S3 metadata", () => {
  it("reports tables Trống ONLY when session is confirmed closed, and keeps session open otherwise (NA45H-07)", () => {
    const paidBill = makeBill({ billCode: "B0411", billStatus: "PAID", status: "PAID" })
    const unpaidBill = makeBill({ billCode: "B0412", billStatus: "UNPAID", status: "AWAITING_PAYMENT" })
    const rc: Receipt = {
      billCode: "B0411",
      visitId: "1283",
      sessionCode: "S-1283",
      code: "A3",
      tables: ["A3"],
      method: "TRANSFER",
      manual: true,
      givenVnd: 155_000,
      changeVnd: 0,
      preRoundVnd: 154_660,
      dueVnd: 155_000,
      confirmedAt: "21:45",
      confirmedBy: "Thu ngân",
    }

    const withUnpaid: SessionBills = {
      visitId: "1283",
      sessionCode: "S-1283",
      code: "A3",
      tables: ["A3"],
      status: "AWAITING_PAYMENT",
      unbilledLineCount: 0,
      bills: [paidBill, unpaidBill],
      version: 2,
    }
    expect(isSessionConfirmedClosed(withUnpaid)).toBe(false)
    expect(buildSuccessFeedbackText(rc, withUnpaid)).toContain("B0411")
    expect(buildSuccessFeedbackText(rc, withUnpaid)).toContain("vẫn đang mở")
    expect(buildSuccessFeedbackText(rc, withUnpaid)).not.toContain("về Trống")

    const withUnbilled: SessionBills = {
      visitId: "1283",
      sessionCode: "S-1283",
      code: "A3",
      tables: ["A3"],
      status: "SERVING",
      unbilledLineCount: 1,
      bills: [paidBill],
      version: 2,
    }
    expect(isSessionConfirmedClosed(withUnbilled)).toBe(false)
    expect(buildSuccessFeedbackText(rc, withUnbilled)).not.toContain("về Trống")
    expect(isSessionConfirmedClosed(undefined)).toBe(false)
    expect(buildSuccessFeedbackText(rc, undefined)).not.toContain("về Trống")

    const closed: SessionBills = {
      visitId: "1283",
      sessionCode: "S-1283",
      code: "A3",
      tables: ["A3"],
      status: "PAID",
      unbilledLineCount: 0,
      bills: [paidBill],
      version: 3,
    }
    expect(isSessionConfirmedClosed(closed)).toBe(true)
    expect(buildSuccessFeedbackText(rc, closed)).toBe("Đã ghi nhận thanh toán. A3 về Trống.")
  })

  it("renders preview error state without falling back to an issued bill amount (NA45H-08)", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
    })
    const issuedBill = makeBill({ billCode: "B0412", dueVnd: 3_044_000, status: "AWAITING_PAYMENT" })
    qc.setQueryData<SessionBills>(["payment-session-bills", "1283"], {
      visitId: "1283",
      sessionCode: "S-1283",
      code: "G02",
      tables: ["B11", "B12"],
      clusterCode: "G02",
      status: "AWAITING_PAYMENT",
      unbilledLineCount: 1,
      bills: [issuedBill],
      version: 2,
    })
    await qc
      .fetchQuery({
        queryKey: ["payment-preview", "1283"],
        queryFn: async () => {
          throw new Error("review preview unavailable")
        },
      })
      .catch(() => undefined)

    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          MemoryRouter,
          { initialEntries: ["/payment/1283/preview"] },
          createElement(PaymentFlowWorkspace, {
            visitIdParam: "1283",
            stepParam: "preview",
            accessOverride: CASHIER_ACCESS,
            api: makeFakeApi({
              previewBill: async () => {
                throw new Error("review preview unavailable")
              },
            }),
          }),
        ),
      ),
    )
    expect(html).toContain("review preview unavailable")
    expect(html).toContain("Thử lại")
    expect(html).not.toContain("3.044.000đ")
    expect(html).not.toContain("Tạm tính – chưa phải hóa đơn")
  })

  it("keeps S2 in loading state while preview is pending for unbilled session and preserves metadata in previewToPayBill (NA45H-09)", () => {
    const preview: PreviewBill = {
      visitId: "1283",
      sessionCode: "S-1283",
      code: "A3",
      tables: ["A3"],
      lines: makeBill().lines,
      subtotalVnd: 140_600,
      vatVnd: 14_060,
      preRoundVnd: 154_660,
      roundingVnd: 340,
      dueVnd: 155_000,
      version: 1,
    }
    const mapped = previewToPayBill(preview, "SERVING", {
      openedAt: "19:05",
      waiterName: "Minh",
      guests: 4,
    })
    expect(mapped.openedAt).toBe("19:05")
    expect(mapped.waiterName).toBe("Minh")
    expect(mapped.guests).toBe(4)
    expect(mapped.roundCount).toBe(2)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData<SessionBills>(["payment-session-bills", "1283"], {
      visitId: "1283",
      sessionCode: "S-1283",
      code: "A3",
      tables: ["A3"],
      status: "SERVING",
      unbilledLineCount: 2,
      bills: [],
      version: 1,
    })
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          MemoryRouter,
          { initialEntries: ["/payment/1283"] },
          createElement(PaymentFlowWorkspace, {
            visitIdParam: "1283",
            stepParam: "detail",
            api: makeFakeApi(),
            accessOverride: CASHIER_ACCESS,
          }),
        ),
      ),
    )
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain("Đang tải dữ liệu bill")
  })
})

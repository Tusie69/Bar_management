import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ApiError } from "@/services"
import { isPaymentAvailable, type PayBill, type PaymentNotification, type Receipt } from "@/services/payment"
import { BillRoundsCard, DetailActionPane, ProvisionalPreviewView } from "./bill-pane"
import { CashActionPane, MethodActionPane, QrActionPane, SuccessView } from "./pay-actions"
import { PaymentFloorMap } from "./payment-floor-map"
import { PaymentNotificationBell } from "./payment-notifications"
import { submitPaymentConfirm, toPaymentError, type IdempotencySlot } from "./payment-submit"

function sampleBill(overrides: Partial<PayBill> = {}): PayBill {
  return {
    billCode: "B0412",
    visitId: "1283",
    sessionCode: "S-1283",
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

  it("renders an honest empty state when a visit has no mock order lines", () => {
    const emptyBill = sampleBill({
      lines: [],
      subtotalVnd: 0,
      vatVnd: 0,
      preRoundVnd: 0,
      roundingVnd: 0,
      dueVnd: 0,
      roundCount: 0,
    })
    const cardHtml = renderToStaticMarkup(createElement(BillRoundsCard, { bill: emptyBill }))
    expect(cardHtml).toContain("Chưa có dữ liệu món cho phiên này")

    const detailHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: emptyBill,
        canCollect: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
      }),
    )
    expect(detailHtml).toContain("Chưa có dữ liệu món (mô phỏng)")
    expect(detailHtml).toContain("disabled")
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

describe("DTO-only money contract (NA45-04)", () => {
  it("renders DTO totals across S2-S6 even when DTO totals differ from line sums", () => {
    const policyAdjustedBill = sampleBill({
      status: "AWAITING_PAYMENT",
      pendingAt: "21:31",
      subtotalVnd: 140_600,
      vatVnd: 11_248,
      preRoundVnd: 151_848,
      roundingVnd: 152,
      dueVnd: 152_000,
      vatLabel: "VAT 8%",
      vatNote: "chính sách DTO",
    })

    const roundsHtml = renderToStaticMarkup(createElement(BillRoundsCard, { bill: policyAdjustedBill }))
    const detailHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: policyAdjustedBill,
        canCollect: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
      }),
    )
    const previewHtml = renderToStaticMarkup(
      createElement(ProvisionalPreviewView, {
        bill: policyAdjustedBill,
        canCollect: true,
        isWaiter: false,
        busy: false,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
        onSimulatedPrint: () => undefined,
      }),
    )
    const methodHtml = renderToStaticMarkup(
      createElement(MethodActionPane, {
        bill: policyAdjustedBill,
        lastMethod: null,
        onSelectMethod: () => undefined,
        onToList: () => undefined,
      }),
    )
    const cashHtml = renderToStaticMarkup(
      createElement(CashActionPane, {
        bill: policyAdjustedBill,
        busy: false,
        error: null,
        onClearError: () => undefined,
        onConfirm: () => undefined,
        onToList: () => undefined,
      }),
    )
    const qrHtml = renderToStaticMarkup(
      createElement(QrActionPane, {
        bill: policyAdjustedBill,
        busy: false,
        error: null,
        onCheckTransfer: async () => ({ found: false }),
        onConfirmManual: () => undefined,
        onToList: () => undefined,
        onCopied: () => undefined,
      }),
    )

    for (const html of [roundsHtml, detailHtml, previewHtml, methodHtml, cashHtml, qrHtml]) {
      expect(html).toContain("152.000đ")
      expect(html).not.toContain("155.000đ")
    }
    expect(roundsHtml).toContain("VAT 8%")
    expect(roundsHtml).toContain("chính sách DTO")
    expect(cashHtml).toContain("152.000")
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

describe("Cash, QR, Method, PAID locks, and Error states", () => {
  it("does not show a method switch on Cash or QR screens and omits vừa đủ sub-label on exact chip", () => {
    const cashHtml = renderToStaticMarkup(
      createElement(CashActionPane, {
        bill: sampleBill({ status: "AWAITING_PAYMENT" }),
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
        bill: sampleBill({ status: "AWAITING_PAYMENT" }),
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

  it("renders network, VERSION_CONFLICT, and DUPLICATE_PAYMENT banners distinctly", () => {
    const netHtml = renderToStaticMarkup(
      createElement(CashActionPane, {
        bill: sampleBill({ status: "AWAITING_PAYMENT" }),
        busy: false,
        error: { kind: "net", message: "Mất mạng" },
        onClearError: () => undefined,
        onConfirm: () => undefined,
        onToList: () => undefined,
      }),
    )
    expect(netHtml).toContain("Không gửi được tới máy chủ")
    expect(netHtml).toContain("CHƯA được ghi nhận")

    const conflictHtml = renderToStaticMarkup(
      createElement(CashActionPane, {
        bill: sampleBill({ status: "AWAITING_PAYMENT" }),
        busy: false,
        error: { kind: "conflict", message: "Version mismatch" },
        onClearError: () => undefined,
        onConfirm: () => undefined,
        onToList: () => undefined,
      }),
    )
    expect(conflictHtml).toContain("Bill vừa được cập nhật")
    expect(conflictHtml).toContain("chưa thu tiền")
    expect(conflictHtml).not.toContain("đã được thanh toán")

    const dupHtml = renderToStaticMarkup(
      createElement(QrActionPane, {
        bill: sampleBill({ status: "PAID" }),
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

  it("locks Method, Cash, and QR actions when bill status is PAID", () => {
    const paidBill = sampleBill({ status: "PAID" })
    const methodHtml = renderToStaticMarkup(
      createElement(MethodActionPane, {
        bill: paidBill,
        lastMethod: "CASH",
        onSelectMethod: () => undefined,
        onToList: () => undefined,
      }),
    )
    expect(methodHtml).toContain("Bill này đã thanh toán")
    const disabledBtns = methodHtml.match(/<button[^>]*disabled=""/g) ?? []
    expect(disabledBtns).toHaveLength(2)

    const cashHtml = renderToStaticMarkup(
      createElement(CashActionPane, {
        bill: paidBill,
        busy: false,
        error: null,
        onClearError: () => undefined,
        onConfirm: () => undefined,
        onToList: () => undefined,
      }),
    )
    expect(cashHtml).toContain("Bill này đã thanh toán")

    const qrHtml = renderToStaticMarkup(
      createElement(QrActionPane, {
        bill: paidBill,
        busy: false,
        error: null,
        onCheckTransfer: async () => ({ found: false }),
        onConfirmManual: () => undefined,
        onToList: () => undefined,
        onCopied: () => undefined,
      }),
    )
    expect(qrHtml).toContain("Bill này đã thanh toán")
  })

  it("renders CLOSED_UNPAID honestly and locks all payment actions (never says paid)", () => {
    const unpaidBill = sampleBill({ status: "CLOSED_UNPAID" })
    const cardHtml = renderToStaticMarkup(createElement(BillRoundsCard, { bill: unpaidBill }))
    expect(cardHtml).toContain("Đã trả bàn · chưa thu")
    expect(cardHtml).not.toContain("Đã thanh toán")

    const detailHtml = renderToStaticMarkup(
      createElement(DetailActionPane, {
        bill: unpaidBill,
        canCollect: true,
        isWaiter: false,
        busy: false,
        onPreview: () => undefined,
        onCollect: () => undefined,
        onRequestPayment: () => undefined,
      }),
    )
    expect(detailHtml).toContain("Phiên đã trả bàn nhưng chưa ghi nhận thu tiền")

    for (const html of [
      renderToStaticMarkup(
        createElement(MethodActionPane, {
          bill: unpaidBill,
          lastMethod: null,
          onSelectMethod: () => undefined,
          onToList: () => undefined,
        }),
      ),
      renderToStaticMarkup(
        createElement(CashActionPane, {
          bill: unpaidBill,
          busy: false,
          error: null,
          onClearError: () => undefined,
          onConfirm: () => undefined,
          onToList: () => undefined,
        }),
      ),
      renderToStaticMarkup(
        createElement(QrActionPane, {
          bill: unpaidBill,
          busy: false,
          error: null,
          onCheckTransfer: async () => ({ found: false }),
          onConfirmManual: () => undefined,
          onToList: () => undefined,
          onCopied: () => undefined,
        }),
      ),
    ]) {
      expect(html).toContain("Phiên đã trả bàn nhưng chưa thu tiền")
      expect(html).not.toContain("Bill này đã thanh toán")
    }
  })

  it("hides floor tile amount and marks aria-label when summary hasOrderLines is false", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentFloorMap, {
        sessions: [
          {
            visitId: "901",
            billCode: "B0901",
            sessionCode: "S-0901",
            code: "G06",
            tables: ["BAR10", "BAR11", "BAR12"],
            clusterCode: "G06",
            status: "SERVING",
            openedAt: "21:14",
            waiterName: "Phục vụ",
            guests: 3,
            dueVnd: 0,
            hasOrderLines: false,
            version: 1,
          },
          {
            visitId: "902",
            billCode: "B0902",
            sessionCode: "S-0902",
            code: "A3",
            tables: ["A3"],
            status: "SERVING",
            openedAt: "19:04",
            waiterName: "Minh",
            guests: 4,
            dueVnd: 0,
            hasOrderLines: true,
            version: 1,
          },
        ],
        selectedId: null,
        onSelectSession: () => undefined,
        onClearSelection: () => undefined,
      }),
    )
    expect(html).toContain("chưa có dữ liệu món")
    expect(html).toContain("A3, đang dùng, 0đ")
  })

  it("applies selected class on Method row and renders cluster receipt on Success", () => {
    const methodHtml = renderToStaticMarkup(
      createElement(MethodActionPane, {
        bill: sampleBill({ status: "AWAITING_PAYMENT" }),
        lastMethod: "CASH",
        onSelectMethod: () => undefined,
      }),
    )
    expect(methodHtml).toContain("pay-mrow sel")
    expect(methodHtml).toContain("Đang chọn")

    const receipt: Receipt = {
      billCode: "B0408",
      visitId: "1284",
      sessionCode: "S-1284",
      code: "G02",
      tables: ["B11", "B12"],
      clusterCode: "G02",
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
    expect(okHtml).toContain("G02 (B11, B12)")
    expect(okHtml).toContain("Chuyển khoản QR · xác nhận tay")
    expect(okHtml).toContain("Trống")
  })

  it("renders split 2-frame floor map for far-apart cluster tables", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentFloorMap, {
        sessions: [
          {
            visitId: "900",
            billCode: "B0900",
            sessionCode: "S-0900",
            code: "G03",
            tables: ["C2", "B5"],
            clusterCode: "G03",
            status: "SERVING",
            openedAt: "21:00",
            waiterName: "Hà",
            guests: 4,
            dueVnd: 200_000,
            version: 1,
          },
        ],
        selectedId: "900",
        onSelectSession: () => undefined,
        onClearSelection: () => undefined,
      }),
    )
    expect(html).toContain("Cụm G03 có bàn ở xa nhau nên sơ đồ tách thành 2 khung.")
    expect(html).toContain("pay-fgrid two")
  })

  it("highlights selected bar-seat cluster frame without thick seat-selection rings (NA45C-11)", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentFloorMap, {
        sessions: [
          {
            visitId: "905",
            billCode: "B0905",
            sessionCode: "S-0905",
            code: "G05",
            tables: ["BAR05", "BAR06"],
            clusterCode: "G05",
            status: "SERVING",
            openedAt: "20:00",
            waiterName: "Khoa",
            guests: 2,
            dueVnd: 200_000,
            version: 1,
          },
        ],
        selectedId: "905",
        onSelectSession: () => undefined,
        onClearSelection: () => undefined,
      }),
    )
    expect(html).toContain("pay-f-cl pay-f-cl-sel")
    expect(html).not.toContain("pay-ft-sel")
  })

  it("renders unread dot on PaymentNotificationBell according to unread prop", () => {
    const ntfs: PaymentNotification[] = [
      { id: "n1", type: "PAID", title: "Đã thanh toán", text: "A3 · 231.000đ", time: "21:45", visitId: "1" },
    ]
    const unreadHtml = renderToStaticMarkup(
      createElement(PaymentNotificationBell, { notifications: ntfs, unread: true, onOpen: () => undefined }),
    )
    expect(unreadHtml).toContain('data-testid="pay-ntf-unread-dot"')

    const readHtml = renderToStaticMarkup(
      createElement(PaymentNotificationBell, { notifications: ntfs, unread: false, onOpen: () => undefined }),
    )
    expect(readHtml).not.toContain('data-testid="pay-ntf-unread-dot"')

    const lockedHtml = renderToStaticMarkup(
      createElement(PaymentNotificationBell, {
        notifications: ntfs,
        unread: true,
        navigationLocked: true,
        onOpen: () => undefined,
      }),
    )
    expect(lockedHtml).toContain("Thông báo thanh toán")
  })
})

describe("PaymentFlowWorkspace submitPaymentConfirm & error classification", () => {
  it("blocks duplicate confirm invocations synchronously before the first adapter call resolves", async () => {
    let resolveConfirm!: (rc: Receipt) => void
    const confirmCash = vi.fn(
      () =>
        new Promise<Receipt>((resolve) => {
          resolveConfirm = resolve
        }),
    )
    const confirmTransfer = vi.fn()
    const inFlightRef = { current: false }
    const idempotencyKeyRef: { current: IdempotencySlot | null } = { current: null }
    const setBusy = vi.fn()
    const setPayError = vi.fn()
    const setReceipt = vi.fn()
    const invalidate = vi.fn(async () => undefined)
    const onSuccess = vi.fn()

    const bill = sampleBill({ status: "AWAITING_PAYMENT" })
    const p1 = submitPaymentConfirm({
      api: { confirmCash, confirmTransfer },
      bill,
      canCollect: true,
      method: "CASH",
      givenVnd: 200_000,
      busy: false,
      inFlightRef,
      idempotencyKeyRef,
      setBusy,
      setPayError,
      setReceipt,
      invalidate,
      onSuccess,
    })
    const p2 = submitPaymentConfirm({
      api: { confirmCash, confirmTransfer },
      bill,
      canCollect: true,
      method: "CASH",
      givenVnd: 200_000,
      busy: false,
      inFlightRef,
      idempotencyKeyRef,
      setBusy,
      setPayError,
      setReceipt,
      invalidate,
      onSuccess,
    })

    expect(confirmCash).toHaveBeenCalledTimes(1)
    const rc: Receipt = {
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
    resolveConfirm(rc)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual(rc)
    expect(r2).toBeNull()
    expect(setReceipt).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(inFlightRef.current).toBe(false)
  })

  it("preserves idempotency key on network error retry with same amount, and rotates key when amount changes", async () => {
    const confirmCash = vi.fn().mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "Mất mạng"))
    const inFlightRef = { current: false }
    const idempotencyKeyRef: { current: IdempotencySlot | null } = { current: null }
    const bill = sampleBill({ status: "AWAITING_PAYMENT", version: 2 })

    await submitPaymentConfirm({
      api: { confirmCash, confirmTransfer: vi.fn() },
      bill,
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
    const firstKey = confirmCash.mock.calls[0][3]

    // Retry same amount -> must reuse exact same key
    await submitPaymentConfirm({
      api: { confirmCash, confirmTransfer: vi.fn() },
      bill,
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
    expect(confirmCash.mock.calls[1][3]).toBe(firstKey)

    // Edit amount -> must generate a new key
    await submitPaymentConfirm({
      api: { confirmCash, confirmTransfer: vi.fn() },
      bill,
      canCollect: true,
      method: "CASH",
      givenVnd: 500_000,
      busy: false,
      inFlightRef,
      idempotencyKeyRef,
      setBusy: () => undefined,
      setPayError: () => undefined,
      setReceipt: () => undefined,
      invalidate: async () => undefined,
      onSuccess: () => undefined,
    })
    expect(confirmCash.mock.calls[2][3]).not.toBe(firstKey)
  })

  it("classifies VERSION_CONFLICT separately from DUPLICATE_PAYMENT and exports availability flag", () => {
    expect(isPaymentAvailable).toBe(true)
    expect(toPaymentError(new ApiError(409, "VERSION_CONFLICT", "Stale")).kind).toBe("conflict")
    expect(
      toPaymentError(
        new ApiError(409, "DUPLICATE_PAYMENT", "Dup", { confirmedBy: "Thu ngân Hà", confirmedAt: "21:43" }),
      ),
    ).toEqual({
      kind: "dup",
      message: "Dup",
      confirmedBy: "Thu ngân Hà",
      confirmedAt: "21:43",
    })
    expect(toPaymentError(new ApiError(409, "IDEMPOTENCY_CONFLICT", "Conflict")).kind).toBe("other")
  })
})

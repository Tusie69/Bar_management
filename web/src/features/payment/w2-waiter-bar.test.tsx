import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ApiError } from "@/services"
import type {
  PayBill,
  PayBillSummary,
  PayLine,
  PaymentApi,
  PreviewBill,
  SessionBills,
} from "@/services/payment"
import { BarBillDrawerBody } from "@/features/preparation/bar-bill-drawer"
import { PreparationTicketCard } from "@/features/preparation/preparation-ticket-card"
import {
  BANK_RECEIVING_NAME,
  PREVIEW_HAS_QR,
  PROVISIONAL_LABEL,
  canIssueNewInvoice,
  isBarGuestSession,
  isMoneyViewParam,
  isWaiterBillRole,
  parseWaiterBillView,
  selectInvoiceBill,
  sortBarSessionsFirst,
  submitIssueInvoice,
  type IssueIdempotencySlot,
} from "@/features/waiter/waiter-invoice-model"
import {
  WaiterInvoiceView,
  WaiterPreviewView,
  WaiterSessionDetailView,
} from "@/features/waiter/waiter-invoice-views"
import { buildWaiterSheetView, WaiterTableSheetBody } from "@/features/waiter/waiter-table-sheet"
import type { ClaimView, FloorTableState, TableView } from "@/domain/models"

function makeLine(overrides: Partial<PayLine> = {}): PayLine {
  return {
    orderRound: 1,
    roundTime: "19:08",
    roundBy: "Minh",
    name: "Tiger Crystal",
    unit: "Chai 330ml",
    qty: 2,
    unitPriceVnd: 42_800,
    lineTotalVnd: 85_600,
    state: "SERVED",
    ...overrides,
  }
}

function makeBill(overrides: Partial<PayBill> = {}): PayBill {
  return {
    billCode: "B0412",
    visitId: "1283",
    sessionCode: "S-1283",
    code: "A3",
    tables: ["A3"],
    status: "AWAITING_PAYMENT",
    billStatus: "UNPAID",
    lines: [makeLine()],
    subtotalVnd: 85_600,
    vatVnd: 8_560,
    preRoundVnd: 94_160,
    roundingVnd: 840,
    dueVnd: 95_000,
    vatLabel: "VAT 10%",
    version: 2,
    openedAt: "19:05",
    pendingAt: "21:30",
    issuedAt: "21:30",
    issuedBy: "Minh",
    issuedByRole: "WAITER",
    waiterName: "Minh",
    guests: 4,
    roundCount: 1,
    ...overrides,
  }
}

function makePreview(overrides: Partial<PreviewBill> = {}): PreviewBill {
  return {
    visitId: "1283",
    sessionCode: "S-1283",
    code: "A3",
    tables: ["A3"],
    lines: [
      makeLine(),
      makeLine({
        orderRound: 2,
        roundTime: "20:15",
        name: "Mojito",
        unit: "Ly",
        qty: 1,
        unitPriceVnd: 55_000,
        lineTotalVnd: 55_000,
        state: "MAKING",
        note: "Ít đá",
      }),
      makeLine({
        orderRound: 2,
        name: "Margarita",
        unit: "Ly",
        qty: 1,
        unitPriceVnd: 120_000,
        lineTotalVnd: 120_000,
        state: "CANCELLED",
      }),
    ],
    subtotalVnd: 140_600,
    vatVnd: 14_060,
    preRoundVnd: 154_660,
    roundingVnd: 340,
    dueVnd: 155_000,
    version: 1,
    ...overrides,
  }
}

function makeSessionBills(overrides: Partial<SessionBills> = {}): SessionBills {
  return {
    visitId: "1283",
    sessionCode: "S-1283",
    code: "A3",
    tables: ["A3"],
    status: "SERVING",
    unbilledLineCount: 2,
    bills: [],
    version: 1,
    ...overrides,
  }
}

function createFakePaymentApi(initial?: {
  session?: SessionBills
  preview?: PreviewBill
  open?: PayBillSummary[]
  failIssueWith?: Error | null
}): {
  api: PaymentApi
  calls: { preview: number; issue: Array<{ visitId: string; version: number; key: string }>; deprecated: number }
} {
  let session = initial?.session ?? makeSessionBills()
  const preview = initial?.preview ?? makePreview()
  const open = initial?.open ?? [
    {
      visitId: "2001",
      billCode: "B2001",
      sessionCode: "S-2001",
      code: "BAR01",
      tables: ["BAR01"],
      status: "SERVING",
      openedAt: "20:49",
      waiterName: "Khoa",
      guests: 1,
      dueVnd: 220_000,
      hasOrderLines: true,
      version: 1,
    },
    {
      visitId: "1283",
      billCode: "B0412",
      sessionCode: "S-1283",
      code: "A3",
      tables: ["A3"],
      status: "SERVING",
      openedAt: "19:05",
      waiterName: "Minh",
      guests: 4,
      dueVnd: 155_000,
      hasOrderLines: true,
      version: 1,
    },
  ]
  const calls = {
    preview: 0,
    issue: [] as Array<{ visitId: string; version: number; key: string }>,
    deprecated: 0,
  }

  const notUsed = async (): Promise<never> => {
    calls.deprecated += 1
    throw new Error("Should not be called in W2 Waiter/Bartender flow")
  }

  const api: PaymentApi = {
    listOpen: async () => open,
    getBill: async () => makeBill(),
    createPrebill: notUsed,
    requestPayment: notUsed,
    confirmCash: notUsed,
    confirmTransfer: notUsed,
    listNotifications: async () => [],
    checkTransfer: async () => ({ found: false }),
    previewBill: async () => {
      calls.preview += 1
      return preview
    },
    issueInvoice: async (visitId, version, idempotencyKey) => {
      calls.issue.push({ visitId, version, key: idempotencyKey })
      if (initial?.failIssueWith) throw initial.failIssueWith
      const issued = makeBill({
        visitId,
        billCode: `B04${session.bills.length + 12}`,
        version: version + 1,
        dueVnd: preview.dueVnd,
        subtotalVnd: preview.subtotalVnd,
        vatVnd: preview.vatVnd,
        preRoundVnd: preview.preRoundVnd,
        roundingVnd: preview.roundingVnd,
        lines: preview.lines,
      })
      session = {
        ...session,
        status: "AWAITING_PAYMENT",
        unbilledLineCount: 0,
        version: version + 1,
        bills: [...session.bills, issued],
      }
      return issued
    },
    getSessionBills: async () => session,
    requestCancel: notUsed,
    listCancelRequests: notUsed,
    decideCancel: notUsed,
    cancelPaid: notUsed,
    listAudit: notUsed,
  }
  return { api, calls }
}

describe("W2 VM-01 / VM-03 / VM-05 / VM-06 / VM-07 / VM-11: Waiter preview & invoice views", () => {
  it("VM-03 / O3: keeps PREVIEW_HAS_QR behind a single false constant and hides QR on preview", () => {
    expect(PREVIEW_HAS_QR).toBe(false)
    const screenHtml = renderToStaticMarkup(
      createElement(WaiterPreviewView, {
        preview: makePreview(),
        sessionStatus: "SERVING",
        canIssue: true,
        busy: false,
        viewMode: "screen",
        onIssueInvoice: () => undefined,
        onSimulatedPrint: () => undefined,
      }),
    )
    expect(screenHtml).toContain(PROVISIONAL_LABEL)
    expect(screenHtml).toContain("gọi thêm món được")
    expect(screenHtml).not.toContain("DEMO – KHÔNG CHUYỂN TIỀN")
    expect(screenHtml).not.toContain("Quét để chuyển khoản")
    expect(screenHtml).not.toContain("Margarita")
    expect(screenHtml).not.toContain("theo cấu hình · chờ chốt TN-03")
    expect(screenHtml).toContain("Phí phục vụ · phụ thu")
    expect(screenHtml).toContain("Đang phát triển")
    expect(screenHtml).toContain("0đ")
    expect(screenHtml).toContain("Xuất hóa đơn")
    expect(screenHtml).not.toContain("Gửi yêu cầu thanh toán")

    const printHtml = renderToStaticMarkup(
      createElement(WaiterPreviewView, {
        preview: makePreview(),
        sessionStatus: "SERVING",
        canIssue: true,
        busy: false,
        viewMode: "print",
        onIssueInvoice: () => undefined,
        onSimulatedPrint: () => undefined,
      }),
    )
    expect(printHtml).toContain("TẠM TÍNH – CHƯA PHẢI HÓA ĐƠN")
    expect(printHtml).not.toContain("DEMO – KHÔNG CHUYỂN TIỀN")
  })

  it("VM-01 / VM-05 / VM-11 / TN-07-K7: issued invoice shows HÓA ĐƠN, QR, Techcombank, bill code, and zero money-collection controls", () => {
    const html = renderToStaticMarkup(
      createElement(WaiterInvoiceView, {
        bill: makeBill({ billCode: "B0412", dueVnd: 155_000 }),
        viewMode: "screen",
        onSimulatedPrint: () => undefined,
        onCopyRef: () => undefined,
        onBackToDetail: () => undefined,
      }),
    )
    expect(html).toContain("HÓA ĐƠN")
    expect(html).toContain("B0412")
    expect(html).toContain("155.000đ")
    expect(html).toContain("DEMO – KHÔNG CHUYỂN TIỀN")
    expect(html).toContain(BANK_RECEIVING_NAME)
    expect(html).toContain("21GAM B0412")
    expect(html).toContain("In hóa đơn")
    expect(html).not.toContain("Bill tạm tính")
    expect(html).not.toContain("Gửi yêu cầu thanh toán")
    expect(html).not.toContain("Chốt bill &amp; thu tiền")
    expect(html).not.toContain("Xác nhận đã nhận tiền")
    expect(html).not.toContain("Tiền mặt")
    expect(html).not.toContain("Đã thấy tiền về")

    const printHtml = renderToStaticMarkup(
      createElement(WaiterInvoiceView, {
        bill: makeBill({ billCode: "B0412", dueVnd: 155_000 }),
        viewMode: "print",
        onSimulatedPrint: () => undefined,
        onCopyRef: () => undefined,
        onBackToDetail: () => undefined,
      }),
    )
    expect(printHtml).toContain("HÓA ĐƠN THANH TOÁN")
    expect(printHtml).toContain("Ngân hàng: Techcombank")
    expect(printHtml).toContain("ND: 21GAM B0412")
    expect(printHtml).toContain("DEMO – KHÔNG CHUYỂN TIỀN")
  })
})

describe("W2 Multi-bill (VM-08 / TN-02-K6)", () => {
  it("shows existing unpaid bill and allows issuing a new bill ONLY when unbilledLineCount > 0", () => {
    const unpaidBill = makeBill({ billCode: "B0410", dueVnd: 95_000, billStatus: "UNPAID" })
    const withNewLines = makeSessionBills({
      status: "AWAITING_PAYMENT",
      bills: [unpaidBill],
      unbilledLineCount: 1,
    })
    expect(canIssueNewInvoice(withNewLines)).toBe(true)

    const htmlWithNew = renderToStaticMarkup(
      createElement(WaiterSessionDetailView, {
        sessionBills: withNewLines,
        preview: makePreview({ dueVnd: 60_000, lines: [makeLine({ name: "Mojito", lineTotalVnd: 55_000 })] }),
        busy: false,
        onPreview: () => undefined,
        onIssueInvoice: () => undefined,
        onOpenInvoice: () => undefined,
      }),
    )
    expect(htmlWithNew).toContain("B0410")
    expect(htmlWithNew).toContain("Chưa thu")
    expect(htmlWithNew).toContain("95.000đ")
    expect(htmlWithNew).toContain("Xuất hóa đơn cho món mới")
    expect(htmlWithNew).not.toContain("Gửi yêu cầu thanh toán")

    const noNewLines = makeSessionBills({
      status: "AWAITING_PAYMENT",
      bills: [unpaidBill],
      unbilledLineCount: 0,
    })
    expect(canIssueNewInvoice(noNewLines)).toBe(false)

    const htmlNoNew = renderToStaticMarkup(
      createElement(WaiterSessionDetailView, {
        sessionBills: noNewLines,
        preview: undefined,
        busy: false,
        onPreview: () => undefined,
        onIssueInvoice: () => undefined,
        onOpenInvoice: () => undefined,
      }),
    )
    expect(htmlNoNew).toContain("B0410")
    expect(htmlNoNew).toContain("Chưa có món mới")
    const issueIdx = htmlNoNew.indexOf("Xuất hóa đơn cho món mới")
    const btnStart = htmlNoNew.lastIndexOf("<button", issueIdx)
    const openTag = htmlNoNew.slice(btnStart, htmlNoNew.indexOf(">", btnStart))
    expect(openTag).toContain('disabled=""')
  })

  it("selects requested billCode or latest unpaid bill cleanly", () => {
    const b1 = makeBill({ billCode: "B01", billStatus: "PAID", status: "PAID" })
    const b2 = makeBill({ billCode: "B02", billStatus: "UNPAID", status: "AWAITING_PAYMENT" })
    const sb = makeSessionBills({ bills: [b1, b2] })
    expect(selectInvoiceBill(sb)?.billCode).toBe("B02")
    expect(selectInvoiceBill(sb, "B01")?.billCode).toBe("B01")
  })
})

describe("W2 Fake PaymentApi controller, idempotency, and NA45C-12 feedback", () => {
  it("previewBill never mutates state or calls deprecated createPrebill/requestPayment", async () => {
    const { api, calls } = createFakePaymentApi()
    const before = await api.getSessionBills("1283")
    const pv = await api.previewBill("1283")
    const after = await api.getSessionBills("1283")
    expect(pv.dueVnd).toBe(155_000)
    expect(before.status).toBe("SERVING")
    expect(after.status).toBe("SERVING")
    expect(after.bills).toHaveLength(0)
    expect(calls.preview).toBe(1)
    expect(calls.deprecated).toBe(0)
  })

  it("issueInvoice blocks synchronous double-clicks, notifies via callback (toast), and preserves idempotency key on network error", async () => {
    const { api, calls } = createFakePaymentApi()
    const inFlightRef = { current: false }
    const idempotencyKeyRef: { current: IssueIdempotencySlot | null } = { current: null }
    const setBusy = vi.fn()
    const invalidate = vi.fn(async () => undefined)
    const onNotify = vi.fn()
    const onIssued = vi.fn()

    const p1 = submitIssueInvoice({
      api,
      visitId: "1283",
      version: 1,
      busy: false,
      inFlightRef,
      idempotencyKeyRef,
      setBusy,
      invalidate,
      onNotify,
      onIssued,
    })
    const p2 = submitIssueInvoice({
      api,
      visitId: "1283",
      version: 1,
      busy: false,
      inFlightRef,
      idempotencyKeyRef,
      setBusy,
      invalidate,
      onNotify,
      onIssued,
    })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(calls.issue).toHaveLength(1)
    expect(r1?.billCode).toBe("B0412")
    expect(r2).toBeNull()
    expect(onNotify).toHaveBeenCalledWith("success", expect.stringContaining("Đã xuất hóa đơn B0412"))
    expect(onIssued).toHaveBeenCalledTimes(1)

    // Network error preserves exact key across retry
    const failing = createFakePaymentApi({
      failIssueWith: new ApiError(0, "NETWORK_ERROR", "Mất mạng"),
    })
    const keySlot: { current: IssueIdempotencySlot | null } = { current: null }
    const errNotify = vi.fn()
    await submitIssueInvoice({
      api: failing.api,
      visitId: "1283",
      version: 4,
      busy: false,
      inFlightRef: { current: false },
      idempotencyKeyRef: keySlot,
      setBusy: () => undefined,
      invalidate: async () => undefined,
      onNotify: errNotify,
      onIssued: () => undefined,
    })
    await submitIssueInvoice({
      api: failing.api,
      visitId: "1283",
      version: 4,
      busy: false,
      inFlightRef: { current: false },
      idempotencyKeyRef: keySlot,
      setBusy: () => undefined,
      invalidate: async () => undefined,
      onNotify: errNotify,
      onIssued: () => undefined,
    })
    expect(failing.calls.issue).toHaveLength(2)
    expect(failing.calls.issue[0].key).toBe(failing.calls.issue[1].key)
    expect(errNotify).toHaveBeenCalledWith("error", "Mất mạng")
  })
})

describe("W2 VM-02 / D1 / TN-02-K7: Bartender & Waiter role gates + /chebien entry", () => {
  it("allows WAITER and BAR only, blocks money view params", () => {
    expect(isWaiterBillRole("WAITER")).toBe(true)
    expect(isWaiterBillRole("BAR")).toBe(true)
    expect(isWaiterBillRole("KITCHEN")).toBe(false)
    expect(isWaiterBillRole("CASHIER")).toBe(false)

    for (const money of ["method", "cash", "qr", "success"]) {
      expect(isMoneyViewParam(money)).toBe(true)
    }
    expect(isMoneyViewParam("preview")).toBe(false)
    expect(isMoneyViewParam("invoice")).toBe(false)
    expect(parseWaiterBillView("preview")).toBe("preview")
    expect(parseWaiterBillView("invoice")).toBe("invoice")
    expect(parseWaiterBillView("unknown")).toBe("detail")
  })

  it("prioritizes Bar guest sessions in Bartender drawer and renders Bar ticket bill action", () => {
    const { api } = createFakePaymentApi()
    const grouped = sortBarSessionsFirst([
      {
        visitId: "1",
        billCode: "B1",
        sessionCode: "S1",
        code: "A3",
        tables: ["A3"],
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
        sessionCode: "S2",
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
    ])
    expect(isBarGuestSession({ code: "G05", tables: ["BAR05", "BAR06"] })).toBe(true)
    expect(grouped.barSessions.map((s) => s.code)).toEqual(["G05"])
    expect(grouped.otherSessions.map((s) => s.code)).toEqual(["A3"])

    const drawerHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BarBillDrawerBody, {
          open: true,
          selectedVisitId: "2001",
          view: "detail",
          onSelectVisit: () => undefined,
          onNavigateView: () => undefined,
          onBackToList: () => undefined,
          api,
        }),
      ),
    )
    expect(drawerHtml).toContain('data-testid="waiter-invoice-workspace"')
    expect(drawerHtml).toContain("Chi tiết Phiên")

    const ticketHtml = renderToStaticMarkup(
      createElement(PreparationTicketCard, {
        ticket: {
          ticketId: 1,
          orderId: 2,
          visitId: 2001,
          visitSequence: 1,
          station: "BAR",
          status: "SUBMITTED",
          version: 1,
          submittedAt: "2026-11-26T10:00:00.000Z",
          acceptedAt: null,
          startedAt: null,
          readyAt: null,
          collectedAt: null,
          waitSeconds: 30,
          tableCodes: ["BAR01"],
          orderedByDisplayName: "Khoa",
          guestFlags: { vip: false, birthday: false, designated: false },
          lines: [
            {
              lineNo: 1,
              itemName: "Old Fashioned",
              variantDisplayName: "Ly",
              menuItemVariantId: 1,
              unitCode: "GLASS",
              quantity: 1,
              cancelledQuantity: 0,
              originalQuantity: 1,
              doneQuantity: 0,
              progressVersion: 0,
              note: null,
              pendingCancellation: null,
            },
          ],
        },
        station: "BAR",
        now: new Date("2026-11-26T10:01:00.000Z"),
        canTransition: true,
        canRetry: false,
        pending: false,
        onTransition: () => undefined,
        onRetry: () => undefined,
        onOpenBill: () => undefined,
        onProgress: () => undefined,
      }),
    )
    expect(ticketHtml).toContain("Hóa đơn BAR01")
  })

  it("WaiterTableSheetBody exposes 'Xem tạm tính & xuất hóa đơn' for seated tables", () => {
    const table: TableView = {
      id: 11,
      version: 1,
      code: "A3",
      displayName: "A3",
      zoneId: 1,
      zoneCode: "A",
      kind: "TABLE",
      capacity: 4,
      seqNo: null,
      isSpare: false,
      status: "ACTIVE",
      x: 0,
      y: 0,
      w: 40,
      h: 30,
      seating: undefined,
    }
    const claim: ClaimView = {
      kind: "visit",
      visitId: 1283,
      reservationId: null,
      waitlistEntryId: null,
      holdId: null,
      displayName: "",
      phoneLast3: null,
      partySize: 4,
      startsAt: new Date("2026-11-26T12:00:00.000Z"),
      deadlineAt: null,
      paid: false,
      origin: null,
      tableIds: [11],
      groupId: null,
      warning: null,
      minutesLate: 0,
      sourceCode: null,
      note: null,
      version: 1,
    }
    const state: FloorTableState = {
      tableId: 11,
      state: "seated",
      claim,
      staleFromPreviousDay: false,
    }
    const byId = new Map([[11, table]])
    const states = new Map([[11, state]])
    const view = buildWaiterSheetView({
      tableId: 11,
      state,
      byId,
      zoneName: "Khu A",
      serverNow: new Date("2026-11-26T12:30:00.000Z"),
      canOrder: true,
      canRearrange: true,
    })
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WaiterTableSheetBody, {
          view,
          tables: [table],
          states,
          byId,
          canMove: true,
          canCombine: true,
          canSplit: false,
          pending: false,
          onOrder: () => undefined,
          onViewOrders: () => undefined,
          onRearrange: () => undefined,
        }),
      ),
    )
    expect(html).toContain("Xem tạm tính &amp; xuất hóa đơn")
    expect(html).not.toContain("gọi thu ngân")
  })
})

// @vitest-environment node
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { roleCan } from "@/domain/access"
import type { RoleCode } from "@/domain/enums"
import { WAITER_FORBIDDEN_PATHS } from "@/features/waiter/waiter-access"
import type {
  CancelEffect,
  CancelRequest,
  PaidBillSummary,
  PayBill,
  PayBillSummary,
  PaymentApi,
  PaymentAuditEntry,
  PaymentNotification,
  PreviewBill,
  Receipt,
  SessionBills,
} from "@/services/payment"
import { AuditPanel } from "./audit-panel"
import {
  buildApproveCancelFeedback,
  buildDirectCancelOutcome,
  canAccessPaymentCancel,
  canApproveCancelRequests,
  canDirectCancelPaid,
  canReadPaymentAudit,
  collectAuditBillCodes,
  extractPaidBillsFromSessions,
  filterPaidBills,
  formatCancelTime,
  formatPaidMethod,
  formatPaidTableLabel,
  paidCandidatesFromVisits,
  partitionCancelRequests,
  resolveCancelSessionImpact,
  sortPaidBillsNewestFirst,
  submitDecideCancel,
  submitDirectCancel,
  type PaidBillCandidate,
} from "./cancel-model"
import { CancelQueuePanel } from "./cancel-queue-panel"
import { DirectCancelPanel } from "./direct-cancel-panel"
import { PaidBillsPanel } from "./paid-bills-panel"
import { PaymentCancelWorkspace } from "./payment-cancel-page"

function makeFakeApi(overrides: Partial<PaymentApi> = {}): PaymentApi {
  const bill: PayBill = {
    billCode: "B0002",
    visitId: "2",
    sessionCode: "S-0002",
    code: "A2",
    tables: ["A2"],
    status: "PAID",
    billStatus: "PAID",
    lines: [],
    subtotalVnd: 150_000,
    vatVnd: 15_000,
    preRoundVnd: 165_000,
    roundingVnd: 0,
    dueVnd: 165_000,
    version: 3,
    openedAt: "19:20",
    waiterName: "Minh",
    guests: 2,
    roundCount: 1,
    paidAt: "21:35",
    paidBy: "Thu ngân · Thu ngân",
  }
  const summary: PayBillSummary = {
    visitId: bill.visitId,
    billCode: bill.billCode,
    sessionCode: bill.sessionCode,
    code: bill.code,
    tables: bill.tables,
    status: "PAID",
    openedAt: bill.openedAt,
    waiterName: bill.waiterName,
    guests: bill.guests,
    dueVnd: bill.dueVnd,
    version: bill.version,
  }
  const preview: PreviewBill = {
    visitId: bill.visitId,
    sessionCode: bill.sessionCode,
    code: bill.code,
    tables: bill.tables,
    lines: [],
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
    status: "PAID",
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
    changeVnd: 35_000,
    preRoundVnd: bill.preRoundVnd,
    dueVnd: bill.dueVnd,
    confirmedAt: "21:35",
    confirmedBy: "Thu ngân",
  }
  const pendingReq: CancelRequest = {
    id: "cr-1",
    billCode: "B0002",
    visitId: "2",
    code: "A2",
    dueVnd: 165_000,
    reason: "Khách đổi sang chuyển khoản QR",
    requestedBy: "Thu ngân · Thu ngân",
    requestedAt: "2026-11-26T21:40:00.000Z",
    status: "PENDING",
  }
  const ntf: PaymentNotification = {
    id: "ntf-1",
    type: "CANCEL_REQUESTED",
    title: "Yêu cầu hủy bill",
    text: "A2 (B0002)",
    time: "21:40",
    visitId: "2",
  }
  const audit: PaymentAuditEntry[] = [
    {
      id: "aud-1",
      action: "CANCEL_REQUESTED",
      billCode: "B0002",
      visitId: "2",
      actor: "Thu ngân · Thu ngân",
      reason: "Khách đổi sang chuyển khoản QR",
      at: "2026-11-26T21:40:00.000Z",
      device: "Máy thu ngân",
    },
    {
      id: "aud-2",
      action: "CANCEL_APPROVED",
      billCode: "B0002",
      visitId: "2",
      actor: "Thu ngân · Thu ngân",
      approver: "Quản trị viên · Quản trị viên",
      reason: "Đã đối soát, cho thu lại",
      at: "2026-11-26T21:42:00.000Z",
      device: "Máy quản trị",
    },
  ]
  const paidBills: PaidBillSummary[] = [
    {
      billCode: "B0002",
      visitId: "2",
      code: "A2",
      tables: ["A2"],
      dueVnd: 165_000,
      method: "CASH",
      paidAt: "2026-11-26T21:35:00.000Z",
      paidBy: "Thu ngân · Thu ngân",
    },
  ]

  return {
    listOpen: async () => [summary],
    getBill: async () => bill,
    createPrebill: async () => bill,
    requestPayment: async () => undefined,
    confirmCash: async () => receipt,
    confirmTransfer: async () => receipt,
    listNotifications: async () => [ntf],
    checkTransfer: async () => ({ found: false }),
    previewBill: async () => preview,
    issueInvoice: async () => bill,
    getSessionBills: async () => sessionBills,
    requestCancel: async () => pendingReq,
    listCancelRequests: async () => [pendingReq],
    decideCancel: async (requestId, approve, note) => ({
      ...pendingReq,
      id: requestId,
      status: approve ? "APPROVED" : "REJECTED",
      decidedBy: "Quản trị viên · Quản trị viên",
      decidedAt: "2026-11-26T21:42:00.000Z",
      ...(note ? { decisionNote: note } : {}),
    }),
    cancelPaid: async () => ({ sessionReopened: true, closedTurnsDelta: -1, tableRestored: true }),
    listAudit: async (billCode) => (billCode ? audit.filter((a) => a.billCode === billCode) : audit),
    listPaidBills: async () => paidBills,
    listMyCancelRequests: async () => [],
    ...overrides,
  }
}

function renderWorkspaceAs(role: RoleCode, payApi: PaymentApi, initialBillCode = "") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(PaymentCancelWorkspace, {
        payApi,
        initialBillCode,
        accessOverride: {
          role,
          canAuditRead: roleCan(role, "audit.read"),
          canCollect: roleCan(role, "payment.collect"),
        },
      }),
    ),
  )
}

describe("W4 TN-14 access gates & pure model helpers", () => {
  it("denies CASHIER, WAITER, BAR, KITCHEN, CUSTOMER_CARE and allows ADMIN, OWNER, RECEPTIONIST", () => {
    expect(canAccessPaymentCancel("CASHIER", false, true)).toBe(false)
    expect(canAccessPaymentCancel("CASHIER", true, true)).toBe(false)
    expect(canAccessPaymentCancel("WAITER", false, false)).toBe(false)
    expect(canAccessPaymentCancel("BAR", false, false)).toBe(false)
    expect(canAccessPaymentCancel("KITCHEN", false, false)).toBe(false)
    expect(canAccessPaymentCancel("CUSTOMER_CARE", false, false)).toBe(false)
    expect(WAITER_FORBIDDEN_PATHS).toContain("/cancel-payment")

    expect(canAccessPaymentCancel("ADMIN", true, true)).toBe(true)
    expect(canAccessPaymentCancel("OWNER", true, true)).toBe(true)
    expect(canAccessPaymentCancel("RECEPTIONIST", false, false)).toBe(true)

    expect(canApproveCancelRequests("ADMIN", true)).toBe(true)
    expect(canApproveCancelRequests("OWNER", true)).toBe(true)
    expect(canApproveCancelRequests("RECEPTIONIST", false)).toBe(false)
    expect(canApproveCancelRequests("CASHIER", false)).toBe(false)

    expect(canDirectCancelPaid("RECEPTIONIST")).toBe(true)
    expect(canDirectCancelPaid("ADMIN")).toBe(true)
    expect(canDirectCancelPaid("OWNER")).toBe(true)
    expect(canDirectCancelPaid("CASHIER")).toBe(false)
    expect(canDirectCancelPaid("WAITER")).toBe(false)
    expect(canDirectCancelPaid("BAR")).toBe(false)

    expect(canReadPaymentAudit("ADMIN", true)).toBe(true)
    expect(canReadPaymentAudit("OWNER", true)).toBe(true)
    expect(canReadPaymentAudit("RECEPTIONIST", false)).toBe(true)
    expect(canReadPaymentAudit("CASHIER", true)).toBe(false)
  })

  it("sorts paid bills newest-first and searches by bill code, table, or cluster", () => {
    const bills: PaidBillCandidate[] = [
      {
        billCode: "B0001",
        visitId: "1",
        code: "A1",
        tables: ["A1"],
        dueVnd: 120_000,
        method: "CASH",
        paidAt: "2026-11-26T20:10:00.000Z",
        paidBy: "Thu ngân 1",
      },
      {
        billCode: "B0003",
        visitId: "3",
        code: "G02",
        clusterCode: "G02",
        tables: ["B11", "B12"],
        dueVnd: 540_000,
        method: "TRANSFER",
        paidAt: "2026-11-26T21:50:00.000Z",
        paidBy: "Thu ngân 2",
      },
      {
        billCode: "B0002",
        visitId: "2",
        code: "A2",
        tables: ["A2"],
        dueVnd: 231_000,
        method: "CASH",
        paidAt: "2026-11-26T21:15:00.000Z",
        paidBy: "Thu ngân 1",
      },
    ]

    const sorted = sortPaidBillsNewestFirst(bills)
    expect(sorted.map((b) => b.billCode)).toEqual(["B0003", "B0002", "B0001"])

    expect(filterPaidBills(sorted, "b0002").map((b) => b.billCode)).toEqual(["B0002"])
    expect(filterPaidBills(sorted, "B12").map((b) => b.billCode)).toEqual(["B0003"])
    expect(filterPaidBills(sorted, "g02").map((b) => b.billCode)).toEqual(["B0003"])
    expect(filterPaidBills(sorted, "  ").map((b) => b.billCode)).toEqual(["B0003", "B0002", "B0001"])

    expect(formatPaidMethod("CASH")).toBe("Tiền mặt")
    expect(formatPaidMethod("TRANSFER")).toBe("Chuyển khoản QR")
    expect(formatPaidMethod(undefined)).toBe("-")
    expect(formatPaidTableLabel(bills[0])).toBe("Bàn A1")
    expect(formatPaidTableLabel(bills[1])).toBe("Cụm G02 (B11, B12)")
  })

  it("NA45H-15: preserves API newest-first order across midnight for HH:mm times and sorts full ISO timestamps across midnight", () => {
    const apiOrderedHhmm: PaidBillCandidate[] = [
      { billCode: "B0003", visitId: "3", code: "A3", tables: ["A3"], paidAt: "00:30" },
      { billCode: "B0002", visitId: "2", code: "A2", tables: ["A2"], paidAt: "23:50" },
    ]
    expect(sortPaidBillsNewestFirst(apiOrderedHhmm).map((b) => b.billCode)).toEqual(["B0003", "B0002"])
    expect(filterPaidBills(sortPaidBillsNewestFirst(apiOrderedHhmm), "A").map((b) => b.billCode)).toEqual([
      "B0003",
      "B0002",
    ])

    const isoAcrossMidnight: PaidBillCandidate[] = [
      { billCode: "B0002", visitId: "2", code: "A2", tables: ["A2"], paidAt: "2026-11-26T23:50:00+07:00" },
      { billCode: "B0003", visitId: "3", code: "A3", tables: ["A3"], paidAt: "2026-11-27T00:30:00+07:00" },
    ]
    expect(sortPaidBillsNewestFirst(isoAcrossMidnight).map((b) => b.billCode)).toEqual(["B0003", "B0002"])
  })

  it("NA45H-12 & NA45H-19: builds cancel impact text strictly from returned CancelEffect and requires tableRestored === true for green table", async () => {
    expect(resolveCancelSessionImpact({ sessionReopened: true, closedTurnsDelta: -1, tableRestored: true })).toBe(
      "REOPENED",
    )
    expect(resolveCancelSessionImpact({ sessionReopened: true, closedTurnsDelta: 0, tableRestored: true })).toBe(
      "REOPENED_NO_TURN",
    )
    expect(resolveCancelSessionImpact({ sessionReopened: true, closedTurnsDelta: 0, tableRestored: false })).toBe(
      "REOPENED_NO_TABLE",
    )
    expect(resolveCancelSessionImpact({ sessionReopened: true, closedTurnsDelta: -1 } as unknown as CancelEffect)).toBe(
      "REOPENED_NO_TABLE",
    )
    expect(resolveCancelSessionImpact({ sessionReopened: false, closedTurnsDelta: 0, tableRestored: false })).toBe(
      "STILL_OPEN",
    )
    expect(resolveCancelSessionImpact(undefined)).toBe("UNKNOWN")
    expect(resolveCancelSessionImpact(null)).toBe("UNKNOWN")

    expect(buildDirectCancelOutcome("B0002", "REOPENED").title).toContain("bàn xanh lá, lượt -1")
    const reopenedNoTurn = buildDirectCancelOutcome("B0002", "REOPENED_NO_TURN")
    expect(reopenedNoTurn.title).toContain("bàn xanh lá")
    expect(reopenedNoTurn.title).not.toContain("lượt -1")

    const reopenedNoTableDirect = buildDirectCancelOutcome("B0005", "REOPENED_NO_TABLE")
    expect(reopenedNoTableDirect.title).toContain("bill về Chưa thu, bàn không mở lại")
    expect(reopenedNoTableDirect.title).not.toContain("bàn xanh")
    expect(reopenedNoTableDirect.title).not.toContain("lượt -1")
    expect(reopenedNoTableDirect.detail).not.toContain("đang phục vụ")

    const stillOpenDirect = buildDirectCancelOutcome("B0003", "STILL_OPEN")
    expect(stillOpenDirect.title).toContain("bill về Chưa thu")
    expect(stillOpenDirect.title).toContain("phiên vẫn đang mở")
    expect(stillOpenDirect.title).not.toContain("lượt -1")
    expect(stillOpenDirect.detail).not.toContain("trả về trạng thái đang phục vụ")

    const unknownDirect = buildDirectCancelOutcome("B0004", "UNKNOWN")
    expect(unknownDirect.title).toContain("bill về Chưa thu")
    expect(unknownDirect.title).not.toContain("lượt -1")
    expect(unknownDirect.title).not.toContain("phiên vẫn đang mở")

    expect(buildApproveCancelFeedback("B0002", "A2", "REOPENED")).toContain("lượt -1")
    const reopenedNoTableApprove = buildApproveCancelFeedback("B0005", "A3", "REOPENED_NO_TABLE")
    expect(reopenedNoTableApprove).toContain("bill về Chưa thu, bàn không mở lại")
    expect(reopenedNoTableApprove).not.toContain("bàn xanh")
    expect(reopenedNoTableApprove).not.toContain("lượt -1")
    const stillOpenApprove = buildApproveCancelFeedback("B0003", "A3", "STILL_OPEN")
    expect(stillOpenApprove).toContain("bill về Chưa thu")
    expect(stillOpenApprove).toContain("phiên vẫn đang mở")
    expect(stillOpenApprove).not.toContain("lượt -1")
    const unknownApprove = buildApproveCancelFeedback("B0004", "A4", "UNKNOWN")
    expect(unknownApprove).toContain("bill về Chưa thu")
    expect(unknownApprove).not.toContain("lượt -1")
    expect(unknownApprove).not.toContain("phiên vẫn đang mở")

    const getSessionBills = vi.fn(makeFakeApi().getSessionBills)
    const listOpen = vi.fn(makeFakeApi().listOpen)
    const getBill = vi.fn(makeFakeApi().getBill)

    const fakeApi = makeFakeApi({
      getSessionBills,
      listOpen,
      getBill,
      cancelPaid: async (billCode: string): Promise<CancelEffect> =>
        billCode === "B0002"
          ? { sessionReopened: true, closedTurnsDelta: -1, tableRestored: true }
          : billCode === "B0005"
            ? { sessionReopened: true, closedTurnsDelta: 0, tableRestored: false }
            : { sessionReopened: false, closedTurnsDelta: 0, tableRestored: false },
      decideCancel: async (requestId, approve, note) => ({
        id: requestId,
        billCode: requestId === "cr-cutoff" ? "B0005" : "B0002",
        visitId: "2",
        code: requestId === "cr-cutoff" ? "A3" : "A2",
        dueVnd: 165_000,
        reason: "Test",
        requestedBy: "Thu ngân",
        requestedAt: "2026-11-26T21:40:00.000Z",
        status: approve ? "APPROVED" : "REJECTED",
        decidedBy: "Admin",
        decidedAt: "2026-11-26T21:42:00.000Z",
        ...(note ? { decisionNote: note } : {}),
        ...(approve
          ? {
              effect:
                requestId === "cr-reopen"
                  ? { sessionReopened: true, closedTurnsDelta: -1, tableRestored: true }
                  : requestId === "cr-cutoff"
                    ? { sessionReopened: true, closedTurnsDelta: 0, tableRestored: false }
                    : { sessionReopened: false, closedTurnsDelta: 0, tableRestored: false },
            }
          : {}),
      }),
    })

    const directReopen = await submitDirectCancel(fakeApi, "B0002", "Khách gọi thêm")
    expect(directReopen.title).toContain("bàn xanh lá, lượt -1")
    const directNoTable = await submitDirectCancel(fakeApi, "B0005", "Qua giờ chốt ca")
    expect(directNoTable.title).toContain("bill về Chưa thu, bàn không mở lại")
    expect(directNoTable.title).not.toContain("bàn xanh")
    const directOpen = await submitDirectCancel(fakeApi, "B0003", "Tách bill")
    expect(directOpen.title).toContain("phiên vẫn đang mở (không đổi lượt)")

    const approveReopen = await submitDecideCancel(fakeApi, { id: "cr-reopen", billCode: "B0002", code: "A2" }, true)
    expect(approveReopen.feedback.text).toContain("bàn xanh lá, lượt -1")
    const approveCutoff = await submitDecideCancel(fakeApi, { id: "cr-cutoff", billCode: "B0005", code: "A3" }, true)
    expect(approveCutoff.feedback.text).toContain("bill về Chưa thu, bàn không mở lại")
    expect(approveCutoff.feedback.text).not.toContain("bàn xanh")
    const approveOpen = await submitDecideCancel(fakeApi, { id: "cr-open", billCode: "B0003", code: "A3" }, true)
    expect(approveOpen.feedback.text).toContain("phiên vẫn đang mở (không đổi lượt)")

    const rejectRes = await submitDecideCancel(
      fakeApi,
      { id: "cr-rej", billCode: "B0002", code: "A2" },
      false,
      "Giữ nguyên",
    )
    expect(rejectRes.feedback.kind).toBe("info")
    expect(rejectRes.feedback.text).toContain("Đã từ chối yêu cầu huỷ")

    // Missing effect fallback (temporary contract without effect) shows only confirmed bill status
    const noEffectApi = makeFakeApi({
      cancelPaid: async () => undefined as unknown as CancelEffect,
    })
    const directUnknown = await submitDirectCancel(noEffectApi, "B0002", "Fallback")
    expect(directUnknown.title).toBe("B0002: Đã huỷ thanh toán - bill về Chưa thu.")
    const approveUnknown = await submitDecideCancel(noEffectApi, { id: "cr-1", billCode: "B0002", code: "A2" }, true)
    expect(approveUnknown.feedback.text).toBe("Đã duyệt huỷ B0002 (A2) - bill về Chưa thu. Đã thông báo Thu ngân.")

    expect(getSessionBills).not.toHaveBeenCalled()
    expect(listOpen).not.toHaveBeenCalled()
    expect(getBill).not.toHaveBeenCalled()
  })

  it("partitions PENDING vs decided cancel requests newest-first", () => {
    const reqs: CancelRequest[] = [
      {
        id: "1",
        billCode: "B0001",
        visitId: "1",
        code: "A1",
        dueVnd: 100_000,
        reason: "Older pending",
        requestedBy: "Thu ngân",
        requestedAt: "2026-11-26T20:00:00.000Z",
        status: "PENDING",
      },
      {
        id: "2",
        billCode: "B0002",
        visitId: "2",
        code: "A2",
        dueVnd: 200_000,
        reason: "Approved one",
        requestedBy: "Thu ngân",
        requestedAt: "2026-11-26T20:10:00.000Z",
        status: "APPROVED",
        decidedBy: "Admin",
        decidedAt: "2026-11-26T20:12:00.000Z",
      },
      {
        id: "3",
        billCode: "B0003",
        visitId: "3",
        code: "A3",
        dueVnd: 300_000,
        reason: "Newer pending",
        requestedBy: "Thu ngân",
        requestedAt: "2026-11-26T21:00:00.000Z",
        status: "PENDING",
      },
    ]
    const { pending, decided } = partitionCancelRequests(reqs)
    expect(pending.map((r) => r.id)).toEqual(["3", "1"])
    expect(decided.map((r) => r.id)).toEqual(["2"])
  })

  it("extracts PAID bills from sessions and fallback visits and formats times cleanly", () => {
    const paidFromSessions = extractPaidBillsFromSessions([
      {
        visitId: "2",
        sessionCode: "S-0002",
        code: "A2",
        tables: ["A2"],
        status: "AWAITING_PAYMENT",
        unbilledLineCount: 0,
        version: 2,
        bills: [
          {
            billCode: "B0002",
            visitId: "2",
            sessionCode: "S-0002",
            code: "A2",
            tables: ["A2"],
            status: "AWAITING_PAYMENT",
            billStatus: "PAID",
            lines: [],
            subtotalVnd: 100_000,
            vatVnd: 10_000,
            preRoundVnd: 110_000,
            roundingVnd: 0,
            dueVnd: 110_000,
            version: 2,
            openedAt: "19:00",
            waiterName: "Minh",
            guests: 2,
            roundCount: 1,
            paidAt: "21:30",
            paidBy: "Thu ngân",
          },
          {
            billCode: "B0002-2",
            visitId: "2",
            sessionCode: "S-0002",
            code: "A2",
            tables: ["A2"],
            status: "AWAITING_PAYMENT",
            billStatus: "UNPAID",
            lines: [],
            subtotalVnd: 50_000,
            vatVnd: 5_000,
            preRoundVnd: 55_000,
            roundingVnd: 0,
            dueVnd: 55_000,
            version: 2,
            openedAt: "19:00",
            waiterName: "Minh",
            guests: 2,
            roundCount: 1,
          },
        ],
      },
    ])
    expect(paidFromSessions.map((b) => b.billCode)).toEqual(["B0002"])

    const visitPaid = paidCandidatesFromVisits(
      [
        {
          id: 9,
          version: 1,
          origin: "WALK_IN",
          customerId: null,
          displayName: "Khách B1",
          phoneLast3: null,
          guestCount: 2,
          startedAt: new Date("2026-11-26T12:00:00.000Z"),
          endedAt: new Date("2026-11-26T14:00:00.000Z"),
          endReason: "GUEST_LEFT",
          paidMarkedAt: new Date("2026-11-26T14:00:00.000Z"),
          tableIds: [11],
          groupId: null,
          symbolNo: null,
          reservationId: null,
          businessDate: "2026-11-26",
          note: null,
        },
      ],
      new Map([[11, "B1"]]),
    )
    expect(visitPaid[0]).toMatchObject({ billCode: "B0009", code: "B1", guestName: "Khách B1" })
    expect(formatCancelTime("21:45")).toBe("21:45")
    expect(formatCancelTime(undefined)).toBe("-")
    expect(collectAuditBillCodes([], paidFromSessions, [])).toEqual(["B0002"])
  })
})

describe("W4 TN-14 UI components against fake PaymentApi", () => {
  it("renders PaidBillsPanel with bill code, table/cluster, amount, method, paid time, cashier preserving across-midnight API order", () => {
    const html = renderToStaticMarkup(
      createElement(PaidBillsPanel, {
        paidBills: [
          {
            billCode: "B0003",
            visitId: "3",
            code: "G02",
            clusterCode: "G02",
            tables: ["B11", "B12"],
            dueVnd: 540_000,
            method: "TRANSFER",
            paidAt: "00:30",
            paidBy: "Thu ngân 2",
          },
          {
            billCode: "B0001",
            visitId: "1",
            code: "A1",
            tables: ["A1"],
            dueVnd: 120_000,
            method: "CASH",
            paidAt: "23:50",
            paidBy: "Thu ngân 1",
          },
        ],
        selectedBillCode: "B0003",
        onSelect: () => undefined,
      }),
    )
    expect(html).toContain("Bill đã thu trong ca")
    expect(html).toContain("Tìm theo mã bill hoặc bàn")
    expect(html).toContain("B0003")
    expect(html).toContain("Cụm G02 (B11, B12)")
    expect(html).toContain("540.000đ")
    expect(html).toContain("Chuyển khoản QR")
    expect(html).toContain("00:30")
    expect(html).toContain("Thu ngân 2")
    expect(html).toContain("B0001")
    expect(html).toContain("Tiền mặt")
    expect(html).toContain("23:50")
    expect(html.indexOf("B0003")).toBeLessThan(html.indexOf("B0001"))
  })

  it("renders Admin approval queue with PENDING bill, table, amount, reason, requester, time, note, Approve/Reject", () => {
    const html = renderToStaticMarkup(
      createElement(CancelQueuePanel, {
        requests: [
          {
            id: "cr-10",
            billCode: "B0412",
            visitId: "412",
            code: "G02",
            dueVnd: 3_044_000,
            reason: "Thu nhầm phương thức tiền mặt",
            requestedBy: "Thu ngân · Thu ngân",
            requestedAt: "21:40",
            status: "PENDING",
          },
        ],
        loading: false,
        error: null,
        api: makeFakeApi(),
        onRefresh: () => undefined,
        onDecided: () => undefined,
        onInspectAudit: () => undefined,
      }),
    )
    expect(html).toContain("Hàng chờ duyệt huỷ")
    expect(html).toContain("B0412")
    expect(html).toContain("Bàn G02")
    expect(html).toContain("3.044.000đ")
    expect(html).toContain("Thu nhầm phương thức tiền mặt")
    expect(html).toContain("Thu ngân · Thu ngân")
    expect(html).toContain("21:40")
    expect(html).toContain("Ghi chú phản hồi (tuỳ chọn)")
    expect(html).toContain("Từ chối")
    expect(html).toContain("Duyệt huỷ")
  })

  it("disables Approve/Reject in readOnly mode for Admin Read-Only", () => {
    const html = renderToStaticMarkup(
      createElement(CancelQueuePanel, {
        requests: [
          {
            id: "cr-10",
            billCode: "B0412",
            visitId: "412",
            code: "G02",
            dueVnd: 3_044_000,
            reason: "Thu nhầm",
            requestedBy: "Thu ngân",
            requestedAt: "21:40",
            status: "PENDING",
          },
        ],
        loading: false,
        error: null,
        readOnly: true,
        api: makeFakeApi(),
        onRefresh: () => undefined,
        onDecided: () => undefined,
      }),
    )
    expect(html).toContain("Chế độ chỉ xem")
    expect(html).toContain("disabled")
  })

  it("renders DirectCancelPanel for a PAID bill with required reason form", () => {
    const html = renderToStaticMarkup(
      createElement(DirectCancelPanel, {
        paidBills: [
          {
            billCode: "B0002",
            visitId: "2",
            code: "A2",
            tables: ["A2"],
            dueVnd: 165_000,
            method: "CASH",
            paidAt: "21:35",
            paidBy: "Thu ngân",
          },
        ],
        initialBillCode: "B0002",
        api: makeFakeApi(),
        canViewAudit: true,
        onInspectAudit: () => undefined,
      }),
    )
    expect(html).toContain("Huỷ thanh toán trực tiếp")
    expect(html).toContain("B0002")
    expect(html).toContain("Bàn A2")
    expect(html).toContain("165.000đ")
    expect(html).toContain("Tiền mặt")
    expect(html).toContain("Lý do huỷ thanh toán (bắt buộc)")
    expect(html).toContain("Xác nhận huỷ thanh toán")
  })

  it("renders per-bill AuditPanel with requester, approver/canceller, reason, time, and device", () => {
    const html = renderToStaticMarkup(
      createElement(AuditPanel, {
        entries: [
          {
            id: "aud-1",
            action: "CANCEL_REQUESTED",
            billCode: "B0002",
            visitId: "2",
            actor: "Thu ngân · Thu ngân",
            reason: "Khách đổi QR",
            at: "21:40",
            device: "Máy thu ngân",
          },
          {
            id: "aud-2",
            action: "CANCEL_APPROVED",
            billCode: "B0002",
            visitId: "2",
            actor: "Thu ngân · Thu ngân",
            approver: "Quản trị viên · Quản trị viên",
            reason: "Khách đổi QR",
            decisionNote: "OK duyệt",
            at: "21:42",
            device: "Máy quản trị",
          },
          {
            id: "aud-3",
            action: "CANCELLED_DIRECT",
            billCode: "B0003",
            visitId: "3",
            actor: "Lễ tân 1 · Lễ tân",
            reason: "Khách gọi thêm món",
            at: "21:45",
            device: "iPad quầy",
          },
        ],
        selectedBillCode: "B0002",
        knownBillCodes: ["B0002", "B0003"],
        onSelectBillCode: () => undefined,
        onRefresh: () => undefined,
      }),
    )
    expect(html).toContain("Nhật ký theo bill")
    expect(html).toContain("Gửi yêu cầu huỷ")
    expect(html).toContain("Duyệt huỷ thanh toán")
    expect(html).toContain("Huỷ thanh toán trực tiếp")
    expect(html).toContain("Thu ngân · Thu ngân")
    expect(html).toContain("Quản trị viên · Quản trị viên")
    expect(html).toContain("Lễ tân 1 · Lễ tân")
    expect(html).toContain("Khách đổi QR")
    expect(html).toContain("Ghi chú quyết định")
    expect(html).toContain("OK duyệt")
    expect(html).toContain("Máy quản trị")
    expect(html).toContain("iPad quầy")
  })

  it("gates PaymentCancelWorkspace by role: CASHIER denied, ADMIN/OWNER full view, RECEPTIONIST paid-bills list and panels on selection", () => {
    const fakeApi = makeFakeApi()

    const cashierHtml = renderWorkspaceAs("CASHIER", fakeApi)
    expect(cashierHtml).toContain("Không có quyền truy cập")
    expect(cashierHtml).not.toContain("Hàng chờ duyệt huỷ")
    expect(cashierHtml).not.toContain("Bill đã thu trong ca")

    const waiterHtml = renderWorkspaceAs("WAITER", fakeApi)
    expect(waiterHtml).toContain("Không có quyền truy cập")

    const barHtml = renderWorkspaceAs("BAR", fakeApi)
    expect(barHtml).toContain("Không có quyền truy cập")

    const adminHtml = renderWorkspaceAs("ADMIN", fakeApi)
    expect(adminHtml).toContain("Duyệt huỷ thanh toán")
    expect(adminHtml).toContain("Hàng chờ duyệt huỷ")
    expect(adminHtml).toContain("Bill đã thu trong ca")
    expect(adminHtml).toContain("Nhật ký theo bill")

    const ownerHtml = renderWorkspaceAs("OWNER", fakeApi)
    expect(ownerHtml).toContain("Duyệt huỷ thanh toán")
    expect(ownerHtml).toContain("Hàng chờ duyệt huỷ")
    expect(ownerHtml).toContain("Bill đã thu trong ca")

    const recListHtml = renderWorkspaceAs("RECEPTIONIST", fakeApi)
    expect(recListHtml).toContain("Huỷ thanh toán đã thu")
    expect(recListHtml).toContain("Bill đã thu trong ca")
    expect(recListHtml).not.toContain("Hàng chờ duyệt huỷ")
    expect(recListHtml).not.toContain("Huỷ thanh toán trực tiếp")
    expect(recListHtml).not.toContain("Nhật ký theo bill")

    const recSelectedHtml = renderWorkspaceAs("RECEPTIONIST", fakeApi, "B0002")
    expect(recSelectedHtml).toContain("Huỷ thanh toán trực tiếp")
    expect(recSelectedHtml).toContain("Nhật ký theo bill")
    expect(recSelectedHtml).not.toContain("Hàng chờ duyệt huỷ")
  })

  it("validates listPaidBills, decideCancel and cancelPaid contract calls against fake PaymentApi", async () => {
    const decideCancel = vi.fn(makeFakeApi().decideCancel)
    const cancelPaid = vi.fn(makeFakeApi().cancelPaid)
    const listPaidBills = vi.fn(makeFakeApi().listPaidBills)
    const fakeApi = makeFakeApi({ decideCancel, cancelPaid, listPaidBills })

    const paidList = await fakeApi.listPaidBills!()
    expect(paidList).toHaveLength(1)
    expect(paidList[0]).toMatchObject({
      billCode: "B0002",
      code: "A2",
      dueVnd: 165_000,
      method: "CASH",
      paidBy: "Thu ngân · Thu ngân",
    })
    expect(listPaidBills).toHaveBeenCalledTimes(1)

    const res = await fakeApi.decideCancel("cr-1", true, "Duyệt test")
    expect(res.status).toBe("APPROVED")
    expect(res.decisionNote).toBe("Duyệt test")
    expect(decideCancel).toHaveBeenCalledWith("cr-1", true, "Duyệt test")

    await fakeApi.cancelPaid("B0002", "Khách gọi thêm")
    expect(cancelPaid).toHaveBeenCalledWith("B0002", "Khách gọi thêm")
  })
})

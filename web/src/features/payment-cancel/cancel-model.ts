import type { RoleCode } from "@/domain/enums"
import type { VisitView } from "@/domain/models"
import {
  type CancelEffect,
  type CancelRequest,
  type PayBill,
  type PaymentApi,
  type PaymentAuditAction,
  type PaymentAuditEntry,
  type PaymentMethod,
  type SessionBills,
} from "@/services/payment"

export type CancelSessionImpact = "REOPENED" | "REOPENED_NO_TURN" | "STILL_OPEN" | "UNKNOWN"

export function resolveCancelSessionImpact(
  effect?: CancelEffect | null,
): CancelSessionImpact {
  if (!effect || typeof effect !== "object" || typeof effect.sessionReopened !== "boolean") {
    return "UNKNOWN"
  }
  if (effect.sessionReopened) {
    return effect.closedTurnsDelta === -1 ? "REOPENED" : "REOPENED_NO_TURN"
  }
  return "STILL_OPEN"
}

export function buildDirectCancelOutcome(
  billCode: string,
  impact: CancelSessionImpact,
): { title: string; detail: string } {
  if (impact === "REOPENED") {
    return {
      title: `${billCode}: Đã huỷ thanh toán - bill về Chưa thu, bàn xanh lá, lượt -1.`,
      detail: "Bill đã mở lại để thu tiền; bàn được trả về trạng thái đang phục vụ trên sơ đồ.",
    }
  }
  if (impact === "REOPENED_NO_TURN") {
    return {
      title: `${billCode}: Đã huỷ thanh toán - bill về Chưa thu, bàn xanh lá.`,
      detail: "Bill đã mở lại để thu tiền; bàn được trả về trạng thái đang phục vụ trên sơ đồ.",
    }
  }
  if (impact === "STILL_OPEN") {
    return {
      title: `${billCode}: Đã huỷ thanh toán - bill về Chưa thu, phiên vẫn đang mở (không đổi lượt).`,
      detail: "Bill đã mở lại để thu tiền; phiên vẫn còn bill hoặc món khác nên bàn không đổi lượt.",
    }
  }
  return {
    title: `${billCode}: Đã huỷ thanh toán - bill về Chưa thu.`,
    detail: "Bill đã mở lại để thu tiền.",
  }
}

export function buildApproveCancelFeedback(
  billCode: string,
  tableCode: string,
  impact: CancelSessionImpact,
): string {
  if (impact === "REOPENED") {
    return `Đã duyệt huỷ ${billCode} (${tableCode}) - bill về Chưa thu, bàn xanh lá, lượt -1. Đã thông báo Thu ngân.`
  }
  if (impact === "REOPENED_NO_TURN") {
    return `Đã duyệt huỷ ${billCode} (${tableCode}) - bill về Chưa thu, bàn xanh lá. Đã thông báo Thu ngân.`
  }
  if (impact === "STILL_OPEN") {
    return `Đã duyệt huỷ ${billCode} (${tableCode}) - bill về Chưa thu, phiên vẫn đang mở (không đổi lượt). Đã thông báo Thu ngân.`
  }
  return `Đã duyệt huỷ ${billCode} (${tableCode}) - bill về Chưa thu. Đã thông báo Thu ngân.`
}

export async function submitDirectCancel(
  api: PaymentApi,
  billCode: string,
  reason: string,
): Promise<{ title: string; detail: string }> {
  const effect = await api.cancelPaid(billCode, reason)
  return buildDirectCancelOutcome(billCode, resolveCancelSessionImpact(effect))
}

export async function submitDecideCancel(
  api: PaymentApi,
  req: Pick<CancelRequest, "id" | "billCode" | "code">,
  approve: boolean,
  note?: string,
): Promise<{ updated: CancelRequest; feedback: { kind: "ok" | "info"; text: string } }> {
  const updated = await api.decideCancel(req.id, approve, note)
  if (!approve) {
    return {
      updated,
      feedback: {
        kind: "info",
        text: `Đã từ chối yêu cầu huỷ ${req.billCode} (${req.code}) - giữ Đã thanh toán. Đã thông báo Thu ngân.`,
      },
    }
  }
  return {
    updated,
    feedback: {
      kind: "ok",
      text: buildApproveCancelFeedback(req.billCode, req.code, resolveCancelSessionImpact(updated.effect)),
    },
  }
}

export const PAID_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Tiền mặt",
  TRANSFER: "Chuyển khoản QR",
}

export const AUDIT_ACTION_META: Record<
  PaymentAuditAction,
  { label: string; tone: "req" | "ok" | "err" | "pend" | "free" }
> = {
  INVOICE_ISSUED: { label: "Xuất hóa đơn", tone: "req" },
  PAID: { label: "Đã thu tiền", tone: "ok" },
  CANCEL_REQUESTED: { label: "Gửi yêu cầu huỷ", tone: "pend" },
  CANCEL_APPROVED: { label: "Duyệt huỷ thanh toán", tone: "ok" },
  CANCEL_REJECTED: { label: "Từ chối huỷ thanh toán", tone: "err" },
  CANCELLED_DIRECT: { label: "Huỷ thanh toán trực tiếp", tone: "err" },
}

export interface PaidBillCandidate {
  billCode: string
  visitId: string
  code: string
  clusterCode?: string
  tables: string[]
  dueVnd?: number
  method?: PaymentMethod
  paidAt?: string
  paidBy?: string
  cancelPending?: boolean
  guestName?: string
}

/**
 * Access gate for W4 payment-cancel surfaces.
 * CASHIER is always denied (TN-14: Cashier can only request cancel inside /payment).
 */
export function canAccessPaymentCancel(
  role: RoleCode,
  canAuditRead: boolean,
  canCollect: boolean,
): boolean {
  if (role === "CASHIER") return false
  if (role === "RECEPTIONIST") return true
  if (role === "OWNER" || role === "ADMIN") return canAuditRead || canCollect
  return false
}

export function canApproveCancelRequests(role: RoleCode, canAuditRead: boolean): boolean {
  return (role === "OWNER" || role === "ADMIN") && canAuditRead
}

export function canDirectCancelPaid(role: RoleCode): boolean {
  return role === "RECEPTIONIST" || role === "ADMIN" || role === "OWNER"
}

export function canReadPaymentAudit(role: RoleCode, canCollect: boolean): boolean {
  return role === "RECEPTIONIST" || ((role === "OWNER" || role === "ADMIN") && canCollect)
}

export function formatPaidMethod(method?: PaymentMethod): string {
  return method ? PAID_METHOD_LABEL[method] : "-"
}

export function formatPaidTableLabel(bill: Pick<PaidBillCandidate, "code" | "clusterCode" | "tables">): string {
  if (bill.clusterCode) {
    return bill.tables.length ? `Cụm ${bill.clusterCode} (${bill.tables.join(", ")})` : `Cụm ${bill.clusterCode}`
  }
  return `Bàn ${bill.code}`
}

function paidAtTimestampMs(raw?: string): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  // "HH:mm" has no calendar date and wraps across midnight (17:00 -> 05:00); preserve API order.
  if (/^\d{2}:\d{2}$/.test(trimmed)) return null
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

export function sortPaidBillsNewestFirst(bills: readonly PaidBillCandidate[]): PaidBillCandidate[] {
  return [...bills].sort((a, b) => {
    const ta = paidAtTimestampMs(a.paidAt)
    const tb = paidAtTimestampMs(b.paidAt)
    if (ta !== null && tb !== null) return tb - ta
    return 0
  })
}

export function filterPaidBills(bills: readonly PaidBillCandidate[], query: string): PaidBillCandidate[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...bills]
  return bills.filter((bill) =>
    [bill.billCode, bill.code, bill.clusterCode ?? "", ...bill.tables, bill.guestName ?? ""].some((field) =>
      field.toLowerCase().includes(q),
    ),
  )
}

export function partitionCancelRequests(requests: readonly CancelRequest[]): {
  pending: CancelRequest[]
  decided: CancelRequest[]
} {
  const pending: CancelRequest[] = []
  const decided: CancelRequest[] = []
  for (const req of requests) {
    if (req.status === "PENDING") pending.push(req)
    else decided.push(req)
  }
  const byTimeDesc = (a: CancelRequest, b: CancelRequest) =>
    (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt)
  pending.sort(byTimeDesc)
  decided.sort(byTimeDesc)
  return { pending, decided }
}

export function formatCancelTime(raw: string | undefined): string {
  if (!raw) return "-"
  if (/^\d{2}:\d{2}$/.test(raw)) return raw
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  return `${hh}:${mm} · ${dd}/${mo}`
}

export function defaultBillCodeForVisit(visitId: string | number): string {
  return `B${String(visitId).padStart(4, "0")}`
}

export function extractPaidBillsFromSessions(sessions: readonly SessionBills[]): PaidBillCandidate[] {
  const out: PaidBillCandidate[] = []
  for (const session of sessions) {
    for (const bill of session.bills) {
      if (isPayBillPaid(bill)) {
        out.push({
          billCode: bill.billCode,
          visitId: bill.visitId,
          code: bill.code,
          clusterCode: bill.clusterCode,
          tables: bill.tables,
          dueVnd: bill.dueVnd,
          paidAt: bill.paidAt,
          paidBy: bill.paidBy,
          cancelPending: bill.cancelPending,
        })
      }
    }
  }
  return out
}

export function isPayBillPaid(bill: Pick<PayBill, "status" | "billStatus">): boolean {
  return bill.billStatus ? bill.billStatus === "PAID" : bill.status === "PAID"
}

export function paidCandidatesFromVisits(
  visits: readonly VisitView[],
  tableCodeById: ReadonlyMap<number, string>,
): PaidBillCandidate[] {
  return visits
    .filter((v) => v.paidMarkedAt !== null)
    .map((v) => {
      const tables = v.tableIds.map((id) => tableCodeById.get(id) ?? `#${id}`)
      return {
        billCode: defaultBillCodeForVisit(v.id),
        visitId: String(v.id),
        code: tables.join(" + ") || `Phiên #${v.id}`,
        tables,
        paidAt: v.paidMarkedAt ? formatCancelTime(v.paidMarkedAt.toISOString()) : undefined,
        guestName: v.displayName,
      }
    })
}

export function collectAuditBillCodes(
  requests: readonly CancelRequest[],
  paidBills: readonly PaidBillCandidate[],
  auditEntries: readonly PaymentAuditEntry[],
): string[] {
  const seen = new Set<string>()
  for (const r of requests) if (r.billCode) seen.add(r.billCode)
  for (const b of paidBills) if (b.billCode) seen.add(b.billCode)
  for (const a of auditEntries) if (a.billCode) seen.add(a.billCode)
  return [...seen]
}

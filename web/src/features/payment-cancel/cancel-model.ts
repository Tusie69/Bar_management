import type { RoleCode } from "@/domain/enums"
import type { VisitView } from "@/domain/models"
import type {
  CancelRequest,
  PayBill,
  PaymentAuditAction,
  PaymentAuditEntry,
  SessionBills,
} from "@/services/payment"

export const PAID_CANCEL_OUTCOME_TEXT =
  "Đã huỷ thanh toán - bill về Chưa thu, bàn xanh lá, lượt -1."

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
  tables: string[]
  dueVnd?: number
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
  return (role === "OWNER" || role === "ADMIN") && canCollect
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

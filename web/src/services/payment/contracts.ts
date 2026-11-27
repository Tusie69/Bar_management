/**
 * TEMPORARY PAYMENT CONTRACT (NA-45/46 · HU-44 v1.1 contract v2)
 *
 * Swap point for TU-45/46: payment screens depend ONLY on this interface and
 * these DTOs. When Tú's backend payment endpoints land, replace the adapter in
 * `web/src/services/payment/index.ts` without modifying screen components.
 *
 * HU-44 v1.1 notes for TU-45/46 alignment:
 * - One Phiên may contain multiple bills (`SessionBills`); preview (`PreviewBill`)
 *   never mutates state; invoice issue (`issueInvoice`) = chốt bill.
 * - Money values are always integer VND (never floating point).
 */

export type VisitPayStatus = "SERVING" | "AWAITING_PAYMENT" | "PAID" | "CLOSED_UNPAID"
export type BillPayStatus = "UNPAID" | "PAID"
export type PayLineState = "SERVED" | "MAKING" | "CANCELLED"
export type PaymentMethod = "CASH" | "TRANSFER"
export type PaymentNotificationType =
  | "CANCELLED_ITEM"
  | "PAYMENT_REQUEST"
  | "AWAITING_PAYMENT"
  | "PAID"
  | "INVOICE_ISSUED"
  | "CANCEL_REQUESTED"
  | "CANCEL_DECIDED"

export interface PayLine {
  orderRound: number
  name: string
  unit: string
  qty: number
  unitPriceVnd: number
  lineTotalVnd: number
  state: PayLineState
  note?: string
  roundTime?: string
  roundBy?: string
}

export interface PayBillSummary {
  visitId: string
  billCode: string
  sessionCode: string
  code: string
  tables: string[]
  clusterCode?: string
  status: VisitPayStatus
  openedAt: string
  pendingAt?: string
  requestedAt?: string
  waiterName: string
  guests: number
  dueVnd: number
  hasOrderLines?: boolean
  vatLabel?: string
  vatNote?: string
  issuedAt?: string
  issuedBy?: string
  unpaidBillCount?: number
  version: number
}

export interface PaidBillSummary {
  billCode: string
  visitId: string
  code: string
  tables: string[]
  clusterCode?: string
  dueVnd: number
  method: PaymentMethod
  paidAt: string
  paidBy: string
}

export interface PayBill {
  billCode: string
  visitId: string
  sessionCode: string
  code: string
  tables: string[]
  clusterCode?: string
  status: VisitPayStatus
  billStatus?: BillPayStatus
  lines: PayLine[]
  subtotalVnd: number
  vatVnd: number
  preRoundVnd: number
  roundingVnd: number
  dueVnd: number
  vatLabel?: string
  vatNote?: string
  version: number
  openedAt: string
  pendingAt?: string
  requestedAt?: string
  issuedAt?: string
  issuedBy?: string
  issuedByRole?: "WAITER" | "BAR" | "CASHIER" | "OWNER" | "ADMIN"
  waiterName: string
  guests: number
  roundCount: number
  paidAt?: string
  paidBy?: string
  manualConfirm?: boolean
  cancelPending?: boolean
}

export interface PreviewBill {
  visitId: string
  sessionCode: string
  code: string
  tables: string[]
  clusterCode?: string
  lines: PayLine[]
  subtotalVnd: number
  vatVnd: number
  preRoundVnd: number
  roundingVnd: number
  dueVnd: number
  version: number
}

export interface SessionBills {
  visitId: string
  sessionCode: string
  code: string
  tables: string[]
  clusterCode?: string
  status: VisitPayStatus
  unbilledLineCount: number
  bills: PayBill[]
  version: number
}

export type CancelRequestStatus = "PENDING" | "APPROVED" | "REJECTED"

export interface CancelRequest {
  id: string
  billCode: string
  visitId: string
  code: string
  dueVnd: number
  reason: string
  requestedBy: string
  requestedAt: string
  status: CancelRequestStatus
  decidedBy?: string
  decidedAt?: string
  decisionNote?: string
}

export type PaymentAuditAction =
  | "INVOICE_ISSUED"
  | "PAID"
  | "CANCEL_REQUESTED"
  | "CANCEL_APPROVED"
  | "CANCEL_REJECTED"
  | "CANCELLED_DIRECT"

export interface PaymentAuditEntry {
  id: string
  action: PaymentAuditAction
  billCode: string
  visitId: string
  actor: string
  approver?: string
  reason?: string
  decisionNote?: string
  at: string
  device: string
}

export interface Receipt {
  billCode: string
  visitId: string
  sessionCode: string
  code: string
  tables: string[]
  clusterCode?: string
  method: PaymentMethod
  manual: boolean
  givenVnd: number
  changeVnd: number
  preRoundVnd: number
  dueVnd: number
  confirmedAt: string
  confirmedBy: string
}

export interface PaymentNotification {
  id: string
  type: PaymentNotificationType
  title: string
  text: string
  time: string
  occurredAt?: string
  visitId?: string
  billCode?: string
}

/**
 * TEMPORARY contract matching spec §4.
 * TU-45/46 wins when backend payment endpoints are implemented.
 */
export interface PaymentApi {
  listOpen(): Promise<PayBillSummary[]>
  getBill(visitId: string): Promise<PayBill>
  /** @deprecated HU-44 v1.1: use previewBill() for view-only preview or issueInvoice() to chốt bill. */
  createPrebill(visitId: string, version: number): Promise<PayBill>
  /** @deprecated HU-44 v1.1: replaced by issueInvoice(). */
  requestPayment(visitId: string): Promise<void>
  confirmCash(
    visitId: string,
    givenVnd: number,
    version: number,
    idempotencyKey: string,
    billCode?: string,
  ): Promise<Receipt>
  confirmTransfer(
    visitId: string,
    manual: boolean,
    version: number,
    idempotencyKey: string,
    billCode?: string,
  ): Promise<Receipt>
  listNotifications(): Promise<PaymentNotification[]>
  checkTransfer(visitId: string): Promise<{ found: boolean }>
  previewBill(visitId: string): Promise<PreviewBill>
  issueInvoice(visitId: string, version: number, idempotencyKey: string): Promise<PayBill>
  getSessionBills(visitId: string): Promise<SessionBills>
  requestCancel(billCode: string, reason: string): Promise<CancelRequest>
  listMyCancelRequests?(billCode?: string): Promise<CancelRequest[]>
  listCancelRequests(): Promise<CancelRequest[]>
  decideCancel(requestId: string, approve: boolean, note?: string): Promise<CancelRequest>
  cancelPaid(billCode: string, reason: string): Promise<void>
  listPaidBills?(): Promise<PaidBillSummary[]>
  listAudit(billCode?: string): Promise<PaymentAuditEntry[]>
}

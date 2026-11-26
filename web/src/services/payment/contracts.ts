/**
 * TEMPORARY PAYMENT CONTRACT (NA-45/46)
 *
 * Swap point for TU-45/46: payment screens depend ONLY on this interface and
 * these DTOs. When Tú's backend payment endpoints land, replace the adapter in
 * `web/src/services/payment/index.ts` without modifying screen components.
 *
 * Money values are always integer VND (never floating point).
 */

export type VisitPayStatus = "SERVING" | "AWAITING_PAYMENT" | "PAID" | "CLOSED_UNPAID"
export type PayLineState = "SERVED" | "MAKING" | "CANCELLED"
export type PaymentMethod = "CASH" | "TRANSFER"
export type PaymentNotificationType = "CANCELLED_ITEM" | "PAYMENT_REQUEST" | "AWAITING_PAYMENT" | "PAID"

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
  version: number
}

export interface PayBill {
  billCode: string
  visitId: string
  sessionCode: string
  code: string
  tables: string[]
  clusterCode?: string
  status: VisitPayStatus
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
  waiterName: string
  guests: number
  roundCount: number
  paidAt?: string
  paidBy?: string
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
}

/**
 * TEMPORARY contract matching spec §4.
 * TU-45/46 wins when backend payment endpoints are implemented.
 */
export interface PaymentApi {
  listOpen(): Promise<PayBillSummary[]>
  getBill(visitId: string): Promise<PayBill>
  createPrebill(visitId: string, version: number): Promise<PayBill>
  requestPayment(visitId: string): Promise<void>
  confirmCash(visitId: string, givenVnd: number, version: number, idempotencyKey: string): Promise<Receipt>
  confirmTransfer(visitId: string, manual: boolean, version: number, idempotencyKey: string): Promise<Receipt>
  listNotifications(): Promise<PaymentNotification[]>
  checkTransfer(visitId: string): Promise<{ found: boolean }>
}

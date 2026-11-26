import type { RoleCode } from "@/domain/enums"
import { isApiError, newIdempotencyKey } from "@/services"
import type { PayBill, PayBillSummary, PaymentApi, PreviewBill, SessionBills } from "@/services/payment"

/**
 * VM-03 / O3: single constant controlling whether "Xem tạm tính" shows a QR.
 * Default false ("Tạm tính – chưa phải hóa đơn"); flip to true if PO decides otherwise.
 */
export const PREVIEW_HAS_QR = false

/** VM-11: receiving bank label without account number in Sprint 5. */
export const BANK_RECEIVING_NAME = "Techcombank"

export const PROVISIONAL_LABEL = "Tạm tính – chưa phải hóa đơn"

export type WaiterBillView = "detail" | "preview" | "invoice"

const MONEY_VIEWS = new Set(["method", "cash", "qr", "success"])

export interface IssueIdempotencySlot {
  key: string
  signature: string
}

export function isWaiterBillRole(role: RoleCode): boolean {
  return role === "WAITER" || role === "BAR"
}

export function isMoneyViewParam(rawView: string | null | undefined): boolean {
  return Boolean(rawView && MONEY_VIEWS.has(rawView))
}

export function parseWaiterBillView(rawView: string | null | undefined): WaiterBillView {
  if (rawView === "preview") return "preview"
  if (rawView === "invoice") return "invoice"
  return "detail"
}

export function canIssueNewInvoice(sessionBills: SessionBills | undefined): boolean {
  if (!sessionBills) return false
  if (sessionBills.status === "PAID" || sessionBills.status === "CLOSED_UNPAID") return false
  return sessionBills.unbilledLineCount > 0
}

export function selectInvoiceBill(sessionBills: SessionBills | undefined, billCode?: string | null): PayBill | null {
  if (!sessionBills || sessionBills.bills.length === 0) return null
  if (billCode) {
    const exact = sessionBills.bills.find((b) => b.billCode === billCode)
    if (exact) return exact
  }
  const latestUnpaid = [...sessionBills.bills].reverse().find((b) => b.billStatus !== "PAID" && b.status !== "PAID")
  return latestUnpaid ?? sessionBills.bills[sessionBills.bills.length - 1] ?? null
}

export function isBarTableCode(tableCode: string): boolean {
  return /^BAR/i.test(tableCode.trim())
}

export function isBarTableItem(table: string | { code: string; zoneCode?: string | null }): boolean {
  if (typeof table === "string") return isBarTableCode(table)
  if (table.zoneCode) return table.zoneCode === "BAR"
  return isBarTableCode(table.code)
}

export function isBarGuestSession(summary: {
  code?: string | null
  tables: readonly (string | { code: string; zoneCode?: string | null })[]
}): boolean {
  return summary.tables.length > 0 && summary.tables.every(isBarTableItem)
}

export function sortBarSessionsFirst(sessions: readonly PayBillSummary[]): {
  barSessions: PayBillSummary[]
  otherSessions: PayBillSummary[]
} {
  const barSessions: PayBillSummary[] = []
  const otherSessions: PayBillSummary[] = []
  for (const s of sessions) {
    if (isBarGuestSession(s)) barSessions.push(s)
    else otherSessions.push(s)
  }
  return { barSessions, otherSessions }
}

export function toWaiterErrorMessage(err: unknown, fallback: string): string {
  if (isApiError(err)) return err.message || fallback
  if (err instanceof Error && err.message) return err.message
  return fallback
}

export function previewToBillDisplay(preview: PreviewBill, status: SessionBills["status"]): PayBill {
  const activeRounds = new Set(preview.lines.filter((l) => l.state !== "CANCELLED").map((l) => l.orderRound))
  return {
    billCode: "TẠM TÍNH",
    visitId: preview.visitId,
    sessionCode: preview.sessionCode,
    code: preview.code,
    tables: preview.tables,
    clusterCode: preview.clusterCode,
    status,
    lines: preview.lines,
    subtotalVnd: preview.subtotalVnd,
    vatVnd: preview.vatVnd,
    preRoundVnd: preview.preRoundVnd,
    roundingVnd: preview.roundingVnd,
    dueVnd: preview.dueVnd,
    vatLabel: "VAT 10%",
    version: preview.version,
    openedAt: "—",
    waiterName: "—",
    guests: 0,
    roundCount: activeRounds.size,
  }
}

export async function submitIssueInvoice(params: {
  api: Pick<PaymentApi, "issueInvoice">
  visitId: string
  version: number
  busy: boolean
  inFlightRef: { current: boolean }
  idempotencyKeyRef: { current: IssueIdempotencySlot | null }
  setBusy: (busy: boolean) => void
  invalidate: () => Promise<void>
  onNotify: (kind: "success" | "info" | "error", text: string) => void
  onIssued: (bill: PayBill) => void
}): Promise<PayBill | null> {
  const { api, visitId, version, busy, inFlightRef, idempotencyKeyRef, setBusy, invalidate, onNotify, onIssued } =
    params
  if (inFlightRef.current || busy) return null
  inFlightRef.current = true
  setBusy(true)

  const signature = `${visitId}:${version}`
  const key =
    idempotencyKeyRef.current?.signature === signature ? idempotencyKeyRef.current.key : newIdempotencyKey()
  idempotencyKeyRef.current = { key, signature }

  try {
    const issued = await api.issueInvoice(visitId, version, key)
    idempotencyKeyRef.current = null
    await invalidate()
    onNotify("success", `Đã xuất hóa đơn ${issued.billCode} cho ${issued.code}.`)
    onIssued(issued)
    return issued
  } catch (err) {
    if (isApiError(err) && err.code !== "NETWORK_ERROR" && err.status !== 0) {
      idempotencyKeyRef.current = null
      if (err.code === "VERSION_CONFLICT") {
        await invalidate()
      }
    }
    onNotify("error", toWaiterErrorMessage(err, "Không xuất được hóa đơn."))
    return null
  } finally {
    inFlightRef.current = false
    setBusy(false)
  }
}

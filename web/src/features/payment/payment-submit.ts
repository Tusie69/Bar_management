import { isApiError, newIdempotencyKey } from "@/services"
import type { PayBill, PaymentApi, PaymentMethod, Receipt } from "@/services/payment"
import type { PaymentErrorState } from "./pay-actions"

export interface IdempotencySlot {
  key: string
  signature: string
}

export function toPaymentError(err: unknown): PaymentErrorState {
  if (isApiError(err)) {
    if (err.code === "NETWORK_ERROR" || err.status === 0) {
      return { kind: "net", message: err.message }
    }
    if (err.code === "DUPLICATE_PAYMENT") {
      return {
        kind: "dup",
        message: err.message,
        confirmedBy: typeof err.details.confirmedBy === "string" ? err.details.confirmedBy : undefined,
        confirmedAt: typeof err.details.confirmedAt === "string" ? err.details.confirmedAt : undefined,
      }
    }
    if (err.code === "VERSION_CONFLICT") {
      return { kind: "conflict", message: err.message }
    }
    return { kind: "other", message: err.message }
  }
  return { kind: "other", message: err instanceof Error ? err.message : "Đã có lỗi xảy ra." }
}

/**
 * Shared synchronous-guarded confirm submitter used by PaymentFlowWorkspace
 * and covered directly by unit tests.
 */
export async function submitPaymentConfirm(params: {
  api: Pick<PaymentApi, "confirmCash" | "confirmTransfer">
  bill: PayBill | undefined
  canCollect: boolean
  method: PaymentMethod
  givenVnd?: number
  busy: boolean
  inFlightRef: { current: boolean }
  idempotencyKeyRef: { current: IdempotencySlot | null }
  setBusy: (busy: boolean) => void
  setPayError: (err: PaymentErrorState | null) => void
  setReceipt: (rc: Receipt) => void
  invalidate: () => Promise<void>
  onSuccess: (rc: Receipt) => void
}): Promise<Receipt | null> {
  const {
    api: payApi,
    bill,
    canCollect,
    method,
    givenVnd = 0,
    busy,
    inFlightRef,
    idempotencyKeyRef,
    setBusy,
    setPayError,
    setReceipt,
    invalidate,
    onSuccess,
  } = params
  // Synchronous in-flight guard prevents duplicate submissions on fast double clicks.
  if (inFlightRef.current || busy) return null
  if (!bill || bill.status === "PAID" || bill.status === "CLOSED_UNPAID" || !canCollect) return null

  inFlightRef.current = true
  setBusy(true)
  setPayError(null)
  const normalizedGiven = method === "CASH" ? givenVnd : 0
  const signature = `${bill.visitId}:${bill.billCode}:${method}:${normalizedGiven}:${bill.version}`
  const key =
    idempotencyKeyRef.current?.signature === signature ? idempotencyKeyRef.current.key : newIdempotencyKey()
  idempotencyKeyRef.current = { key, signature }

  try {
    const rc =
      method === "CASH"
        ? await payApi.confirmCash(bill.visitId, normalizedGiven, bill.version, key, bill.billCode)
        : await payApi.confirmTransfer(bill.visitId, true, bill.version, key, bill.billCode)
    idempotencyKeyRef.current = null
    setReceipt(rc)
    await invalidate()
    onSuccess(rc)
    return rc
  } catch (err) {
    const parsed = toPaymentError(err)
    setPayError(parsed)
    if (parsed.kind !== "net") {
      idempotencyKeyRef.current = null
    }
    if (parsed.kind === "dup" || parsed.kind === "conflict") {
      await invalidate()
    }
    return null
  } finally {
    inFlightRef.current = false
    setBusy(false)
  }
}

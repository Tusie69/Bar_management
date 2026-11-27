import { AlertTriangle, Check, History, RotateCcw } from "lucide-react"
import { useState } from "react"
import { isApiError } from "@/services"
import { formatVnd, paymentApi, type PaymentApi } from "@/services/payment"
import {
  formatCancelTime,
  formatPaidMethod,
  formatPaidTableLabel,
  submitDirectCancel,
  type PaidBillCandidate,
} from "./cancel-model"

export function DirectCancelPanel({
  selectedBill = null,
  paidBills = [],
  initialBillCode = "",
  api = paymentApi,
  canViewAudit = false,
  onCancelled,
  onInspectAudit,
  onClose,
}: {
  selectedBill?: PaidBillCandidate | null
  paidBills?: readonly PaidBillCandidate[]
  initialBillCode?: string
  api?: PaymentApi
  canViewAudit?: boolean
  onCancelled?: (billCode: string) => void | Promise<void>
  onInspectAudit?: (billCode: string) => void
  onClose?: () => void
}) {
  const activeBill =
    selectedBill ?? (initialBillCode ? (paidBills.find((b) => b.billCode === initialBillCode) ?? null) : null)
  const activeBillCode = activeBill?.billCode ?? initialBillCode.trim()

  const [prevBillCode, setPrevBillCode] = useState(activeBillCode)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ title: string; detail: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (activeBillCode && activeBillCode !== prevBillCode) {
    setPrevBillCode(activeBillCode)
    setReason("")
    setReasonError(null)
    setApiError(null)
    setOutcome(null)
  }

  const handleSubmit = async () => {
    const code = activeBillCode.trim()
    if (!code) {
      setReasonError("Vui lòng chọn bill đã thanh toán cần huỷ.")
      return
    }
    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      setReasonError("Vui lòng nhập lý do huỷ thanh toán.")
      return
    }
    if (submitting) return
    setSubmitting(true)
    setReasonError(null)
    setApiError(null)
    setOutcome(null)
    try {
      const nextOutcome = await submitDirectCancel(api, code, trimmedReason)
      setReason("")
      setOutcome(nextOutcome)
      await onCancelled?.(code)
    } catch (err) {
      setApiError(isApiError(err) || err instanceof Error ? err.message : "Không thể huỷ thanh toán cho bill này.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section aria-label="Huỷ thanh toán trực tiếp" className="pc-card">
      <div className="pc-card-h">
        <h2>
          Huỷ thanh toán trực tiếp
          {activeBillCode ? <span className="pc-pill pc-p-req tnum">{activeBillCode}</span> : null}
        </h2>
        <span className="pc-pill pc-p-free">Lễ tân · Admin Edit · SuperAdmin</span>
      </div>

      <div className="pc-card-b">
        {outcome ? (
          <div role="status" aria-live="polite" data-testid="pc-direct-outcome" className="pc-bn pc-bn-ok">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <b>{outcome.title}</b>
              {outcome.detail}
            </span>
          </div>
        ) : null}

        {apiError ? (
          <div role="alert" data-testid="pc-direct-error" className="pc-bn pc-bn-err">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{apiError}</span>
          </div>
        ) : null}

        {activeBill || activeBillCode ? (
          <article data-testid={`pc-direct-form-${activeBillCode}`} className="pc-item">
            <div className="pc-item-top">
              <div className="pc-item-id">
                <b>{activeBillCode}</b>
                <span className="pc-pill pc-p-ok">Đã thu</span>
                {activeBill ? <span className="pc-pill pc-p-req">{formatPaidTableLabel(activeBill)}</span> : null}
                {activeBill?.cancelPending ? <span className="pc-pill pc-p-pend">Có yêu cầu chờ duyệt</span> : null}
              </div>
              {activeBill?.dueVnd !== undefined ? <span className="pc-amt">{formatVnd(activeBill.dueVnd)}</span> : null}
            </div>

            {activeBill ? (
              <dl className="pc-meta-grid">
                <div>
                  <dt>Phương thức</dt>
                  <dd>{formatPaidMethod(activeBill.method)}</dd>
                </div>
                <div>
                  <dt>Thu lúc</dt>
                  <dd className="tnum">{formatCancelTime(activeBill.paidAt)}</dd>
                </div>
                <div>
                  <dt>Thu ngân</dt>
                  <dd>{activeBill.paidBy || "-"}</dd>
                </div>
              </dl>
            ) : null}

            <div className="grid gap-3 border-t border-border pt-3">
              <div className="pc-field">
                <label htmlFor={`pc-direct-reason-${activeBillCode}`}>Lý do huỷ thanh toán (bắt buộc)</label>
                <textarea
                  id={`pc-direct-reason-${activeBillCode}`}
                  className="pc-textarea"
                  placeholder="Ví dụ: Khách quay lại gọi thêm, thu nhầm bàn hoặc nhầm phương thức..."
                  disabled={submitting}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value)
                    if (reasonError) setReasonError(null)
                  }}
                />
              </div>

              {reasonError ? (
                <div role="alert" className="pc-bn pc-bn-err">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{reasonError}</span>
                </div>
              ) : null}

              <div className="pc-act-row">
                {canViewAudit && onInspectAudit ? (
                  <button
                    type="button"
                    onClick={() => onInspectAudit(activeBillCode)}
                    className="pc-btn pc-btn-g pc-btn-sm mr-auto"
                  >
                    <History className="size-4" aria-hidden />
                    Xem nhật ký
                  </button>
                ) : null}
                {onClose ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setReason("")
                      setReasonError(null)
                      setApiError(null)
                      onClose()
                    }}
                    className="pc-btn pc-btn-s"
                  >
                    Đóng
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                  className="pc-btn pc-btn-danger"
                >
                  <RotateCcw className="size-4" aria-hidden />
                  {submitting ? "Đang huỷ..." : "Xác nhận huỷ thanh toán"}
                </button>
              </div>
            </div>
          </article>
        ) : outcome && onClose ? (
          <div className="pc-act-row">
            <button
              type="button"
              onClick={() => {
                setOutcome(null)
                onClose()
              }}
              className="pc-btn pc-btn-s"
            >
              Đóng
            </button>
          </div>
        ) : (
          <div className="pc-empty">
            <b>Chọn một bill từ danh sách &ldquo;Bill đã thu trong ca&rdquo;</b>
            Sau khi chọn bill, nhập lý do bắt buộc để huỷ thanh toán và xem nhật ký thao tác.
          </div>
        )}
      </div>
    </section>
  )
}

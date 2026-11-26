import { AlertTriangle, Check, History, RotateCcw } from "lucide-react"
import { useState } from "react"
import { isApiError } from "@/services"
import { formatVnd, paymentApi, type PaymentApi } from "@/services/payment"
import { PAID_CANCEL_OUTCOME_TEXT, type PaidBillCandidate } from "./cancel-model"

export function DirectCancelPanel({
  paidBills,
  loading = false,
  initialBillCode = "",
  api = paymentApi,
  canViewAudit = false,
  onCancelled,
  onInspectAudit,
}: {
  paidBills: readonly PaidBillCandidate[]
  loading?: boolean
  initialBillCode?: string
  api?: PaymentApi
  canViewAudit?: boolean
  onCancelled?: (billCode: string) => void | Promise<void>
  onInspectAudit?: (billCode: string) => void
}) {
  const [selectedBillCode, setSelectedBillCode] = useState<string>(initialBillCode)
  const [manualBillCode, setManualBillCode] = useState<string>(initialBillCode)
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [outcomeBanner, setOutcomeBanner] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const activeBillCode = (selectedBillCode || manualBillCode).trim()

  const startCancelForBill = (billCode: string) => {
    setSelectedBillCode(billCode)
    setManualBillCode(billCode)
    setReason("")
    setReasonError(null)
    setApiError(null)
    setOutcomeBanner(null)
  }

  const handleSubmit = async (targetBillCode = activeBillCode) => {
    const code = targetBillCode.trim()
    if (!code) {
      setReasonError("Vui lòng chọn hoặc nhập mã bill đã thanh toán.")
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
    setOutcomeBanner(null)
    try {
      await api.cancelPaid(code, trimmedReason)
      setReason("")
      setSelectedBillCode("")
      setManualBillCode("")
      await onCancelled?.(code)
      setOutcomeBanner(`${code}: ${PAID_CANCEL_OUTCOME_TEXT}`)
    } catch (err) {
      setApiError(
        isApiError(err) || err instanceof Error
          ? err.message
          : "Không thể huỷ thanh toán cho bill này.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section aria-label="Huỷ thanh toán trực tiếp" className="pc-card">
      <div className="pc-card-h">
        <h2>
          Huỷ thanh toán trực tiếp
          <span className="pc-count tnum">{paidBills.length}</span>
        </h2>
        <span className="pc-pill pc-p-free">Lễ tân · Admin Edit · SuperAdmin</span>
      </div>

      <div className="pc-card-b">
        {outcomeBanner ? (
          <div role="status" aria-live="polite" data-testid="pc-direct-outcome" className="pc-bn pc-bn-ok">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <b>{outcomeBanner}</b>
              Bill đã mở lại để thu tiền; bàn được trả về trạng thái đang phục vụ trên sơ đồ.
            </span>
          </div>
        ) : null}

        {apiError ? (
          <div role="alert" data-testid="pc-direct-error" className="pc-bn pc-bn-err">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{apiError}</span>
          </div>
        ) : null}

        {loading && paidBills.length === 0 ? (
          <div className="pc-empty">Đang tải danh sách bill đã thanh toán trong ca...</div>
        ) : paidBills.length === 0 ? (
          <div className="pc-empty">
            <b>Chưa có bill đã thanh toán nào trong ca</b>
            Bạn vẫn có thể nhập mã bill trực tiếp bên dưới nếu cần huỷ một bill đã thu.
          </div>
        ) : (
          <div className="pc-list">
            {paidBills.map((bill) => {
              const isSelected = activeBillCode === bill.billCode
              return (
                <article
                  key={bill.billCode}
                  data-testid={`pc-paid-${bill.billCode}`}
                  className="pc-item"
                >
                  <div className="pc-item-top">
                    <div className="pc-item-id">
                      <b>{bill.billCode}</b>
                      <span className="pc-pill pc-p-ok">Đã thu</span>
                      <span className="pc-pill pc-p-req">{`Bàn ${bill.code}`}</span>
                      {bill.cancelPending ? (
                        <span className="pc-pill pc-p-pend">Có yêu cầu chờ duyệt</span>
                      ) : null}
                    </div>
                    {bill.dueVnd !== undefined ? (
                      <span className="pc-amt">{formatVnd(bill.dueVnd)}</span>
                    ) : null}
                  </div>

                  <dl className="pc-meta-grid">
                    {bill.guestName ? (
                      <div>
                        <dt>Khách</dt>
                        <dd>{bill.guestName}</dd>
                      </div>
                    ) : null}
                    {bill.paidBy ? (
                      <div>
                        <dt>Người thu</dt>
                        <dd>{bill.paidBy}</dd>
                      </div>
                    ) : null}
                    {bill.paidAt ? (
                      <div>
                        <dt>Thu lúc</dt>
                        <dd className="tnum">{bill.paidAt}</dd>
                      </div>
                    ) : null}
                  </dl>

                  <div className="pc-act-row">
                    {canViewAudit && onInspectAudit ? (
                      <button
                        type="button"
                        onClick={() => onInspectAudit(bill.billCode)}
                        className="pc-btn pc-btn-g pc-btn-sm mr-auto"
                      >
                        <History className="size-4" aria-hidden />
                        Xem nhật ký
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => startCancelForBill(bill.billCode)}
                      aria-expanded={isSelected}
                      className="pc-btn pc-btn-danger-outline"
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      Huỷ thanh toán
                    </button>
                  </div>

                  {isSelected ? (
                    <div
                      data-testid={`pc-direct-form-${bill.billCode}`}
                      className="grid gap-3 border-t border-border pt-3"
                    >
                      <div className="pc-field">
                        <label htmlFor={`pc-direct-reason-${bill.billCode}`}>
                          Lý do huỷ thanh toán (bắt buộc)
                        </label>
                        <textarea
                          id={`pc-direct-reason-${bill.billCode}`}
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
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => {
                            setSelectedBillCode("")
                            setManualBillCode("")
                            setReason("")
                            setReasonError(null)
                          }}
                          className="pc-btn pc-btn-s"
                        >
                          Đóng
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void handleSubmit(bill.billCode)}
                          className="pc-btn pc-btn-danger"
                        >
                          {submitting ? "Đang huỷ..." : "Xác nhận huỷ thanh toán"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}

        {/* Fallback manual bill code entry (e.g. Receptionist multi-bill or embedded usage) */}
        {!selectedBillCode ? (
          <div className="grid gap-3 border-t border-border pt-3">
            <div className="pc-field">
              <label htmlFor="pc-manual-bill">Hoặc nhập mã bill đã thu để huỷ nhanh</label>
              <input
                id="pc-manual-bill"
                type="text"
                className="pc-input tnum"
                placeholder="Ví dụ: B0002 hoặc B0002-2"
                disabled={submitting}
                value={manualBillCode}
                onChange={(e) => {
                  setManualBillCode(e.target.value)
                  if (reasonError) setReasonError(null)
                }}
              />
            </div>

            {manualBillCode.trim() ? (
              <>
                <div className="pc-field">
                  <label htmlFor="pc-manual-reason">Lý do huỷ thanh toán (bắt buộc)</label>
                  <textarea
                    id="pc-manual-reason"
                    className="pc-textarea"
                    placeholder="Nhập lý do huỷ thanh toán..."
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
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleSubmit(manualBillCode)}
                    className="pc-btn pc-btn-danger"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    {submitting ? "Đang huỷ..." : "Huỷ thanh toán"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

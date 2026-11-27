import { AlertTriangle, Check, Clock, History, RefreshCw, X } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { isApiError } from "@/services"
import { formatVnd, paymentApi, type CancelRequest, type PaymentApi } from "@/services/payment"
import {
  buildApproveCancelFeedback,
  formatCancelTime,
  isVisitOpenAfterCancelCheck,
  partitionCancelRequests,
  resolveCancelSessionImpact,
} from "./cancel-model"

export function CancelQueuePanel({
  requests,
  loading,
  error,
  readOnly = false,
  api = paymentApi,
  checkVisitOpen,
  onRefresh,
  onDecided,
  onInspectAudit,
}: {
  requests: readonly CancelRequest[]
  loading: boolean
  error: unknown
  readOnly?: boolean
  api?: PaymentApi
  checkVisitOpen?: (visitId: string) => Promise<boolean | null>
  onRefresh: () => void
  onDecided: (result: CancelRequest) => void | Promise<void>
  onInspectAudit?: (billCode: string) => void
}) {
  const [tab, setTab] = useState<"PENDING" | "DECIDED">("PENDING")
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "info"; text: string } | null>(null)

  const { pending, decided } = partitionCancelRequests(requests)
  const visible = tab === "PENDING" ? pending : decided

  const handleDecide = async (req: CancelRequest, approve: boolean) => {
    if (busyId || readOnly) return
    setBusyId(req.id)
    setActionError(null)
    setFeedback(null)
    try {
      const note = notes[req.id]?.trim() || undefined
      const probeOpen = checkVisitOpen ?? ((id: string) => isVisitOpenAfterCancelCheck(id, api, true))
      const wasOpenBefore = approve ? await probeOpen(req.visitId) : null
      const updated = await api.decideCancel(req.id, approve, note)
      const isOpenAfter = approve ? await probeOpen(req.visitId) : null
      const impact = approve ? resolveCancelSessionImpact(wasOpenBefore, isOpenAfter) : "UNKNOWN"
      setNotes((prev) => {
        const next = { ...prev }
        delete next[req.id]
        return next
      })
      await onDecided(updated)
      setFeedback(
        approve
          ? {
              kind: "ok",
              text: buildApproveCancelFeedback(req.billCode, req.code, impact),
            }
          : {
              kind: "info",
              text: `Đã từ chối yêu cầu huỷ ${req.billCode} (${req.code}) - giữ Đã thanh toán. Đã thông báo Thu ngân.`,
            },
      )
    } catch (err) {
      setActionError(
        isApiError(err) || err instanceof Error ? err.message : "Không xử lý được yêu cầu huỷ.",
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-label="Hàng chờ duyệt huỷ thanh toán" className="pc-card">
      <div className="pc-card-h">
        <h2>
          Hàng chờ duyệt huỷ
          <span className={cn("pc-count tnum", pending.length > 0 && "pc-count-hot")}>{pending.length}</span>
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Lọc trạng thái yêu cầu huỷ" className="pc-seg">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "PENDING"}
              aria-pressed={tab === "PENDING"}
              onClick={() => setTab("PENDING")}
            >
              {`Chờ duyệt (${pending.length})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "DECIDED"}
              aria-pressed={tab === "DECIDED"}
              onClick={() => setTab("DECIDED")}
            >
              {`Đã xử lý (${decided.length})`}
            </button>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Làm mới hàng chờ duyệt huỷ"
            className="pc-btn pc-btn-s pc-btn-sm"
          >
            <RefreshCw className="size-4" aria-hidden />
            Làm mới
          </button>
        </div>
      </div>

      <div className="pc-card-b">
        {readOnly ? (
          <div role="status" className="pc-bn pc-bn-info">
            <span>
              <b>Chế độ chỉ xem</b>
              Tài khoản Admin Read-Only chỉ xem hàng chờ, không duyệt hoặc từ chối.
            </span>
          </div>
        ) : null}

        {feedback ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="pc-queue-feedback"
            className={cn("pc-bn", feedback.kind === "ok" ? "pc-bn-ok" : "pc-bn-info")}
          >
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{feedback.text}</span>
          </div>
        ) : null}

        {actionError ? (
          <div role="alert" data-testid="pc-queue-error" className="pc-bn pc-bn-err">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{actionError}</span>
          </div>
        ) : null}

        {loading && requests.length === 0 ? (
          <div className="pc-empty">Đang tải hàng chờ duyệt huỷ thanh toán...</div>
        ) : error ? (
          <div role="alert" className="pc-bn pc-bn-err">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <b>Không tải được hàng chờ duyệt huỷ</b>
              {isApiError(error) || error instanceof Error ? error.message : "Vui lòng thử lại."}
            </span>
          </div>
        ) : visible.length === 0 ? (
          <div className="pc-empty">
            <b>
              {tab === "PENDING"
                ? "Chưa có yêu cầu huỷ nào đang chờ duyệt"
                : "Chưa có yêu cầu huỷ nào đã xử lý"}
            </b>
            {tab === "PENDING"
              ? "Khi Thu ngân gửi yêu cầu huỷ từ bill đã thanh toán, yêu cầu sẽ tự động hiện tại đây."
              : "Lịch sử các yêu cầu đã duyệt hoặc từ chối sẽ hiện ở đây."}
          </div>
        ) : (
          <div className="pc-list">
            {visible.map((req) => {
              const isPending = req.status === "PENDING"
              const isBusy = busyId === req.id
              const noteId = `pc-note-${req.id}`
              return (
                <article
                  key={req.id}
                  data-testid={`pc-req-${req.id}`}
                  className={cn("pc-item", isPending && "pc-item-pend")}
                >
                  <div className="pc-item-top">
                    <div className="pc-item-id">
                      <b>{req.billCode}</b>
                      <span className="pc-pill pc-p-req">{`Bàn ${req.code}`}</span>
                      {req.status === "PENDING" ? (
                        <span className="pc-pill pc-p-pend">
                          <Clock className="size-3.5" aria-hidden />
                          PENDING
                        </span>
                      ) : req.status === "APPROVED" ? (
                        <span className="pc-pill pc-p-ok">
                          <Check className="size-3.5" aria-hidden />
                          Đã duyệt
                        </span>
                      ) : (
                        <span className="pc-pill pc-p-err">
                          <X className="size-3.5" aria-hidden />
                          Từ chối
                        </span>
                      )}
                    </div>
                    <span className="pc-amt">{formatVnd(req.dueVnd)}</span>
                  </div>

                  <dl className="pc-meta-grid">
                    <div>
                      <dt>Lý do yêu cầu</dt>
                      <dd>{req.reason}</dd>
                    </div>
                    <div>
                      <dt>Người yêu cầu</dt>
                      <dd>{req.requestedBy}</dd>
                    </div>
                    <div>
                      <dt>Thời gian</dt>
                      <dd className="tnum">{formatCancelTime(req.requestedAt)}</dd>
                    </div>
                    {!isPending && req.decidedBy ? (
                      <div>
                        <dt>Người xử lý</dt>
                        <dd>{`${req.decidedBy} (${formatCancelTime(req.decidedAt)})`}</dd>
                      </div>
                    ) : null}
                    {!isPending && req.decisionNote ? (
                      <div>
                        <dt>Ghi chú quyết định</dt>
                        <dd>{req.decisionNote}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {isPending ? (
                    <>
                      <div className="pc-field">
                        <label htmlFor={noteId}>Ghi chú phản hồi (tuỳ chọn)</label>
                        <input
                          id={noteId}
                          type="text"
                          className="pc-input"
                          placeholder="Ví dụ: Đã đối soát, cho phép thu lại bằng QR..."
                          disabled={isBusy || readOnly}
                          value={notes[req.id] ?? ""}
                          onChange={(e) => setNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        />
                      </div>
                      <div className="pc-act-row">
                        {onInspectAudit ? (
                          <button
                            type="button"
                            onClick={() => onInspectAudit(req.billCode)}
                            className="pc-btn pc-btn-g pc-btn-sm mr-auto"
                          >
                            <History className="size-4" aria-hidden />
                            Xem nhật ký
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={isBusy || readOnly}
                          onClick={() => void handleDecide(req, false)}
                          className="pc-btn pc-btn-s"
                        >
                          <X className="size-4" aria-hidden />
                          Từ chối
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || readOnly}
                          onClick={() => void handleDecide(req, true)}
                          className="pc-btn pc-btn-ok"
                        >
                          <Check className="size-4" aria-hidden />
                          {isBusy ? "Đang xử lý..." : "Duyệt huỷ"}
                        </button>
                      </div>
                    </>
                  ) : onInspectAudit ? (
                    <div className="pc-act-row">
                      <button
                        type="button"
                        onClick={() => onInspectAudit(req.billCode)}
                        className="pc-btn pc-btn-g pc-btn-sm"
                      >
                        <History className="size-4" aria-hidden />
                        Xem nhật ký
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

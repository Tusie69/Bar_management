import { AlertTriangle, History, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { isApiError } from "@/services"
import type { PaymentAuditEntry } from "@/services/payment"
import { AUDIT_ACTION_META, formatCancelTime } from "./cancel-model"

const TONE_CLASS = {
  req: "pc-p-req",
  ok: "pc-p-ok",
  err: "pc-p-err",
  pend: "pc-p-pend",
  free: "pc-p-free",
} as const

export function AuditPanel({
  entries,
  selectedBillCode,
  knownBillCodes,
  loading = false,
  error = null,
  onSelectBillCode,
  onRefresh,
}: {
  entries: readonly PaymentAuditEntry[]
  selectedBillCode: string
  knownBillCodes: readonly string[]
  loading?: boolean
  error?: unknown
  onSelectBillCode: (billCode: string) => void
  onRefresh: () => void
}) {
  return (
    <section aria-label="Nhật ký thanh toán và huỷ theo bill" className="pc-card">
      <div className="pc-card-h">
        <h2>
          <History className="size-4" aria-hidden />
          Nhật ký theo bill
          <span className="pc-count tnum">{entries.length}</span>
        </h2>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Làm mới nhật ký"
          className="pc-btn pc-btn-s pc-btn-sm"
        >
          <RefreshCw className="size-4" aria-hidden />
          Làm mới
        </button>
      </div>

      <div className="pc-card-b">
        <div className="pc-input-row">
          <div className="pc-field min-w-0 flex-1">
            <label htmlFor="pc-audit-bill-filter">Lọc theo mã bill</label>
            <input
              id="pc-audit-bill-filter"
              type="text"
              className="pc-input tnum"
              list="pc-audit-bill-options"
              placeholder="Tất cả bill (hoặc nhập mã bill, VD: B0002)"
              value={selectedBillCode}
              onChange={(e) => onSelectBillCode(e.target.value)}
            />
            <datalist id="pc-audit-bill-options">
              {knownBillCodes.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
          </div>
          {selectedBillCode ? (
            <button
              type="button"
              onClick={() => onSelectBillCode("")}
              className="pc-btn pc-btn-s pc-btn-sm self-end"
            >
              Xem tất cả
            </button>
          ) : null}
        </div>

        {error ? (
          <div role="alert" className="pc-bn pc-bn-err">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <b>Không tải được nhật ký bill</b>
              {isApiError(error) || error instanceof Error ? error.message : "Vui lòng thử lại."}
            </span>
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="pc-empty">Đang tải nhật ký thao tác...</div>
        ) : entries.length === 0 ? (
          <div className="pc-empty">
            <b>
              {selectedBillCode
                ? `Chưa có nhật ký nào cho ${selectedBillCode}`
                : "Chưa có nhật ký thu tiền hoặc huỷ bill nào"}
            </b>
            Mọi thao tác xuất hóa đơn, thu tiền, gửi yêu cầu huỷ, duyệt/từ chối và huỷ trực tiếp đều được lưu vết
            tại đây.
          </div>
        ) : (
          <ol className="pc-audit-list">
            {entries.map((entry) => {
              const meta = AUDIT_ACTION_META[entry.action]
              const approverOrActor =
                entry.approver ?? (entry.action === "CANCELLED_DIRECT" ? entry.actor : undefined)
              return (
                <li key={entry.id} data-testid={`pc-audit-${entry.id}`} className="pc-audit-item">
                  <div className="pc-audit-head">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("pc-pill", TONE_CLASS[meta.tone])}>{meta.label}</span>
                      <button
                        type="button"
                        onClick={() => onSelectBillCode(entry.billCode)}
                        className="pc-audit-bill tnum"
                        title={`Lọc nhật ký theo ${entry.billCode}`}
                      >
                        {entry.billCode}
                      </button>
                    </div>
                    <time className="tnum text-xs text-[var(--text-muted)]">
                      {formatCancelTime(entry.at)}
                    </time>
                  </div>

                  <dl className="pc-meta-grid">
                    <div>
                      <dt>Người yêu cầu / thực hiện</dt>
                      <dd>{entry.actor}</dd>
                    </div>
                    {approverOrActor ? (
                      <div>
                        <dt>Người duyệt / huỷ</dt>
                        <dd>{approverOrActor}</dd>
                      </div>
                    ) : null}
                    {entry.reason ? (
                      <div>
                        <dt>Lý do</dt>
                        <dd>{entry.reason}</dd>
                      </div>
                    ) : null}
                    {entry.decisionNote ? (
                      <div>
                        <dt>Ghi chú quyết định</dt>
                        <dd>{entry.decisionNote}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Thiết bị</dt>
                      <dd>{entry.device || "-"}</dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}

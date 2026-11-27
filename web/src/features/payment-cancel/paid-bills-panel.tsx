import { RefreshCw, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { isApiError } from "@/services"
import { formatVnd } from "@/services/payment"
import {
  filterPaidBills,
  formatCancelTime,
  formatPaidMethod,
  formatPaidTableLabel,
  sortPaidBillsNewestFirst,
  type PaidBillCandidate,
} from "./cancel-model"

export function PaidBillsPanel({
  paidBills,
  selectedBillCode,
  loading = false,
  error = null,
  onSelect,
  onRefresh,
}: {
  paidBills: readonly PaidBillCandidate[]
  selectedBillCode: string
  loading?: boolean
  error?: unknown
  onSelect: (billCode: string) => void
  onRefresh?: () => void
}) {
  const [search, setSearch] = useState("")

  const sortedBills = useMemo(() => sortPaidBillsNewestFirst(paidBills), [paidBills])
  const visibleBills = useMemo(() => filterPaidBills(sortedBills, search), [search, sortedBills])

  return (
    <section aria-label="Bill đã thu trong ca" className="pc-card">
      <div className="pc-card-h">
        <h2>
          Bill đã thu trong ca
          <span className="pc-count tnum">{sortedBills.length}</span>
        </h2>

        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Làm mới danh sách bill đã thu"
            className="pc-btn pc-btn-s pc-btn-sm"
          >
            <RefreshCw className="size-4" aria-hidden />
            Làm mới
          </button>
        ) : null}
      </div>

      <div className="pc-card-b">
        <div className="pc-field">
          <label htmlFor="pc-paid-search">Tìm theo mã bill hoặc bàn</label>
          <div className="pc-search-wrap">
            <Search className="pc-search-ico size-4" aria-hidden />
            <input
              id="pc-paid-search"
              type="search"
              className="pc-input pc-input-search"
              placeholder="Nhập mã bill, bàn hoặc cụm (VD: B0002, A2, G02)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {error ? (
          <div role="alert" className="pc-bn pc-bn-err">
            <span>
              <b>Không tải được danh sách bill đã thu</b>
              {isApiError(error) || error instanceof Error ? error.message : "Vui lòng thử lại."}
            </span>
          </div>
        ) : loading && sortedBills.length === 0 ? (
          <div className="pc-empty">Đang tải danh sách bill đã thu trong ca...</div>
        ) : sortedBills.length === 0 ? (
          <div className="pc-empty">
            <b>Chưa có bill đã thu nào trong ca</b>
            Khi Thu ngân hoàn tất thu tiền, bill sẽ hiển thị tại đây theo thứ tự mới nhất trước.
          </div>
        ) : visibleBills.length === 0 ? (
          <div className="pc-empty">
            <b>Không tìm thấy bill phù hợp</b>
            Thử xoá từ khoá hoặc nhập mã bill / mã bàn khác.
          </div>
        ) : (
          <div className="pc-list">
            {visibleBills.map((bill) => {
              const isSelected = selectedBillCode === bill.billCode
              return (
                <article
                  key={bill.billCode}
                  data-testid={`pc-paid-${bill.billCode}`}
                  className={cn("pc-item", isSelected && "pc-item-selected")}
                >
                  <div className="pc-item-top">
                    <div className="pc-item-id">
                      <b>{bill.billCode}</b>
                      <span className="pc-pill pc-p-ok">Đã thu</span>
                      <span className="pc-pill pc-p-req">{formatPaidTableLabel(bill)}</span>
                      {bill.cancelPending ? (
                        <span className="pc-pill pc-p-pend">Có yêu cầu chờ duyệt</span>
                      ) : null}
                    </div>
                    <span className="pc-amt">
                      {bill.dueVnd !== undefined ? formatVnd(bill.dueVnd) : "-"}
                    </span>
                  </div>

                  <dl className="pc-meta-grid">
                    <div>
                      <dt>Phương thức</dt>
                      <dd>{formatPaidMethod(bill.method)}</dd>
                    </div>
                    <div>
                      <dt>Thu lúc</dt>
                      <dd className="tnum">{formatCancelTime(bill.paidAt)}</dd>
                    </div>
                    <div>
                      <dt>Thu ngân</dt>
                      <dd>{bill.paidBy || "-"}</dd>
                    </div>
                    {bill.guestName ? (
                      <div>
                        <dt>Khách</dt>
                        <dd>{bill.guestName}</dd>
                      </div>
                    ) : null}
                  </dl>

                  <div className="pc-act-row">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelect(bill.billCode)}
                      className={cn(
                        "pc-btn pc-btn-sm",
                        isSelected ? "pc-btn-p" : "pc-btn-danger-outline",
                      )}
                    >
                      {isSelected ? "Đang chọn" : "Chọn huỷ thanh toán"}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

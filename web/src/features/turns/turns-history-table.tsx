import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Layers, X } from "lucide-react"
import type { TableTurnsResult } from "@/domain/models"
import { fmtBusinessDate, fmtDayMonth } from "@/lib/time"
import {
  formatEndReason,
  formatScopeLabel,
  formatStaffName,
  formatTimeRange,
  formatTurnCode,
  formatTurnSource,
  isTurnOpen,
  maskPhoneNumbersInText,
  resolveStaffIdentity,
  type ExtendedTableTurnView,
} from "./turns-helpers"

interface TurnsHistoryTableProps {
  result: TableTurnsResult | undefined
  rangeCaption: string
  isMultiDay: boolean
  isFetching: boolean
  includeUncounted: boolean
  selectedStaffId: number | undefined
  selectedStaffLabel: string | null
  onClearStaff: () => void
  onPageChange: (nextPage: number) => void
}

function isAnonymousGuestName(name: string): boolean {
  const normalized = name.trim()
  return normalized === "" || normalized === "Khách" || normalized.startsWith("Khách Walk-in")
}

/**
 * Renders multi-table cluster strings (`A + B + C`) so wrapping only happens
 * after a ` + ` separator, never mid-code or leaving `+` orphaned on its own line.
 */
function renderScopeLabel(scopeLabel: string) {
  if (!scopeLabel.includes(" + ")) return scopeLabel
  const codes = scopeLabel.split(" + ")
  return codes.map((code, index) => (
    <Fragment key={`${index}-${code}`}>
      <span className="whitespace-nowrap">{index < codes.length - 1 ? `${code} +` : code}</span>
      {index < codes.length - 1 ? " " : null}
    </Fragment>
  ))
}

/**
 * Paginated turn ledger table ("Sổ lượt - <range caption>") driven by `useTableTurns`.
 * Matches the Figma column order, adding "NGÀY CA" only on multi-day ranges and keeping
 * "NGƯỜI CHECK-IN" as the rightmost column.
 */
export function TurnsHistoryTable({
  result,
  rangeCaption,
  isMultiDay,
  isFetching,
  includeUncounted,
  selectedStaffId,
  selectedStaffLabel,
  onClearStaff,
  onPageChange,
}: TurnsHistoryTableProps) {
  const turns = result?.turns ?? []
  const page = result?.page ?? 1
  const pageSize = result?.pageSize ?? 20
  const total = result?.total ?? 0
  const completedTotal = result?.completedTotal ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const startRow = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endRow = total === 0 ? 0 : Math.min(page * pageSize, total)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollState, setScrollState] = useState({ left: false, right: false })

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nextLeft = el.scrollLeft > 2
    const nextRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setScrollState((prev) =>
      prev.left === nextLeft && prev.right === nextRight
        ? prev
        : { left: nextLeft, right: nextRight },
    )
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollState()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateScrollState, turns.length, page, isMultiDay])

  return (
    <section
      className="turns-card"
      aria-labelledby="turns-history-heading"
      data-testid="turns-history-card"
    >
      <div className="turns-card-header">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="turns-history-heading" className="turns-card-title">
              {`Sổ lượt - ${rangeCaption}`}
            </h2>
            {isFetching ? (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: "var(--turns-sunken)",
                  color: "var(--turns-muted)",
                }}
              >
                Đang cập nhật…
              </span>
            ) : null}
          </div>
          <p className="turns-card-subtitle">Mỗi lần khách ngồi bàn là một bản ghi</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {includeUncounted && result ? (
            <span
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{
                backgroundColor: "var(--turns-sunken)",
                color: "var(--turns-muted)",
              }}
              data-testid="turns-history-count-meta"
            >
              {completedTotal} tính chỉ số · {total} bản ghi
            </span>
          ) : null}

          {selectedStaffId !== undefined ? (
            <button
              type="button"
              onClick={onClearStaff}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium"
              style={{
                borderColor: "var(--turns-blue)",
                backgroundColor: "var(--turns-tint-blue)",
                color: "var(--turns-blue-ink)",
              }}
              data-testid="turns-active-staff-chip"
            >
              <span>Người check-in: {selectedStaffLabel ?? `#${selectedStaffId}`}</span>
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {turns.length === 0 ? (
        <div
          className="grid place-items-center gap-3 px-6 py-12 text-center"
          data-testid="turns-history-empty"
        >
          <p className="text-base font-medium" style={{ color: "var(--turns-text)" }}>
            Chưa có lượt nào trong khoảng này
          </p>
          <p className="max-w-md text-sm" style={{ color: "var(--turns-muted)" }}>
            {selectedStaffId !== undefined
              ? "Nhân sự đang chọn chưa có lượt check-in nào trong khoảng thời gian này."
              : includeUncounted
                ? "Không có lượt phục vụ hoặc lượt không tính nào trong khoảng ngày kinh doanh đã chọn."
                : "Thử chọn khoảng ngày khác hoặc bật “Hiện lượt không tính” nếu muốn kiểm tra bản ghi đóng ca / nhập nhầm."}
          </p>
          {selectedStaffId !== undefined ? (
            <button
              type="button"
              onClick={onClearStaff}
              className="turns-pill-btn"
              data-testid="turns-empty-clear-staff"
            >
              Xóa lọc nhân viên
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div
            className="turns-table-scroll-wrap"
            data-scroll-left={scrollState.left ? "true" : "false"}
            data-scroll-right={scrollState.right ? "true" : "false"}
            data-testid="turns-history-scroll-wrap"
          >
            <div
              ref={scrollRef}
              onScroll={updateScrollState}
              className="turns-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Bảng sổ lượt tới quán"
            >
              <table className="turns-table turns-history-table" data-testid="turns-history-table">
                <thead>
                  <tr>
                    <th scope="col" className="turns-sticky-col turns-history-code-col">
                      Mã lượt
                    </th>
                    {isMultiDay ? (
                      <th scope="col" className="turns-history-date-col">
                        Ngày ca
                      </th>
                    ) : null}
                    <th scope="col" className="turns-history-time-col">
                      Tới → về
                    </th>
                    <th scope="col" className="turns-history-scope-col">
                      Bàn
                    </th>
                    <th scope="col" className="turns-history-pax-col text-right">
                      Pax
                    </th>
                    <th scope="col" className="turns-history-guest-col">
                      Khách hàng
                    </th>
                    <th scope="col" className="turns-history-source-col">
                      Nguồn
                    </th>
                    <th scope="col" className="turns-history-end-col">
                      Kết thúc
                    </th>
                    <th scope="col" className="turns-history-staff-col">
                      Người check-in
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(turns as ExtendedTableTurnView[]).map((row) => {
                    const scopeLabel = formatScopeLabel(row)
                    const open = isTurnOpen(row)
                    const reason = formatEndReason(row.endReason, row.status ?? (open ? "OPEN" : "CLOSED"))
                    const isUncountedRow = !row.counted || reason.isUncounted
                    const isEntryError = row.endReason === "ENTRY_ERROR"
                    const isSystemEnd = row.endReason === "BUSINESS_DAY_END"
                    const { userId: staffUserId, displayName: staffDisplayName } = resolveStaffIdentity(row)
                    const staffName = formatStaffName(staffUserId, staffDisplayName)
                    const safeGuestName = maskPhoneNumbersInText(row.guestName)
                    const anonymousGuest = isAnonymousGuestName(safeGuestName)

                    const rowClass = isEntryError
                      ? "turns-row-error"
                      : isUncountedRow
                        ? "turns-row-uncounted"
                        : undefined

                    return (
                      <tr
                        key={row.visitId}
                        className={rowClass}
                        data-visit-id={row.visitId}
                        data-turn-id={row.turnId ?? undefined}
                        data-status={open ? "OPEN" : "CLOSED"}
                        data-counted={row.counted ? "true" : "false"}
                      >
                        <td className="turns-sticky-col turns-history-code-col font-medium whitespace-nowrap">
                          {formatTurnCode(row.visitId)}
                        </td>
                        {isMultiDay ? (
                          <td
                            className="turns-history-date-col whitespace-nowrap"
                            style={{ color: "var(--turns-muted)" }}
                            title={fmtBusinessDate(row.businessDate, "long")}
                          >
                            {fmtDayMonth(row.businessDate)}
                          </td>
                        ) : null}
                        <td
                          className="turns-history-time-col whitespace-nowrap"
                          style={{ color: "var(--turns-text)" }}
                        >
                          {formatTimeRange(
                            row.seatedAt,
                            row.releasedAt,
                            row.status ?? (open ? "OPEN" : "CLOSED"),
                          )}
                        </td>
                        <td className="turns-history-scope-col">
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <span className="font-medium" style={{ color: "var(--turns-text)" }}>
                              {renderScopeLabel(scopeLabel)}
                            </span>
                            {row.scope === "GROUP" ? (
                              <span className="turns-badge turns-badge-group" title="Cụm bàn ghép">
                                <Layers className="size-3" aria-hidden="true" />
                                Cụm
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="turns-history-pax-col text-right font-medium whitespace-nowrap">
                          {row.guestCount}
                        </td>
                        <td className="turns-history-guest-col">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              style={{
                                color: anonymousGuest ? "var(--turns-muted)" : "var(--turns-text)",
                              }}
                            >
                              {safeGuestName || "—"}
                            </span>
                            {isUncountedRow ? (
                              <span
                                className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-4 font-semibold"
                                style={{
                                  backgroundColor: "var(--turns-sunken)",
                                  color: "var(--turns-muted)",
                                }}
                                data-testid="turns-uncounted-mark"
                              >
                                Không tính
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="turns-history-source-col" style={{ color: "var(--turns-text)" }}>
                          <span className="turns-cell-wrap">
                            {formatTurnSource(row.sourceCode, row.origin)}
                          </span>
                        </td>
                        <td className="turns-history-end-col">
                          <span
                            className="turns-cell-wrap"
                            data-testid={reason.isOpen ? "turns-open-chip" : undefined}
                            style={{
                              color: isEntryError
                                ? "var(--turns-red-ink)"
                                : isSystemEnd || isUncountedRow
                                  ? "var(--turns-amber-ink)"
                                  : "var(--turns-text)",
                            }}
                          >
                            {reason.label}
                          </span>
                        </td>
                        <td
                          className="turns-history-staff-col"
                          style={{
                            color: staffUserId === null ? "var(--turns-muted)" : "var(--turns-text)",
                          }}
                        >
                          <span className="turns-staff-name" title={staffName}>
                            {staffName}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="turns-pagination" data-testid="turns-pagination">
            <span className="text-xs font-medium" style={{ color: "var(--turns-muted)" }}>
              Hiển thị {startRow}-{endRow} / {total} bản ghi · Trang {page} / {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="turns-page-btn"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                aria-label="Trang trước"
                data-testid="turns-page-prev"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Trước
              </button>
              <button
                type="button"
                className="turns-page-btn"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                aria-label="Trang sau"
                data-testid="turns-page-next"
              >
                Sau
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

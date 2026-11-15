import { vi } from "date-fns/locale"
import { AlertTriangle, CalendarDays, Inbox, Lock, RotateCcw } from "lucide-react"
import { useMemo, useState } from "react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import type { TableTurnQuery, TableTurnsParams } from "@/domain/models"
import { useBusinessDate, useTableTurnSummary, useTableTurns } from "@/hooks/use-data"
import { fmtBusinessDate, fromLocalDate, toLocalDate, type BusinessDate } from "@/lib/time"
import { api, isApiError } from "@/services"
import { useCan, useSession } from "@/state/session"
import { TurnsDailyChart } from "./turns-daily-chart"
import {
  buildListParams,
  buildSummaryQuery,
  fillBusinessDateSeries,
  formatRangeCaption,
  formatStaffName,
  getSummaryUncountedTotal,
  hasCheckedInByStaffField,
  resolveStaffIdentity,
  resolveTurnDateRange,
  type TurnRangePreset,
} from "./turns-helpers"
import { TurnsHistoryTable } from "./turns-history-table"
import { TurnsRadioGroup, type TurnsRadioOption } from "./turns-radio-group"
import { StaffBreakdownCard, TopScopesCard } from "./turns-side-cards"
import "./turns.css"

const RANGE_PRESET_OPTIONS: readonly TurnsRadioOption<Exclude<TurnRangePreset, "date">>[] = [
  { id: "today", label: "Ca hôm nay", testId: "turns-range-today" },
  { id: "week", label: "Tuần này", testId: "turns-range-week" },
  { id: "7days", label: "7 ngày", testId: "turns-range-7days" },
]

const DEFAULT_PAGE_SIZE = 20

function useCanReadTurnLedger(): boolean {
  const canFromRole = useCan("report.read")
  const hasPrincipal = useSession((state) => state.principal !== null)
  const hasServerPermission = useSession((state) => state.permissions.includes("report.read"))
  if (api.mode === "http" || hasPrincipal) {
    return hasServerPermission
  }
  return canFromRole
}

function isForbiddenError(error: unknown): boolean {
  return isApiError(error) && (error.status === 403 || error.code === "PERMISSION_DENIED")
}

function TurnsLoadingSkeleton({ showUncounted }: { showUncounted: boolean }) {
  return (
    <div
      className="grid gap-5"
      role="status"
      aria-live="polite"
      aria-label="Đang tải sổ lượt tới quán"
      data-testid="turns-loading-skeleton"
    >
      <div className="turns-metrics-grid">
        <div className="turns-card turns-metric-card">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-1 h-9 w-20" />
          <Skeleton className="h-3.5 w-40" />
        </div>
        <div className="turns-card turns-metric-card">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-1 h-9 w-20" />
          <Skeleton className="h-3.5 w-36" />
        </div>
        {showUncounted ? (
          <div className="turns-card turns-metric-card">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1 h-9 w-16" />
            <Skeleton className="h-3.5 w-44" />
          </div>
        ) : null}
      </div>

      <div className="turns-main-grid">
        <div className="turns-card p-5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-4 w-64" />
          <div className="mt-5 grid gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
        <div className="turns-side-stack">
          <div className="turns-card p-5">
            <Skeleton className="h-6 w-36" />
            <div className="mt-4 grid gap-2.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <div className="turns-card p-5">
            <Skeleton className="h-6 w-44" />
            <div className="mt-4 grid gap-2.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export interface TurnLedgerPageProps {
  /** Optional initial range preset (defaults to `"today"`). */
  initialPreset?: TurnRangePreset
}

/**
 * Sổ lượt tới quán (/admin/turns) - Sprint 4 NA-34.
 * Renders inside `AdminShell`'s main content area without duplicating sidebar/header chrome.
 */
export function TurnLedgerPage({ initialPreset = "today" }: TurnLedgerPageProps) {
  const canRead = useCanReadTurnLedger()
  const currentBusinessDate = useBusinessDate()

  const [preset, setPreset] = useState<TurnRangePreset>(initialPreset)
  const [pickedDate, setPickedDate] = useState<BusinessDate>(currentBusinessDate)
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const [includeUncounted, setIncludeUncounted] = useState(false)
  const [selectedStaffId, setSelectedStaffId] = useState<number | undefined>(undefined)
  const [page, setPage] = useState(1)

  const { from, to } = useMemo(
    () => resolveTurnDateRange(preset, currentBusinessDate, pickedDate),
    [preset, currentBusinessDate, pickedDate],
  )

  const summaryParams = useMemo<TableTurnQuery>(
    () => buildSummaryQuery(from, to, includeUncounted),
    [from, to, includeUncounted],
  )

  const summaryQuery = useTableTurnSummary(summaryParams, canRead)
  const summary = summaryQuery.data

  const staffFilterField = hasCheckedInByStaffField(summary)
    ? "checkedInByUserId"
    : "closedByUserId"

  const listParams = useMemo<TableTurnsParams>(
    () =>
      buildListParams(
        from,
        to,
        includeUncounted,
        selectedStaffId,
        page,
        DEFAULT_PAGE_SIZE,
        staffFilterField,
      ),
    [from, to, includeUncounted, selectedStaffId, page, staffFilterField],
  )

  const turnsQuery = useTableTurns(listParams, canRead)
  const turnsData = turnsQuery.data

  const dailySeries = useMemo(
    () => (from !== to && summary ? fillBusinessDateSeries(from, to, summary.byBusinessDate) : []),
    [from, to, summary],
  )

  const selectedStaffLabel = useMemo(() => {
    if (selectedStaffId === undefined || !summary) return null
    const match = summary.byStaff.find((row) => resolveStaffIdentity(row).userId === selectedStaffId)
    if (!match) return null
    const { userId, displayName } = resolveStaffIdentity(match)
    return formatStaffName(userId, displayName)
  }, [selectedStaffId, summary])

  const forbidden =
    !canRead || isForbiddenError(summaryQuery.error) || isForbiddenError(turnsQuery.error)

  if (forbidden) {
    return (
      <div className="turns-page" data-testid="turns-forbidden-state">
        <section
          className="turns-card p-8"
          role="alert"
          aria-labelledby="turns-forbidden-heading"
        >
          <div className="flex items-start gap-4">
            <div
              className="flex size-11 shrink-0 items-center justify-center rounded-lg"
              style={{
                backgroundColor: "var(--turns-tint-red)",
                color: "var(--turns-red-ink)",
              }}
            >
              <Lock className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="turns-badge turns-badge-entry-error">
                403 · Thiếu quyền report.read
              </span>
              <h2 id="turns-forbidden-heading" className="turns-card-title mt-3">
                Không có quyền xem Sổ lượt tới quán
              </h2>
              <p className="mt-1.5 text-sm leading-6" style={{ color: "var(--turns-muted)" }}>
                Tài khoản hiện tại không có quyền <code>report.read</code> để truy cập dữ liệu sổ
                lượt tới quán. Vui lòng liên hệ Chủ quán để được cấp quyền phù hợp.
              </p>
            </div>
          </div>
        </section>
      </div>
    )
  }

  const isInitialLoading = (summaryQuery.isPending && !summary) || (turnsQuery.isPending && !turnsData)
  const fatalError =
    (summaryQuery.isError && !summary ? summaryQuery.error : null) ??
    (turnsQuery.isError && !turnsData ? turnsQuery.error : null)
  const backgroundError =
    !fatalError && (summaryQuery.isError || turnsQuery.isError)
      ? summaryQuery.error ?? turnsQuery.error
      : null

  const handleSelectPreset = (nextPreset: Exclude<TurnRangePreset, "date">) => {
    setPreset(nextPreset)
    setSelectedStaffId(undefined)
    setPage(1)
  }

  const handlePickDate = (date: Date | undefined) => {
    if (!date) return
    setPickedDate(fromLocalDate(date))
    setPreset("date")
    setSelectedStaffId(undefined)
    setPage(1)
    setDatePopoverOpen(false)
  }

  const handleToggleUncounted = () => {
    setIncludeUncounted((prev) => !prev)
    setPage(1)
  }

  const handleSelectStaff = (staffId: number | undefined) => {
    setSelectedStaffId(staffId)
    setPage(1)
  }

  const handleRetry = () => {
    void summaryQuery.refetch()
    void turnsQuery.refetch()
  }

  const uncountedTotal = summary ? getSummaryUncountedTotal(summary) : 0
  const isRangeEmpty =
    summary !== undefined &&
    summary.completedTotal === 0 &&
    summary.byBusinessDate.length === 0 &&
    (turnsData?.total ?? 0) === 0

  return (
    <div className="turns-page" data-testid="turn-ledger-page">
      {/* Filter Toolbar */}
      <div className="turns-toolbar" data-testid="turns-filter-bar">
        <div className="turns-filter-pills">
          <TurnsRadioGroup
            ariaLabel="Khoảng ngày kinh doanh"
            options={RANGE_PRESET_OPTIONS}
            value={preset === "date" ? undefined : preset}
            onValueChange={handleSelectPreset}
            className="flex flex-wrap items-center gap-2"
            itemClassName="turns-pill-btn"
          />

          <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="turns-pill-btn"
                data-active={preset === "date" ? "true" : "false"}
                aria-label="Chọn một ngày kinh doanh cụ thể"
                data-testid="turns-date-picker-trigger"
              >
                <CalendarDays className="size-4" aria-hidden="true" />
                {preset === "date"
                  ? `${fmtBusinessDate(pickedDate, "short")}/${pickedDate.slice(0, 4)}`
                  : "Chọn ngày"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                locale={vi}
                defaultMonth={toLocalDate(pickedDate)}
                selected={toLocalDate(pickedDate)}
                onSelect={handlePickDate}
              />
            </PopoverContent>
          </Popover>

          <span className="turns-range-caption" data-testid="turns-range-caption">
            {formatRangeCaption(preset, from, to)}
          </span>
        </div>

        <div className="turns-toolbar-right">
          <button
            type="button"
            role="switch"
            aria-checked={includeUncounted}
            onClick={handleToggleUncounted}
            className="turns-switch-btn"
            data-testid="turns-include-uncounted-toggle"
          >
            <span className="turns-switch-track" aria-hidden="true">
              <span className="turns-switch-thumb" />
            </span>
            <span>Hiện lượt không tính</span>
          </button>
        </div>
      </div>

      {/* Non-blocking background refresh warning */}
      {backgroundError ? (
        <div
          className="turns-card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          role="alert"
          style={{
            backgroundColor: "var(--turns-tint-amber)",
            borderColor: "var(--turns-amber)",
            color: "var(--turns-amber-ink)",
          }}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>
              Không thể làm mới dữ liệu sổ lượt:{" "}
              {backgroundError instanceof Error ? backgroundError.message : "Lỗi kết nối"}
            </span>
          </div>
          <button type="button" onClick={handleRetry} className="turns-page-btn">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Thử lại
          </button>
        </div>
      ) : null}

      {/* Content states */}
      {isInitialLoading ? (
        <TurnsLoadingSkeleton showUncounted={includeUncounted} />
      ) : fatalError ? (
        <section
          className="turns-card grid place-items-center gap-4 px-6 py-12 text-center"
          role="alert"
          data-testid="turns-error-state"
        >
          <div
            className="flex size-12 items-center justify-center rounded-full"
            style={{
              backgroundColor: "var(--turns-tint-red)",
              color: "var(--turns-red-ink)",
            }}
          >
            <AlertTriangle className="size-6" aria-hidden="true" />
          </div>
          <div>
            <h2 className="turns-card-title">Không thể tải Sổ lượt tới quán</h2>
            <p className="mt-1.5 max-w-md text-sm" style={{ color: "var(--turns-muted)" }}>
              {fatalError instanceof Error
                ? fatalError.message
                : "Kết nối tới máy chủ bị gián đoạn. Vui lòng thử lại."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
            style={{
              backgroundColor: "var(--turns-blue)",
              color: "#ffffff",
            }}
            data-testid="turns-retry-button"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Thử lại
          </button>
        </section>
      ) : summary ? (
        <>
          {/* Summary Metric Cards (exclusively from API summary) */}
          <dl className="turns-metrics-grid" data-testid="turns-metrics-grid">
            <div className="turns-card turns-metric-card" data-testid="turns-metric-completed">
              <dt className="turns-metric-label">Lượt tới quán</dt>
              <dd className="turns-metric-value m-0">{summary.completedTotal}</dd>
              <dd className="turns-metric-caption m-0">lượt check-in được ghi nhận</dd>
            </div>

            <div className="turns-card turns-metric-card" data-testid="turns-metric-guests">
              <dt className="turns-metric-label">Tổng khách</dt>
              <dd className="turns-metric-value m-0">{summary.guestTotal}</dd>
              <dd className="turns-metric-caption m-0">tổng số khách phục vụ</dd>
            </div>

            {includeUncounted ? (
              <div className="turns-card turns-metric-card" data-testid="turns-metric-uncounted">
                <dt className="turns-metric-label">Lượt không tính</dt>
                <dd
                  className="turns-metric-value m-0"
                  style={{ color: "var(--turns-amber-ink)" }}
                >
                  {uncountedTotal}
                </dd>
                <dd className="turns-metric-caption m-0">nhập nhầm / hệ thống đóng ca</dd>
              </div>
            ) : null}
          </dl>

          {/* Daily Breakdown (when range > 1 business day) */}
          {from !== to ? <TurnsDailyChart days={dailySeries} /> : null}

          {/* Empty state vs Two-column detail */}
          {isRangeEmpty ? (
            <section
              className="turns-card grid place-items-center gap-3 px-6 py-14 text-center"
              data-testid="turns-empty-state"
            >
              <div
                className="flex size-12 items-center justify-center rounded-full"
                style={{
                  backgroundColor: "var(--turns-sunken)",
                  color: "var(--turns-muted)",
                }}
              >
                <Inbox className="size-6" aria-hidden="true" />
              </div>
              <h2 className="turns-card-title">Chưa có lượt nào trong khoảng này</h2>
              <p className="max-w-md text-sm" style={{ color: "var(--turns-muted)" }}>
                Thử chuyển sang &ldquo;7 ngày&rdquo; hoặc bật &ldquo;Hiện lượt không tính&rdquo; để
                xem thêm dữ liệu.
              </p>
            </section>
          ) : (
            <div className="turns-main-grid" data-testid="turns-main-grid">
              <TurnsHistoryTable
                result={turnsData}
                isFetching={turnsQuery.isFetching}
                includeUncounted={includeUncounted}
                selectedStaffId={selectedStaffId}
                selectedStaffLabel={selectedStaffLabel}
                onClearStaff={() => handleSelectStaff(undefined)}
                onPageChange={setPage}
              />

              <div className="turns-side-stack">
                <StaffBreakdownCard
                  byStaff={summary.byStaff}
                  selectedStaffId={selectedStaffId}
                  onSelectStaff={handleSelectStaff}
                />
                <TopScopesCard byScope={summary.byScope} />
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

export default TurnLedgerPage

import { vi } from "date-fns/locale"
import { AlertTriangle, CalendarDays, Inbox, Lock, RotateCcw } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import type { TableTurnQuery, TableTurnsParams } from "@/domain/models"
import { useBusinessDate, useBusinessShift, useTableTurnSummary, useTableTurns } from "@/hooks/use-data"
import { fmtBusinessDate, fmtBusinessShift, fromLocalDate, toLocalDate, type BusinessDate } from "@/lib/time"
import { api, isApiError } from "@/services"
import { useCan, useSession } from "@/state/session"
import { AnonymousVisitsCard, DuplicateCustomersCard } from "./turns-customer-history-cards"
import { TurnsDailyChart } from "./turns-daily-chart"
import {
  buildListParams,
  buildSummaryQuery,
  computeTurnKpis,
  fillBusinessDateSeries,
  formatLedgerRangeCaption,
  formatStaffName,
  hasCheckedInByStaffField,
  resolveStaffIdentity,
  resolveTurnDateRange,
  resolveTurnWriteAccess,
  type TurnRangePreset,
} from "./turns-helpers"
import { TurnsHistoryTable } from "./turns-history-table"
import { TurnsRadioGroup, type TurnsRadioOption } from "./turns-radio-group"
import { useTurnsFirstReveal } from "./turns-reveal"
import { StaffBreakdownCard, TopScopesCard } from "./turns-side-cards"
import "./turns.css"

const RANGE_PRESET_OPTIONS: readonly TurnsRadioOption<Exclude<TurnRangePreset, "date">>[] = [
  { id: "today", label: "Ca hôm nay", testId: "turns-range-today" },
  { id: "week", label: "Tuần này", testId: "turns-range-week" },
  { id: "7days", label: "7 ngày", testId: "turns-range-7days" },
  { id: "30days", label: "30 ngày", testId: "turns-range-30days" },
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

function useTurnHistoryReadOnly(): boolean {
  const role = useSession((state) => state.user?.role)
  const userAccessLevel = useSession((state) => state.user?.accessLevel ?? null)
  const principal = useSession((state) => state.principal)
  const permissions = useSession((state) => state.permissions)
  return resolveTurnWriteAccess({
    mode: api.mode,
    role,
    userAccessLevel,
    principalAccessLevel: principal?.accessLevel ?? null,
    hasPrincipal: principal !== null,
    permissions,
  }).isReadOnly
}

function isForbiddenError(error: unknown): boolean {
  return isApiError(error) && (error.status === 403 || error.code === "PERMISSION_DENIED")
}

function TurnsLoadingSkeleton() {
  return (
    <div
      className="grid gap-[18px]"
      role="status"
      aria-live="polite"
      aria-label="Đang tải sổ lượt tới quán"
      data-testid="turns-loading-skeleton"
    >
      <div className="turns-metrics-grid">
        {[0, 1, 2, 3].map((idx) => (
          <div key={idx} className="turns-card turns-metric-card">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-16" />
            <Skeleton className="h-3.5 w-36" />
          </div>
        ))}
      </div>

      <div className="turns-main-grid">
        <div className="turns-card p-5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-2 h-4 w-72" />
          <div className="mt-5 grid gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <div className="turns-side-stack">
          <div className="turns-card p-5">
            <Skeleton className="h-5 w-36" />
            <div className="mt-4 grid gap-2.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <div className="turns-card p-5">
            <Skeleton className="h-5 w-44" />
            <div className="mt-4 grid gap-2.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>
      </div>

      <div className="turns-bottom-grid">
        <div className="turns-card p-5">
          <Skeleton className="h-5 w-36" />
          <div className="mt-4 grid gap-2.5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
        <div className="turns-card p-5">
          <Skeleton className="h-5 w-44" />
          <div className="mt-4 grid gap-2.5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
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
  const isReadOnly = useTurnHistoryReadOnly()
  const currentBusinessDate = useBusinessDate()
  // TU-38: the operating shift the figures are grouped by, read from the venue configuration.
  const shiftLabel = fmtBusinessShift(useBusinessShift())
  const rootRef = useRef<HTMLDivElement>(null)

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
  const isMultiDay = from !== to

  const summaryParams = useMemo<TableTurnQuery>(
    () => buildSummaryQuery(from, to, includeUncounted),
    [from, to, includeUncounted],
  )

  const summaryQuery = useTableTurnSummary(summaryParams, canRead)
  const summary = summaryQuery.data

  const staffFilterField = hasCheckedInByStaffField(summary) ? "checkedInByUserId" : "closedByUserId"

  const listParams = useMemo<TableTurnsParams>(
    () => buildListParams(from, to, includeUncounted, selectedStaffId, page, DEFAULT_PAGE_SIZE, staffFilterField),
    [from, to, includeUncounted, selectedStaffId, page, staffFilterField],
  )

  const turnsQuery = useTableTurns(listParams, canRead)
  const turnsData = turnsQuery.data

  const dailySeries = useMemo(
    () => (isMultiDay && summary ? fillBusinessDateSeries(from, to, summary.byBusinessDate) : []),
    [isMultiDay, from, to, summary],
  )

  const selectedStaffLabel = useMemo(() => {
    if (selectedStaffId === undefined || !summary) return null
    const match = summary.byStaff.find((row) => resolveStaffIdentity(row).userId === selectedStaffId)
    if (!match) return null
    const { userId, displayName } = resolveStaffIdentity(match)
    return formatStaffName(userId, displayName)
  }, [selectedStaffId, summary])

  const forbidden = !canRead || isForbiddenError(summaryQuery.error) || isForbiddenError(turnsQuery.error)
  const isInitialLoading = (summaryQuery.isPending && !summary) || (turnsQuery.isPending && !turnsData)
  const fatalError =
    (summaryQuery.isError && !summary ? summaryQuery.error : null) ??
    (turnsQuery.isError && !turnsData ? turnsQuery.error : null)
  const backgroundError =
    !fatalError && (summaryQuery.isError || turnsQuery.isError) ? (summaryQuery.error ?? turnsQuery.error) : null

  const kpis = summary ? computeTurnKpis(summary) : null
  const isContentReady = !forbidden && !isInitialLoading && !fatalError && Boolean(summary && kpis)

  useTurnsFirstReveal(rootRef, isContentReady)

  if (forbidden) {
    return (
      <div className="turns-page" data-testid="turns-forbidden-state">
        <section className="turns-card p-8" role="alert" aria-labelledby="turns-forbidden-heading">
          <div className="flex items-start gap-4">
            <div
              className="flex size-11 shrink-0 items-center justify-center rounded-full"
              style={{
                backgroundColor: "var(--turns-tint-red)",
                color: "var(--turns-red-ink)",
              }}
            >
              <Lock className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="turns-badge turns-badge-entry-error">403 · Thiếu quyền report.read</span>
              <h2 id="turns-forbidden-heading" className="turns-card-title mt-3">
                Không có quyền xem Sổ lượt tới quán
              </h2>
              <p className="mt-1.5 text-sm leading-6" style={{ color: "var(--turns-muted)" }}>
                Tài khoản hiện tại không có quyền <code>report.read</code> để truy cập dữ liệu sổ lượt tới quán. Vui
                lòng liên hệ Chủ quán để được cấp quyền phù hợp.
              </p>
            </div>
          </div>
        </section>
      </div>
    )
  }

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

  const rangeCaption = formatLedgerRangeCaption(preset, from, to)
  const isRangeEmpty =
    summary !== undefined &&
    summary.completedTotal === 0 &&
    summary.byBusinessDate.length === 0 &&
    (turnsData?.total ?? 0) === 0

  return (
    <div ref={rootRef} className="turns-page" data-testid="turn-ledger-page">
      {/* Filter Toolbar */}
      <div className="turns-toolbar" data-testid="turns-filter-bar">
        <div className="turns-filter-pills">
          <TurnsRadioGroup
            ariaLabel="Khoảng ngày kinh doanh"
            options={RANGE_PRESET_OPTIONS}
            value={preset === "date" ? undefined : preset}
            onValueChange={handleSelectPreset}
            className="turns-segmented-track"
            itemClassName="turns-segmented-item"
          />

          <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
            <PopoverTrigger asChild>
              {(() => {
                const pickedDateText = `${fmtBusinessDate(pickedDate, "short")}/${pickedDate.slice(0, 4)}`
                return (
                  <button
                    type="button"
                    className="turns-date-chip-btn"
                    data-active={preset === "date" ? "true" : "false"}
                    aria-label={preset === "date" ? `Chọn ngày ${pickedDateText}` : "Chọn ngày kinh doanh cụ thể"}
                    data-testid="turns-date-picker-trigger"
                  >
                    <CalendarDays className="size-4" aria-hidden="true" />
                    {preset === "date" ? pickedDateText : "Chọn ngày"}
                  </button>
                )
              })()}
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
          <Button type="button" variant="outline" size="sm" onClick={handleRetry} className="turns-touch-btn">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Thử lại
          </Button>
        </div>
      ) : null}

      {/* Content states */}
      {isInitialLoading ? (
        <TurnsLoadingSkeleton />
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
              {fatalError instanceof Error ? fatalError.message : "Kết nối tới máy chủ bị gián đoạn. Vui lòng thử lại."}
            </p>
          </div>
          <Button type="button" onClick={handleRetry} data-testid="turns-retry-button">
            <RotateCcw className="size-4" aria-hidden="true" />
            Thử lại
          </Button>
        </section>
      ) : summary && kpis ? (
        <>
          {/* 4-card KPI row matching Figma geometry (exclusively from API summary) */}
          <dl className="turns-metrics-grid" data-testid="turns-metrics-grid" data-turns-reveal>
            <div
              className="turns-card turns-metric-card turns-metric-card--completed"
              data-testid="turns-metric-completed"
            >
              <dt className="turns-metric-label">Lượt tới quán</dt>
              <dd className="turns-metric-value m-0">{kpis.arrivedTotal}</dd>
              <dd className="turns-metric-caption m-0">lượt tính vào chỉ số</dd>
            </div>

            <div className="turns-card turns-metric-card turns-metric-card--guests" data-testid="turns-metric-guests">
              <dt className="turns-metric-label">Tổng khách</dt>
              <dd className="turns-metric-value m-0">{kpis.guestTotal}</dd>
              <dd className="turns-metric-caption m-0">tổng số khách phục vụ</dd>
            </div>

            <div className="turns-card turns-metric-card turns-metric-card--open" data-testid="turns-metric-open">
              <dt className="turns-metric-label">
                <span className="turns-metric-dot turns-metric-dot--amber" aria-hidden="true" />
                Đang ngồi
              </dt>
              <dd className="turns-metric-value turns-metric-value-amber m-0">{kpis.openTotal}</dd>
              <dd className="turns-metric-caption m-0">lượt đang phục vụ trong khoảng</dd>
            </div>

            <div className="turns-card turns-metric-card turns-metric-card--closed" data-testid="turns-metric-closed">
              <dt className="turns-metric-label">
                <span className="turns-metric-dot turns-metric-dot--green" aria-hidden="true" />
                Đã trả bàn
              </dt>
              <dd className="turns-metric-value turns-metric-value-green m-0">{kpis.closedCountedTotal}</dd>
              <dd className="turns-metric-caption m-0">lượt đã kết thúc hợp lệ</dd>
            </div>
          </dl>

          {/* Daily Breakdown (only for multi-day ranges) */}
          {isMultiDay ? (
            <div data-turns-reveal>
              <TurnsDailyChart days={dailySeries} shiftLabel={shiftLabel} />
            </div>
          ) : null}

          {/* Empty state vs Two-column detail */}
          {isRangeEmpty ? (
            <section
              className="turns-card grid place-items-center gap-3 px-6 py-14 text-center"
              data-testid="turns-empty-state"
              data-turns-reveal
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
                Thử chuyển sang &ldquo;7 ngày&rdquo; hoặc bật &ldquo;Hiện lượt không tính&rdquo; để xem thêm dữ liệu.
              </p>
            </section>
          ) : (
            <>
              <div className="turns-wide-grid">
                <div className="turns-main-grid" data-testid="turns-main-grid">
                  <div className="min-w-0" data-turns-reveal>
                    <TurnsHistoryTable
                      result={turnsData}
                      rangeCaption={rangeCaption}
                      isMultiDay={isMultiDay}
                      isFetching={turnsQuery.isFetching}
                      includeUncounted={includeUncounted}
                      selectedStaffId={selectedStaffId}
                      selectedStaffLabel={selectedStaffLabel}
                      onClearStaff={() => handleSelectStaff(undefined)}
                      onPageChange={setPage}
                    />
                  </div>

                  <div className="turns-side-stack" data-testid="turns-side-stack" data-turns-reveal>
                    <AnonymousVisitsCard
                      key={`${from}:${to}`}
                      from={from}
                      to={to}
                      currentBusinessDate={currentBusinessDate}
                      turns={turnsData?.turns}
                      isReadOnly={isReadOnly}
                    />
                    <DuplicateCustomersCard isReadOnly={isReadOnly} />
                  </div>
                </div>

                <div className="turns-bottom-grid" data-testid="turns-bottom-grid" data-turns-reveal>
                  <StaffBreakdownCard
                    byStaff={summary.byStaff}
                    selectedStaffId={selectedStaffId}
                    onSelectStaff={handleSelectStaff}
                  />
                  <TopScopesCard byScope={summary.byScope} />
                </div>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  )
}

export default TurnLedgerPage

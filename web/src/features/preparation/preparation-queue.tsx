import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { ArrowLeft, ChefHat, GlassWater, LogOut, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useNow } from "@/hooks/use-data"
import { httpClient, newIdempotencyKey } from "@/services"
import { useSession } from "@/state/session"
import { PREPARATION_QUEUE_LAYOUT_CLASS, canShowPrintRetry, type PreparationTicketStatus } from "./preparation-layout"
import {
  PREPARATION_EMPTY_QUEUE_TEXT,
  PREPARATION_FILTER_EMPTY_TEXT,
  PREPARATION_QUEUE_FILTERS,
  preparationColumnCount,
  preparationColumns,
  preparationQueueFilterLabel,
  preparationQueueFilterProjection,
  preparationQueueViewState,
  preparationStationLabel,
  type PreparationQueueFilter,
  type PreparationQueueStatus,
} from "./preparation-presentation"
import {
  preparationQueueKey,
  usePreparationQueue,
  type PreparationStation,
  type PreparationTicket,
} from "./preparation-queue-data"
import { PreparationTicketCard } from "./preparation-ticket-card"
import { aggregatePreparationItems } from "./preparation-totals"
import { PreparationTotalsPanel } from "./preparation-totals-panel"

/** Lần tải đầu: ba khung xám thay cho bốn cột trống. */
function PreparationQueueSkeleton() {
  return (
    <div className="grid gap-2.5" aria-label="Đang tải hàng đợi" aria-busy="true" role="status">
      <p className="text-sm text-muted-foreground">Đang tải hàng đợi…</p>
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-24 rounded-xl" />
      ))}
    </div>
  )
}

export interface PreparationQueueFilterBarProps {
  filter: PreparationQueueFilter
  totalCount: number
  visibleCount: number
  hiddenCount: number
  hiddenCriticalCount: number
  onFilterChange: (filter: PreparationQueueFilter) => void
}

export function PreparationQueueFilterBar({
  filter,
  totalCount,
  visibleCount,
  hiddenCount,
  hiddenCriticalCount,
  onFilterChange,
}: PreparationQueueFilterBarProps) {
  if (totalCount === 0) return null
  const activeLabel = preparationQueueFilterLabel(filter)

  return (
    <div className="mb-3 grid min-w-0 gap-2.5">
      <div role="group" aria-label="Lọc hàng đợi" className="grid min-w-0 grid-cols-3 gap-2 sm:flex sm:w-fit">
        {PREPARATION_QUEUE_FILTERS.map((option) => (
          <Button
            key={option}
            type="button"
            variant={filter === option ? "default" : "outline"}
            className="min-h-11 min-w-0 px-2 sm:px-4"
            aria-pressed={filter === option}
            onClick={() => onFilterChange(option)}
          >
            {preparationQueueFilterLabel(option)}
          </Button>
        ))}
      </div>
      {filter !== "all" && hiddenCount > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="flex min-w-0 flex-col gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p>{`Đang lọc ${activeLabel} — ${hiddenCount} phiếu bị ẩn.`}</p>
            {hiddenCriticalCount > 0 ? (
              <p className="mt-1 font-semibold text-destructive">
                {`${hiddenCriticalCount} phiếu bị ẩn đã chờ quá lâu.`}
              </p>
            ) : null}
            {visibleCount === 0 ? <p className="mt-1 font-medium">{PREPARATION_FILTER_EMPTY_TEXT}</p> : null}
          </div>
          <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={() => onFilterChange("all")}>
            Xem tất cả
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export interface PreparationQueueProps {
  station: PreparationStation
  canRead: boolean
  canTransition: boolean
  canRetry: boolean
  embedded?: boolean
  stationControls?: ReactNode
  onBack?: () => void
  onLogout?: () => void
}

export function PreparationQueue({
  station,
  canRead,
  canTransition,
  canRetry: hasRetryPermission,
  embedded = false,
  stationControls,
  onBack,
  onLogout,
}: PreparationQueueProps) {
  const venueId = useSession((state) => state.principal?.venueId ?? null)
  const queryClient = useQueryClient()
  const queue = usePreparationQueue(station, canRead)
  const now = useNow(30_000)
  const [filter, setFilter] = useState<PreparationQueueFilter>("all")
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const snapshot = queue.data
  const canRetry = canShowPrintRetry(hasRetryPermission, snapshot?.printing.enabled === true)
  const stationLabel = preparationStationLabel(station)
  const readPermission = `preparation.${station.toLowerCase()}.read`
  const columns = useMemo(() => preparationColumns(station), [station])
  const refresh = useCallback(() => queue.refetch(), [queue])

  useEffect(() => {
    if (!httpClient || !canRead) return
    const stream = new EventSource(`${httpClient.root}/tables/stream`, { withCredentials: true })
    const changed = () => void queryClient.invalidateQueries({ queryKey: preparationQueueKey(venueId, station) })
    stream.addEventListener("floor-changed", changed)
    return () => stream.close()
  }, [canRead, queryClient, station, venueId])

  const transition = async (ticket: PreparationTicket, toStatus: PreparationTicketStatus) => {
    if (!httpClient) return
    setPendingId(ticket.ticketId)
    try {
      const idempotencyKey = newIdempotencyKey()
      await httpClient.post(
        `/preparation/${station}/tickets/${ticket.ticketId}/transition`,
        { toStatus, expectedVersion: ticket.version, idempotencyKey },
        { idempotencyKey },
      )
      setActionError(null)
      await refresh()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không cập nhật được phiếu.")
      await refresh()
    } finally {
      setPendingId(null)
    }
  }

  const retry = async (ticket: PreparationTicket) => {
    if (!httpClient) return
    setPendingId(ticket.ticketId)
    try {
      const idempotencyKey = newIdempotencyKey()
      await httpClient.post(
        `/preparation/${station}/tickets/${ticket.ticketId}/print-retry`,
        { idempotencyKey },
        { idempotencyKey },
      )
      setActionError(null)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không yêu cầu in lại được.")
    } finally {
      setPendingId(null)
    }
  }

  const filterProjection = useMemo(
    () => preparationQueueFilterProjection(snapshot?.tickets ?? [], filter, now),
    [filter, now, snapshot],
  )
  const aggregateItems = useMemo(() => aggregatePreparationItems(snapshot?.tickets ?? []), [snapshot])
  const groupedTotal = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [
          column.status,
          snapshot?.tickets.filter((ticket) => ticket.status === column.status) ?? [],
        ]),
      ) as Record<PreparationQueueStatus, PreparationTicket[]>,
    [columns, snapshot],
  )
  const groupedVisible = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [
          column.status,
          filterProjection.visibleTickets.filter((ticket) => ticket.status === column.status),
        ]),
      ) as Record<PreparationQueueStatus, PreparationTicket[]>,
    [columns, filterProjection.visibleTickets],
  )

  // Refetch nền không xóa snapshot cũ: còn `queue.data` thì màn hình vẫn vẽ
  // phiếu, nên hàng đợi không nháy mỗi 10 giây.
  const viewState = preparationQueueViewState({
    hasSnapshot: snapshot !== undefined,
    ticketCount: snapshot?.tickets.length ?? 0,
  })
  const loadFailedWithoutData = snapshot === undefined && queue.error !== null

  if (!canRead)
    return (
      <section className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">{`Không có quyền xem hàng đợi ${stationLabel}`}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {`Phiên này thiếu quyền ${readPermission}. Backend cũng sẽ từ chối dữ liệu quầy.`}
          </p>
        </div>
      </section>
    )

  return (
    <section className={`${embedded ? "h-full overflow-y-auto" : "min-h-dvh"} min-w-0 bg-background p-3 sm:p-4`}>
      <header className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-1 p-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? (
            <Button variant="outline" className="min-h-11 shrink-0" onClick={onBack} aria-label="Quay về sơ đồ">
              <ArrowLeft className="size-4" aria-hidden="true" /> Sơ đồ
            </Button>
          ) : null}
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            {station === "BAR" ? <GlassWater className="size-5" /> : <ChefHat className="size-5" />}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{`Hàng đợi ${stationLabel}`}</h1>
            <p className="truncate text-xs text-muted-foreground">
              Cursor {snapshot?.changeCursor ?? "—"} · tự tải lại khi có thay đổi
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {stationControls}
          <Button variant="outline" size="icon" className="size-11" onClick={() => void refresh()} aria-label="Tải lại">
            <RefreshCw className="size-4" />
          </Button>
          {onLogout ? (
            <Button variant="outline" size="icon" className="size-11" onClick={onLogout} aria-label="Đăng xuất">
              <LogOut className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>
      {queue.error || actionError ? (
        <p role="alert" className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
          {actionError ?? (queue.error instanceof Error ? queue.error.message : "Không tải được hàng đợi.")}
        </p>
      ) : null}
      {loadFailedWithoutData ? null : viewState === "loading" ? (
        <PreparationQueueSkeleton />
      ) : viewState === "empty" ? (
        <p className="rounded-2xl border border-border bg-surface-1 p-6 text-center text-sm text-muted-foreground">
          {PREPARATION_EMPTY_QUEUE_TEXT}
        </p>
      ) : (
        <>
          <PreparationQueueFilterBar
            filter={filter}
            totalCount={snapshot!.tickets.length}
            visibleCount={filterProjection.visibleTickets.length}
            hiddenCount={filterProjection.hiddenCount}
            hiddenCriticalCount={filterProjection.hiddenCriticalCount}
            onFilterChange={setFilter}
          />
          <PreparationTotalsPanel station={station} items={aggregateItems} />
          <section className={PREPARATION_QUEUE_LAYOUT_CLASS} aria-label="Các trạng thái hàng đợi">
            {columns.map((column) => {
              const count = preparationColumnCount(
                groupedVisible[column.status].length,
                groupedTotal[column.status].length,
                filter,
              )
              return (
                <section
                  key={column.status}
                  data-queue-status={column.status}
                  className={`min-w-0 rounded-2xl border p-2.5 ${column.tone}`}
                >
                  <h2 className="mb-2 flex items-center justify-between gap-2 px-1 text-sm font-bold">
                    <span className="min-w-0 break-words">{column.label}</span>
                    <span
                      className="shrink-0 rounded-full bg-surface-1 px-2 py-0.5 text-xs"
                      aria-label={count.accessibleLabel}
                      data-visible-count={groupedVisible[column.status].length}
                      data-total-count={groupedTotal[column.status].length}
                    >
                      {count.text}
                    </span>
                  </h2>
                  <div className="grid min-w-0 gap-2.5">
                    {groupedVisible[column.status].map((ticket) => (
                      <PreparationTicketCard
                        key={ticket.ticketId}
                        ticket={ticket}
                        station={station}
                        now={now}
                        canTransition={canTransition}
                        canRetry={canRetry}
                        pending={pendingId === ticket.ticketId}
                        onTransition={(item, status) => void transition(item, status)}
                        onRetry={(item) => void retry(item)}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </section>
        </>
      )}
    </section>
  )
}

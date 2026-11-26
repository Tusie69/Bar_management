import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ChefHat, GlassWater, LogOut, RefreshCw, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useNow } from "@/hooks/use-data"
import { httpClient, newIdempotencyKey } from "@/services"
import { useSession } from "@/state/session"
import { PREPARATION_QUEUE_LAYOUT_CLASS, canShowPrintRetry, type PreparationTicketStatus } from "./preparation-layout"
import {
  PREPARATION_CALLOUT_CLASS,
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
import { planPreparationDrop } from "./preparation-drag"
import { usePreparationDrag } from "./use-preparation-drag"
import { aggregatePreparationItems } from "./preparation-totals"
import { PreparationTotalsPanel } from "./preparation-totals-panel"
import { usePreparationAudio } from "./preparation-audio"

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
          className={cn(
            "flex min-w-0 flex-col gap-2 rounded-xl p-3 text-sm sm:flex-row sm:items-center sm:justify-between",
            PREPARATION_CALLOUT_CLASS.warning,
          )}
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
  headerActions?: ReactNode
  stationControls?: ReactNode
  onOpenBill?: (ticket: PreparationTicket) => void
  onBack?: () => void
  onLogout?: () => void
}

export function PreparationQueue({
  station,
  canRead,
  canTransition,
  canRetry: hasRetryPermission,
  embedded = false,
  headerActions,
  stationControls,
  onOpenBill,
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
  const audio = usePreparationAudio(venueId, station, snapshot?.tickets)
  const canRetry = canShowPrintRetry(hasRetryPermission, snapshot?.printing.enabled === true)
  const stationLabel = preparationStationLabel(station)
  const columns = useMemo(() => preparationColumns(station), [station])
  const sectionRef = useRef<HTMLElement>(null)
  const jumpNavRef = useRef<HTMLDivElement>(null)
  const [canScrollJumpRight, setCanScrollJumpRight] = useState(false)
  const syncJumpScrollCue = useCallback(() => {
    const el = jumpNavRef.current
    if (!el) {
      setCanScrollJumpRight(false)
      return
    }
    setCanScrollJumpRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
  }, [])
  useEffect(() => {
    const el = jumpNavRef.current
    if (!el) return
    syncJumpScrollCue()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(syncJumpScrollCue)
    ro.observe(el)
    return () => ro.disconnect()
  }, [columns, snapshot, filter, syncJumpScrollCue])
  const refresh = useCallback(() => queue.refetch(), [queue])
  const scrollToColumn = useCallback((status: PreparationQueueStatus) => {
    const column = sectionRef.current?.querySelector<HTMLElement>(`[data-queue-status="${status}"]`)
    if (!column) return
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    column.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })
    column.querySelector<HTMLElement>(`#queue-${status}`)?.focus({ preventScroll: true })
  }, [])

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

  const updateProgress = async (
    ticket: PreparationTicket,
    lineNo: number,
    doneQuantity: number,
    expectedVersion: number,
  ) => {
    if (!httpClient) return
    setPendingId(ticket.ticketId)
    try {
      const idempotencyKey = newIdempotencyKey()
      await httpClient.post(
        `/preparation/${station}/tickets/${ticket.ticketId}/lines/${lineNo}/progress`,
        { doneQuantity, expectedVersion, idempotencyKey },
        { idempotencyKey },
      )
      setActionError(null)
      await refresh()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không cập nhật được tiến độ món.")
      await refresh()
    } finally {
      setPendingId(null)
    }
  }

  const revert = async (ticket: PreparationTicket, toStatus: PreparationTicketStatus) => {
    if (!httpClient) return
    setPendingId(ticket.ticketId)
    try {
      const idempotencyKey = newIdempotencyKey()
      await httpClient.post(
        `/preparation/${station}/tickets/${ticket.ticketId}/revert`,
        { toStatus, expectedVersion: ticket.version, idempotencyKey },
        { idempotencyKey },
      )
      setActionError(null)
      await refresh()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Không lùi được phiếu.")
      await refresh()
    } finally {
      setPendingId(null)
    }
  }

  const handleDrop = (ticketId: number, toStatus: PreparationQueueStatus) => {
    const ticket = snapshot?.tickets.find((item) => item.ticketId === ticketId)
    if (!ticket) return
    const plan = planPreparationDrop(ticket.status, toStatus, canTransition)
    if (plan.kind === "same") return
    if (plan.kind === "blocked") {
      setActionError(plan.blockedReason)
      return
    }
    setActionError(null)
    if (!plan.toStatus) return
    // Tiến hay lùi đều là một cú kéo, một yêu cầu: không hỏi lại giữa chừng.
    if (plan.kind === "revert") void revert(ticket, plan.toStatus)
    else void transition(ticket, plan.toStatus)
  }

  const { drag, startDrag } = usePreparationDrag(handleDrop)
  const draggingTicket = drag ? (snapshot?.tickets.find((item) => item.ticketId === drag.ticketId) ?? null) : null
  const dropPlan =
    draggingTicket && drag?.overStatus
      ? planPreparationDrop(draggingTicket.status, drag.overStatus, canTransition)
      : null
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

  const Root = embedded ? "section" : "main"

  if (!canRead)
    return (
      <Root className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-xl font-semibold">{`Không có quyền xem hàng đợi ${stationLabel}`}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tài khoản này chỉ dùng cho nhân viên có quyền xem màn hình quầy. Hãy liên hệ quản lý nếu cần mở quyền.
          </p>
        </div>
      </Root>
    )

  return (
    <Root
      ref={sectionRef}
      className={`${embedded ? "h-full overflow-y-auto" : "min-h-dvh"} min-w-0 bg-background p-3 sm:p-4`}
    >
      <header className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface-1 p-3 sm:gap-3 sm:p-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {onBack ? (
            <Button
              variant="outline"
              className="min-h-11 min-w-11 shrink-0 px-2.5 sm:px-3"
              onClick={onBack}
              aria-label="Quay về sơ đồ"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              <span className="hidden min-[380px]:inline">Sơ đồ</span>
            </Button>
          ) : null}
          <span className="hidden size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground sm:grid">
            {station === "BAR" ? <GlassWater className="size-5" /> : <ChefHat className="size-5" />}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold sm:text-xl">{`Hàng đợi ${stationLabel}`}</h1>
            <p className="truncate text-xs text-muted-foreground">Tự cập nhật</p>
          </div>
        </div>
        {stationControls ? <div className="order-last w-full sm:order-none sm:w-auto">{stationControls}</div> : null}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {headerActions}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            aria-pressed={audio.enabled}
            aria-label={audio.enabled ? "Tắt âm báo phiếu mới" : "Bật âm báo phiếu mới"}
            onClick={() => audio.setEnabled(!audio.enabled)}
          >
            {audio.enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </Button>
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
          <nav aria-label="Chuyển nhanh theo cột" className="relative mb-3 xl:hidden">
            <div
              ref={jumpNavRef}
              onScroll={syncJumpScrollCue}
              className="no-scrollbar flex flex-nowrap gap-2 overflow-x-auto pr-1 pb-0.5 md:flex-wrap md:overflow-visible md:pr-0 md:pb-0"
            >
              {columns.map((column) => {
                const count = preparationColumnCount(
                  groupedVisible[column.status].length,
                  groupedTotal[column.status].length,
                  filter,
                )
                return (
                  <a
                    key={column.status}
                    href={`#queue-${column.status}`}
                    className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-border bg-surface-1 px-3 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none"
                    onClick={(event) => {
                      event.preventDefault()
                      scrollToColumn(column.status)
                    }}
                  >
                    {`${column.label} (${count.text})`}
                  </a>
                )
              })}
            </div>
            {canScrollJumpRight ? (
              <span
                aria-hidden="true"
                data-testid="preparation-jump-scroll-cue"
                className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background via-background/85 to-transparent md:hidden"
              />
            ) : null}
          </nav>
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
                  data-drop-state={
                    drag?.overStatus === column.status
                      ? dropPlan?.kind === "blocked"
                        ? "blocked"
                        : dropPlan?.kind === "same"
                          ? "same"
                          : "allowed"
                      : undefined
                  }
                  className={cn(
                    "min-w-0 rounded-2xl border p-2.5 transition-colors",
                    column.tone,
                    drag?.overStatus === column.status &&
                      (dropPlan?.kind === "blocked"
                        ? "border-destructive/60 bg-destructive/10"
                        : dropPlan?.kind === "same"
                          ? ""
                          : "border-primary bg-primary/10"),
                  )}
                >
                  <h2
                    id={`queue-${column.status}`}
                    tabIndex={-1}
                    className="mb-2 flex items-center justify-between gap-2 rounded-md px-1 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="min-w-0 break-words">{column.label}</span>
                    <span
                      className="tnum shrink-0 rounded-full bg-surface-1 px-2 py-0.5 text-xs"
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
                        dragging={drag?.ticketId === ticket.ticketId}
                        onDragHandlePointerDown={
                          canTransition ? (event, item) => startDrag(event, item.ticketId) : undefined
                        }
                        onRevert={(item) => {
                          const plan = planPreparationDrop(
                            item.status,
                            item.status === "PREPARING" ? "ACCEPTED" : "SUBMITTED",
                            canTransition,
                          )
                          if (plan.kind === "revert" && plan.toStatus) void revert(item, plan.toStatus)
                          else if (plan.blockedReason) setActionError(plan.blockedReason)
                        }}
                        onTransition={(item, status) => void transition(item, status)}
                        onRetry={(item) => void retry(item)}
                        onOpenBill={onOpenBill}
                        onProgress={(item, lineNo, doneQuantity, expectedVersion) =>
                          void updateProgress(item, lineNo, doneQuantity, expectedVersion)
                        }
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </section>
        </>
      )}
      {drag && draggingTicket ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-primary bg-surface-1 px-2.5 py-1.5 text-sm font-semibold shadow-lg"
          style={{ left: drag.x, top: drag.y }}
        >
          {draggingTicket.tableCodes.join(", ") || `#${draggingTicket.ticketId}`}
        </div>
      ) : null}
    </Root>
  )
}

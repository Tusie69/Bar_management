import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Lock, RotateCcw } from "lucide-react"
import { useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useShiftAlerts } from "@/features/floor/alerts"
import { useFloorModel } from "@/features/floor/use-floor-model"
import { useBusinessDate, useNow, useReceptionGuestCount, useReservations, useWaitlist } from "@/hooks/use-data"
import { isApiError } from "@/services"
import { ShiftOverviewAlerts } from "./shift-overview-alerts"
import { ShiftOverviewFloor } from "./shift-overview-floor"
import { isForbiddenError, useCanReadShiftOverview } from "./shift-overview-hooks"
import { ShiftOverviewKpis } from "./shift-overview-kpis"
import { ShiftOverviewOccupancy } from "./shift-overview-occupancy"
import { useShiftOverviewFirstReveal } from "./shift-overview-reveal"
import {
  buildOperationalAlerts,
  selectActiveWaitlistCount,
  selectFloorMetrics,
  selectKpiRows,
} from "./shift-overview-selectors"
import "./shift-overview.css"

function describeLoadError(error: unknown): string {
  if (isApiError(error)) return error.message
  if (error instanceof Error && error.message.trim()) return error.message
  return "Không thể tải dữ liệu tổng quan ca. Vui lòng thử lại."
}

function KpiSkeletonCard({ tier, hasSubcaption = false }: { tier: "primary" | "secondary"; hasSubcaption?: boolean }) {
  return (
    <div className={`so-kpi-card so-kpi-card--${tier}`} data-testid="so-kpi-skeleton-card">
      <div className="so-kpi-top">
        <div className="so-kpi-title-row">
          <Skeleton className="h-[18px] w-24" />
        </div>
        <Skeleton className="h-[16px] w-20" />
        {hasSubcaption ? <Skeleton className="h-[14px] w-28" /> : null}
      </div>
      <div className="so-kpi-middle">
        <Skeleton className="h-[32px] w-14" />
      </div>
      <div className="so-kpi-footer">
        <Skeleton className="h-[18px] w-24 rounded-full" />
      </div>
    </div>
  )
}

function ShiftOverviewSkeleton() {
  return (
    <div className="so-root" aria-busy="true" aria-label="Đang tải tổng quan ca" data-testid="shift-overview-loading">
      <div className="so-kpi-row-1">
        {Array.from({ length: 6 }, (_, i) => (
          <KpiSkeletonCard key={i} tier="primary" hasSubcaption={i === 3 || i === 4} />
        ))}
      </div>

      <div className="so-kpi-row-2">
        {Array.from({ length: 4 }, (_, i) => (
          <KpiSkeletonCard key={i} tier="secondary" />
        ))}
      </div>

      <div className="so-main-grid">
        <div className="so-panel so-panel--stretch">
          <div className="so-panel-header so-panel-header--bordered">
            <div className="so-panel-heading-group">
              <Skeleton className="h-[22px] w-44" />
              <Skeleton className="h-[18px] w-56" />
            </div>
          </div>

          <div className="so-floor-stage so-floor-stage--skeleton" aria-hidden="true">
            <Skeleton className="h-full w-full max-w-[360px] rounded-[10px]" />
          </div>
        </div>

        <div className="so-right-stack">
          <div className="so-panel so-panel--alerts">
            <div className="so-panel-header so-panel-header--bordered">
              <div className="so-panel-heading-group">
                <Skeleton className="h-[22px] w-40" />
                <Skeleton className="h-[18px] w-44" />
              </div>
            </div>
            <div className="so-alert-list">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-[60px] w-full rounded-[12px]" />
              ))}
            </div>
          </div>

          <div className="so-panel">
            <div className="so-panel-header so-panel-header--bordered">
              <div className="so-panel-heading-group">
                <Skeleton className="h-[22px] w-44" />
                <Skeleton className="h-[18px] w-36" />
              </div>
            </div>
            <div className="so-occupancy-list">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="so-occupancy-row">
                  <Skeleton className="h-[18px] w-full" />
                  <Skeleton className="h-[10px] w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ShiftOverviewPage() {
  const canRead = useCanReadShiftOverview()
  const queryClient = useQueryClient()
  const businessDate = useBusinessDate()
  const now = useNow(30_000)
  const rootRef = useRef<HTMLDivElement>(null)

  const model = useFloorModel(businessDate)
  const guestCount = useReceptionGuestCount(businessDate)
  const reservations = useReservations(businessDate)
  const waitlist = useWaitlist(businessDate)

  const bookedReservations = useMemo(
    () => (reservations.data ?? []).filter((r) => r.status === "BOOKED"),
    [reservations.data],
  )
  const shiftAlerts = useShiftAlerts(model, bookedReservations, now)

  const floorMetrics = useMemo(
    () => selectFloorMetrics(model.tables, model.states, model.floor?.groups ?? []),
    [model.tables, model.states, model.floor?.groups],
  )

  const waitlistCount = useMemo(() => selectActiveWaitlistCount(waitlist.data ?? []), [waitlist.data])

  const kpiRows = useMemo(
    () => selectKpiRows(guestCount.data, floorMetrics, waitlistCount),
    [guestCount.data, floorMetrics, waitlistCount],
  )

  const alerts = useMemo(
    () => buildOperationalAlerts(shiftAlerts, waitlist.data ?? [], now),
    [shiftAlerts, waitlist.data, now],
  )

  const firstError = model.error ?? guestCount.error ?? reservations.error ?? waitlist.error
  const isInitialLoading = model.loading || guestCount.isLoading || reservations.isLoading || waitlist.isLoading
  const isForbidden = !canRead || isForbiddenError(firstError)
  const isContentReady = !isForbidden && !isInitialLoading && !firstError

  useShiftOverviewFirstReveal(rootRef, isContentReady)

  if (isForbidden) {
    return (
      <div className="so-root" data-testid="shift-overview-forbidden">
        <section className="so-state-card" role="alert">
          <div className="so-state-icon so-state-icon--muted" aria-hidden="true">
            <Lock className="size-5" />
          </div>
          <h2 className="so-state-title">Không có quyền xem Tổng quan ca</h2>
          <p className="so-state-desc">
            Tài khoản hiện tại không có quyền <code>report.read</code> để truy cập báo cáo tổng quan ca.
          </p>
        </section>
      </div>
    )
  }

  if (isInitialLoading && !firstError) {
    return <ShiftOverviewSkeleton />
  }

  if (firstError) {
    return (
      <div className="so-root" data-testid="shift-overview-error">
        <section className="so-state-card" role="alert">
          <div className="so-state-icon so-state-icon--danger" aria-hidden="true">
            <AlertTriangle className="size-5" />
          </div>
          <h2 className="so-state-title">Không tải được dữ liệu tổng quan ca</h2>
          <p className="so-state-desc">{describeLoadError(firstError)}</p>
          <Button
            type="button"
            variant="default"
            onClick={() => {
              void queryClient.refetchQueries({ type: "active" })
            }}
            data-testid="shift-overview-retry"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            <span>Thử lại</span>
          </Button>
        </section>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div ref={rootRef} className="so-root" data-testid="shift-overview-page" data-business-date={businessDate}>
        <ShiftOverviewKpis row1={kpiRows.row1} row2={kpiRows.row2} />
        <div className="so-main-grid">
          <ShiftOverviewFloor
            tables={model.tables}
            states={model.states}
            zones={model.catalog?.zones}
            groups={model.floor?.groups}
            now={now}
          />
          <div className="so-right-stack">
            <ShiftOverviewAlerts alerts={alerts} />
            <ShiftOverviewOccupancy items={floorMetrics.occupancyByZone} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default ShiftOverviewPage

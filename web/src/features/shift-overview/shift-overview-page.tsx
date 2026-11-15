import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Lock, RotateCcw } from "lucide-react"
import { useMemo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useShiftAlerts } from "@/features/floor/alerts"
import { useFloorModel } from "@/features/floor/use-floor-model"
import {
  useBusinessDate,
  useNow,
  useReceptionGuestCount,
  useReservations,
  useWaitlist,
} from "@/hooks/use-data"
import { isApiError } from "@/services"
import { ShiftOverviewAlerts } from "./shift-overview-alerts"
import { ShiftOverviewFloor } from "./shift-overview-floor"
import { isForbiddenError, useCanReadShiftOverview } from "./shift-overview-hooks"
import { ShiftOverviewKpis } from "./shift-overview-kpis"
import { ShiftOverviewOccupancy } from "./shift-overview-occupancy"
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

function KpiSkeletonCard({ hasSubcaption = false }: { hasSubcaption?: boolean }) {
  return (
    <div className="so-kpi-card" data-testid="so-kpi-skeleton-card">
      <div className="so-kpi-top">
        <div className="so-kpi-title-row">
          <Skeleton className="h-[18px] w-24" />
        </div>
        <Skeleton className="h-[16px] w-20" />
        {hasSubcaption ? <Skeleton className="h-[14px] w-28" /> : null}
      </div>
      <div className="so-kpi-middle">
        <Skeleton className="h-[36px] w-14" />
      </div>
      <div className="so-kpi-footer">
        <Skeleton className="h-[15px] w-20" />
      </div>
    </div>
  )
}

function ShiftOverviewSkeleton() {
  return (
    <div
      className="so-root"
      aria-busy="true"
      aria-label="Đang tải tổng quan ca"
      data-testid="shift-overview-loading"
    >
      <div className="so-kpi-row-1">
        {Array.from({ length: 6 }, (_, i) => (
          <KpiSkeletonCard key={i} hasSubcaption={i === 3 || i === 4} />
        ))}
      </div>

      <div className="so-kpi-row-2">
        {Array.from({ length: 4 }, (_, i) => (
          <KpiSkeletonCard key={i} />
        ))}
      </div>

      <div className="so-main-grid">
        <div className="so-panel so-panel--stretch">
          <div className="so-panel-header">
            <div className="so-panel-heading-group">
              <Skeleton className="h-[22px] w-44" />
              <Skeleton className="h-[18px] w-56" />
            </div>
          </div>

          <div className="so-legend" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-[16px] w-16" />
            ))}
          </div>

          <div className="so-zones-list">
            {[8, 10, 4, 15].map((chipCount, z) => (
              <div key={z} className="so-zone-block">
                <Skeleton className="h-[16px] w-20" />
                <div className="so-chip-grid">
                  {Array.from({ length: chipCount }, (_, c) => (
                    <Skeleton key={c} className="h-[40px] w-[62px] rounded-lg" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="so-right-stack">
          <div className="so-panel">
            <div className="so-panel-header">
              <div className="so-panel-heading-group">
                <Skeleton className="h-[22px] w-40" />
                <Skeleton className="h-[18px] w-44" />
              </div>
            </div>
            <div className="so-alert-list">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-[60px] w-full rounded-[10px]" />
              ))}
            </div>
          </div>

          <div className="so-panel">
            <div className="so-panel-header">
              <div className="so-panel-heading-group">
                <Skeleton className="h-[22px] w-44" />
                <Skeleton className="h-[18px] w-36" />
              </div>
            </div>
            <div className="so-occupancy-list">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="so-occupancy-row">
                  <Skeleton className="h-[18px] w-full" />
                  <Skeleton className="h-[8px] w-full rounded-full" />
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

  const waitlistCount = useMemo(
    () => selectActiveWaitlistCount(waitlist.data ?? []),
    [waitlist.data],
  )

  const kpiRows = useMemo(
    () => selectKpiRows(guestCount.data, floorMetrics, waitlistCount),
    [guestCount.data, floorMetrics, waitlistCount],
  )

  const alerts = useMemo(
    () => buildOperationalAlerts(shiftAlerts, waitlist.data ?? [], now),
    [shiftAlerts, waitlist.data, now],
  )

  const firstError = model.error ?? guestCount.error ?? reservations.error ?? waitlist.error

  if (!canRead || isForbiddenError(firstError)) {
    return (
      <div className="so-root" data-testid="shift-overview-forbidden">
        <section className="so-state-card" role="alert">
          <div className="flex items-center gap-2 text-[#102a43]">
            <Lock className="size-5" aria-hidden="true" />
            <h2 className="so-state-title">Không có quyền xem Tổng quan ca</h2>
          </div>
          <p className="so-state-desc">
            Tài khoản hiện tại không có quyền <code>report.read</code> để truy cập báo cáo tổng quan ca.
          </p>
        </section>
      </div>
    )
  }

  const isInitialLoading =
    model.loading ||
    guestCount.isLoading ||
    reservations.isLoading ||
    waitlist.isLoading

  if (isInitialLoading && !firstError) {
    return <ShiftOverviewSkeleton />
  }

  if (firstError) {
    return (
      <div className="so-root" data-testid="shift-overview-error">
        <section className="so-state-card" role="alert">
          <div className="flex items-center gap-2 text-[#a82424]">
            <AlertTriangle className="size-5" aria-hidden="true" />
            <h2 className="so-state-title">Không tải được dữ liệu tổng quan ca</h2>
          </div>
          <p className="so-state-desc">{describeLoadError(firstError)}</p>
          <button
            type="button"
            className="so-retry-btn"
            onClick={() => {
              void queryClient.refetchQueries({ type: "active" })
            }}
            data-testid="shift-overview-retry"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            <span>Thử lại</span>
          </button>
        </section>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="so-root" data-testid="shift-overview-page" data-business-date={businessDate}>
        <ShiftOverviewKpis row1={kpiRows.row1} row2={kpiRows.row2} />
        <div className="so-main-grid">
          <ShiftOverviewFloor zones={floorMetrics.zones} />
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

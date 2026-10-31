import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ZoneCode } from "@/domain/venue-layout"
import { useCatalog, useFloorState, useNow } from "@/hooks/use-data"
import { addDays, businessDateOf, type BusinessDate } from "@/lib/time"
import { activeWaitlistEntries, isApiError, waitlistApi } from "@/services"
import { useSession } from "@/state/session"
import { HttpBookingsPage } from "@/features/reservations/http-bookings-page"
import { FloorCanvas } from "./floor-canvas"
import { LayoutBookingOperations } from "./layout-booking-operations"
import { LayoutTableMove } from "./layout-table-move"
import { LayoutTableMerge } from "./layout-table-merge"
import { LayoutWaitlistAssignment, LayoutWaitlistPanel } from "./layout-waitlist"
import { useLayoutTableController } from "./use-layout-table-controller"
import { useFloorModel } from "./use-floor-model"

export function HttpFloorPage() {
  const principal = useSession((state) => state.principal)
  const permissions = useSession((state) => state.permissions)
  const logout = useSession((state) => state.logout)
  const catalogQuery = useCatalog()
  const now = useNow(30_000)
  const cutoffHour = Number(catalogQuery.data?.venue.businessDayCutoffLocal?.split(":")[0] ?? 5)
  const currentBusinessDate = businessDateOf(now, cutoffHour)
  const [selectedBusinessDate, setSelectedBusinessDate] = useState<BusinessDate>(() => businessDateOf(now))
  const dateTouched = useRef(false)
  const model = useFloorModel(selectedBusinessDate)
  const floorQuery = useFloorState(selectedBusinessDate)
  const [zone, setZone] = useState<ZoneCode | "ALL">("ALL")
  const [pendingLogout, setPendingLogout] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [page, setPage] = useState<"floor" | "bookings">("floor")
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const layout = useLayoutTableController(model, permissions)
  const businessDate = model.floor?.businessDate ?? ""
  useEffect(() => {
    if (!dateTouched.current) setSelectedBusinessDate(currentBusinessDate)
  }, [currentBusinessDate])

  const changeBusinessDate = (next: BusinessDate, userSelected = true) => {
    dateTouched.current = userSelected
    setSelectedBusinessDate(next)
    setWaitlistOpen(false)
  }
  const waitlistQuery = useQuery({
    queryKey: ["http-waitlist", businessDate],
    queryFn: () => waitlistApi!.list(businessDate),
    enabled: waitlistApi !== null && businessDate !== "" && permissions.includes("customer.view_masked"),
    refetchInterval: 15_000,
    retry: false,
  })
  const waitlistCount = activeWaitlistEntries(waitlistQuery.data ?? []).length

  if (!principal) return null

  const refresh = () => Promise.all([catalogQuery.refetch(), floorQuery.refetch(), waitlistQuery.refetch()])
  const error = catalogQuery.error ?? floorQuery.error
  const empty = !model.loading && !error && model.tables.length === 0

  const signOut = async () => {
    setPendingLogout(true)
    setLogoutError(null)
    try {
      await logout()
    } catch (cause) {
      setLogoutError(isApiError(cause) ? cause.message : "Không thể đăng xuất. Vui lòng thử lại.")
    } finally {
      setPendingLogout(false)
    }
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-surface-1 px-2.5 sm:h-16 sm:gap-3 sm:px-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground sm:size-9">
          <Server className="size-4 sm:size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold sm:text-sm">21GAM · {page === "floor" ? "Floor Map" : "Booking"}</p>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            {principal.displayName} · {model.catalog?.venue.name ?? `Venue #${principal.venueId}`}
          </p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground lg:flex">
          <ShieldCheck className="size-3.5 text-emerald-500" /> Dữ liệu backend thật
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          className="sm:w-auto sm:px-3"
          aria-label="Làm mới dữ liệu"
          onClick={() => void refresh()}
          disabled={catalogQuery.isFetching || floorQuery.isFetching}
        >
          <RefreshCw className={catalogQuery.isFetching || floorQuery.isFetching ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Làm mới</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="sm:w-auto sm:px-3"
          aria-label={pendingLogout ? "Đang đăng xuất" : "Đăng xuất"}
          onClick={() => void signOut()}
          disabled={pendingLogout}
        >
          <LogOut /> <span className="hidden sm:inline">{pendingLogout ? "Đang thoát…" : "Đăng xuất"}</span>
        </Button>
      </header>

      <nav className="flex h-10 shrink-0 gap-1 border-b bg-surface-1 px-2.5 py-1 sm:h-11 sm:px-5" aria-label="Chức năng HTTP">
        <Button className="h-8 px-2.5" variant={page === "floor" ? "secondary" : "ghost"} size="sm" onClick={() => setPage("floor")}>
          <LayoutDashboard /> Sơ đồ bàn
        </Button>
        <Button className="h-8 px-2.5" variant={page === "bookings" ? "secondary" : "ghost"} size="sm" onClick={() => setPage("bookings")}>
          <CalendarDays /> Booking
        </Button>
      </nav>

      {page === "bookings" ? (
        <HttpBookingsPage />
      ) : (
        <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 sm:gap-2.5 sm:p-3 lg:p-4">
          <div className="flex shrink-0 flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Ngày trước"
                onClick={() => changeBusinessDate(addDays(selectedBusinessDate, -1))}
              >
                <ChevronLeft />
              </Button>
              <input
                type="date"
                value={selectedBusinessDate}
                aria-label="Ngày nghiệp vụ của Layout"
                onChange={(event) => changeBusinessDate(event.target.value as BusinessDate)}
                className="h-8 w-[142px] rounded-md border bg-background px-2 text-sm sm:w-[150px]"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Ngày sau"
                onClick={() => changeBusinessDate(addDays(selectedBusinessDate, 1))}
              >
                <ChevronRight />
              </Button>
              {selectedBusinessDate !== currentBusinessDate ? (
                <Button className="h-8 px-2 text-xs" variant="outline" size="sm" onClick={() => changeBusinessDate(currentBusinessDate, false)}>
                  Ca hiện tại
                </Button>
              ) : null}
              <p className="ml-auto truncate text-[11px] text-muted-foreground sm:hidden" aria-live="polite">
                {model.floor ? `${model.counts.seated ?? 0} dùng · ${model.counts.reserved ?? 0} giữ` : "Đang tải"}
              </p>
            </div>
            <div
              className="flex min-w-0 max-w-full gap-0.5 overflow-x-auto rounded-lg border bg-surface-1 p-0.5"
              role="tablist"
              aria-label="Lọc khu"
            >
              <Button
                className="h-8 shrink-0 px-2.5 text-xs"
                variant={zone === "ALL" ? "secondary" : "ghost"}
                size="sm"
                role="tab"
                aria-selected={zone === "ALL"}
                onClick={() => setZone("ALL")}
              >
                Tất cả
              </Button>
              {(model.catalog?.zones ?? []).map((item) => (
                <Button
                  key={item.id}
                  className="h-8 shrink-0 px-2.5 text-xs"
                  variant={zone === item.code ? "secondary" : "ghost"}
                  size="sm"
                  role="tab"
                  aria-selected={zone === item.code}
                  onClick={() => setZone(item.code)}
                >
                  {item.name}
                </Button>
              ))}
            </div>
            <p className="ml-auto hidden shrink-0 text-xs text-muted-foreground sm:block" aria-live="polite">
              {model.floor
                ? `${model.tables.length} vị trí · ${model.counts.seated ?? 0} đang dùng · ${model.counts.reserved ?? 0} đã giữ · ${model.counts.spare ?? 0} sơ cua`
                : "Đang đồng bộ trạng thái bàn"}
            </p>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-surface-1 shadow-sm sm:rounded-xl">
            {model.loading ? (
              <div className="grid h-full place-items-center p-5" aria-label="Đang tải sơ đồ bàn">
                <Skeleton className="h-full max-h-[720px] w-full max-w-[620px] rounded-xl" />
              </div>
            ) : error ? (
              <div className="grid h-full place-items-center p-6">
                <div className="max-w-md text-center" role="alert">
                  <AlertTriangle className="mx-auto size-10 text-amber-500" />
                  <h1 className="mt-3 text-lg font-semibold">Không tải được sơ đồ bàn</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {isApiError(error) ? error.message : "Backend không phản hồi hoặc dữ liệu không đúng contract."}
                  </p>
                  <Button className="mt-4" onClick={() => void refresh()}>
                    <RefreshCw /> Thử lại
                  </Button>
                </div>
              </div>
            ) : empty ? (
              <div className="grid h-full place-items-center p-6 text-center">
                <div>
                  <h1 className="text-lg font-semibold">Chưa có bàn để hiển thị</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Catalog backend không trả về bàn hoạt động hoặc ngưng phục vụ.
                  </p>
                </div>
              </div>
            ) : model.catalog ? (
              <>
                <FloorCanvas
                  tables={model.tables}
                  zones={model.catalog.zones}
                  mode="live"
                  states={model.states}
                  groups={model.floor?.groups ?? []}
                  selectedIds={layout.selectedIds}
                  pickable={layout.pickable}
                  zoneFocus={zone}
                  now={now}
                  onTableClick={layout.selectTable}
                  onBackgroundClick={
                    layout.workflow.phase === "IDLE" &&
                    layout.directBookingWorkflow.phase !== "SELECTING_DIRECT_BOOKING_TABLES"
                      ? layout.clearSelection
                      : undefined
                  }
                  ariaLabel="Sơ đồ bàn từ backend"
                  waitlistCount={waitlistCount}
                  waitlistSelected={waitlistOpen || layout.waitlistWorkflow.phase !== "IDLE"}
                  onWaitlistClick={() =>
                    layout.waitlistWorkflow.phase === "IDLE" &&
                    layout.directBookingWorkflow.phase === "IDLE" &&
                    setWaitlistOpen(true)
                  }
                />
                {layout.table && layout.intent && model.floor ? (
                  <LayoutBookingOperations
                    key={`${layout.table.id}-${layout.intent.kind}`}
                    table={layout.table}
                    intent={layout.intent}
                    catalogTables={model.catalog.tables}
                    sources={model.catalog.sources}
                    businessDate={model.floor.businessDate}
                    onClose={layout.intent.kind === "create" ? layout.closeDirectBooking : layout.clearSelection}
                    onStartMove={layout.beginMove}
                    onStartMerge={layout.beginMerge}
                    directBookingWorkflow={layout.directBookingWorkflow}
                    onBeginDirectBookingSelection={layout.beginDirectBookingSelection}
                    onCancelDirectBookingSelection={layout.cancelDirectBookingSelection}
                    onFinishDirectBookingSelection={layout.finishDirectBookingSelection}
                    onBusinessDateChange={(next) => changeBusinessDate(next)}
                  />
                ) : null}
                <LayoutTableMove
                  workflow={layout.workflow}
                  model={model}
                  cancel={layout.cancelOperation}
                  confirm={layout.confirmMove}
                  back={layout.backToSelection}
                  submitting={layout.startSubmitting}
                  success={layout.markSuccess}
                  fail={layout.markError}
                />
                <LayoutTableMerge
                  workflow={layout.mergeWorkflow}
                  model={model}
                  cancel={layout.cancelMerge}
                  confirm={layout.confirmMerge}
                  back={layout.backMerge}
                  submitting={layout.startMergeSubmitting}
                  success={layout.markMergeSuccess}
                  fail={layout.markMergeError}
                />
                <LayoutWaitlistPanel
                  open={waitlistOpen}
                  onOpenChange={setWaitlistOpen}
                  businessDate={businessDate}
                  entries={waitlistQuery.data ?? []}
                  loading={waitlistQuery.isLoading}
                  error={waitlistQuery.error}
                  beginAssignment={layout.beginWaitlistAssignment}
                />
                <LayoutWaitlistAssignment
                  workflow={layout.waitlistWorkflow}
                  model={model}
                  cancel={layout.cancelWaitlist}
                  confirm={layout.confirmWaitlist}
                  back={layout.backWaitlist}
                  submitting={layout.startWaitlistSubmitting}
                  success={layout.markWaitlistSuccess}
                  fail={layout.markWaitlistError}
                />
              </>
            ) : null}
          </div>

          {logoutError ? (
            <p className="text-sm text-destructive" role="alert">
              {logoutError}
            </p>
          ) : null}
          {!permissions.includes("customer.view_masked") ? (
            <p className="text-xs text-amber-600">
              Tài khoản không có quyền customer.view_masked; backend sẽ từ chối dữ liệu Floor Map.
            </p>
          ) : null}
        </section>
      )}
    </main>
  )
}

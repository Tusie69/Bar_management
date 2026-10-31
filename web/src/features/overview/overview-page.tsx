import { AlertCircle, ArrowUpRight, CalendarPlus, History, UserPlus } from "lucide-react"
import { useMemo } from "react"
import { useNavigate } from "react-router"
import { BarChart } from "@/components/bar-chart"
import { EmptyState, GuardedButton, SectionTitle, TableCodes } from "@/components/common"
import { WarningChip } from "@/components/status"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useNow, useOperations, useOverview, useReservations } from "@/hooks/use-data"
import { fmtBusinessDate, fmtTime, MS, venueParts } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api, isApiError } from "@/services"
import { useUi } from "@/state/ui"
import { useShiftAlerts } from "../floor/alerts"
import { useFloorModel } from "../floor/use-floor-model"

export default function OverviewPage() {
  const overview = useOverview()
  const model = useFloorModel()
  const now = useNow(15_000)
  const bd = overview.data?.businessDate ?? model.floor?.businessDate ?? ""
  const reservations = useReservations(bd)
  const ops = useOperations(14)
  const ui = useUi()
  const navigate = useNavigate()
  const booked = useMemo(() => (reservations.data ?? []).filter((r) => r.status === "BOOKED"), [reservations.data])
  const alerts = useShiftAlerts(model, booked, now)
  const o = overview.data
  const nowHour = String(venueParts(now).hour).padStart(2, "0")
  const next60 = booked.filter((r) => r.expectedAt.getTime() - now.getTime() <= 60 * MS.MIN).slice(0, 8)

  if (overview.isError) {
    const msg = isApiError(overview.error)
      ? overview.error.message
      : overview.error instanceof Error
        ? overview.error.message
        : "Không thể tải thông tin ca vận hành"
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState title="Lỗi tải ca vận hành" icon={<AlertCircle className="size-6 text-destructive" />}>
          {msg}
        </EmptyState>
      </div>
    )
  }

  if (!o) {
    return (
      <div className="grid gap-4 p-6">
        <Skeleton className="h-24" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  const metrics: { label: string; value: React.ReactNode; hint?: string; tone?: "alert"; to?: string }[] = [
    {
      label: "Booking tối nay",
      value: o.reservationsTotal,
      hint: `${o.checkedInReservations} đã check-in`,
      to: "/reservations",
    },
    {
      label: "Sắp đến trong 60'",
      value: o.reservationsUpcoming60,
      hint: `${o.reservationsUnassigned} chưa có bàn`,
      to: "/reservations",
    },
    { label: "Khách đang ngồi", value: o.seatedGuests, hint: `${o.seatedVisits} lượt ghé đang mở`, to: "/floor" },
    {
      label: "Bàn đang dùng",
      value: (
        <>
          {o.tablesInUse}
          <span className="text-muted-foreground">/{o.tablesTotal}</span>
        </>
      ),
      hint: `Bar ${o.barSeatsInUse}/${o.barSeatsTotal} ghế`,
      to: "/floor",
    },
    {
      label: "Cần chú ý",
      value: o.attention,
      hint: "muộn · không đến · quá hạn",
      tone: o.attention ? "alert" : undefined,
      to: "/floor",
    },
    {
      label: "Danh sách chờ",
      value: o.waitlistAdvance + o.waitlistWalkIn,
      hint: `${o.waitlistAdvance} đặt trước · ${o.waitlistWalkIn} walk-in`,
      to: "/waitlist",
    },
  ]

  return (
    <div className="h-full scrollbar-thin overflow-y-auto">
      <div className="mx-auto grid max-w-[1400px] gap-6 p-4 md:p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Ca vận hành</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight md:text-[28px]">{fmtBusinessDate(bd)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              17:00 → 05:00 · cập nhật lúc <span className="tnum">{fmtTime(now)}</span>
              {o.visitsTonight !== null && o.guestsTonight !== null ? (
                <>
                  {" "}
                  · {o.visitsTonight} lượt ghé, {o.guestsTonight} khách từ đầu ca
                </>
              ) : (
                <> · Chưa có dữ liệu lượt ghé từ đầu ca</>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <GuardedButton permission="reservation.create" variant="outline" onClick={() => ui.openBooking()}>
              <CalendarPlus /> Đặt bàn
            </GuardedButton>
            <GuardedButton permission="visit.walkin" onClick={() => ui.openWalkIn()}>
              <UserPlus /> Walk-in
            </GuardedButton>
          </div>
        </header>

        <section
          aria-label="Chỉ số ca"
          className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3 xl:grid-cols-6"
        >
          {/* Hairlines come from the 1px grid gap over bg-border: no doubled edges at any breakpoint. */}
          {metrics.map((m) => (
            <button
              key={m.label}
              type="button"
              onClick={() => m.to && navigate(m.to)}
              className="group grid content-start gap-1 bg-background p-4 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
            >
              <span className="flex items-center justify-between text-xs text-muted-foreground">
                {m.label}
                <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </span>
              <span
                className={cn(
                  "tnum text-[32px] leading-none font-bold tracking-tight",
                  m.tone === "alert" && "text-st-late",
                )}
              >
                {m.value}
              </span>
              <span className="text-xs text-subtle">{m.hint}</span>
            </button>
          ))}
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <section className="grid min-w-0 content-start gap-3 rounded-2xl border p-4 md:p-5">
            <SectionTitle aside={<span className="text-xs text-subtle">khách theo giờ</span>}>Nhịp ca</SectionTitle>
            {(() => {
              const hasSeated = o.byHour.some((h) => h.seated !== null)
              return (
                <>
                  <BarChart
                    ariaLabel="Số khách dự kiến theo booking và số khách đã ngồi, theo từng giờ trong ca"
                    series={hasSeated ? ["Dự kiến (booking)", "Đã ngồi"] : ["Dự kiến (booking)"]}
                    data={o.byHour.map((h) => ({
                      key: h.hour,
                      label: `${h.hour}h`,
                      values: hasSeated ? [h.expected ?? 0, h.seated ?? 0] : [h.expected ?? 0],
                      highlight: h.hour === nowHour,
                    }))}
                    marker={{ key: nowHour, label: "bây giờ" }}
                    unit=" khách"
                    height={210}
                  />
                  {!hasSeated ? (
                    <p className="text-xs text-muted-foreground">Chưa có dữ liệu lượt khách theo giờ</p>
                  ) : null}
                </>
              )
            })()}
            <div className="grid gap-2 border-t pt-4">
              <SectionTitle>Theo khu</SectionTitle>
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {o.byZone.map((z) => (
                  <li key={z.zone} className="grid gap-1.5">
                    <div className="flex items-baseline justify-between text-sm">
                      <span>
                        {z.name}
                        {z.zone === "C" ? <span className="text-subtle"> · khu chờ</span> : null}
                      </span>
                      <span className="tnum text-muted-foreground">
                        {z.inUse}/{z.total}
                      </span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-surface-3"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={z.total}
                      aria-valuenow={z.inUse}
                      aria-label={`${z.name} đang dùng`}
                    >
                      <div
                        className="h-full rounded-full bg-st-seated"
                        style={{ width: `${z.total ? (z.inUse / z.total) * 100 : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="grid min-w-0 content-start gap-3 rounded-2xl border p-4 md:p-5">
            <SectionTitle
              aside={
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs font-normal text-muted-foreground"
                  onClick={() => navigate("/floor")}
                >
                  Mở sơ đồ
                </Button>
              }
            >
              Cần xử lý · {alerts.length}
            </SectionTitle>
            {alerts.length === 0 ? (
              <EmptyState title="Ca đang ổn" />
            ) : (
              <ul className="grid gap-1">
                {alerts.slice(0, 7).map((a) => (
                  <li key={a.key}>
                    <button
                      type="button"
                      onClick={() => {
                        if (a.tableId) {
                          ui.selectTable(a.tableId)
                          navigate("/floor")
                        } else if (a.reservationId) ui.openReservation(a.reservationId, bd)
                      }}
                      className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-surface-2"
                    >
                      <span
                        className="grid size-8 shrink-0 place-items-center rounded-full"
                        style={{ color: `var(--st-${a.tone})`, background: `var(--st-${a.tone}-tint)` }}
                      >
                        {a.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{a.detail}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 border-t pt-4">
              <SectionTitle>Sắp đến trong 60 phút</SectionTitle>
              {next60.length === 0 ? (
                <p className="text-sm text-muted-foreground">Không có booking nào.</p>
              ) : (
                <ul className="grid gap-1.5">
                  {next60.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => ui.openReservation(r.id, r.businessDate)}
                        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-surface-2"
                      >
                        <span className="tnum w-12 text-sm font-semibold">{fmtTime(r.expectedAt)}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {r.displayName} · {r.partySize} khách
                        </span>
                        {r.warning ? (
                          <WarningChip warning={r.warning} minutes={r.minutesLate} />
                        ) : r.tableIds.length ? (
                          <TableCodes codes={model.codes(r.tableIds)} symbolNo={r.symbolNo} />
                        ) : (
                          <span className="text-xs text-subtle">Chưa có bàn</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        <section className="grid min-w-0 gap-3 rounded-2xl border p-4 md:p-5">
          <SectionTitle
            aside={
              <span className="inline-flex items-center gap-1.5 text-xs text-subtle">
                <History className="size-3.5" /> operation_log
              </span>
            }
          >
            Hoạt động gần đây
          </SectionTitle>
          {api.mode === "http" ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nhật ký hoạt động (operation_log) chưa được backend v1 hỗ trợ.
            </p>
          ) : (
            <ol className="grid gap-x-8 gap-y-1 md:grid-cols-2">
              {(ops.data ?? []).map((op) => (
                <li
                  key={op.id}
                  className="grid grid-cols-[3.25rem_1fr] gap-2 border-b border-dashed py-2 text-sm last:border-0 md:[&:nth-last-child(2)]:border-0"
                >
                  <span className="tnum text-xs text-subtle">{fmtTime(op.occurredAt)}</span>
                  <span className="min-w-0">
                    <span className="block truncate">
                      <span className="font-medium">{op.actionLabel}</span> · {op.summary}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {op.actorKind === "SYSTEM"
                        ? "Hệ thống (cảnh báo tự động)"
                        : `${op.actorName}${op.deviceLabel ? ` · ${op.deviceLabel}` : ""}`}
                      {op.compensatedBy ? " · đã hoàn tác" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}

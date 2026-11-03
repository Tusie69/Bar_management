import { Fragment, useEffect, useRef } from "react"
import { EmptyState, GroupSymbolIcon } from "@/components/common"
import { STATE_META } from "@/components/status-meta"
import { Skeleton } from "@/components/ui/skeleton"
import type { AllocationView, TableView } from "@/domain/models"
import type { ZoneCode } from "@/domain/venue-layout"
import { useDayAllocations } from "@/hooks/use-data"
import { atBusinessTime, fmtTime, minutesBetween, MS, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import type { FloorModel } from "./use-floor-model"

// shortcut: reservations-page.tsx keeps its own older Timeline; point it here once that page gets the v2 look.
const HW = 112
const LW = 104
const HOURS = 12
const ZONES: ZoneCode[] = ["A", "B", "C", "BAR"]
const GRID =
  "repeating-linear-gradient(90deg,var(--border) 0 1px,transparent 1px 112px),repeating-linear-gradient(90deg,var(--surface-2) 0 1px,transparent 1px 56px)"
const pad2 = (n: number) => String(n).padStart(2, "0")

/** "Thời gian" view (v2): one row per table, grouped by zone, from table_allocations. */
export function FloorTimeline({
  model,
  date,
  now,
  zone,
  live,
}: {
  model: FloorModel
  date: BusinessDate
  now: Date
  zone: ZoneCode | "ALL"
  live: boolean
}) {
  const allocations = useDayAllocations(date)
  const ui = useUi()
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)
  const start = atBusinessTime(date, "17:00").getTime()
  const end = start + HOURS * MS.HOUR
  const x = (t: Date) => Math.round(((Math.min(Math.max(t.getTime(), start), end) - start) / MS.HOUR) * HW)
  const nowX = now.getTime() >= start && now.getTime() <= end ? x(now) : null

  // Jump to "now" once per date, not on every clock tick.
  useEffect(() => {
    if (scrollRef.current && nowX !== null && scrolledFor.current !== date) {
      scrollRef.current.scrollLeft = Math.max(0, nowX - 260)
      scrolledFor.current = date
    }
  })

  if (api.mode === "http") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState title="Chưa hỗ trợ dòng thời gian">
          Dữ liệu lịch sử sử dụng bàn (allocations) chưa được backend v1 hỗ trợ.
        </EmptyState>
      </div>
    )
  }

  if (!model.catalog || allocations.isLoading) return <Skeleton className="min-h-0 flex-1" />

  const byTable = new Map<number, AllocationView[]>()
  for (const a of allocations.data ?? []) {
    if (a.kind === "HOLD" && a.releasedAt) continue
    if (!byTable.has(a.tableId)) byTable.set(a.tableId, [])
    byTable.get(a.tableId)!.push(a)
  }
  const groups = ZONES.filter((z) => zone === "ALL" || zone === z).map((z) => {
    const zv = model.catalog!.zones.find((q) => q.code === z)
    const tables = model.tables
      .filter((t) => t.zoneCode === z)
      .sort((a, b) => (a.seqNo ?? 0) - (b.seqNo ?? 0) || a.code.localeCompare(b.code, "vi", { numeric: true }))
    const unit = z === "BAR" ? "ghế" : "bàn"
    return {
      z,
      name: `${zv?.name ?? z}${zv?.isWaitingArea ? " · khu chờ" : ""}`,
      count: `${tables.length} ${unit}`,
      tables,
    }
  })
  const select = (t: TableView, a?: AllocationView) => {
    if (live && (!a || !a.releasedAt)) ui.selectTable(t.id)
    else if (a?.reservationId) ui.openReservation(a.reservationId, date)
  }

  const item = (t: TableView, a: AllocationView) => {
    const x0 = x(a.startsAt)
    const head = `${fmtTime(a.startsAt)} · ${a.partySize ?? "?"} khách`
    if (a.kind === "USAGE") {
      const active = !a.releasedAt
      const x1 = a.releasedAt ? x(a.releasedAt) : (nowX ?? x(new Date(end)))
      const w = Math.max(4, x1 - x0)
      const inside = w >= 150
      return (
        <Fragment key={a.allocationId}>
          <button
            type="button"
            onClick={() => select(t, a)}
            title={`${head} · ${a.name}`}
            className={cn(
              "absolute inset-y-1.5 z-[2] overflow-hidden text-left",
              active ? "rounded-l-sm" : "rounded-sm bg-surface-3 text-tx-2",
            )}
            style={{
              left: x0,
              width: w,
              ...(active ? { background: "var(--st-seated-fill)", color: "var(--on-seated)" } : {}),
            }}
          >
            {inside ? (
              <span className="absolute inset-x-2 inset-y-0 flex flex-col justify-center text-xs leading-4 whitespace-nowrap">
                <span className="tnum font-semibold">{head}</span>
                <span className="truncate font-medium">{a.name}</span>
              </span>
            ) : null}
          </button>
          {active ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-1.5 z-[2] w-8 opacity-55"
              style={{ left: x0 + w, background: "linear-gradient(90deg,var(--st-seated-fill),transparent)" }}
            />
          ) : null}
          {!inside ? (
            <span
              className={cn(
                "tnum absolute top-1/2 z-[2] -translate-y-1/2 text-xs leading-4 font-medium whitespace-nowrap",
                active ? "text-st-seated-ink" : "text-tx-3",
              )}
              style={{ left: x1 + (active ? 40 : 8) }}
            >
              {head} · {a.name}
            </span>
          ) : null}
        </Fragment>
      )
    }
    if (a.holdKind === "WAITLIST_OFFER") {
      const overdue = !!a.deadlineAt && now > a.deadlineAt
      const m = STATE_META[overdue ? "hold_overdue" : "hold"]
      const x1 = a.deadlineAt ? x(a.deadlineAt) : x0 + HW / 2
      const mins = a.deadlineAt ? Math.abs(minutesBetween(now, a.deadlineAt)) : 0
      return (
        <Fragment key={a.allocationId}>
          {overdue && nowX !== null ? (
            <div
              className="absolute bottom-[7px] z-[2] border-b-2 border-dotted"
              style={{ left: x1, width: nowX - x1, borderColor: "var(--st-late)" }}
            />
          ) : null}
          <button
            type="button"
            onClick={() => select(t, a)}
            className="absolute inset-y-2 z-[2] rounded-sm border-[1.5px] border-dashed"
            style={{ left: x0, width: Math.max(8, x1 - x0), borderColor: m.color, background: m.tint }}
            aria-label={`Giữ cho ${a.name} đến ${fmtTime(a.deadlineAt)}`}
          />
          <span
            className="absolute top-1/2 z-[2] flex -translate-y-1/2 flex-col text-xs leading-4 whitespace-nowrap"
            style={{ left: Math.max(x1, nowX ?? 0) + 12 }}
          >
            <span className="tnum font-semibold" style={{ color: m.ink }}>
              Giữ {fmtTime(a.startsAt)} → {fmtTime(a.deadlineAt)}
            </span>
            <span className="font-medium text-tx-2">
              {a.name} · {overdue ? `quá hạn ${mins}'` : `còn ${mins}'`}
            </span>
          </span>
        </Fragment>
      )
    }
    const tone = a.warning ?? "reserved"
    const m = STATE_META[tone]
    const late = Math.max(0, minutesBetween(a.startsAt, now))
    const word = tone === "late" ? `Muộn ${late}'` : tone === "noshow" ? `Không đến · ${late}'` : "Đã đặt"
    return (
      <Fragment key={a.allocationId}>
        {a.warning && nowX !== null && nowX > x0 ? (
          <div
            className="absolute bottom-[7px] z-[2] border-b-2 border-dotted"
            style={{ left: x0, width: nowX - x0, borderColor: m.color }}
          />
        ) : null}
        <button
          type="button"
          onClick={() => (a.reservationId ? ui.openReservation(a.reservationId, date) : select(t, a))}
          className="absolute inset-y-[5px] z-[2] flex text-left"
          style={{ left: x0 }}
        >
          <span className="w-[3px] shrink-0 rounded-[2px]" style={{ background: m.color }} />
          <span
            className="flex min-w-[132px] flex-col justify-center pr-6 pl-2 text-xs leading-4 whitespace-nowrap"
            style={{ background: `linear-gradient(90deg, ${m.tint} 70%, transparent)` }}
          >
            <span className="tnum flex items-center gap-1.5 font-semibold" style={{ color: m.ink }}>
              {head}
              {a.symbolNo ? <GroupSymbolIcon no={a.symbolNo} size={12} /> : null}
            </span>
            <span className="font-medium text-tx-2">
              {a.name} · {word}
            </span>
          </span>
        </button>
      </Fragment>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 scrollbar-thin overflow-auto rounded-sm border bg-surface-1"
    >
      <div className="relative" style={{ width: LW + HOURS * HW }}>
        <div className="sticky top-0 z-[5] flex h-11 border-b border-strong bg-surface-1">
          <div className="sticky left-0 z-[6] flex w-[104px] shrink-0 items-center gap-2 border-r border-strong bg-surface-1 px-3 text-xs font-semibold text-tx-head">
            Bàn<span className="ml-auto">Chỗ</span>
          </div>
          <div className="relative shrink-0" style={{ width: HOURS * HW }}>
            {Array.from({ length: HOURS }, (_, i) => (
              <span
                key={i}
                className="tnum absolute inset-y-0 flex items-center border-l pl-2 text-[13px] font-semibold text-tx-head"
                style={{ left: i * HW }}
              >
                {pad2((17 + i) % 24)}h
              </span>
            ))}
            {nowX !== null ? (
              <span
                className="tnum absolute top-2.5 flex h-6 -translate-x-1/2 items-center rounded-sm bg-foreground px-2 text-xs font-semibold text-background"
                style={{ left: nowX }}
              >
                {fmtTime(now)}
              </span>
            ) : null}
          </div>
        </div>
        {groups.map((g) => (
          <Fragment key={g.z}>
            <div className="flex h-8 border-b bg-surface-2">
              <div className="sticky left-0 z-[3] flex items-center gap-2 bg-surface-2 px-3 text-[13px] font-semibold whitespace-nowrap text-tx-strong">
                {g.name}
                <span className="text-xs font-normal text-tx-3">{g.count}</span>
              </div>
            </div>
            {g.tables.map((t) => {
              const sel = live && ui.selectedTableId === t.id
              return (
                <div key={t.id} className={cn("flex h-12 border-b", sel && "bg-surface-2")}>
                  <button
                    type="button"
                    onClick={() => select(t)}
                    aria-pressed={sel}
                    className={cn(
                      "sticky left-0 z-[3] flex w-[104px] shrink-0 items-center gap-2 border-r border-strong px-3 text-left",
                      sel ? "bg-surface-3" : "bg-surface-1",
                    )}
                  >
                    <span className="text-xs font-semibold text-tx-strong">{model.label(t.id)}</span>
                    <span className="tnum ml-auto text-xs font-medium text-tx-2">
                      {t.isSpare ? "sơ cua" : t.capacity}
                    </span>
                  </button>
                  <div className="relative shrink-0" style={{ width: HOURS * HW, backgroundImage: GRID }}>
                    {t.status === "OUT_OF_SERVICE" ? (
                      <div
                        className="absolute inset-x-0 inset-y-1"
                        style={{
                          background: "repeating-linear-gradient(45deg,var(--surface-3) 0 2px,transparent 2px 7px)",
                        }}
                      >
                        <span
                          className="absolute top-1/2 -translate-y-1/2 text-xs font-medium whitespace-nowrap text-tx-2"
                          style={{ left: (nowX ?? 360) + 12 }}
                        >
                          Ngưng phục vụ
                        </span>
                      </div>
                    ) : null}
                    {(byTable.get(t.id) ?? []).map((a) => item(t, a))}
                  </div>
                </div>
              )
            })}
          </Fragment>
        ))}
        {nowX !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-11 bottom-0 z-[1] w-0.5 bg-foreground opacity-75"
            style={{ left: LW + nowX - 1 }}
          />
        ) : null}
      </div>
    </div>
  )
}

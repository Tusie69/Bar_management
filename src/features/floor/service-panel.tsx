import { AlarmClock, CalendarClock, LogIn, Plus, Users } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { EmptyState, GuardedButton, MaskedPhone, TableCodes } from "@/components/common"
import { StateChip, StateSwatch, WarningChip } from "@/components/status"
import { STATE_META, STATE_ORDER } from "@/components/status-meta"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WAITLIST_KIND_LABEL, WAITLIST_STATUS_LABEL } from "@/domain/enums"
import type { ReservationView, VisitView, WaitlistEntryView } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { useNow, useReservations, useVisits, useWaitlist } from "@/hooks/use-data"
import { fmtBusinessDate, fmtElapsed, fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import { GuestCountDialog } from "./floor-dialogs"
import type { FloorModel } from "./use-floor-model"
import { useShiftAlerts, type Alert } from "./alerts"

export function ServicePanel({ model }: { model: FloorModel }) {
  const bd = model.floor?.businessDate ?? ""
  const reservations = useReservations(bd)
  const visits = useVisits(bd)
  const waitlist = useWaitlist(bd)
  const now = useNow(15_000)
  const [tab, setTab] = useState("alerts")

  const booked = useMemo(() => (reservations.data ?? []).filter((r) => r.status === "BOOKED"), [reservations.data])
  const seated = useMemo(() => (visits.data ?? []).filter((v) => !v.endedAt), [visits.data])
  const waiting = useMemo(
    () => (waitlist.data ?? []).filter((e) => ["WAITING", "CONTACTING", "OFFERED", "HOLD_ACTIVE"].includes(e.status)),
    [waitlist.data],
  )

  const alerts = useShiftAlerts(model, booked, now)

  const loading = reservations.isLoading || visits.isLoading || waitlist.isLoading

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-4 pt-4 pb-3">
        <p className="eyebrow">Ca tối nay</p>
        <h2 className="mt-1 text-lg font-bold">
          {bd ? fmtBusinessDate(bd) : "..."} <span className="font-normal text-muted-foreground">· 17:00 → 05:00</span>
        </h2>
        <Legend model={model} />
      </header>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="mx-3 mt-3 grid h-11 w-auto grid-cols-4">
          <TabsTrigger value="alerts" className="h-9 gap-1 px-1 text-xs">
            Xử lý <CountBadge n={alerts.length} tone={alerts.length ? "alert" : undefined} />
          </TabsTrigger>
          <TabsTrigger value="upcoming" className="h-9 gap-1 px-1 text-xs">
            Sắp đến <CountBadge n={booked.length} />
          </TabsTrigger>
          <TabsTrigger value="seated" className="h-9 gap-1 px-1 text-xs">
            Đang ngồi <CountBadge n={seated.length} />
          </TabsTrigger>
          <TabsTrigger value="waiting" className="h-9 gap-1 px-1 text-xs">
            Chờ <CountBadge n={waiting.length} />
          </TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto">
          {loading ? (
            <div className="grid gap-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : (
            <>
              <TabsContent value="alerts" className="m-0 p-2">
                <AlertList alerts={alerts} bd={bd} />
              </TabsContent>
              <TabsContent value="upcoming" className="m-0 p-2">
                <UpcomingList list={booked} model={model} />
              </TabsContent>
              <TabsContent value="seated" className="m-0 p-2">
                <SeatedList list={seated} model={model} />
              </TabsContent>
              <TabsContent value="waiting" className="m-0 p-2">
                <WaitingList list={waiting} model={model} />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  )
}

function CountBadge({ n, tone }: { n: number; tone?: "alert" }) {
  return (
    <span
      className={cn(
        "tnum rounded-full px-1.5 text-[10px] leading-4",
        tone === "alert" ? "bg-st-late text-background" : "bg-surface-3 text-muted-foreground",
      )}
    >
      {n}
    </span>
  )
}

function Legend({ model }: { model: FloorModel }) {
  return (
    <ul className="mt-3 grid grid-cols-3 gap-x-3 gap-y-1.5" aria-label="Chú giải trạng thái">
      {STATE_ORDER.map((s) => (
        <li key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StateSwatch state={s} />
          <span className="truncate">{STATE_META[s].short}</span>
          <span className="tnum ml-auto text-foreground">{model.counts[s] ?? 0}</span>
        </li>
      ))}
    </ul>
  )
}

function Row({
  onClick,
  children,
  className,
}: {
  onClick?: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-lg px-2.5 py-2 transition-colors outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  )
}

function AlertList({ alerts, bd }: { alerts: Alert[]; bd: string }) {
  const ui = useUi()
  const bdOf = () => bd
  if (!alerts.length)
    return (
      <EmptyState title="Không có gì cần xử lý" icon={<AlarmClock />}>
        Cảnh báo đến muộn (15'), không đến (30') và giữ bàn quá hạn sẽ xuất hiện ở đây.
      </EmptyState>
    )
  return (
    <ul className="grid gap-1">
      {alerts.map((a) => (
        <li key={a.key}>
          <Row
            onClick={() =>
              a.tableId
                ? ui.selectTable(a.tableId)
                : a.reservationId
                  ? ui.openReservation(a.reservationId, bdOf())
                  : undefined
            }
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full"
              style={{ color: `var(--st-${a.tone})`, background: `var(--st-${a.tone}-tint)` }}
            >
              {a.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{a.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{a.detail}</span>
            </span>
          </Row>
        </li>
      ))}
    </ul>
  )
}

function UpcomingList({ list, model }: { list: ReservationView[]; model: FloorModel }) {
  const ui = useUi()
  const { run } = useAction()
  const [checkIn, setCheckIn] = useState<ReservationView | null>(null)
  if (!list.length) return <EmptyState title="Không còn booking chờ đến" icon={<CalendarClock />} />
  const assign = (r: ReservationView) =>
    ui.startPick({
      intent: "assign",
      title: `Phân bàn cho ${r.displayName} · ${r.partySize} khách`,
      hint: `Booking ${fmtTime(r.expectedAt)}. Chạm một hoặc nhiều bàn trống.`,
      multi: true,
      confirmLabel: "Phân bàn",
      onConfirm: async (ids) => !!(await run((o) => api.assignTables(r.id, r.version, ids, o))),
    })
  return (
    <>
      <ul className="grid gap-1">
        {list.map((r) => (
          <li key={r.id}>
            <Row
              onClick={() => (r.tableIds[0] ? ui.selectTable(r.tableIds[0]) : ui.openReservation(r.id, r.businessDate))}
            >
              <span className="tnum w-12 shrink-0 text-sm font-semibold">{fmtTime(r.expectedAt)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{r.displayName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.partySize} khách</span>
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {r.tableIds.length ? (
                    <TableCodes codes={model.codes(r.tableIds)} symbolNo={r.symbolNo} className="[&>span]:text-xs" />
                  ) : (
                    <Badge variant="outline" className="h-5 border-dashed text-[11px]">
                      {r.subState === "CHO_BAN" ? "Đang chờ bàn" : "Chờ phân bàn"}
                    </Badge>
                  )}
                  <WarningChip warning={r.warning} minutes={r.minutesLate} />
                </span>
              </span>
              {r.tableIds.length ? (
                <GuardedButton
                  permission="visit.checkin"
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCheckIn(r)
                  }}
                  aria-label={`Check-in ${r.displayName}`}
                >
                  <LogIn /> Check-in
                </GuardedButton>
              ) : r.subState === "CHO_PHAN_BAN" ? (
                <GuardedButton
                  permission="table.assign"
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation()
                    assign(r)
                  }}
                >
                  Phân bàn
                </GuardedButton>
              ) : null}
            </Row>
          </li>
        ))}
      </ul>
      <GuestCountDialog
        open={!!checkIn}
        onOpenChange={(o) => !o && setCheckIn(null)}
        title={`Check-in ${checkIn?.displayName ?? ""}`}
        description={
          <>
            Booking {fmtTime(checkIn?.expectedAt)} · {checkIn ? model.codes(checkIn.tableIds).join(" + ") : ""}
          </>
        }
        initial={checkIn?.partySize ?? 2}
        confirmLabel="Check-in"
        onConfirm={async (count) => {
          if (!checkIn) return
          const r = await run(() =>
            api.checkIn({ reservationId: checkIn.id, version: checkIn.version, guestCount: count }),
          )
          if (r) setCheckIn(null)
        }}
      />
    </>
  )
}

function SeatedList({ list, model }: { list: VisitView[]; model: FloorModel }) {
  const ui = useUi()
  const now = useNow(30_000)
  if (!list.length) return <EmptyState title="Chưa có khách đang ngồi" icon={<Users />} />
  return (
    <ul className="grid gap-1">
      {list.map((v) => (
        <li key={v.id}>
          <Row onClick={() => v.tableIds[0] && ui.selectTable(v.tableIds[0])}>
            <span className="w-16 shrink-0">
              <TableCodes codes={model.codes(v.tableIds)} symbolNo={v.symbolNo} className="[&>span]:text-xs" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{v.displayName}</span>
              <span className="block text-xs text-muted-foreground">
                {v.guestCount} khách · từ {fmtTime(v.startedAt)} · {fmtElapsed(now.getTime() - v.startedAt.getTime())}
              </span>
            </span>
            {v.paidMarkedAt ? (
              <StateChip state="seated" className="h-5 text-[11px]">
                Đã TT
              </StateChip>
            ) : null}
          </Row>
        </li>
      ))}
    </ul>
  )
}

function WaitingList({ list, model }: { list: WaitlistEntryView[]; model: FloorModel }) {
  const navigate = useNavigate()
  const ui = useUi()
  const now = useNow(30_000)
  const groups = (["ADVANCE_RESERVATION", "WALK_IN"] as const).map((kind) => ({
    kind,
    items: list.filter((e) => e.kind === kind),
  }))
  return (
    <div className="grid gap-3">
      {groups.map((g) => (
        <section key={g.kind} className="grid gap-1">
          <h3 className="eyebrow px-2.5 pt-1">
            {WAITLIST_KIND_LABEL[g.kind]} · {g.items.length}
          </h3>
          {g.items.length === 0 ? <p className="px-2.5 text-sm text-muted-foreground">Trống</p> : null}
          {g.items.map((e) => (
            <Row
              key={e.id}
              onClick={() =>
                e.hold?.tableIds[0] ? ui.selectTable(e.hold.tableIds[0]) : navigate(`/waitlist?entry=${e.id}`)
              }
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{e.displayName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{e.partySize} khách</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {WAITLIST_STATUS_LABEL[e.status]}
                  {e.hold ? ` ${model.codes(e.hold.tableIds).join(" + ")}` : ""} · chờ{" "}
                  {fmtElapsed(now.getTime() - e.queuedAt.getTime())}
                </span>
              </span>
              <MaskedPhone last3={e.phoneLast3} className="hidden 2xl:inline-flex" />
            </Row>
          ))}
        </section>
      ))}
      <div className="flex gap-2 px-2">
        <GuardedButton
          permission="waitlist.create"
          variant="outline"
          size="sm"
          onClick={() => navigate("/waitlist?add=1")}
        >
          <Plus /> Thêm khách chờ
        </GuardedButton>
        <Button variant="ghost" size="sm" onClick={() => navigate("/waitlist")}>
          Mở danh sách chờ
        </Button>
      </div>
    </div>
  )
}

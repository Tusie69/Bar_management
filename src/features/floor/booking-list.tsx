import { Filter, Search, Users } from "lucide-react"
import { useMemo, useState } from "react"
import { GuardedButton } from "@/components/common"
import { STATE_META } from "@/components/status-meta"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import type { Permission } from "@/domain/access"
import { SOURCE_LABEL, type BookingSourceCode } from "@/domain/enums"
import type { ReservationView, TableLiveState } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { useReservations } from "@/hooks/use-data"
import { foldVietnamese, maskedPhone } from "@/lib/text"
import { fmtTime, minutesBetween, MS, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useUi } from "@/state/ui"
import { GuestCountDialog } from "./floor-dialogs"
import type { FloorModel } from "./use-floor-model"

export type ListTab = "attn" | "upcoming" | "all"
type Tone = Extract<TableLiveState, "reserved" | "late" | "noshow" | "seated" | "hold" | "hold_overdue">

export interface BookingItem {
  key: string
  at: Date
  cap: string
  name: string
  phone: string
  source: string
  sourceCode: BookingSourceCode | null
  party: number
  tables: string
  status: string
  tone: Tone
  tableId: number | null
  reservation: ReservationView | null
  search: string
}

const ATTN: Tone[] = ["noshow", "late", "hold_overdue", "hold"]
const byTime = (a: BookingItem, b: BookingItem) => a.at.getTime() - b.at.getTime()

/** One feed for the left list, the list view and the tab counts: bookings of the day + live waitlist holds. */
export function useBookingItems(model: FloorModel, bd: BusinessDate, live: boolean, nowMin: number) {
  const reservations = useReservations(bd)
  return useMemo(() => {
    const now = new Date(nowMin * MS.MIN)
    const items: BookingItem[] = []
    const labels = (ids: number[]) => ids.map(model.label).join(" + ")
    for (const r of reservations.data ?? []) {
      if (r.status !== "BOOKED" && r.status !== "CHECKED_IN") continue
      const tone: Tone = r.status === "CHECKED_IN" ? "seated" : (r.warning ?? "reserved")
      const tables = r.tableIds.length ? labels(r.tableIds) : "Chưa có bàn"
      items.push({
        key: `r${r.id}`,
        at: r.expectedAt,
        cap: "giờ đặt",
        name: r.displayName,
        phone: maskedPhone(r.phoneLast3),
        source: SOURCE_LABEL[r.sourceCode],
        sourceCode: r.sourceCode,
        party: r.partySize,
        tables,
        status:
          tone === "seated"
            ? `Đến ${fmtTime(r.checkedInAt)}`
            : tone === "late"
              ? `Muộn ${r.minutesLate}'`
              : tone === "noshow"
                ? `Không đến · ${r.minutesLate}'`
                : r.subState === "CHO_PHAN_BAN"
                  ? "Chờ phân bàn"
                  : "Đã đặt",
        tone,
        tableId: r.tableIds[0] ?? null,
        reservation: r,
        search: foldVietnamese(`${r.displayName} ${r.phoneLast3 ?? ""} ${tables}`),
      })
    }
    if (live) {
      const seen = new Set<number>()
      for (const [tableId, s] of model.states) {
        const c = s.claim
        if ((s.state !== "hold" && s.state !== "hold_overdue") || !c || c.kind !== "waitlist_hold") continue
        const id = c.holdId ?? tableId
        if (seen.has(id)) continue
        seen.add(id)
        const deadline = c.deadlineAt ?? c.startsAt
        const mins = Math.abs(minutesBetween(now, deadline))
        const tables = labels(c.tableIds.length ? c.tableIds : [tableId])
        items.push({
          key: `h${id}`,
          at: deadline,
          cap: "hạn giữ",
          name: c.displayName,
          phone: maskedPhone(c.phoneLast3),
          source: "Danh sách chờ",
          sourceCode: null,
          party: c.partySize,
          tables,
          status: s.state === "hold" ? `Còn ${mins}'` : `Quá hạn ${mins}'`,
          tone: s.state,
          tableId,
          reservation: null,
          search: foldVietnamese(`${c.displayName} ${c.phoneLast3 ?? ""} ${tables}`),
        })
      }
    }
    return {
      loading: reservations.isLoading,
      attn: items
        .filter((i) => ATTN.includes(i.tone))
        .sort((a, b) => ATTN.indexOf(a.tone) - ATTN.indexOf(b.tone) || byTime(a, b)),
      upcoming: items.filter((i) => i.tone === "reserved").sort(byTime),
      all: [...items].sort(byTime),
    }
  }, [reservations.data, reservations.isLoading, model, live, nowMin])
}

export type BookingFeed = ReturnType<typeof useBookingItems>

export const LIST_TABS: { id: ListTab; label: string }[] = [
  { id: "attn", label: "Cần xử lý" },
  { id: "upcoming", label: "Sắp đến" },
  { id: "all", label: "Tất cả" },
]

const pad2 = (n: number) => String(n).padStart(2, "0")

/** Row click + the one primary action per row, wired to the existing flows. */
function useRowActions(model: FloorModel, live: boolean) {
  const ui = useUi()
  const { run } = useAction()
  const [checkIn, setCheckIn] = useState<ReservationView | null>(null)

  const select = (it: BookingItem) => {
    if (live && it.tableId) ui.selectTable(it.tableId)
    else if (it.reservation) ui.openReservation(it.reservation.id, it.reservation.businessDate)
  }

  const actionOf = (it: BookingItem): { label: string; permission?: Permission; run: () => void } => {
    const r = it.reservation
    if (!r) return { label: "Xếp chỗ", run: () => select(it) }
    if (r.status === "CHECKED_IN") return { label: "Chi tiết", run: () => select(it) }
    if (it.tone === "noshow") return { label: "Xử lý", run: () => ui.openReservation(r.id, r.businessDate) }
    if (r.tableIds.length && live) return { label: "Check-in", permission: "visit.checkin", run: () => setCheckIn(r) }
    if (r.subState === "CHO_PHAN_BAN" && live)
      return {
        label: "Phân bàn",
        permission: "table.assign",
        run: () =>
          ui.startPick({
            intent: "assign",
            title: `Phân bàn cho ${r.displayName} · ${r.partySize} khách`,
            hint: `Booking ${fmtTime(r.expectedAt)}. Chạm một hoặc nhiều bàn trống.`,
            multi: true,
            confirmLabel: "Phân bàn",
            onConfirm: async (ids) => !!(await run((o) => api.assignTables(r.id, r.version, ids, o))),
          }),
      }
    return { label: "Chi tiết", run: () => ui.openReservation(r.id, r.businessDate) }
  }

  const dialog = (
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
        const r = await run(() => api.checkIn({ reservationId: checkIn.id, version: checkIn.version, guestCount: count }))
        if (r) setCheckIn(null)
      }}
    />
  )

  return { select, actionOf, dialog }
}

function StatusTag({ it }: { it: BookingItem }) {
  const m = STATE_META[it.tone]
  return (
    <span
      className="tnum inline-flex h-6 items-center rounded-sm px-2 text-xs font-semibold whitespace-nowrap"
      style={{ background: m.tint, color: m.ink }}
    >
      {it.status}
    </span>
  )
}

function ActionButton({ a }: { a: ReturnType<ReturnType<typeof useRowActions>["actionOf"]> }) {
  const primary = a.label === "Check-in"
  return (
    <GuardedButton
      permission={a.permission}
      variant="outline"
      size="sm"
      className={cn("min-w-[84px] bg-surface-1 font-semibold", primary ? "border-primary text-primary-ink" : "border-strong")}
      onClick={(e) => {
        e.stopPropagation()
        a.run()
      }}
    >
      {a.label}
    </GuardedButton>
  )
}

const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault()
    fn()
  }
}

/** Left column of the Điều phối screen (v2): search + source filter, cards, tab bar. */
export function BookingList({
  feed,
  tab,
  setTab,
  model,
  live,
}: {
  feed: BookingFeed
  tab: ListTab
  setTab: (t: ListTab) => void
  model: FloorModel
  live: boolean
}) {
  const selectedId = useUi((s) => s.selectedTableId)
  const [q, setQ] = useState("")
  const [sources, setSources] = useState<BookingSourceCode[]>([])
  const { select, actionOf, dialog } = useRowActions(model, live)
  const fq = foldVietnamese(q)
  const rows = feed[tab].filter(
    (it) => (!sources.length || (it.sourceCode && sources.includes(it.sourceCode))) && (!fq || it.search.includes(fq)),
  )
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-1">
      <div className="shrink-0 bg-background px-4 py-3">
        <div className="flex h-10 items-center gap-2.5 rounded-sm bg-surface-2 pr-1 pl-3 focus-within:shadow-[inset_0_-2px_0_var(--primary)]">
          <Search className="size-4 shrink-0 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tên khách, 3 số cuối SĐT, mã bàn"
            aria-label="Tìm booking"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <span className="h-[18px] w-px shrink-0 bg-border" />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Lọc theo nguồn đặt"
                className={cn(
                  "relative grid size-8 shrink-0 place-items-center rounded-sm hover:bg-surface-3",
                  sources.length ? "bg-primary-tint text-primary-ink" : "text-muted-foreground",
                )}
              >
                <Filter className="size-4" />
                {sources.length ? (
                  <span className="tnum absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                    {sources.length}
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-0">
              <div className="flex items-center py-2 pr-2 pl-3.5">
                <span className="text-sm font-semibold text-primary-ink">Nguồn đặt</span>
                <button
                  type="button"
                  onClick={() => setSources([])}
                  className="ml-auto h-8 rounded-sm px-2.5 text-sm font-medium text-tx-2 hover:bg-surface-2"
                >
                  Xóa lọc
                </button>
              </div>
              {(Object.keys(SOURCE_LABEL) as BookingSourceCode[]).map((code) => (
                <label key={code} className="flex h-10 cursor-pointer items-center gap-2.5 px-3.5 text-sm hover:bg-surface-2">
                  <Checkbox
                    checked={sources.includes(code)}
                    onCheckedChange={(on) =>
                      setSources((s) => (on ? [...s, code] : s.filter((x) => x !== code)))
                    }
                  />
                  <span className="flex-1">{SOURCE_LABEL[code]}</span>
                  <span className="tnum text-xs text-tx-3">{feed.all.filter((it) => it.sourceCode === code).length}</span>
                </label>
              ))}
              <span className="block h-2" />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-2 overflow-y-auto bg-background px-2.5 pb-3">
        {feed.loading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] shrink-0" />)
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
            <span className="text-sm font-semibold">{q ? "Không tìm thấy" : "Không có mục nào"}</span>
            <span className="text-xs text-tx-2">{q ? `Không có booking khớp “${q}”.` : "Danh sách này đang trống."}</span>
          </div>
        ) : (
          rows.map((it) => {
            const sel = live && !!it.tableId && it.tableId === selectedId
            return (
              <div
                key={it.key}
                role="button"
                tabIndex={0}
                aria-pressed={sel}
                onClick={() => select(it)}
                onKeyDown={onEnter(() => select(it))}
                className={cn(
                  "grid shrink-0 cursor-pointer grid-cols-[64px_minmax(0,1fr)_auto] gap-2.5 rounded-sm border bg-surface-1 p-3 outline-none hover:border-strong focus-visible:ring-2 focus-visible:ring-primary",
                  sel && "border-primary bg-primary-tint",
                )}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="tnum text-sm font-semibold text-tx-strong">{fmtTime(it.at)}</span>
                  <span className="text-xs text-tx-3">{it.cap}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-semibold text-tx-strong">{it.name}</span>
                  <span className="tnum truncate text-xs text-tx-3">
                    {it.phone} · {it.source}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-tx-2">
                    <Users className="size-3.5 shrink-0" />
                    <span className="tnum font-medium text-tx-1">{pad2(it.party)}</span>
                    <span className="text-strong">·</span>
                    <span className="truncate font-semibold text-tx-strong">{it.tables}</span>
                  </span>
                </div>
                <div className="flex flex-col items-end justify-between gap-2">
                  <StatusTag it={it} />
                  <ActionButton a={actionOf(it)} />
                </div>
              </div>
            )
          })
        )}
      </div>
      <div role="tablist" aria-label="Lọc booking" className="flex shrink-0 border-t">
        {LIST_TABS.map((t) => {
          const on = tab === t.id
          const n = feed[t.id].length
          const hot = t.id === "attn" && n > 0
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex h-12 flex-1 items-center justify-center gap-1.5 px-1.5 text-sm whitespace-nowrap",
                on ? "bg-primary-tint font-medium text-primary-ink shadow-[inset_0_2px_0_var(--primary)]" : "text-tx-2 hover:bg-surface-2",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "tnum grid h-5 min-w-5 place-items-center rounded-sm px-1.5 text-xs font-semibold",
                  hot ? "bg-st-noshow text-white" : "bg-surface-3 text-tx-2",
                )}
              >
                {n}
              </span>
            </button>
          )
        })}
      </div>
      {dialog}
    </div>
  )
}

const COLS = "grid-cols-[76px_minmax(150px,1.3fr)_112px_64px_minmax(96px,0.8fr)_104px_132px_104px]"

/** "Danh sách" workspace view: same feed as the left list, as a table. */
export function BookingTable({ feed, tab, model, live }: { feed: BookingFeed; tab: ListTab; model: FloorModel; live: boolean }) {
  const { select, actionOf, dialog } = useRowActions(model, live)
  const rows = feed[tab]
  return (
    <div className="min-h-0 flex-1 scrollbar-thin overflow-auto rounded-sm border bg-surface-1">
      <div role="table" aria-label="Danh sách booking" className="min-w-[860px]">
        <div
          role="row"
          className={cn(
            "sticky top-0 z-[2] grid h-11 items-center gap-3 border-b border-strong bg-surface-1 px-4 text-xs font-semibold text-tx-head",
            COLS,
          )}
        >
          <span role="columnheader">Giờ</span>
          <span role="columnheader">Khách</span>
          <span role="columnheader">SĐT</span>
          <span role="columnheader">Số khách</span>
          <span role="columnheader">Bàn</span>
          <span role="columnheader">Nguồn</span>
          <span role="columnheader">Trạng thái</span>
          <span role="columnheader" />
        </div>
        {rows.map((it) => (
          <div
            key={it.key}
            role="row"
            tabIndex={0}
            onClick={() => select(it)}
            onKeyDown={onEnter(() => select(it))}
            className={cn(
              "grid min-h-14 cursor-pointer items-center gap-3 border-b px-4 outline-none hover:bg-surface-2 focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]",
              COLS,
            )}
          >
            <span className="flex flex-col">
              <span className="tnum text-sm font-semibold text-tx-strong">{fmtTime(it.at)}</span>
              <span className="text-xs text-tx-3">{it.cap}</span>
            </span>
            <span className="truncate text-sm font-semibold text-tx-strong">{it.name}</span>
            <span className="tnum text-xs text-tx-2">{it.phone}</span>
            <span className="tnum text-sm font-medium">{pad2(it.party)}</span>
            <span className="truncate text-sm font-semibold text-tx-strong">{it.tables}</span>
            <span className="text-xs text-tx-2">{it.source}</span>
            <span>
              <StatusTag it={it} />
            </span>
            <ActionButton a={actionOf(it)} />
          </div>
        ))}
        {!feed.loading && rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-tx-2">Danh sách này đang trống.</div>
        ) : null}
      </div>
      {dialog}
    </div>
  )
}

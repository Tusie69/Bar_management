import {
  AlertCircle,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  LogIn,
  MessageSquareText,
  Search,
  SquareGanttChart,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { EmptyState, GuardedButton, MaskedPhone, TableCodes } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SOURCE_LABEL, type BookingSourceCode } from "@/domain/enums"
import type { AllocationView, ReservationView, TableView } from "@/domain/models"
import { useAction } from "@/hooks/use-action"
import { useDragScroll } from "@/hooks/use-drag-scroll"
import { useElementWidth } from "@/hooks/use-element-width"
import { useBusinessDate, useCatalog, useDayAllocations, useNow, useReservations } from "@/hooks/use-data"
import { addDays, atBusinessTime, businessDateOf, fmtBusinessDate, fmtTime, MS, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api, isApiError } from "@/services"
import { useCan } from "@/state/session"
import { useUi } from "@/state/ui"
import { GuestCountDialog } from "../floor/floor-dialogs"
import { DateField } from "../floor/floor-toolbar"
import { ReservationStatusChip } from "./reservation-status"
import { ZaloBookingExport } from "./zalo-booking-export"

type StatusFilter = "all" | "upcoming" | "late" | "unassigned" | "checked_in" | "closed"

const FILTERS: { value: StatusFilter; label: string; test: (r: ReservationView) => boolean }[] = [
  { value: "all", label: "Tất cả", test: () => true },
  { value: "upcoming", label: "Sắp đến", test: (r) => r.status === "BOOKED" && !r.warning },
  { value: "late", label: "Muộn / chưa đến", test: (r) => r.status === "BOOKED" && !!r.warning },
  { value: "unassigned", label: "Chưa có bàn", test: (r) => r.status === "BOOKED" && r.subState !== "DANG_GIU_BAN" },
  { value: "checked_in", label: "Đã check-in", test: (r) => r.status === "CHECKED_IN" },
  { value: "closed", label: "Hủy / không đến", test: (r) => r.status === "CANCELLED" || r.status === "NO_SHOW" },
]

export default function ReservationsPage() {
  const today = useBusinessDate()
  const [date, setDate] = useState<BusinessDate>(today)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [source, setSource] = useState<"ALL" | BookingSourceCode>("ALL")
  const [view, setView] = useState<"list" | "timeline">("list")
  const [exportOpen, setExportOpen] = useState(false)
  const canExport = useCan("customer.view_masked")
  const ui = useUi()
  const list = useReservations(date, search)
  const catalog = useCatalog()
  const searching = search.trim().length > 0
  const tabListRef = useDragScroll<HTMLDivElement>()

  const rows = useMemo(
    () =>
      (list.data ?? [])
        .filter((r) => FILTERS.find((f) => f.value === filter)!.test(r))
        .filter((r) => source === "ALL" || r.sourceCode === source),
    [list.data, filter, source],
  )
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.value, (list.data ?? []).filter(f.test).length])),
    [list.data],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid gap-3 border-b px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center">
            <Button variant="ghost" size="icon" aria-label="Ngày trước" onClick={() => setDate(addDays(date, -1))}>
              <ChevronLeft />
            </Button>
            <DateField value={date} minDate={addDays(today, -60)} onChange={setDate} />
            <Button variant="ghost" size="icon" aria-label="Ngày sau" onClick={() => setDate(addDays(date, 1))}>
              <ChevronRight />
            </Button>
          </div>
          {date !== today ? (
            <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
              Hôm nay
            </Button>
          ) : null}
          <div className="relative order-last min-w-0 basis-full sm:order-none sm:min-w-[220px] sm:flex-1 sm:basis-auto md:max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên (không dấu) hoặc 3 số cuối SĐT"
              className="h-11 pr-10 pl-9"
              aria-label="Tìm booking"
              inputMode="search"
            />
            {search ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                aria-label="Xóa tìm kiếm"
                onClick={() => setSearch("")}
              >
                <X />
              </Button>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              aria-label="Xuất text Zalo"
              onClick={() => setExportOpen(true)}
              disabled={!canExport}
            >
              <MessageSquareText /> <span className="hidden sm:inline">Xuất text Zalo</span>
            </Button>
            <ToggleGroup
              type="single"
              variant="outline"
              value={view}
              onValueChange={(v) => v && setView(v as "list" | "timeline")}
              aria-label="Kiểu xem"
            >
              <ToggleGroupItem value="list" className="gap-1.5 px-3">
                <LayoutList className="size-4" /> Danh sách
              </ToggleGroupItem>
              <ToggleGroupItem value="timeline" className="gap-1.5 px-3">
                <SquareGanttChart className="size-4" /> Lịch<span className="hidden sm:inline"> bàn</span>
              </ToggleGroupItem>
            </ToggleGroup>
            <GuardedButton
              permission="reservation.create"
              aria-label="Đặt bàn mới"
              onClick={() => ui.openBooking({ date })}
            >
              <CalendarPlus /> <span className="hidden sm:inline">Đặt bàn</span>
            </GuardedButton>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            ref={tabListRef}
            className="-mx-1 no-scrollbar flex max-w-full touch-pan-x gap-1.5 overflow-x-auto overscroll-x-contain px-1 md:scrollbar-thin"
            role="tablist"
            aria-label="Lọc trạng thái"
          >
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                  filter === f.value
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {f.label}
                <span className="tnum text-xs opacity-70">{counts[f.value] ?? 0}</span>
              </button>
            ))}
          </div>
          <Select value={source} onValueChange={(v) => setSource(v as "ALL" | BookingSourceCode)}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Lọc nguồn đặt">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Mọi nguồn</SelectItem>
              {(catalog.data?.sources ?? []).map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {SOURCE_LABEL[s.code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {searching ? (
            <p className="text-xs text-muted-foreground">
              Tìm trong ±7 ngày quanh {fmtBusinessDate(date, "short")} (tối đa 20 kết quả theo 3 số cuối).
            </p>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 scrollbar-thin overflow-auto">
        {list.isLoading ? (
          <div className="grid gap-2 p-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.isError ? (
          <EmptyState title="Lỗi tải danh sách booking" icon={<AlertCircle className="size-6 text-destructive" />}>
            {isApiError(list.error)
              ? list.error.message
              : list.error instanceof Error
                ? list.error.message
                : "Không thể tải danh sách đặt bàn"}
          </EmptyState>
        ) : view === "list" ? (
          <ReservationList rows={rows} tables={catalog.data?.tables ?? []} showDate={searching} />
        ) : (
          <Timeline date={date} reservations={list.data ?? []} tables={catalog.data?.tables ?? []} />
        )}
      </div>
      <ZaloBookingExport businessDate={date} open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  )
}

function useCodes(tables: TableView[]) {
  return useMemo(() => {
    const byId = new Map(tables.map((t) => [t.id, t]))
    return (ids: number[]) =>
      ids.map((id) => {
        const t = byId.get(id)
        return t ? (t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code) : `#${id}`
      })
  }, [tables])
}

function ReservationList({
  rows,
  tables,
  showDate,
}: {
  rows: ReservationView[]
  tables: TableView[]
  showDate: boolean
}) {
  const ui = useUi()
  const codes = useCodes(tables)
  const now = useNow(30_000)
  const today = businessDateOf(now)
  const { run } = useAction()
  const [checkIn, setCheckIn] = useState<ReservationView | null>(null)
  const navigate = useNavigate()

  if (!rows.length)
    return (
      <EmptyState title="Không có booking phù hợp" icon={<LayoutList />}>
        Đổi ngày, bộ lọc hoặc tạo booking mới.
      </EmptyState>
    )

  const groups: { hour: string; items: ReservationView[] }[] = []
  for (const r of rows) {
    const h = showDate ? r.businessDate : fmtTime(r.expectedAt).slice(0, 2)
    const g = groups[groups.length - 1]
    if (g && g.hour === h) g.items.push(r)
    else groups.push({ hour: h, items: [r] })
  }

  const action = (r: ReservationView) => {
    if (r.status !== "BOOKED") return null
    if (r.tableIds.length && r.businessDate === today) {
      return (
        <GuardedButton
          permission="visit.checkin"
          size="sm"
          variant="outline"
          aria-label={`Check-in ${r.displayName}`}
          onClick={(e) => {
            e.stopPropagation()
            setCheckIn(r)
          }}
        >
          <LogIn /> <span className="hidden sm:inline">Check-in</span>
        </GuardedButton>
      )
    }
    if (!r.tableIds.length && r.subState === "CHO_PHAN_BAN") {
      return (
        <GuardedButton
          permission="table.assign"
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation()
            navigate("/floor")
            ui.setFloorMode("live")
            ui.startPick({
              intent: "assign",
              title: `Phân bàn cho ${r.displayName} · ${r.partySize} khách`,
              hint: `Booking ${fmtTime(r.expectedAt)} ${r.businessDate !== today ? fmtBusinessDate(r.businessDate, "short") : ""}. Chạm bàn trống.`,
              multi: true,
              confirmLabel: "Phân bàn",
              onConfirm: async (ids) => !!(await run((o) => api.assignTables(r.id, r.version, ids, o))),
            })
          }}
        >
          Phân bàn
        </GuardedButton>
      )
    }
    return null
  }

  return (
    <>
      <Table className="hidden md:table">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-20 pl-6">Giờ</TableHead>
            <TableHead>Khách</TableHead>
            <TableHead className="w-24 text-right">Số khách</TableHead>
            <TableHead className="w-28">Nguồn</TableHead>
            <TableHead className="w-36">Bàn</TableHead>
            <TableHead className="w-48">Trạng thái</TableHead>
            <TableHead className="w-36 pr-6 text-right">
              <span className="sr-only">Thao tác</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <GroupRows key={g.hour} label={showDate ? fmtBusinessDate(g.hour) : `${g.hour}:00`} count={g.items.length}>
              {g.items.map((r) => (
                <TableRow
                  key={r.id}
                  className="h-14 cursor-pointer"
                  onClick={() => ui.openReservation(r.id, r.businessDate)}
                >
                  <TableCell className="tnum pl-6 text-[15px] font-semibold">{fmtTime(r.expectedAt)}</TableCell>
                  <TableCell>
                    <span className="block font-medium">{r.displayName}</span>
                    <MaskedPhone last3={r.phoneLast3} />
                  </TableCell>
                  <TableCell className="tnum text-right">{r.partySize}</TableCell>
                  <TableCell className="text-muted-foreground">{SOURCE_LABEL[r.sourceCode]}</TableCell>
                  <TableCell>
                    {r.tableIds.length ? (
                      <TableCodes codes={codes(r.tableIds)} symbolNo={r.symbolNo} />
                    ) : (
                      <span className="text-sm text-subtle">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ReservationStatusChip r={r} />
                  </TableCell>
                  <TableCell className="pr-6 text-right">{action(r)}</TableCell>
                </TableRow>
              ))}
            </GroupRows>
          ))}
        </TableBody>
      </Table>

      <ul className="grid gap-px md:hidden">
        {groups.map((g) => (
          <li key={g.hour}>
            <p className="eyebrow sticky top-0 z-10 bg-background px-4 py-2">
              {showDate ? fmtBusinessDate(g.hour) : `${g.hour}:00`} · {g.items.length}
            </p>
            <ul>
              {g.items.map((r) => (
                <li key={r.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => ui.openReservation(r.id, r.businessDate)}
                    onKeyDown={(e) => e.key === "Enter" && ui.openReservation(r.id, r.businessDate)}
                    className="flex min-h-16 items-center gap-3 border-b px-4 py-2 active:bg-surface-2"
                  >
                    <span className="tnum w-12 shrink-0 font-semibold">{fmtTime(r.expectedAt)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {r.displayName} <span className="font-normal text-muted-foreground">· {r.partySize} khách</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <ReservationStatusChip r={r} />
                        {r.tableIds.length ? (
                          <TableCodes codes={codes(r.tableIds)} symbolNo={r.symbolNo} className="[&>span]:text-xs" />
                        ) : null}
                      </span>
                    </span>
                    {action(r)}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <GuestCountDialog
        open={!!checkIn}
        onOpenChange={(o) => !o && setCheckIn(null)}
        title={`Check-in ${checkIn?.displayName ?? ""}`}
        description={
          <>
            Booking {fmtTime(checkIn?.expectedAt)} · {checkIn ? codes(checkIn.tableIds).join(" + ") : ""}
          </>
        }
        initial={checkIn?.partySize ?? 2}
        readOnly
        confirmLabel="Check-in"
        onConfirm={async () => {
          if (!checkIn) return
          const r = await run(() =>
            api.checkIn({ reservationId: checkIn.id, version: checkIn.version, guestCount: checkIn.partySize }),
          )
          if (r) setCheckIn(null)
        }}
      />
    </>
  )
}

function GroupRows({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={7} className="bg-surface-1 py-1.5 pl-6">
          <span className="eyebrow">
            {label} · {count}
          </span>
        </TableCell>
      </TableRow>
      {children}
    </>
  )
}

/* ---------------- Timeline (Lịch bàn) ---------------- */

const HOUR_W = 84
const ROW_H = 40
const LABEL_W = 84
const HOURS = ["17", "18", "19", "20", "21", "22", "23", "00", "01", "02", "03", "04"]
const CHIP_W = 176

function Timeline({
  date,
  reservations,
  tables,
}: {
  date: BusinessDate
  reservations: ReservationView[]
  tables: TableView[]
}) {
  const allocations = useDayAllocations(date)
  const [boxRef, boxW] = useElementWidth<HTMLDivElement>()
  // Hours stretch to fill wide screens; below the minimum the grid scrolls horizontally.
  const hourW = Math.max(HOUR_W, (boxW - LABEL_W) / HOURS.length)
  const ui = useUi()
  const navigate = useNavigate()
  const now = useNow(30_000)
  const start = atBusinessTime(date, "17:00").getTime()
  const end = start + 12 * MS.HOUR
  const x = (t: Date) => LABEL_W + ((Math.min(Math.max(t.getTime(), start), end) - start) / MS.HOUR) * hourW
  const width = LABEL_W + HOURS.length * hourW
  const zones = ["A", "B", "C", "BAR"] as const
  const rows = zones.flatMap((z) =>
    tables
      .filter((t) => t.zoneCode === z)
      .sort((a, b) => (a.seqNo ?? 0) - (b.seqNo ?? 0) || a.code.localeCompare(b.code, "vi", { numeric: true })),
  )
  const nowX = now.getTime() >= start && now.getTime() <= end ? x(now) : null
  const label = (t: TableView) => (t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code)

  // Unassigned bookings packed into lanes so chips never overlap.
  const unassigned = reservations
    .filter((r) => r.status === "BOOKED" && r.tableIds.length === 0)
    .sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime())
  const lanes: number[] = []
  const placed = unassigned.map((r) => {
    const left = x(r.expectedAt)
    let lane = lanes.findIndex((right) => left >= right + 6)
    if (lane === -1) {
      lane = lanes.length
      lanes.push(0)
    }
    lanes[lane] = left + CHIP_W
    return { r, left, lane }
  })
  const byTable = new Map<number, AllocationView[]>()
  for (const a of allocations.data ?? []) {
    if (a.kind === "HOLD" && a.releasedAt) continue
    if (!byTable.has(a.tableId)) byTable.set(a.tableId, [])
    byTable.get(a.tableId)!.push(a)
  }

  return (
    <div className="p-4 md:p-6">
      <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
        Mỗi hàng là một bàn/ghế, lấy từ lịch sử table_allocations (đổi bàn hiện thành hai đoạn). Thanh mờ dần nghĩa là
        không có giờ kết thúc: quán không giới hạn thời gian ngồi.
      </p>
      <div ref={boxRef} className="scrollbar-thin overflow-x-auto rounded-xl border">
        <div style={{ width }} className="relative">
          <div className="sticky top-0 z-20 flex border-b bg-background" style={{ height: 32 }}>
            <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 border-r bg-background" />
            {HOURS.map((h, i) => {
              // The "now" line + badge (line .. +40px) wins over an hour label it would touch.
              const labelLeft = LABEL_W + i * hourW + 8
              const covered = nowX !== null && nowX > labelLeft - 44 && nowX < labelLeft + 42
              return (
                <div
                  key={h}
                  style={{ width: hourW }}
                  className={cn(
                    "tnum shrink-0 border-r px-2 py-1.5 text-xs text-subtle last:border-r-0",
                    covered && "text-transparent",
                  )}
                >
                  {h}:00
                </div>
              )
            })}
          </div>
          {placed.length ? (
            <div className="relative flex border-b bg-surface-1" style={{ height: lanes.length * 34 + 6 }}>
              <div
                style={{ width: LABEL_W }}
                className="sticky left-0 z-10 flex shrink-0 items-center border-r bg-surface-1 px-2 text-xs font-medium"
              >
                Chưa có bàn
              </div>
              {placed.map(({ r, left, lane }) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => ui.openReservation(r.id, r.businessDate)}
                  className="absolute h-7 truncate rounded-md border border-dashed border-strong bg-background px-2 text-left text-xs whitespace-nowrap hover:bg-surface-2"
                  style={{ left, top: 6 + lane * 34, width: CHIP_W }}
                >
                  <span className="tnum">{fmtTime(r.expectedAt)}</span> · {r.displayName} · {r.partySize}
                </button>
              ))}
            </div>
          ) : null}
          {rows.map((t) => (
            <div key={t.id} className="relative flex border-b last:border-b-0" style={{ height: ROW_H }}>
              <div
                style={{ width: LABEL_W }}
                className="sticky left-0 z-10 flex shrink-0 items-center border-r bg-background px-2"
              >
                <span
                  className={cn(
                    "rounded px-1 text-xs font-semibold",
                    t.isSpare && "border border-dashed border-strong",
                  )}
                  title={t.isSpare ? "Bàn sơ cua" : undefined}
                >
                  {label(t)}
                </span>
              </div>
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{ width: hourW }}
                  className={cn("shrink-0 border-r border-dashed border-border/60", h === HOURS.at(-1) && "border-r-0")}
                />
              ))}
              {(byTable.get(t.id) ?? []).map((a) => {
                const left = x(a.startsAt)
                if (a.kind === "USAGE") {
                  const active = !a.releasedAt
                  const right = a.releasedAt ? x(a.releasedAt) : (nowX ?? x(new Date(end)))
                  return (
                    <button
                      key={a.allocationId}
                      type="button"
                      onClick={() => {
                        if (active) {
                          ui.selectTable(t.id)
                          navigate("/floor")
                        } else if (a.reservationId) ui.openReservation(a.reservationId, date)
                      }}
                      title={`${a.name} · ${a.partySize ?? "?"} khách · ${fmtTime(a.startsAt)}${a.releasedAt ? `-${fmtTime(a.releasedAt)}` : " → đang ngồi"}`}
                      className={cn(
                        "absolute top-1.5 h-7 overflow-hidden rounded-md px-2 text-left text-xs whitespace-nowrap",
                        active
                          ? "bg-st-seated-tint text-foreground ring-1 ring-st-seated/60 ring-inset"
                          : "bg-surface-3 text-muted-foreground",
                      )}
                      style={{
                        left,
                        width: Math.max(24, right - left),
                        ...(active ? { maskImage: "linear-gradient(90deg, #000 85%, transparent)" } : {}),
                      }}
                    >
                      {a.releaseReason === "MOVED" ? "→ " : ""}
                      {a.name} · {a.partySize}
                    </button>
                  )
                }
                if (a.holdKind === "WAITLIST_OFFER") {
                  const overdue = !!a.deadlineAt && now > a.deadlineAt
                  const tone = overdue ? "late" : "reserved"
                  const right = a.deadlineAt ? x(a.deadlineAt) : left + hourW / 2
                  return (
                    <button
                      key={a.allocationId}
                      type="button"
                      onClick={() => navigate(`/waitlist?entry=${a.waitlistEntryId}`)}
                      title={`Giữ cho khách chờ ${a.name} đến ${fmtTime(a.deadlineAt)}`}
                      className="absolute top-1.5 h-7 overflow-hidden rounded-md border border-dashed px-2 text-left text-xs whitespace-nowrap"
                      style={{
                        left,
                        width: Math.max(64, right - left),
                        borderColor: `var(--st-${tone})`,
                        color: `var(--st-${tone}-ink)`,
                        background: `var(--st-${tone}-tint)`,
                      }}
                    >
                      Giữ · {a.name}
                    </button>
                  )
                }
                const tone = a.warning === "noshow" ? "noshow" : a.warning === "late" ? "late" : "reserved"
                return (
                  <button
                    key={a.allocationId}
                    type="button"
                    onClick={() => a.reservationId && ui.openReservation(a.reservationId, date)}
                    title={`${a.name} · ${a.partySize ?? "?"} khách · ${fmtTime(a.startsAt)}`}
                    className="absolute top-1.5 h-7 overflow-hidden rounded-md border px-2 text-left text-xs whitespace-nowrap"
                    style={{
                      left,
                      width: hourW * 2,
                      borderColor: `var(--st-${tone})`,
                      color: `var(--st-${tone}-ink)`,
                      background: `linear-gradient(90deg, var(--st-${tone}-tint), transparent)`,
                      maskImage: "linear-gradient(90deg, #000 70%, transparent)",
                    }}
                  >
                    <span className="tnum">{fmtTime(a.startsAt)}</span> {a.name} · {a.partySize}
                  </button>
                )
              })}
            </div>
          ))}
          {nowX !== null ? (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-foreground/80"
              style={{ left: nowX }}
              aria-hidden
            >
              <span className="tnum absolute top-1.5 left-1 rounded bg-foreground px-1 text-[10px] text-background">
                {fmtTime(now)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

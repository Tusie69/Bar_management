import { Funnel, MessageSquareText, Search } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { slotLabel } from "@/domain/booking-rules"
import { SOURCE_LABEL, type BookingSourceCode } from "@/domain/enums"
import type { ReservationView } from "@/domain/models"
import { useDayAllocations, useReservations } from "@/hooks/use-data"
import { foldVietnamese } from "@/lib/text"
import { addDays, atBusinessTime, fmtBusinessDate, fmtTime12, MS, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { isApiError } from "@/services"
import { useCan } from "@/state/session"
import { ZaloBookingExport } from "../reservations/zalo-booking-export"
import { useM } from "./context"
import { byTime, chipOf, levelOf } from "./model"
import { BookingCard, CardSkeleton, Chip, EmptyBox, PlainHeader, Seg, useKeepScroll } from "./ui"

type Status = "all" | "attention" | "upcoming" | "seated" | "closed"
const GROUPS: Record<Status, (r: ReservationView) => boolean> = {
  all: () => true,
  attention: (r) => r.status === "BOOKED" && levelOf(r) < 9,
  upcoming: (r) => r.status === "BOOKED" && levelOf(r) === 9,
  seated: (r) => r.status === "CHECKED_IN",
  closed: (r) => r.status === "NO_SHOW" || r.status === "CANCELLED",
}
const STATUS_CHIPS: [Status, string][] = [
  ["all", "Tất cả"],
  ["attention", "Cần xử lý"],
  ["upcoming", "Sắp đến"],
  ["seated", "Đã nhận bàn"],
  ["closed", "Không đến, hủy"],
]

export function ListScreen() {
  const m = useM()
  const [mode, setMode] = useState<"list" | "timeline">("list")
  const [q, setQ] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [src, setSrc] = useState<BookingSourceCode | null>(null)
  const [status, setStatus] = useState<Status>("all")
  const [dateIdx, setDateIdx] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  const canExport = useCan("customer.view_masked")
  const bd = addDays(m.today, dateIdx)
  const resQuery = useReservations(bd)
  const res = resQuery.data
  const ref = useKeepScroll("list")

  const base = useMemo(() => {
    const f = foldVietnamese(q.trim())
    const compact = f.replace(/\s/g, "")
    return (res ?? [])
      .filter((r) => !src || r.sourceCode === src)
      .filter(
        (r) =>
          !f ||
          foldVietnamese(r.displayName).includes(f) ||
          (/^\d{3}$/.test(f) && r.phoneLast3 === f) ||
          r.tableIds.some((id) => foldVietnamese(m.model.label(id)).replace(/\s/g, "").includes(compact)),
      )
  }, [res, q, src, m.model])
  const shown = base.filter(GROUPS[status]).sort(byTime)
  const guests = shown.filter((r) => r.status !== "CANCELLED").reduce((s, r) => s + r.partySize, 0)
  const venue = m.model.catalog?.venue
  const shift = `Ca tối ${slotLabel(venue?.businessDayStartLocal.slice(0, 5) ?? "17:00")} – ${slotLabel(venue?.businessDayCutoffLocal.slice(0, 5) ?? "05:00")}`

  return (
    <>
      <PlainHeader title="Danh sách">
        <div className="flex flex-col gap-2.5 pt-1 pb-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Seg
                label="Kiểu xem"
                value={mode}
                onChange={setMode}
                opts={[
                  ["list", "Danh sách"],
                  ["timeline", "Thời gian"],
                ]}
              />
            </div>
            <button
              type="button"
              aria-label="Xuất text Zalo"
              disabled={!canExport}
              onClick={() => setExportOpen(true)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface-1 px-3 text-[14px] font-medium text-tx-1 transition-colors",
                !canExport && "cursor-not-allowed opacity-50",
              )}
            >
              <MessageSquareText className="size-4 shrink-0" aria-hidden />
              <span>Xuất text Zalo</span>
            </button>
          </div>
          {mode === "list" ? (
            <>
              <div className="flex gap-2">
                <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface-1 px-3">
                  <Search className="size-[18px] shrink-0 text-subtle" aria-hidden />
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Tên, 3 số cuối SĐT, mã bàn"
                    aria-label="Tìm booking"
                    className="h-10 min-w-0 flex-1 border-0 bg-transparent text-base text-tx-1 outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setFilterOpen((v) => !v)}
                  aria-expanded={filterOpen}
                  aria-label="Lọc theo nguồn"
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-xl border bg-surface-1 text-tx-1",
                    src ? "border-primary" : "border-border",
                  )}
                >
                  <Funnel className="size-[18px]" />
                </button>
              </div>
              {filterOpen ? (
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(SOURCE_LABEL) as [BookingSourceCode, string][]).map(([code, label]) => (
                    <Chip key={code} on={src === code} onClick={() => setSrc(src === code ? null : code)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              ) : null}
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
                {STATUS_CHIPS.map(([k, label]) => (
                  <Chip key={k} on={status === k} onClick={() => setStatus(k)}>
                    {label} <span className="opacity-70">{base.filter(GROUPS[k]).length}</span>
                  </Chip>
                ))}
              </div>
            </>
          ) : null}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
            {Array.from({ length: 7 }, (_, i) => {
              const on = dateIdx === i
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDateIdx(i)}
                  className={cn(
                    "h-[34px] shrink-0 rounded-full px-3 text-[13px]",
                    on ? "bg-primary-tint font-semibold text-primary-ink" : "bg-transparent text-tx-2",
                  )}
                >
                  {i === 0 ? "Hôm nay" : fmtBusinessDate(addDays(m.today, i), "short").replace(",", "")}
                </button>
              )
            })}
          </div>
        </div>
      </PlainHeader>

      {mode === "timeline" ? (
        <Timeline bd={bd} reservations={res ?? []} />
      ) : (
        <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-1 pb-20">
          {resQuery.isError ? (
            <EmptyBox
              title="Lỗi tải danh sách"
              body={
                isApiError(resQuery.error)
                  ? resQuery.error.message
                  : resQuery.error instanceof Error
                    ? resQuery.error.message
                    : "Không thể tải danh sách đặt bàn."
              }
            />
          ) : !res ? (
            <CardSkeleton />
          ) : shown.length ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-3 px-3.5 py-3">
                <span className="text-[14px] font-semibold text-tx-strong">{shift}</span>
                <span className="text-[13px] text-tx-2">
                  {shown.length} booking, {guests} khách
                </span>
              </div>
              {shown.map((r) => (
                <BookingCard key={r.id} r={r} actions={levelOf(r) < 9} />
              ))}
            </>
          ) : res.length ? (
            <EmptyBox title="Không có booking khớp bộ lọc" body="Thử bỏ bớt bộ lọc hoặc tìm bằng 3 số cuối SĐT." />
          ) : (
            <EmptyBox
              title="Chưa có booking cho ngày này"
              body="Tạo booking mới, giờ đến từ 7:00 PM đến 1:00 AM."
              action={{ label: "Tạo đặt trước", onClick: () => m.openForm({ mode: "booking" }) }}
            />
          )}
        </div>
      )}
      <ZaloBookingExport businessDate={bd} open={exportOpen} onOpenChange={setExportOpen} />
    </>
  )
}

/* ---------------- Thời gian ---------------- */

const LW = 84
const PX = 1.2
const HOURS = 12
const ZONE_ORDER: Record<string, number> = { A: 1, B: 2, C: 3, BAR: 4 }

interface Item {
  key: string
  kind: "booking" | "usage" | "ended"
  min: number
  end?: number
  label: string
  aria: string
  tone: "reserved" | "late" | "noshow"
  reservationId: number | null
}

function Timeline({ bd, reservations }: { bd: BusinessDate; reservations: ReservationView[] }) {
  const m = useM()
  const alloc = useDayAllocations(bd).data
  const box = useRef<HTMLDivElement>(null)
  const start = atBusinessTime(bd, "17:00").getTime()
  const toMin = useCallback((t: Date) => (t.getTime() - start) / MS.MIN, [start])
  const isToday = bd === m.today
  const nowMin = isToday ? toMin(m.now) : -1

  const rows = useMemo(() => {
    const byTable = new Map<number, Item[]>()
    for (const a of alloc ?? []) {
      if (a.kind === "HOLD" && a.releasedAt) continue // converted, moved or released: nothing to draw
      const usage = a.kind === "USAGE"
      const item: Item = {
        key: `a${a.allocationId}`,
        kind: usage ? (a.releasedAt ? "ended" : "usage") : "booking",
        min: toMin(a.startsAt),
        end: a.releasedAt ? toMin(a.releasedAt) : undefined,
        label: `${a.name}${a.partySize ? `, ${a.partySize}` : ""}`,
        aria: usage
          ? `${a.name}, ${a.releasedAt ? `${fmtTime12(a.startsAt)} đến ${fmtTime12(a.releasedAt)}, đã rời` : `ngồi từ ${fmtTime12(a.startsAt)}`}`
          : `${fmtTime12(a.startsAt)} ${a.name}${a.partySize ? `, ${a.partySize} khách` : ""}`,
        tone: a.warning ?? "reserved",
        reservationId: a.reservationId,
      }
      byTable.set(a.tableId, [...(byTable.get(a.tableId) ?? []), item])
    }
    const out: { key: string; tableId: number | null; label: string; cap: string; active: boolean; items: Item[] }[] =
      []
    const unassigned = reservations.filter((r) => r.status === "BOOKED" && !r.tableIds.length)
    if (unassigned.length) {
      const sorted = [...unassigned].sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime())
      out.push({
        key: "none",
        tableId: null,
        label: "Chưa bàn",
        cap: `${unassigned.length} booking`,
        active: true,
        items: sorted.map((r) => ({
          key: `r${r.id}`,
          kind: "booking",
          min: toMin(r.expectedAt),
          label: `${r.displayName}, ${r.partySize}`,
          aria: `${fmtTime12(r.expectedAt)} ${r.displayName}, ${r.partySize} khách, ${chipOf(r, m.now)}`,
          tone: r.warning ?? "reserved",
          reservationId: r.id,
        })),
      })
    }
    const tables = [...m.model.tables].sort((a, b) => {
      const za = ZONE_ORDER[a.zoneCode] ?? 99
      const zb = ZONE_ORDER[b.zoneCode] ?? 99
      if (za !== zb) return za - zb
      return a.code.localeCompare(b.code, "vi", { numeric: true }) || (a.seqNo ?? 0) - (b.seqNo ?? 0)
    })
    for (const t of tables)
      out.push({
        key: `t${t.id}`,
        tableId: t.id,
        label: m.model.label(t.id),
        cap: t.kind === "BAR_SEAT" ? "1 ghế" : t.isSpare ? "sơ cua" : `${t.capacity} chỗ`,
        active: !t.isSpare && t.status === "ACTIVE",
        items: byTable.get(t.id) ?? [],
      })
    return out
  }, [alloc, reservations, m.model, m.now, toMin])

  // Open at "Bây giờ".
  useEffect(() => {
    if (box.current && isToday) box.current.scrollLeft = Math.max(0, toMin(m.now) * PX - 90)
  }, [bd]) // once per day, not on every clock tick

  const trackW = HOURS * 60 * PX
  const open = (it: Item, tableId: number | null) => {
    if (it.reservationId) m.openDetail(it.reservationId, bd)
    else if (tableId) m.openTable(tableId)
  }

  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-auto border-t border-border bg-surface-1 pb-20">
      <div className="relative" style={{ width: LW + trackW }}>
        <div className="sticky top-0 z-[4] flex h-9 border-b border-border bg-surface-1">
          <div className="sticky left-0 z-[5] flex w-[84px] shrink-0 items-center border-r border-border bg-surface-1 pl-3 text-xs font-medium text-[var(--text-muted)]">
            Bàn
          </div>
          <div className="relative shrink-0" style={{ width: trackW }}>
            {Array.from({ length: HOURS }, (_, i) => {
              const h = (17 + i) % 24
              const tickX = i * 60 * PX
              const nowX = nowMin * PX
              const collidesWithNow = nowMin >= 0 && tickX + 46 >= nowX - 34 && tickX + 4 <= nowX + 34
              return (
                <span
                  key={i}
                  className="absolute inset-y-0 flex items-center border-l border-border pl-1.5 text-xs whitespace-nowrap text-[var(--text-muted)]"
                  style={{ left: tickX }}
                >
                  {!collidesWithNow && `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`}
                </span>
              )
            })}
            {nowMin >= 0 ? (
              <span
                className="absolute top-1.5 z-[6] flex h-[22px] -translate-x-1/2 items-center rounded-full bg-primary px-2 text-[11px] font-semibold whitespace-nowrap text-primary-foreground shadow-sm"
                style={{ left: nowMin * PX }}
              >
                {fmtTime12(m.now)}
              </span>
            ) : null}
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.key} className="flex h-12 border-b border-border">
            <button
              type="button"
              disabled={!r.tableId}
              onClick={() => r.tableId && m.openTable(r.tableId)}
              className={cn(
                "sticky left-0 z-[3] flex w-[84px] shrink-0 flex-col justify-center border-r border-border bg-surface-1 pr-1 pl-3 text-left text-tx-1",
                !r.tableId && "cursor-default",
              )}
            >
              {r.label ? <span className="truncate text-[13px] font-semibold">{r.label}</span> : null}
              {r.cap ? <span className="truncate text-[11px] text-subtle">{r.cap}</span> : null}
            </button>
            <div
              className="relative shrink-0"
              style={{
                width: trackW,
                backgroundImage: "repeating-linear-gradient(to right,var(--border) 0 1px,transparent 1px 72px)",
                backgroundColor: r.active ? "transparent" : "var(--surface-2)",
              }}
            >
              {r.items.map((it) => {
                const bar = it.kind !== "booking"
                const w = bar ? Math.max(28, ((it.kind === "ended" ? (it.end ?? it.min) : nowMin) - it.min) * PX) : null
                const late = it.kind === "booking" && it.tone !== "reserved" && nowMin > it.min
                return (
                  <span key={it.key}>
                    {late ? (
                      <span
                        className="absolute bottom-2"
                        style={{
                          left: it.min * PX,
                          width: (nowMin - it.min) * PX,
                          borderBottom: `2px dotted var(--st-${it.tone})`,
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => open(it, r.tableId)}
                      aria-label={it.aria}
                      className={cn(
                        "absolute top-[7px] flex h-[34px] min-w-7 items-center gap-1 overflow-hidden rounded-[10px] border px-2.5 text-xs font-medium whitespace-nowrap shadow-sm focus:z-10 active:z-10",
                        !bar && "max-w-[130px]",
                      )}
                      style={{
                        left: it.min * PX,
                        width: w ?? "auto",
                        borderStyle: bar ? "solid" : "dashed",
                        ...(it.kind === "ended"
                          ? { background: "var(--surface-3)", color: "var(--tx-2)", borderColor: "var(--surface-3)" }
                          : it.kind === "usage"
                            ? {
                                background: "var(--st-seated-fill)",
                                color: "var(--on-seated)",
                                borderColor: "var(--st-seated-fill)",
                              }
                            : {
                                backgroundColor: "var(--surface-1)",
                                backgroundImage: `linear-gradient(var(--st-${it.tone}-tint), var(--st-${it.tone}-tint))`,
                                color: `var(--st-${it.tone}-ink)`,
                                borderColor: `var(--st-${it.tone})`,
                              }),
                      }}
                    >
                      {w === null || w >= 64 ? <span className="min-w-0 truncate">{it.label}</span> : null}
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
        ))}
        <div className="h-20" />
        {nowMin >= 0 ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-9 bottom-0 z-[2] -ml-px w-0.5 bg-primary"
            style={{ left: LW + nowMin * PX }}
          />
        ) : null}
      </div>
    </div>
  )
}

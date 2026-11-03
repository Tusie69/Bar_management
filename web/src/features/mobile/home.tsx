import { ChartColumn, Check, ChevronDown, ChevronRight, Clock, List, ListOrdered, Map as MapIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { ROLE_LABEL } from "@/domain/enums"
import { useOverview } from "@/hooks/use-data"
import { initials } from "@/lib/text"
import { fmtBusinessDate, fmtTime12, MS } from "@/lib/time"
import { cn } from "@/lib/utils"
import { isApiError } from "@/services"
import { useSession } from "@/state/session"
import { useM } from "./context"
import { isOpenEntry, splitShift, tableText } from "./model"
import {
  BellButton,
  BookingCard,
  card,
  CardSkeleton,
  EmptyBox,
  LinkButton,
  NowMarker,
  SectionHead,
  useKeepScroll,
} from "./ui"
import { WaitCard } from "./wait"

export function HomeScreen() {
  const m = useM()
  const ref = useKeepScroll("home")
  return (
    <div ref={ref} data-scroll className="min-h-0 flex-1 overflow-x-clip overflow-y-auto">
      <Hero title={m.isOwner ? "Tổng quan" : "Tiếp đón"} />
      {m.isOwner ? <OwnerBody /> : <ReceptionBody />}
    </div>
  )
}

/* Flat hills, only on the two home screens. Last hill = page background so it blends into content. */
function Hero({ title }: { title: string }) {
  const m = useM()
  const user = useSession((s) => s.user)
  return (
    <div className="relative isolate px-4 pt-[var(--top-safe)]">
      <svg
        aria-hidden
        viewBox="0 0 390 236"
        preserveAspectRatio="none"
        className="pointer-events-none absolute top-0 left-0 -z-10 block h-[236px] w-full"
      >
        <rect x="0" y="0" width="390" height="236" fill="var(--hero-sky)" />
        <circle cx="246" cy="66" r="22" fill="var(--hero-sun)" />
        <path d="M0 150 C 70 116, 140 120, 205 138 S 330 108, 390 124 V236 H0 Z" fill="var(--hill-far)" />
        <circle cx="292" cy="118" r="11" fill="var(--tree)" />
        <rect x="291" y="126" width="2" height="10" fill="var(--tree)" />
        <circle cx="312" cy="124" r="8" fill="var(--tree)" />
        <rect x="311" y="130" width="2" height="8" fill="var(--tree)" />
        <circle cx="58" cy="132" r="9" fill="var(--tree)" />
        <rect x="57" y="139" width="2" height="9" fill="var(--tree)" />
        <path d="M0 184 C 90 156, 170 164, 240 178 S 350 160, 390 170 V236 H0 Z" fill="var(--hill-mid)" />
        <path d="M0 214 C 100 196, 210 204, 280 210 S 360 200, 390 204 V236 H0 Z" fill="var(--background)" />
      </svg>
      <div className="relative flex h-[52px] items-center gap-3">
        <button
          type="button"
          onClick={m.openAccount}
          aria-label="Tài khoản và giao diện"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--glass)] text-[15px] font-semibold text-tx-strong shadow-[var(--shadow-xs)]"
        >
          {initials(user.displayName).slice(0, 1)}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-base leading-tight font-semibold text-tx-strong">{user.displayName}</span>
          <span className="self-start rounded-full bg-[var(--glass)] px-2 text-xs leading-5 font-medium text-tx-2">
            {ROLE_LABEL[user.role]}
          </span>
        </div>
        <BellButton glass />
      </div>
      <div className="relative flex items-baseline justify-between gap-3 px-0.5 pt-4">
        <h1 className="m-0 text-[26px] leading-[1.15] font-semibold tracking-[-0.015em] text-tx-strong">{title}</h1>
        <span className="text-[13px] whitespace-nowrap text-tx-2">{fmtBusinessDate(m.today)}</span>
      </div>
      <div className="h-6" />
    </div>
  )
}

function ReceptionBody() {
  const m = useM()
  const [showSeated, setShowSeated] = useState(false)
  const g = useMemo(() => splitShift(m.reservations ?? []), [m.reservations])
  const soon = (min: number) => (r: { expectedAt: Date }) => r.expectedAt.getTime() - m.now.getTime() <= min * MS.MIN
  const openWait = (m.waitlist ?? []).filter(isOpenEntry)
  const scrollToAttention = () => {
    const el = document.getElementById("m-attention")
    const box = el?.closest<HTMLElement>("[data-scroll]")
    if (el && box) box.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" })
  }
  const summary = [
    { label: "Booking", value: g.live.length, go: () => m.go("list") },
    { label: "Số khách", value: g.live.reduce((s, r) => s + r.partySize, 0), go: () => m.go("list") },
    { label: "Cần xử lý", value: g.attention.length, alert: g.attention.length > 0, go: scrollToAttention },
    { label: "Sắp đến 60'", value: g.upcoming.filter(soon(60)).length, go: () => m.go("list") },
  ]
  return (
    <div className="relative z-10 flex flex-col pb-8">
      <div className={cn(card, "mx-4 -mt-3.5 grid grid-cols-4 px-1 py-3.5 shadow-[var(--shadow-soft)]")}>
        {summary.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={s.go}
            className={cn("flex flex-col items-center gap-0.5 px-1 py-0.5 text-tx-1", i && "border-l border-border")}
          >
            <span
              className={cn("text-[22px] leading-[1.15] font-medium", s.alert ? "text-st-late-ink" : "text-tx-strong")}
            >
              {s.value}
            </span>
            <span className="text-center text-xs leading-[1.3] text-[var(--text-muted)]">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-3.5">
        <div id="m-attention">
          <SectionHead title="Cần xử lý ngay" aside={`${g.attention.length} booking`} />
        </div>
        {!m.reservations ? (
          <CardSkeleton n={2} />
        ) : g.attention.length ? (
          g.attention.map((r) => <BookingCard key={r.id} r={r} actions />)
        ) : (
          <EmptyBox
            title="Không có booking cần xử lý"
            body={`Cảnh báo trễ ${m.th.late} phút và ${m.th.noshow} phút sẽ hiện ở đây.`}
          />
        )}

        <NowMarker now={m.now} />

        <SectionHead title="Sắp đến" aside={`${g.upcoming.length} booking`} />
        {g.upcoming.length ? (
          g.upcoming.map((r) => <BookingCard key={r.id} r={r} actions={soon(15)(r)} />)
        ) : m.reservations ? (
          <EmptyBox
            title="Chưa có khách sắp đến"
            body="Xem toàn bộ booking của ca trong Danh sách."
            action={{ label: "Mở Danh sách", onClick: () => m.go("list") }}
          />
        ) : null}

        <button
          type="button"
          aria-expanded={showSeated}
          onClick={() => setShowSeated((v) => !v)}
          className="mt-1.5 flex min-h-[52px] items-center gap-2.5 rounded-2xl border border-border bg-surface-1 px-3.5 text-left text-[15px] font-medium text-tx-1"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-st-seated-tint text-st-seated-ink">
            <Check className="size-[15px]" strokeWidth={2.2} />
          </span>
          <span className="flex-1">Đã nhận bàn</span>
          <span className="text-[13px] font-normal text-[var(--text-muted)]">{g.seated.length} booking</span>
          <ChevronDown
            className={cn(
              "size-[18px] shrink-0 text-subtle transition-transform duration-150",
              showSeated && "rotate-180",
            )}
          />
        </button>
        {showSeated ? g.seated.map((r) => <BookingCard key={r.id} r={r} />) : null}
      </div>

      {openWait.length ? (
        <section className="flex flex-col gap-2.5 px-4 pt-2 pb-20">
          <SectionHead
            title="Đang chờ bàn"
            action={<LinkButton onClick={() => m.go("wait")}>Xem đơn chờ</LinkButton>}
          />
          {openWait.slice(0, 2).map((e) => (
            <WaitCard key={e.id} e={e} />
          ))}
        </section>
      ) : (
        <div className="h-20" />
      )}
    </div>
  )
}

function OwnerBody() {
  const m = useM()
  const navigate = useNavigate()
  const overviewQuery = useOverview()
  const o = overviewQuery.data
  const g = useMemo(() => splitShift(m.reservations ?? []), [m.reservations])
  const openWait = (m.waitlist ?? []).filter(isOpenEntry)
  const zoneTag = (code: string) =>
    m.model.catalog?.zones.find((z) => z.code === code)?.isWaitingArea ? "khu chờ" : ""

  if (overviewQuery.isError) {
    return (
      <div className="flex flex-col gap-2.5 px-4">
        <EmptyBox
          title="Lỗi tải tổng quan"
          body={
            isApiError(overviewQuery.error)
              ? overviewQuery.error.message
              : overviewQuery.error instanceof Error
                ? overviewQuery.error.message
                : "Không thể tải dữ liệu tổng quan."
          }
        />
      </div>
    )
  }

  if (!o) {
    return (
      <div className="flex flex-col gap-2.5 px-4">
        <CardSkeleton n={3} />
      </div>
    )
  }

  const kpis = [
    {
      label: "Bàn đang sử dụng",
      value: o.tablesInUse,
      of: `/${o.tablesTotal}`,
      hint: `Bar ${o.barSeatsInUse}/${o.barSeatsTotal} ghế`,
      go: () => m.go("map"),
    },
    { label: "Lượt ghé", value: o.visitsTonight, hint: `${o.seatedVisits} lượt đang mở`, go: () => m.go("list") },
    {
      label: "Số khách thực tế",
      value: o.guestsTonight,
      hint: "Không đếm trùng khi ghép, đổi bàn",
      go: () => m.go("list"),
    },
    // BL-07: "lượt sử dụng bàn" is not defined yet, so no number is shown.
    { label: "Lượt sử dụng bàn", value: null, hint: "Chờ chốt BL-07", go: undefined },
  ]
  const bookingSum = [
    { label: "Tổng", value: o.reservationsTotal },
    { label: "Đã check-in", value: o.checkedInReservations },
    { label: "Sắp đến", value: g.upcoming.length },
    { label: "Chưa có bàn", value: o.reservationsUnassigned, alert: o.reservationsUnassigned > 0 },
  ]
  const quick = [
    { label: "Sơ đồ", icon: MapIcon, go: () => m.go("map") },
    { label: "Booking", icon: List, go: () => m.go("list") },
    { label: "Đơn chờ", icon: ListOrdered, go: () => m.go("wait") },
    { label: "Báo cáo", icon: ChartColumn, go: () => navigate("/reports") },
  ]

  return (
    <div className="relative z-10 -mt-3.5 flex flex-col gap-[22px] px-4 pb-6">
      <div role="group" aria-label="Chỉ số chính" className="grid grid-cols-2 gap-2.5">
        {kpis.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={k.go}
            disabled={!k.go}
            className={cn(
              card,
              "flex min-h-28 flex-col items-start gap-1 p-3.5 text-left text-tx-1 shadow-[var(--shadow-soft)] disabled:opacity-100",
            )}
          >
            <span className="text-[13px] text-[var(--text-muted)]">{k.label}</span>
            {k.value === null ? (
              <span className="mt-1 rounded-full border border-dashed border-strong px-2.5 py-0.5 text-xs font-medium text-tx-2">
                Đang chuẩn hóa
              </span>
            ) : (
              <span className="flex items-baseline gap-0.5 text-[30px] leading-[1.1] font-medium tracking-[-0.02em] text-tx-strong">
                {k.value}
                {k.of ? <span className="text-base font-normal text-subtle">{k.of}</span> : null}
              </span>
            )}
            <span className="mt-auto text-xs leading-[1.35] text-pretty text-subtle">{k.hint}</span>
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 text-base font-semibold text-tx-strong">Theo khu</h2>
          <LinkButton onClick={() => m.go("map")}>Mở sơ đồ</LinkButton>
        </div>
        <div className={cn(card, "flex flex-col gap-3.5 p-4")}>
          {o.byZone.map((z) => (
            <div key={z.zone} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[14px]">
                <span>
                  {z.name} <span className="text-subtle">{zoneTag(z.zone)}</span>
                </span>
                <span className="text-tx-2">
                  {z.inUse}/{z.total} {z.zone === "BAR" ? "ghế" : "bàn"}
                </span>
              </div>
              <div
                role="meter"
                aria-label={`${z.name} đang dùng`}
                aria-valuemin={0}
                aria-valuemax={z.total}
                aria-valuenow={z.inUse}
                className="h-2 overflow-hidden rounded-full bg-surface-3"
              >
                <div
                  className="h-full rounded-full bg-[var(--st-seated-fill)]"
                  style={{ width: `${z.total ? Math.round((z.inUse / z.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="m-0 text-base font-semibold text-tx-strong">
          Cần xử lý <span className="font-normal text-[var(--text-muted)]">{g.attention.length}</span>
        </h2>
        {g.attention.length ? (
          <div className={cn(card, "flex flex-col overflow-hidden")}>
            {g.attention.map((r, i) => {
              const late = r.warning ? r.minutesLate : 0
              const tone = r.warning === "noshow" ? "noshow" : "late"
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => m.openDetail(r.id, r.businessDate)}
                  className={cn(
                    "flex min-h-[62px] items-center gap-3 px-3.5 py-2 text-left text-tx-1 active:bg-surface-2",
                    i && "border-t border-border",
                  )}
                >
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-full"
                    style={{ background: `var(--st-${tone}-tint)`, color: `var(--st-${tone}-ink)` }}
                  >
                    <Clock className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-medium">
                      {late ? `${r.displayName}, trễ ${late} phút` : `${r.displayName}, chưa có bàn`}
                    </span>
                    <span className="text-[13px] text-[var(--text-muted)]">
                      {fmtTime12(r.expectedAt)}, {r.partySize} khách
                      {r.tableIds.length ? `, ${tableText(r.tableIds, m.model)}` : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-subtle" />
                </button>
              )
            })}
          </div>
        ) : (
          <EmptyBox title="Ca đang ổn" body="Không có booking trễ hoặc chưa có bàn." />
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="m-0 text-base font-semibold text-tx-strong">Booking ca tối</h2>
        <div className={cn(card, "grid grid-cols-4 px-1 py-3.5")}>
          {bookingSum.map((s, i) => (
            <div key={s.label} className={cn("flex flex-col items-center gap-0.5", i && "border-l border-border")}>
              <span className={cn("text-xl font-medium", s.alert ? "text-st-late-ink" : "text-tx-strong")}>
                {s.value}
              </span>
              <span className="text-center text-xs leading-[1.3] text-[var(--text-muted)]">{s.label}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => m.go("wait")}
          className={cn(card, "flex min-h-14 items-center gap-3 px-3.5 py-2 text-left text-tx-1")}
        >
          <span className="flex flex-1 flex-col">
            <span className="text-[15px] font-medium">
              Danh sách chờ <span className="font-normal text-[var(--text-muted)]">{openWait.length}</span>
            </span>
            <span className="text-[13px] text-[var(--text-muted)]">
              {o.waitlistAdvance} đặt trước chưa có bàn, {o.waitlistWalkIn} walk-in chưa có bàn
            </span>
          </span>
          <ChevronRight className="size-4 text-subtle" />
        </button>
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="m-0 text-base font-semibold text-tx-strong">Truy cập nhanh</h2>
        <div className="grid grid-cols-4 gap-2">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={q.go}
              className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-surface-1 px-1 py-3 text-xs text-tx-1"
            >
              <q.icon className="size-[22px] text-primary-ink" strokeWidth={1.8} />
              {q.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

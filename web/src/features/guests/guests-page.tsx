import {
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Clock3,
  Footprints,
  History,
  ListOrdered,
  NotebookPen,
  Repeat2,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react"
import { useState } from "react"
import { BarChart } from "@/components/bar-chart"
import { EmptyState, GuardedButton, GuestAvatar, MaskedPhone, SectionTitle, TableCodes } from "@/components/common"
import { RevealPhone } from "@/components/reveal-phone"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ORIGIN_LABEL, SOURCE_LABEL, type VisitOrigin } from "@/domain/enums"
import type { CustomerProfile } from "@/domain/models"
import { ReservationStatusChip } from "../reservations/reservation-status"
import { useAction } from "@/hooks/use-action"
import { useCatalog, useCustomer, useCustomers } from "@/hooks/use-data"
import { useMediaQuery } from "@/hooks/use-media"
import { NOTE_PHONE_ERROR, noteHasPhoneNumber } from "@/lib/text"
import { fmtBusinessDate, fmtDayMonth, fmtTime, venueDateString } from "@/lib/time"
import { cn } from "@/lib/utils"
import { api } from "@/services"
import { useSession } from "@/state/session"

export default function GuestsPage() {
  if (api.mode === "http") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState icon={<Users />} title="Chưa hỗ trợ hồ sơ khách hàng">
          Hệ thống backend v1 chưa hỗ trợ tìm kiếm và quản lý hồ sơ khách hàng.
        </EmptyState>
      </div>
    )
  }
  return <GuestsContent />
}

function GuestsContent() {
  const [q, setQ] = useState("")
  const [picked, setSelected] = useState<number | null>(null)
  const list = useCustomers(q)
  const wide = useMediaQuery("(min-width: 1024px)")
  const selected = picked ?? (wide ? (list.data?.[0]?.id ?? null) : null)

  const showList = wide || selected === null
  const showProfile = wide || selected !== null

  return (
    <div className="flex h-full min-h-0">
      {showList ? (
        <aside className="flex w-full min-w-0 flex-col border-r lg:w-[380px] lg:shrink-0" aria-label="Danh sách khách">
          <div className="grid gap-2 border-b p-4">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tên (không dấu) hoặc 3 số cuối"
                className="h-11 pr-10 pl-9"
                aria-label="Tìm khách"
              />
              {q ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  aria-label="Xóa tìm kiếm"
                  onClick={() => setQ("")}
                >
                  <X />
                </Button>
              ) : null}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-subtle">
              <ShieldCheck className="size-3.5" aria-hidden /> Chỉ hiện tên và 3 số cuối SĐT
            </p>
          </div>
          <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto">
            {list.isLoading ? (
              <div className="grid gap-2 p-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : (list.data ?? []).length === 0 ? (
              <EmptyState title="Không tìm thấy khách" icon={<Users />} />
            ) : (
              <ul className="divide-y divide-border/70">
                {list.data!.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(c.id)}
                      aria-current={selected === c.id}
                      className={cn(
                        "relative flex min-h-[68px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2",
                        selected === c.id &&
                          "bg-surface-2 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-foreground",
                      )}
                    >
                      <GuestAvatar name={c.displayName} seed={c.id} size={38} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{c.displayName}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <MaskedPhone last3={c.phoneLast3} className="text-xs" />
                          {c.lastVisitAt ? (
                            <span className="tnum inline-flex items-center gap-1 text-subtle">
                              <Clock3 className="size-3" aria-hidden />
                              {fmtDayMonth(venueDateString(c.lastVisitAt))}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span
                        className="tnum inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground"
                        aria-label={`${c.visitCount} lượt ghé`}
                      >
                        <Repeat2 className="size-3" aria-hidden />
                        <span className="font-medium text-foreground">{c.visitCount}</span> lượt
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      ) : null}
      {showProfile ? (
        <section className="min-w-0 flex-1 scrollbar-thin overflow-y-auto" aria-label="Hồ sơ khách">
          {selected ? (
            <Profile id={selected} onBack={wide ? undefined : () => setSelected(null)} />
          ) : (
            <EmptyState title="Chọn một khách để xem hồ sơ" icon={<Users />} />
          )}
        </section>
      ) : null}
    </div>
  )
}

function Profile({ id, onBack }: { id: number; onBack?: () => void }) {
  const profile = useCustomer(id)
  const catalog = useCatalog()
  const p = profile.data
  const codes = (ids: number[]) =>
    ids.map((tid) => {
      const t = catalog.data?.tables.find((x) => x.id === tid)
      return t ? (t.kind === "BAR_SEAT" ? `Bar ${t.seqNo}` : t.code) : `#${tid}`
    })
  if (!p)
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  const [sinceY, sinceM] = venueDateString(p.createdAt).split("-")
  const sinceMonth = `T${Number(sinceM)}/${sinceY}`
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-4 md:p-6">
      {onBack ? (
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onBack}>
          <ArrowLeft /> Danh sách khách
        </Button>
      ) : null}
      <header className="flex flex-wrap items-center gap-4">
        <GuestAvatar name={p.displayName} seed={p.id} size={56} />
        <div className="grid min-w-0 gap-1.5">
          <h2 className="truncate text-2xl leading-tight font-bold">{p.displayName}</h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <RevealPhone key={p.id} customerId={p.id} last3={p.phoneLast3} />
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-3.5 text-subtle" aria-hidden /> Khách từ {sinceMonth}
            </span>
            <span className="text-subtle">#{p.id}</span>
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={CalendarCheck} hue={265} k="Lượt ghé 30 ngày" v={p.visits30d} />
        <Stat icon={CalendarRange} hue={200} k="Lượt ghé 90 ngày" v={p.visits90d} />
        <Stat
          icon={Clock3}
          hue={300}
          k="Lần gần nhất"
          v={p.lastVisitAt ? fmtBusinessDate(venueDateString(p.lastVisitAt), "short") : "-"}
        />
        <Stat icon={Users} hue={130} k="Khách TB / lượt" v={p.averageParty ?? "-"} />
      </dl>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="grid content-start gap-3 rounded-2xl border p-4 md:p-5">
          <SectionTitle>Lượt ghé theo tháng</SectionTitle>
          <BarChart
            ariaLabel="Số lượt ghé theo tháng, 6 tháng gần nhất"
            series={["Lượt ghé"]}
            data={p.visitsByMonth.map((m) => ({
              key: m.month,
              label: `T${Number(m.month.slice(5))}`,
              values: [m.count],
            }))}
            height={150}
            unit=" lượt"
          />
          <p className="text-xs text-subtle">Đếm theo lượt ghé. Không gán doanh thu bàn cho một khách.</p>
        </section>
        <NotesEditor key={`${p.id}:${p.version}`} profile={p} />
      </div>

      <section className="grid gap-2.5">
        <SectionTitle aside={<span className="tnum text-xs text-subtle">{p.visitCount}</span>}>
          Lịch sử lượt ghé
        </SectionTitle>
        {p.visits.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-subtle">
            <History className="size-4" aria-hidden /> Chưa có lượt ghé
          </p>
        ) : (
          <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border">
            {p.visits.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <DateBlock bd={v.businessDate} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="tnum text-sm">
                      {fmtTime(v.startedAt)}
                      {v.endedAt ? <span className="text-muted-foreground"> → {fmtTime(v.endedAt)}</span> : null}
                    </span>
                    {!v.endedAt ? (
                      <span className="inline-flex h-5 items-center rounded-full bg-st-seated-tint px-2 text-[11px] text-st-seated-ink">
                        đang ngồi
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <TableCodes codes={codes(v.tableIds)} symbolNo={v.symbolNo} className="[&>span]:text-xs" />
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" aria-hidden /> {v.guestCount}
                    </span>
                  </span>
                </span>
                <OriginChip origin={v.origin} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-2.5">
        <SectionTitle aside={<span className="tnum text-xs text-subtle">{p.reservations.length}</span>}>
          Lịch sử booking
        </SectionTitle>
        {p.reservations.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-subtle">
            <CalendarDays className="size-4" aria-hidden /> Chưa có booking
          </p>
        ) : (
          <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border">
            {p.reservations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <DateBlock bd={r.businessDate} />
                <span className="min-w-0 flex-1">
                  <span className="tnum block text-sm">Hẹn {fmtTime(r.expectedAt)}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" aria-hidden /> {r.partySize}
                    </span>
                    <span>{SOURCE_LABEL[r.sourceCode]}</span>
                  </span>
                </span>
                <ReservationStatusChip r={r} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

const ORIGIN_META: Record<VisitOrigin, { icon: typeof Footprints; hue: number }> = {
  RESERVATION: { icon: CalendarCheck, hue: 265 },
  WALK_IN: { icon: Footprints, hue: 200 },
  WAITLIST: { icon: ListOrdered, hue: 300 },
}

function OriginChip({ origin }: { origin: VisitOrigin }) {
  const m = ORIGIN_META[origin]
  return (
    <span
      className="tone inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium"
      style={{ ["--h" as string]: m.hue }}
    >
      <m.icon className="size-3.5" aria-hidden />
      {ORIGIN_LABEL[origin]}
    </span>
  )
}

/** "22/10" over a short weekday, so rows scan by date without a table grid. */
function DateBlock({ bd }: { bd: string }) {
  const weekday = fmtBusinessDate(bd, "short").split(",")[0]
  return (
    <span className="grid w-11 shrink-0 text-center leading-tight">
      <span className="tnum text-sm font-semibold">{fmtDayMonth(bd)}</span>
      <span className="text-[11px] text-subtle">{weekday}</span>
    </span>
  )
}

function Stat({ icon: Icon, hue, k, v }: { icon: typeof Users; hue: number; k: string; v: React.ReactNode }) {
  // dt/dd must be direct children of the dl item: the icon lives inside dt, positioned left.
  return (
    <div className="relative grid min-h-[68px] content-center gap-0.5 rounded-2xl border py-3 pr-3 pl-[66px]">
      <dt className="truncate text-xs text-muted-foreground">
        <span
          className="tone absolute top-1/2 left-3.5 grid size-10 -translate-y-1/2 place-items-center rounded-xl"
          style={{ ["--h" as string]: hue }}
          aria-hidden
        >
          <Icon className="size-[18px]" />
        </span>
        {k}
      </dt>
      <dd className="tnum text-xl leading-tight font-semibold">{v}</dd>
    </div>
  )
}

function NotesEditor({ profile }: { profile: CustomerProfile }) {
  const role = useSession((s) => s.user.role)
  const [notes, setNotes] = useState(profile.notes ?? "")
  const { run, pending } = useAction()
  const invalid = noteHasPhoneNumber(notes)
  const dirty = notes !== (profile.notes ?? "")
  return (
    <section className="grid content-start gap-3 rounded-2xl border p-4 md:p-5">
      <SectionTitle aside={<NotebookPen className="size-4 text-subtle" aria-hidden />}>Ghi chú phục vụ</SectionTitle>
      <Textarea
        rows={5}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={role === "CASHIER"}
        aria-invalid={invalid}
        aria-label="Ghi chú phục vụ"
        placeholder="Sở thích chỗ ngồi, dịp đặc biệt…"
      />
      {invalid ? (
        <p className="text-sm text-destructive">{NOTE_PHONE_ERROR}</p>
      ) : (
        <p className="text-xs text-subtle">Tối đa 500 ký tự, không ghi thông tin nhạy cảm.</p>
      )}
      <div className="flex gap-2">
        <GuardedButton
          permission="reservation.update"
          disabled={!dirty || invalid || pending}
          onClick={() => run(() => api.updateCustomerNotes(profile.id, profile.version, notes))}
        >
          Lưu ghi chú
        </GuardedButton>
        {dirty ? (
          <Button variant="ghost" onClick={() => setNotes(profile.notes ?? "")}>
            Bỏ thay đổi
          </Button>
        ) : null}
      </div>
    </section>
  )
}

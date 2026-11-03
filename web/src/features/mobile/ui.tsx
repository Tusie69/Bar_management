import { Bell, ChevronDown, Ellipsis, StickyNote, Users } from "lucide-react"
import { useEffect, useRef, type ReactNode } from "react"
import { SOURCE_LABEL } from "@/domain/enums"
import type { ReservationView } from "@/domain/models"
import { fmtTime12 } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useMobileActions } from "./actions"
import { useM, type Tab } from "./context"
import { chipOf, fmtShort, subOf, tableText, toneOf, toneStyle } from "./model"

export const card = "rounded-[18px] border border-border bg-surface-1"

/* Scroll position survives tab switches (each tab remounts). */
const scrollPos = new Map<string, number>()
export function useKeepScroll(key: Tab | string) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = scrollPos.get(key) ?? 0
    return () => {
      if (el) scrollPos.set(key, el.scrollTop)
    }
  }, [key])
  return ref
}

export function BellButton({ glass }: { glass?: boolean }) {
  const m = useM()
  return (
    <button
      type="button"
      onClick={m.openAlerts}
      aria-label={`Thông báo, ${m.unread} chưa xem`}
      className={cn(
        "relative grid size-11 shrink-0 place-items-center rounded-full text-tx-1",
        glass ? "bg-[var(--glass)] shadow-[var(--shadow-xs)]" : "-mr-1.5 active:bg-surface-2",
      )}
    >
      <Bell className="size-[21px]" strokeWidth={1.8} />
      {m.unread ? (
        <span className="absolute top-0.5 right-0 h-[18px] min-w-[18px] rounded-full bg-st-noshow px-[5px] text-center text-[11px] leading-[18px] font-semibold text-white">
          {m.unread}
        </span>
      ) : null}
    </button>
  )
}

export function PlainHeader({ title, children }: { title: string; children?: ReactNode }) {
  const m = useM()
  return (
    <header className="z-[5] shrink-0 bg-background px-4 pt-[var(--top-safe)]">
      <div className="flex h-[52px] items-center gap-3">
        <h1 className="m-0 flex-1 truncate text-[22px] font-semibold tracking-[-0.01em] text-tx-strong">{title}</h1>
        <span className="shrink-0 text-[13px] text-[var(--text-muted)]">{fmtShort(m.today)}</span>
        <BellButton />
      </div>
      {children}
    </header>
  )
}

export function Seg<T extends string>({
  label,
  opts,
  value,
  onChange,
  small,
}: {
  label: string
  opts: [T, string][]
  value: T
  onChange: (v: T) => void
  small?: boolean
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid gap-1 rounded-[14px] bg-surface-3 p-1"
      style={{ gridTemplateColumns: `repeat(${opts.length},minmax(0,1fr))` }}
    >
      {opts.map(([k, l]) => {
        const on = k === value
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(k)}
            className={cn(
              "h-9 rounded-[10px]",
              small ? "text-[13px]" : "text-[14px]",
              on ? "bg-surface-1 font-semibold text-tx-strong shadow-[var(--shadow-xs)]" : "font-medium text-tx-2",
            )}
          >
            {l}
          </button>
        )
      })}
    </div>
  )
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-[34px] shrink-0 rounded-full border px-3 text-[13px] font-medium",
        on ? "border-tx-strong bg-tx-strong text-background" : "border-border bg-surface-1 text-tx-1",
      )}
    >
      {children}
    </button>
  )
}

export function SectionHead({ title, aside, action }: { title: string; aside?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-0.5 pt-2.5">
      <h2 className="m-0 text-base font-semibold text-tx-strong">{title}</h2>
      {aside ? <span className="text-[13px] text-[var(--text-muted)]">{aside}</span> : null}
      {action}
    </div>
  )
}

export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-my-1.5 -mr-2 h-8 rounded-[10px] px-2 text-[13px] font-medium text-primary-ink"
    >
      {children}
    </button>
  )
}

export function EmptyBox({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[18px] border border-dashed border-strong px-6 py-8 text-center">
      <span className="text-[15px] font-medium text-tx-strong">{title}</span>
      <span className="text-[13px] text-pretty text-[var(--text-muted)]">{body}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 h-11 rounded-xl border border-primary px-[18px] text-[14px] font-medium text-primary-ink"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

export function NowMarker({ now }: { now: Date }) {
  const t = fmtTime12(now)
  return (
    <div role="separator" aria-label={`Bây giờ ${t}`} className="flex items-center gap-2 pt-2 pb-0.5">
      <span className="rounded-full bg-primary px-2.5 text-xs leading-6 font-semibold whitespace-nowrap text-primary-foreground">
        Bây giờ {t}
      </span>
      <span className="h-0.5 flex-1 rounded-[1px] bg-primary opacity-50" />
    </div>
  )
}

export function StatusChip({ r, onClick, big }: { r: ReservationView; onClick: () => void; big?: boolean }) {
  const m = useM()
  const chip = chipOf(r, m.now)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={`Trạng thái ${chip}. Đổi trạng thái`}
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-full font-medium",
        big ? "h-[30px] pr-2 pl-3 text-[13px]" : "-my-1.5 -mr-1 h-7 pr-2 pl-2.5 text-xs",
      )}
      style={toneStyle(toneOf(r))}
    >
      {chip}
      <ChevronDown className="size-3.5" strokeWidth={2.2} />
    </button>
  )
}

export function BookingCard({ r, actions }: { r: ReservationView; actions?: boolean }) {
  const m = useM()
  const a = useMobileActions()
  const chip = chipOf(r, m.now)
  const dim = r.status !== "BOOKED"
  const unassigned = r.status === "BOOKED" && !r.tableIds.length
  const sub = subOf(r, m.now, m.th)
  const subColor =
    r.warning === "noshow"
      ? "var(--st-noshow-ink)"
      : r.warning === "late" || unassigned
        ? "var(--st-late-ink)"
        : "var(--text-muted)"
  const open = () => m.openDetail(r.id, r.businessDate)
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          open()
        }
      }}
      aria-label={`${fmtTime12(r.expectedAt)} ${r.displayName}, ${r.partySize} khách, ${chip}. Mở chi tiết`}
      className={cn(
        card,
        "flex cursor-pointer flex-col gap-1.5 py-3.5 pr-3.5 pl-4 shadow-[var(--shadow-xs)] outline-none active:bg-surface-2",
        (r.status === "CANCELLED" || r.status === "NO_SHOW") && "opacity-70",
      )}
      style={r.status === "BOOKED" && r.warning === "noshow" ? { borderColor: "var(--st-noshow)" } : undefined}
    >
      <div className="flex items-center gap-2">
        <span className={cn("w-[72px] shrink-0 text-[15px] font-semibold", dim ? "text-subtle" : "text-tx-strong")}>
          {fmtTime12(r.expectedAt)}
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-base font-medium", dim ? "text-tx-2" : "text-tx-strong")}>
          {r.displayName}
        </span>
        <StatusChip r={r} onClick={() => m.openStatus(r)} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0.5 pl-20 text-[13px] text-tx-2">
        <span className="flex items-center gap-[5px]">
          <Users className="size-3.5 text-subtle" aria-hidden />
          {r.partySize} khách
        </span>
        <span className={unassigned ? "font-medium text-st-late-ink" : undefined}>
          {tableText(r.tableIds, m.model)}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 pl-20 text-[13px] text-subtle">
        <span>{SOURCE_LABEL[r.sourceCode]}</span>
        {r.phoneLast3 ? <span>•••{r.phoneLast3}</span> : null}
      </div>
      {sub ? (
        <div className="pl-20 text-[13px] font-medium" style={{ color: subColor }}>
          {sub}
        </div>
      ) : null}
      {r.note && r.status === "BOOKED" ? (
        <div className="ml-20 flex gap-1.5 rounded-[10px] bg-surface-2 px-2.5 py-1.5 text-[13px] text-tx-2">
          <StickyNote className="mt-[3px] size-3.5 shrink-0 text-subtle" aria-hidden />
          <span className="text-pretty">{r.note}</span>
        </div>
      ) : null}
      {actions && r.status === "BOOKED" ? (
        <div className="flex gap-2 pt-1 pl-20">
          <button
            type="button"
            disabled={a.pending}
            onClick={(e) => {
              e.stopPropagation()
              if (unassigned) a.assign(r)
              else void a.checkIn(r)
            }}
            className={cn(
              "h-11 flex-1 rounded-xl border border-primary text-[14px] font-medium active:brightness-95",
              unassigned ? "bg-transparent text-primary-ink" : "bg-primary text-primary-foreground",
            )}
          >
            {unassigned ? "Xếp bàn" : "Khách đã đến"}
          </button>
          <button
            type="button"
            aria-label="Thao tác khác"
            onClick={(e) => {
              e.stopPropagation()
              m.openStatus(r)
            }}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-strong text-tx-1"
          >
            <Ellipsis className="size-[18px]" />
          </button>
        </div>
      ) : null}
    </article>
  )
}

export function CardSkeleton({ n = 3 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={cn(card, "h-[104px] animate-pulse bg-surface-2")} />
      ))}
    </>
  )
}

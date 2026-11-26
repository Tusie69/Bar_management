import { Bell, ChevronDown, Ellipsis, Inbox, Redo2, StickyNote, Undo2, Users } from "lucide-react"
import { useEffect, useRef, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { SOURCE_LABEL } from "@/domain/enums"
import type { ReservationView } from "@/domain/models"
import { fmtTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useUndoRedo, useUndoRedoShortcuts } from "@/features/operations/use-undo-redo"
import { useMobileActions } from "./actions"
import { useM, type Tab } from "./context"
import { chipOf, fmtShort, subOf, tableText, toneOf, toneStyle } from "./model"

export const card = "rounded-2xl border border-border bg-surface-1 shadow-[var(--shadow-xs)]"

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

/**
 * BA-020 / US-10 on Mobile. Same hook, same endpoints and same server-owned
 * eligibility as the Desktop top bar; a button only enables when the server
 * reports a compensable operation for this device session.
 */
export function UndoRedoButtons({ glass, square }: { glass?: boolean; square?: boolean }) {
  const controller = useUndoRedo()
  const { undo, redo, pending, apply } = controller
  useUndoRedoShortcuts(controller)
  if (!controller.enabled) return null
  const base = cn(
    "gm-press grid size-11 shrink-0 place-items-center text-tx-1 disabled:pointer-events-none disabled:text-[var(--text-muted)] disabled:opacity-40",
    square
      ? "rounded-xl border border-border bg-surface-1 shadow-[var(--shadow-xs)] enabled:hover:border-border-strong enabled:hover:bg-surface-2"
      : "rounded-full",
    !square &&
      (glass
        ? "border border-[var(--border-subtle)] bg-[var(--glass)] shadow-[var(--shadow-xs)] backdrop-blur-md"
        : "enabled:hover:bg-surface-2"),
  )
  return (
    <>
      <button
        type="button"
        aria-label="Hoàn tác"
        disabled={!undo || pending}
        onClick={() => void apply("undo")}
        className={base}
      >
        <Undo2 className="size-[20px]" strokeWidth={1.85} />
      </button>
      <button
        type="button"
        aria-label="Làm lại"
        disabled={!redo || pending}
        onClick={() => void apply("redo")}
        className={base}
      >
        <Redo2 className="size-[20px]" strokeWidth={1.85} />
      </button>
    </>
  )
}

export function MenuUnreadDot({ unread }: { unread: number }) {
  if (unread <= 0) return null
  return (
    <span
      aria-hidden
      data-testid="reception-menu-unread"
      className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-st-noshow ring-2 ring-background"
    />
  )
}

export function BellButton({ glass, square }: { glass?: boolean; square?: boolean }) {
  const m = useM()
  if (m.role === "RECEPTIONIST") return null
  return (
    <button
      type="button"
      onClick={m.openAlerts}
      aria-label={`Thông báo, ${m.unread} chưa xem`}
      className={cn(
        "gm-press relative grid size-11 shrink-0 place-items-center text-tx-1",
        square
          ? "rounded-xl border border-border bg-surface-1 shadow-[var(--shadow-xs)] hover:border-border-strong hover:bg-surface-2"
          : "rounded-full",
        !square &&
          (glass
            ? "border border-[var(--border-subtle)] bg-[var(--glass)] shadow-[var(--shadow-xs)] backdrop-blur-md"
            : "-mr-1.5 hover:bg-surface-2"),
      )}
    >
      <Bell className={square ? "size-[19px]" : "size-[20px]"} strokeWidth={1.85} />
      {m.unread ? (
        <span
          className={cn(
            "tnum absolute h-[18px] min-w-[18px] rounded-full bg-st-noshow px-[5px] text-center text-[11px] leading-[18px] font-semibold text-white shadow-xs",
            square ? "-top-1.5 -right-1.5" : "top-0.5 right-0",
          )}
        >
          {m.unread}
        </span>
      ) : null}
    </button>
  )
}

export function PlainHeader({ title, children }: { title: string; children?: ReactNode }) {
  const m = useM()
  return (
    <header className="gm-glass-chrome z-[5] shrink-0 border-b border-border/70 bg-[var(--glass-chrome)] px-4 pt-[var(--top-safe)] backdrop-blur-md">
      <div className="flex h-[54px] items-center gap-2.5">
        <h1 className="m-0 min-w-0 flex-1 truncate text-[21px] leading-[1.2] font-bold tracking-[-0.02em] text-tx-strong">
          {title}
        </h1>
        <span className="tnum shrink-0 rounded-full border border-border/70 bg-surface-2 px-2.5 py-1 text-xs font-medium text-[var(--text-muted)]">
          {fmtShort(m.today)}
        </span>
        <UndoRedoButtons />
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
      className="grid gap-1 rounded-xl border border-border/60 bg-surface-3/85 p-1"
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
              "gm-press min-h-11 rounded-[10px] px-2 transition-[background-color,color,box-shadow,transform]",
              small ? "text-[13px]" : "text-[14px]",
              on
                ? "bg-surface-1 font-semibold text-tx-strong shadow-[var(--shadow-xs)]"
                : "font-medium text-tx-2 hover:text-tx-1",
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
        "gm-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap",
        on
          ? "border-tx-strong bg-tx-strong text-background shadow-[var(--shadow-xs)]"
          : "border-border bg-surface-1 text-tx-1 hover:border-border-strong hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  )
}

export function SectionHead({ title, aside, action }: { title: string; aside?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5 pt-3">
      <h2 className="m-0 text-[16px] leading-snug font-semibold tracking-[-0.01em] text-tx-strong">{title}</h2>
      {aside ? <span className="tnum text-[13px] font-medium text-[var(--text-muted)]">{aside}</span> : null}
      {action}
    </div>
  )
}

export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="gm-press -my-1.5 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-[13px] font-semibold text-primary-ink hover:bg-primary-tint"
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
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong bg-surface-1/65 px-6 py-8 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-[var(--text-muted)]">
        <Inbox className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="text-[15px] font-semibold text-tx-strong">{title}</span>
      <span className="max-w-[30ch] text-[13px] leading-relaxed text-pretty text-[var(--text-muted)]">{body}</span>
      {action ? (
        <Button type="button" variant="outline" onClick={action.onClick} className="mt-1.5 rounded-xl px-5">
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

export function NowMarker({ now }: { now: Date }) {
  const t = fmtTime(now)
  return (
    <div role="separator" aria-label={`Bây giờ ${t}`} className="flex items-center gap-2.5 pt-2.5 pb-0.5">
      <span className="tnum inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold whitespace-nowrap text-primary-foreground shadow-[var(--shadow-xs)]">
        <span className="size-1.5 rounded-full bg-primary-foreground/90" aria-hidden />
        Bây giờ {t}
      </span>
      <span className="h-[1.5px] flex-1 rounded-full bg-primary/35" />
    </div>
  )
}

export function StatusChip({ r, onClick, big }: { r: ReservationView; onClick: () => void; big?: boolean }) {
  const m = useM()
  const chip = chipOf(r, m.now)
  const tone = toneOf(r)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={`Trạng thái ${chip}. Đổi trạng thái`}
      className={cn(
        "gm-press inline-flex min-h-11 min-w-11 shrink-0 items-center justify-end",
        big ? "-my-1" : "-my-2 -mr-1",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap",
          big ? "h-8 pr-2.5 pl-3 text-[13px]" : "h-7 pr-2 pl-2.5 text-xs",
        )}
        style={toneStyle(tone)}
      >
        {chip}
        <ChevronDown className="size-3.5 shrink-0 opacity-80" strokeWidth={2.2} aria-hidden />
      </span>
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
  const isNoShowWarn = r.status === "BOOKED" && r.warning === "noshow"
  const isLateOrUnassigned = r.status === "BOOKED" && (r.warning === "late" || unassigned)
  const subColor = isNoShowWarn
    ? "var(--st-noshow-ink)"
    : isLateOrUnassigned
      ? "var(--st-late-ink)"
      : "var(--text-muted)"
  const open = () => m.openDetail(r.id, r.businessDate)
  return (
    <article
      className={cn(
        card,
        "relative flex flex-col gap-2 p-4 hover:border-border-strong",
        (r.status === "CANCELLED" || r.status === "NO_SHOW") && "opacity-70",
      )}
      style={isNoShowWarn ? { borderColor: "color-mix(in oklab, var(--st-noshow) 65%, var(--border))" } : undefined}
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={open}
          aria-label={`${fmtTime(r.expectedAt)} ${r.displayName}, ${r.partySize} khách, ${chip}. Mở chi tiết`}
          className="gm-press-card flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:ring-[3px] focus-visible:ring-primary/25"
        >
          <span
            className={cn(
              "tnum shrink-0 rounded-lg px-2 py-1 text-[13px] font-semibold",
              dim ? "bg-surface-2 text-subtle" : "bg-surface-2 text-tx-strong",
            )}
          >
            {fmtTime(r.expectedAt)}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]",
              dim ? "text-tx-2" : "text-tx-strong",
            )}
          >
            {r.displayName}
          </span>
        </button>
        <div className="relative z-10 shrink-0">
          <StatusChip r={r} onClick={() => m.openStatus(r)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-tx-2">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Users className="size-3.5 text-subtle" aria-hidden />
          {r.partySize} khách
        </span>
        <span className="text-border-strong" aria-hidden>
          ·
        </span>
        <span className={cn("font-medium", unassigned && "text-st-late-ink")}>{tableText(r.tableIds, m.model)}</span>
        <span className="text-border-strong" aria-hidden>
          ·
        </span>
        <span className="text-subtle">{SOURCE_LABEL[r.sourceCode]}</span>
        {r.phoneLast3 ? (
          <>
            <span className="text-border-strong" aria-hidden>
              ·
            </span>
            <span className="tnum text-subtle">•••{r.phoneLast3}</span>
          </>
        ) : null}
      </div>

      {sub ? (
        <div
          className={cn("text-[13px] font-medium", (isNoShowWarn || isLateOrUnassigned) && "rounded-lg px-2.5 py-1.5")}
          style={{
            color: subColor,
            ...(isNoShowWarn
              ? { background: "var(--st-noshow-tint)" }
              : isLateOrUnassigned
                ? { background: "var(--st-late-tint)" }
                : {}),
          }}
        >
          {sub}
        </div>
      ) : null}

      {r.note && r.status === "BOOKED" ? (
        <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface-2/80 px-3 py-2 text-[13px] text-tx-2">
          <StickyNote className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <span className="text-pretty">{r.note}</span>
        </div>
      ) : null}

      {actions && r.status === "BOOKED" ? (
        <div className="relative z-10 flex gap-2 pt-1">
          <Button
            type="button"
            variant={unassigned ? "outline" : "default"}
            disabled={a.pending}
            onClick={(e) => {
              e.stopPropagation()
              if (unassigned) a.assign(r)
              else void a.checkIn(r)
            }}
            className={cn(
              "h-11 flex-1 rounded-xl text-[14px] font-semibold",
              unassigned && "border-primary/60 text-primary-ink hover:bg-primary-tint",
            )}
          >
            {unassigned ? "Xếp bàn" : "Khách đã đến"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Thao tác khác"
            onClick={(e) => {
              e.stopPropagation()
              m.openStatus(r)
            }}
            className="size-11 shrink-0 rounded-xl border-border-strong"
          >
            <Ellipsis className="size-[18px]" />
          </Button>
        </div>
      ) : null}
    </article>
  )
}

export function CardSkeleton({ n = 3 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={cn(card, "flex flex-col gap-3 p-4")}>
          <div className="flex items-center gap-2.5">
            <div className="gam-skeleton h-7 w-16 rounded-lg bg-surface-2" />
            <div className="gam-skeleton h-5 flex-1 rounded-md bg-surface-2" />
            <div className="gam-skeleton h-7 w-20 rounded-full bg-surface-2" />
          </div>
          <div className="gam-skeleton h-4 w-3/4 rounded-md bg-surface-2" />
        </div>
      ))}
    </>
  )
}

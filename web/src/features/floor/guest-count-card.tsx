/**
 * "Đếm khách" card that floats on the top left of the plan, as the approved
 * mockup draws it: the six figures on the card itself, not hidden behind a
 * pill that has to be tapped first. Tapping the figures still opens the full
 * report.
 *
 * It can be folded away. Expanded it covers a corner of Khu C, and the
 * receptionist needs that corner when the plan is busy, so the chevron folds
 * it to a pill and the choice is remembered on the device.
 *
 * Size follows the mockup (124 x 112 at k = 1) but in real pixels, so the
 * figures stay readable when the plan scales down on a small phone.
 */

import { ChevronDown, Users } from "lucide-react"
import { useState, type ReactElement } from "react"
import type { ReservationView } from "@/domain/models"
import { cn } from "@/lib/utils"
import { buildGuestCount } from "./guest-count"

const STORAGE_KEY = "gam21.guest-count-open"

function loadOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0"
  } catch {
    return true
  }
}

function saveOpen(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0")
  } catch {
    // Private mode: the card just reopens next load.
  }
}

function Row({ label, value, divided }: { label: string; value: number; divided?: boolean }): ReactElement {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-1.5",
        divided && "mt-0.5 border-t border-border/70 pt-1",
      )}
    >
      <span className="truncate text-[9px] leading-tight text-tx-2">{label}</span>
      <span className="tnum shrink-0 text-[9px] leading-tight font-bold text-tx-strong">{value}</span>
    </div>
  )
}

export function GuestCountCard({
  reservations,
  onOpen,
  className,
}: {
  reservations: readonly ReservationView[] | undefined
  onOpen?: () => void
  className?: string
}): ReactElement {
  const [open, setOpen] = useState(loadOpen)
  const c = buildGuestCount(reservations)

  const toggle = () => {
    setOpen((v) => {
      saveOpen(!v)
      return !v
    })
  }

  const shell =
    "rounded-lg border border-border/80 bg-background/95 shadow-lg backdrop-blur dark:border-slate-700/80 dark:bg-[#1e232d]/95"

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-expanded={false}
        aria-label="Mở bảng đếm khách"
        data-testid="guest-count-card-collapsed"
        className={cn(shell, "inline-flex h-9 items-center gap-1.5 px-2.5 active:scale-95", className)}
      >
        <Users className="size-4 shrink-0" aria-hidden />
        <span className="text-[13px] font-semibold text-tx-strong">Đếm khách</span>
        <ChevronDown className="size-3.5 text-tx-2" aria-hidden />
      </button>
    )
  }

  return (
    <div
      data-testid="guest-count-card"
      className={cn(shell, "flex w-[124px] flex-col gap-0.5 px-[7px] py-1.5 text-left", className)}
    >
      <div className="flex items-center gap-1">
        <Users className="size-3 shrink-0" aria-hidden />
        <span className="flex-1 text-[10px] leading-tight font-bold text-tx-strong">Đếm khách</span>
        <button
          type="button"
          onClick={toggle}
          aria-expanded
          aria-label="Thu gọn bảng đếm khách"
          className="-mr-1 grid size-5 shrink-0 place-items-center rounded text-tx-2 active:scale-95"
        >
          <ChevronDown className="size-3.5 rotate-180" aria-hidden />
        </button>
      </div>
      <button
        type="button"
        onClick={onOpen}
        title="Đếm khách và xem báo cáo hiện có"
        aria-label={`Đếm khách. Trước ${c.splitLabel} ${c.arrivedBefore}, sau ${c.splitLabel} ${c.arrivedAfter}, tổng đã tới ${c.arrivedTotal}, tổng bàn đặt ${c.bookedTables}, tổng khách đặt ${c.bookedGuests}, khách quen ${c.returningGuests}. Mở báo cáo.`}
        className="flex flex-col gap-0.5 text-left active:scale-[0.98]"
      >
        <Row label={`Trước ${c.splitLabel}`} value={c.arrivedBefore} />
        <Row label={`Sau ${c.splitLabel}`} value={c.arrivedAfter} />
        <Row label="Tổng đã tới" value={c.arrivedTotal} divided />
        <Row label="Tổng bàn đặt" value={c.bookedTables} />
        <Row label="Tổng khách đặt" value={c.bookedGuests} />
        <Row label="Khách quen (O)" value={c.returningGuests} />
      </button>
    </div>
  )
}

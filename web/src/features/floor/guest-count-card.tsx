/**
 * "Đếm khách" card that floats on the top left of the plan, as the approved
 * mockup draws it: the six figures on the card itself, not hidden behind a
 * pill that has to be tapped first. Tapping it still opens the full report.
 *
 * Size follows the mockup (124 x 112 at k = 1) but in real pixels, so the
 * figures stay readable when the plan scales down on a small phone.
 */

import { Users } from "lucide-react"
import type { ReactElement } from "react"
import type { ReservationView } from "@/domain/models"
import { cn } from "@/lib/utils"
import { buildGuestCount } from "./guest-count"

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
  const c = buildGuestCount(reservations)

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Đếm khách và xem báo cáo hiện có"
      aria-label={`Đếm khách. Trước ${c.splitLabel} ${c.arrivedBefore}, sau ${c.splitLabel} ${c.arrivedAfter}, tổng đã tới ${c.arrivedTotal}, tổng bàn đặt ${c.bookedTables}, tổng khách đặt ${c.bookedGuests}, khách quen ${c.returningGuests}. Mở báo cáo.`}
      data-testid="guest-count-card"
      className={cn(
        "flex w-[124px] flex-col gap-0.5 rounded-lg border border-border/80 bg-background/95 px-[7px] py-1.5 text-left shadow-lg backdrop-blur active:scale-95 dark:border-slate-700/80 dark:bg-[#1e232d]/95",
        className,
      )}
    >
      <span className="flex items-center gap-1 text-[10px] leading-tight font-bold text-tx-strong">
        <Users className="size-3 shrink-0" aria-hidden />
        Đếm khách
      </span>
      <Row label={`Trước ${c.splitLabel}`} value={c.arrivedBefore} />
      <Row label={`Sau ${c.splitLabel}`} value={c.arrivedAfter} />
      <Row label="Tổng đã tới" value={c.arrivedTotal} divided />
      <Row label="Tổng bàn đặt" value={c.bookedTables} />
      <Row label="Tổng khách đặt" value={c.bookedGuests} />
      <Row label="Khách quen (O)" value={c.returningGuests} />
    </button>
  )
}

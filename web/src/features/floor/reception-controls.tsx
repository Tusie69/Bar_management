import { Search, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useBusinessDate } from "@/hooks/use-data"
import type { useReceptionSearch } from "@/hooks/use-reception-search"
import { fmtDayMonth, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useUi } from "@/state/ui"
import { DateField } from "./floor-toolbar"

export function ReceptionDatePicker({ onDateChange, className }: { onDateChange?: () => void; className?: string }) {
  const today = useBusinessDate()
  const ui = useUi()
  const date = ui.floorMode === "live" ? today : ui.availDate
  return (
    <span className={cn("inline-flex shrink-0 [&>button]:h-11 [&>button]:bg-surface-1 [&>button]:px-3", className)}>
      <DateField
        value={date}
        minDate={today}
        label={fmtDayMonth(date)}
        onChange={(next) => {
          onDateChange?.()
          ui.selectTable(null)
          ui.setAvailability({ date: next })
          ui.setFloorMode(next === today ? "live" : "availability")
        }}
      />
    </span>
  )
}

export function ReceptionControls({
  search,
  waitCount: _waitCount,
  onWaitlist: _onWaitlist,
  onCount,
  onOpenBooking,
  onDateChange,
}: {
  search: ReturnType<typeof useReceptionSearch>
  waitCount?: number
  onWaitlist?: () => void
  onCount: () => void
  onOpenBooking: (id: number, businessDate: BusinessDate) => void
  onDateChange?: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search.suffix}
            inputMode="numeric"
            pattern="[0-9]{3}"
            maxLength={3}
            autoComplete="off"
            aria-label="Tìm 3 số cuối SĐT"
            placeholder="3 số cuối SĐT"
            className="h-11 min-w-0 bg-surface-1 pl-9 text-sm"
            onChange={(event) => search.setSuffix(event.target.value.replace(/\D/g, "").slice(0, 3))}
          />
        </div>
        <ReceptionDatePicker onDateChange={onDateChange} />
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 bg-surface-1"
          onClick={onCount}
          aria-label="Đếm khách"
          title="Đếm khách và xem báo cáo hiện có"
        >
          <Users className="size-5" />
        </Button>
      </div>
      {search.suffix.length === 3 ? (
        <div className="flex flex-wrap gap-1.5 text-xs" aria-live="polite">
          {search.query.isFetching ? <span>Đang tìm…</span> : search.query.error ? <span role="alert">Không tải được kết quả. Thử lại sau.</span> : search.matches.length ? (
            search.matches.map((row) => (
              <button key={row.id} type="button" className="min-h-11 rounded-sm border bg-surface-1 px-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenBooking(row.id, row.businessDate)}>
                {row.displayName} · ***{row.phoneLast3} · {row.tableIds.length ? `${row.tableIds.length} bàn` : "Chưa có bàn"}
              </button>
            ))
          ) : <span>Không có khách khớp 3 số cuối trong ngày đã chọn.</span>}
        </div>
      ) : null}
    </div>
  )
}

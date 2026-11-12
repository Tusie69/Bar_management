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
    <span className={cn("inline-flex shrink-0 [&>button]:h-11 [&>button]:min-h-[44px] [&>button]:min-w-[44px] [&>button]:bg-surface-1 [&>button]:px-3", className)}>
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
  onCount,
  onOpenBooking,
  onDateChange,
}: {
  search: ReturnType<typeof useReceptionSearch>
  onCount: () => void
  onOpenBooking: (id: number, businessDate: BusinessDate) => void
  onDateChange?: () => void
}) {
  const { searching, result } = search
  const byName = search.mode === "name"
  const matchedWaitlist = result?.summary.waitlistCount ?? 0
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:gap-2">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            className="absolute inset-y-0 left-0 grid w-11 min-h-[44px] min-w-[44px] place-items-center rounded-sm text-muted-foreground focus-visible:ring-2"
            aria-label={byName ? "Chuyển sang tìm theo SĐT" : "Chuyển sang tìm theo tên"}
            title={byName ? "Tìm theo 3 số cuối" : "Tìm theo tên khách"}
            onClick={search.toggleMode}
          >
            <Search className="size-4" aria-hidden />
          </button>
          <Input
            value={search.value}
            inputMode={byName ? "text" : "numeric"}
            pattern={byName ? undefined : "[0-9]{3}"}
            maxLength={byName ? 120 : 3}
            autoComplete="off"
            aria-label={byName ? "Tìm theo tên khách" : "Tìm 3 số cuối SĐT"}
            placeholder={byName ? "Tên khách" : "3 số cuối SĐT"}
            className="h-11 min-h-[44px] min-w-0 bg-surface-1 pl-11 text-sm"
            onChange={(event) => search.setValue(byName ? event.target.value : event.target.value.replace(/\D/g, "").slice(0, 3))}
          />
        </div>
        <ReceptionDatePicker onDateChange={onDateChange} />
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 bg-surface-1"
          onClick={onCount}
          aria-label="Đếm khách"
          title="Đếm khách và xem báo cáo hiện có"
        >
          <Users className="size-5" />
        </Button>
      </div>
      {search.active ? (
        <div className="flex flex-wrap gap-1.5 text-xs" aria-live="polite">
          {searching ? (
            <span>Đang tìm…</span>
          ) : search.error ? (
            <span role="alert">Không tải được kết quả. Thử lại sau.</span>
          ) : result?.summary.totalCount ? (
            <span data-testid="reception-search-summary">
              {result.summary.totalCount} khách khớp · {search.tableIds.length} bàn được đánh dấu
              {matchedWaitlist ? <span data-testid="waitlist-search-badge"> · {matchedWaitlist} khớp trong Bàn chờ</span> : null}
            </span>
          ) : (
            <span>Không có khách khớp trong ngày đã chọn.</span>
          )}
        </div>
      ) : null}
      {search.active && !searching && result?.bookings.length ? (
        <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
          {result.bookings.map((row) => (
            <button
              key={row.id}
              type="button"
              className="min-h-11 min-h-[44px] shrink-0 rounded-sm border bg-surface-1 px-3 text-left text-xs"
              onClick={() => onOpenBooking(row.id, result.businessDate)}
            >
              {row.displayName} · ***{row.phoneLast3} · {row.tableIds.length ? `${row.tableIds.length} bàn` : "Chưa có bàn"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

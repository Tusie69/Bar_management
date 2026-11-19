import { vi } from "date-fns/locale"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  ListTodo,
  Map as MapIcon,
  Plus,
  type LucideIcon,
} from "lucide-react"
import { useState } from "react"
import { GuardedButton } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useNow } from "@/hooks/use-data"
import {
  addDays,
  businessDateOf,
  businessSlots,
  fmtBusinessDate,
  fromLocalDate,
  toLocalDate,
  type BusinessDate,
} from "@/lib/time"
import { cn } from "@/lib/utils"
import { useUi, type FloorView } from "@/state/ui"

export function DateField({
  value,
  onChange,
  minDate,
  label,
  compactCalendar = false,
}: {
  value: BusinessDate
  onChange: (bd: BusinessDate) => void
  minDate: BusinessDate
  label?: string
  compactCalendar?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-11 min-h-[44px] justify-start gap-2 font-normal"
          aria-label="Chọn ngày kinh doanh"
        >
          <CalendarDays className="text-muted-foreground" />
          {label ?? fmtBusinessDate(value, "short")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          className={cn(
            compactCalendar &&
              "py-2 [&_.rdp-month]:gap-2 [&_.rdp-week]:mt-1 [&_button[data-day]]:aspect-auto [&_button[data-day]]:h-6",
          )}
          mode="single"
          locale={vi}
          selected={toLocalDate(value)}
          disabled={{ before: toLocalDate(minDate) }}
          onSelect={(d) => {
            if (d) {
              onChange(fromLocalDate(d))
              setOpen(false)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function TimeField({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (t: string) => void
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-11 min-h-[44px] w-[104px]", className)} aria-label="Giờ khách muốn đến">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {businessSlots().map((s) => (
          <SelectItem key={s} value={s} className="tnum">
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const VIEWS: { id: FloorView; label: string; icon: LucideIcon }[] = [
  { id: "list", label: "Danh sách", icon: List },
  { id: "timeline", label: "Thời gian", icon: Clock },
  { id: "map", label: "Sơ đồ", icon: MapIcon },
]

const Sep = () => <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

/** ‹ day › — today is Live; any other day previews availability at that date. */
function DayNav({ today }: { today: BusinessDate }) {
  const ui = useUi()
  const [open, setOpen] = useState(false)
  const date = ui.floorMode === "live" ? today : ui.availDate
  const go = (d: BusinessDate) => {
    if (d <= today) return ui.setFloorMode("live")
    ui.setAvailability({ date: d })
    if (ui.floorMode === "live") ui.setFloorMode("availability")
  }
  const [weekday, dayMonth] = fmtBusinessDate(date).split(", ")
  return (
    <div className="mx-auto flex items-center gap-1.5">
      <Button
        variant="outline"
        size="icon"
        className="h-11 min-h-[44px] w-11 min-w-[44px] rounded-lg bg-surface-1 shadow-xs"
        disabled={date <= today}
        onClick={() => go(addDays(date, -1))}
        aria-label="Ngày trước"
      >
        <ChevronLeft />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-11 min-h-[44px] min-w-[200px] items-center justify-center gap-2 rounded-lg border border-border bg-surface-1 px-3.5 text-sm shadow-xs transition-[background-color,border-color,transform] duration-150 hover:bg-surface-2 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none active:scale-[0.99]"
            aria-label="Chọn ngày trên lịch"
          >
            <CalendarDays className="size-4 text-muted-foreground" />
            <span className="whitespace-nowrap text-tx-2">{weekday}</span>
            <span className="tnum font-semibold whitespace-nowrap text-foreground">
              {dayMonth}/{date.slice(0, 4)}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto rounded-xl p-0 shadow-float" align="center">
          <Calendar
            mode="single"
            locale={vi}
            selected={toLocalDate(date)}
            disabled={{ before: toLocalDate(today) }}
            onSelect={(d) => {
              if (d) {
                go(fromLocalDate(d))
                setOpen(false)
              }
            }}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="outline"
        size="icon"
        className="h-11 min-h-[44px] w-11 min-w-[44px] rounded-lg bg-surface-1 shadow-xs"
        onClick={() => go(addDays(date, 1))}
        aria-label="Ngày sau"
      >
        <ChevronRight />
      </Button>
      {date !== today ? (
        <Button
          variant="outline"
          className="h-11 min-h-[44px] min-w-[44px] rounded-lg bg-surface-1"
          onClick={() => go(today)}
        >
          Hôm nay
        </Button>
      ) : null}
    </div>
  )
}

export function FloorToolbar({ onOpenList }: { onOpenList?: () => void }) {
  const ui = useUi()
  const now = useNow(15_000)
  const today = businessDateOf(now)
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 overflow-x-auto border-b border-border-subtle bg-background px-3 sm:px-4">
      <div
        role="tablist"
        aria-label="Chế độ xem"
        className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-2 p-0.5"
      >
        {VIEWS.map((v) => {
          const on = ui.view === v.id
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={v.label}
              onClick={() => ui.setView(v.id)}
              className={cn(
                "flex h-11 min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-md px-3 text-sm whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25 active:scale-[0.98] sm:px-3.5",
                on
                  ? "bg-surface-1 font-semibold text-foreground shadow-xs"
                  : "font-medium text-tx-2 hover:text-foreground",
              )}
            >
              <v.icon className="size-4" />
              <span className="hidden xl:inline">{v.label}</span>
            </button>
          )
        })}
      </div>
      <Sep />
      <DayNav today={today} />
      <Sep />
      <div role="group" aria-label="Tạo mới" className="flex shrink-0 items-center gap-2">
        {onOpenList ? (
          <Button
            variant="outline"
            size="icon"
            onClick={onOpenList}
            aria-label="Danh sách booking"
            className="h-11 min-h-[44px] w-11 min-w-[44px] rounded-lg bg-surface-1 shadow-xs"
          >
            <ListTodo />
          </Button>
        ) : null}
        {ui.floorMode === "live" ? (
          <GuardedButton
            permission="visit.walkin"
            variant="outline"
            className="h-11 min-h-[44px] rounded-lg bg-surface-1 px-4 shadow-xs"
            onClick={() => ui.openWalkIn()}
          >
            Walk-in
          </GuardedButton>
        ) : null}
        <GuardedButton
          permission="reservation.create"
          className="h-11 min-h-[44px] rounded-lg px-4 font-semibold shadow-xs dark:bg-[color-mix(in_oklab,var(--primary)_88%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--primary)_78%,var(--background))] dark:active:bg-[color-mix(in_oklab,var(--primary)_70%,var(--background))]"
          onClick={() =>
            ui.openBooking(
              !(ui.bookingOpen || ui.walkInOpen) && ui.floorMode === "availability"
                ? { date: ui.availDate, time: ui.availTime, party: ui.availParty }
                : {},
            )
          }
        >
          <Plus /> Tạo đặt bàn
        </GuardedButton>
      </div>
    </div>
  )
}

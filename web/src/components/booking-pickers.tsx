/**
 * Shared booking pickers for every booking form (Điều phối inline form, Đặt bàn sheet, mobile).
 * Rules live in domain/booking-rules.ts:
 * - GuestPicker: 1–10 in one tap, "Khác" for whole numbers above 10. 4 columns on phones, 6 from `sm`.
 * - BookingTimePicker: 13 slots 19:00 → 01:00 next morning, every 30', in one horizontal, touch-friendly row.
 */
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { GUEST_QUICK, bookingSlots, isBookingSlot, parseOtherGuests } from "@/domain/booking-rules"
import { addDays, fmtDayMonth, venueDateString, type BusinessDate } from "@/lib/time"
import { cn } from "@/lib/utils"

const chip = (on: boolean) =>
  cn(
    "tnum h-11 min-w-0 rounded-sm border px-1 text-sm whitespace-nowrap",
    on
      ? "border-primary bg-primary-tint font-semibold text-primary-ink"
      : "border-strong bg-background font-medium hover:border-foreground",
    "disabled:cursor-not-allowed disabled:border-dashed disabled:border-border disabled:bg-transparent disabled:font-normal disabled:text-tx-3",
  )

export interface GuestValue {
  mode: "quick" | "other"
  /** Last valid count (quick pick or a valid "Khác"). */
  party: number
  /** Raw "Khác" text, kept when switching back to 1–10. */
  otherText: string
}

export const guestValueFrom = (party: number): GuestValue =>
  party > 10 ? { mode: "other", party, otherText: String(party) } : { mode: "quick", party, otherText: "" }

/** Effective guest count, or null while "Khác" is invalid. */
export function guestCount(v: GuestValue): number | null {
  if (v.mode === "quick") return v.party
  const p = parseOtherGuests(v.otherText)
  return p.ok ? p.value : null
}

export const guestError = (v: GuestValue): string | null =>
  v.mode === "other" ? parseOtherGuests(v.otherText).error : null

export function GuestPicker({
  value,
  onChange,
  showErrors = false,
}: {
  value: GuestValue
  onChange: (v: GuestValue) => void
  /** Show "Khác" errors even when the field is empty (after a submit attempt). */
  showErrors?: boolean
}) {
  const id = useId()
  const parsed = value.mode === "other" ? parseOtherGuests(value.otherText) : null
  const error = parsed && !parsed.ok && (showErrors || value.otherText.trim()) ? parsed.error : null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="text-xs text-tx-2">
          Số khách
        </span>
        <span className="text-xs text-tx-3">Trên 10 khách, chọn Khác</span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-1.5"
      >
        {GUEST_QUICK.map((n) => {
          const on = value.mode === "quick" && value.party === n
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${n} khách`}
              className={chip(on)}
              onClick={() => onChange({ ...value, mode: "quick", party: n })}
            >
              {n}
            </button>
          )
        })}
        <button
          type="button"
          role="radio"
          aria-checked={value.mode === "other"}
          aria-label={parsed?.ok ? `Khác, ${parsed.value} khách` : "Khác, trên 10 khách"}
          className={cn(chip(value.mode === "other"), "col-span-2")}
          onClick={() => onChange({ ...value, mode: "other" })}
        >
          {parsed?.ok ? `Khác: ${parsed.value}` : "Khác"}
        </button>
      </div>
      {value.mode === "other" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-other`} className="text-xs text-tx-2">
            Số khách, từ 11 trở lên
          </label>
          <div className="relative">
            {/* text + inputMode: iOS number pad without type=number quirks. 16px stops iOS focus zoom. */}
            <input
              id={`${id}-other`}
              autoFocus
              className="tnum h-11 w-full rounded-sm border border-strong bg-background pr-16 pl-3 text-base outline-none placeholder:text-tx-3 focus:border-foreground aria-[invalid=true]:border-st-noshow"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              autoComplete="off"
              placeholder="Ví dụ: 12"
              value={value.otherText}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-err` : undefined}
              onChange={(e) => {
                const p = parseOtherGuests(e.target.value)
                onChange({ mode: "other", otherText: e.target.value, party: p.ok ? p.value : value.party })
              }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-tx-2"
            >
              khách
            </span>
          </div>
          {error ? (
            <span id={`${id}-err`} role="alert" className="text-xs text-st-noshow-ink">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function BookingTimePicker({
  date,
  value,
  now,
  onChange,
  error,
  legacyValue,
}: {
  date: BusinessDate
  value: string
  now: Date
  onChange: (time: string) => void
  /** From validateBookingTime; shown under the picker. */
  error?: string | null
  /** Existing out-of-window value: display it explicitly and preserve it until staff selects a valid slot. */
  legacyValue?: string | null
}) {
  const id = useId()
  const slots = bookingSlots(date, now)
  const past = slots.filter((slot) => slot.disabled)
  const allPast = past.length === slots.length
  const selected = slots.find((slot) => slot.time === value)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef(new Map<string, HTMLButtonElement>())
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false })

  const updateScrollEdges = useCallback(() => {
    const node = scrollerRef.current
    if (!node) return
    setScrollEdges({
      left: node.scrollLeft > 2,
      right: node.scrollLeft + node.clientWidth < node.scrollWidth - 2,
    })
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    const button = slotRefs.current.get(value)
    if (scroller && button) {
      const left = button.offsetLeft - (scroller.clientWidth - button.offsetWidth) / 2
      scroller.scrollTo({ left: Math.max(0, left), behavior: "auto" })
    }
    const frame = requestAnimationFrame(updateScrollEdges)
    window.addEventListener("resize", updateScrollEdges)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", updateScrollEdges)
    }
  }, [date, updateScrollEdges, value])

  const selectWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, time: string) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const enabled = slots.filter((slot) => !slot.disabled)
    if (!enabled.length) return
    const current = Math.max(0, enabled.findIndex((slot) => slot.time === time))
    const next = event.key === "Home"
      ? enabled[0]
      : event.key === "End"
        ? enabled[enabled.length - 1]
        : enabled[Math.min(enabled.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)))]
    onChange(next.time)
    requestAnimationFrame(() => slotRefs.current.get(next.time)?.focus())
  }

  const today = venueDateString(now)
  const selectedDayLabel = selected?.calendarDate === today
    ? "Hôm nay"
    : selected?.calendarDate === addDays(today, 1)
      ? "Hôm sau"
      : null
  return (
    <div className="min-w-0 flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="text-xs text-tx-2">
          Giờ khách dự kiến đến
        </span>
        <span className="tnum text-xs text-tx-3">19:00–01:00</span>
      </div>
      {legacyValue ? (
        <p className="rounded-sm border border-st-late/40 bg-st-late-tint px-3 py-2 text-xs text-st-late-ink">
          Giờ hiện tại {legacyValue} không nằm trong các mốc chọn hiện tại. Giờ này được giữ nguyên nếu chỉ sửa thông
          tin khác; chọn một giờ bên dưới nếu muốn đổi lịch.
        </p>
      ) : null}
      <p className="tnum text-xs text-tx-3">{fmtDayMonth(date)} · Vuốt ngang hoặc dùng phím mũi tên để chọn giờ</p>
      <div className="relative min-w-0">
        {scrollEdges.left ? (
          <span className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-8 items-center bg-gradient-to-r from-background to-transparent text-tx-2" aria-hidden>
            <ChevronLeft className="size-4" />
          </span>
        ) : null}
        <div
          ref={scrollerRef}
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          className="flex min-w-0 snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-2 touch-pan-x scroll-smooth"
          onScroll={updateScrollEdges}
        >
          {slots.map((slot) => {
            const on = isBookingSlot(value) && value === slot.time
            return (
              <button
                key={slot.time}
                ref={(node) => {
                  if (node) slotRefs.current.set(slot.time, node)
                  else slotRefs.current.delete(slot.time)
                }}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={slot.disabled}
                tabIndex={on || (!isBookingSlot(value) && !slot.disabled && slots.find((item) => !item.disabled)?.time === slot.time) ? 0 : -1}
                aria-label={`${slot.label}${slot.nextDay ? `, hôm sau ${fmtDayMonth(slot.calendarDate)}` : ""}${slot.disabled ? ", đã qua" : ""}`}
                className={cn(chip(on), "h-14 min-w-[76px] shrink-0 snap-center px-3")}
                onClick={() => onChange(slot.time)}
                onKeyDown={(event) => selectWithKeyboard(event, slot.time)}
              >
                <span className="block">{slot.label}</span>
                {slot.nextDay ? <span className="mt-0.5 block text-[10px] font-normal">Hôm sau</span> : null}
              </button>
            )
          })}
        </div>
        {scrollEdges.right ? (
          <span className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-8 items-center justify-end bg-gradient-to-l from-background to-transparent text-tx-2" aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        ) : null}
      </div>
      {selected ? (
        <p className="tnum text-sm font-medium" aria-live="polite">
          Đã chọn: {selected.label} — {fmtDayMonth(selected.calendarDate)}{selectedDayLabel ? ` (${selectedDayLabel})` : ""}
        </p>
      ) : null}
      {allPast ? (
        <span className="text-xs text-tx-2">Ca này đã hết giờ nhận đặt. Chọn ngày khác.</span>
      ) : past.length ? (
        <span className="tnum text-xs text-tx-3">{`Đã qua ${past[0].label} đến ${past[past.length - 1].label}.`}</span>
      ) : null}
      {error && value ? (
        <span role="alert" className="text-xs text-st-noshow-ink">
          {error}
        </span>
      ) : null}
    </div>
  )
}

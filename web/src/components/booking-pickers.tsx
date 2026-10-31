/**
 * Shared booking pickers for every booking form (Điều phối inline form, Đặt bàn sheet, mobile).
 * Rules live in domain/booking-rules.ts:
 * - GuestPicker: 1–10 in one tap, "Khác" for whole numbers above 10. 4 columns on phones, 6 from `sm`.
 * - BookingTimePicker: 13 slots 19:00 → 01:00 next morning, every 30', past slots disabled, never scrolls sideways.
 */
import { useId } from "react"
import { GUEST_QUICK, bookingSlotGroups, isBookingSlot, parseOtherGuests } from "@/domain/booking-rules"
import { fmtDayMonth, type BusinessDate } from "@/lib/time"
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
  gridClassName,
  legacyValue,
}: {
  date: BusinessDate
  value: string
  now: Date
  onChange: (time: string) => void
  /** From validateBookingTime; shown under the grid. */
  error?: string | null
  gridClassName?: string
  /** Existing out-of-window value: display it explicitly and preserve it until staff selects a valid slot. */
  legacyValue?: string | null
}) {
  const id = useId()
  const groups = bookingSlotGroups(date, now)
  const past = groups[0].slots.filter((s) => s.disabled)
  const allPast = groups.every((g) => g.slots.every((s) => s.disabled))
  const valid = isBookingSlot(value) && !error
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="text-xs text-tx-2">
          Giờ đến
        </span>
        <span className="text-xs text-tx-3">19:00 đến 01:00 · mốc 30 phút hiện có</span>
      </div>
      {legacyValue ? (
        <p className="rounded-sm border border-st-late/40 bg-st-late-tint px-3 py-2 text-xs text-st-late-ink">
          Giờ hiện tại {legacyValue} không nằm trong các mốc chọn hiện tại. Giờ này được giữ nguyên nếu chỉ sửa thông
          tin khác; chọn một giờ bên dưới nếu muốn đổi lịch.
        </p>
      ) : null}
      {groups.map((g) => (
        <div key={g.key} role="radiogroup" aria-label={g.title} className="flex flex-col gap-1.5">
          <span className="tnum text-xs text-tx-3">{g.title}</span>
          <div className={cn("grid grid-cols-4 gap-2 sm:gap-1.5", gridClassName)}>
            {g.slots.map((s) => {
              const on = valid && value === s.time
              return (
                <button
                  key={s.time}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={s.disabled}
                  aria-label={`${s.label} (${s.time})${s.nextDay ? `, sáng ${fmtDayMonth(s.calendarDate)}` : ""}${s.disabled ? ", đã qua" : ""}`}
                  className={chip(on)}
                  onClick={() => onChange(s.time)}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {allPast ? (
        <span className="text-xs text-tx-2">Ca này đã hết giờ nhận đặt. Chọn ngày khác.</span>
      ) : past.length ? (
        <span className="tnum text-xs text-tx-3">{`Hôm nay đã qua ${past[0].label} đến ${past[past.length - 1].label}.`}</span>
      ) : null}
      {error && value ? (
        <span role="alert" className="text-xs text-st-noshow-ink">
          {error}
        </span>
      ) : null}
    </div>
  )
}

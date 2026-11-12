/**
 * Shared booking pickers for every booking form (Điều phối inline form, Đặt bàn sheet, mobile).
 * Rules live in domain/booking-rules.ts:
 * - GuestPicker: 1–6 in one tap, "số khác..." input for whole numbers above 6. 6 columns.
 * - BookingTimePicker: venue quick times + hour/minute wheels (19:00 → 01:00, 5-minute step). R6, NA-13, TU-16.
 */
import { ChevronDown, Clock } from "lucide-react"
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { SOURCE_LABEL, type BookingSourceCode } from "@/domain/enums"
import {
  BOOKING_HOURS,
  BOOKING_MINUTES,
  GUEST_QUICK,
  bookingCalendarDate,
  bookingInstant,
  isAfterMidnight,
  isBookingTime,
  parseOtherGuests,
  type GuestValue,
  usableQuickTimes,
} from "@/domain/booking-rules"
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

export function GuestPicker({
  value,
  onChange,
  showErrors = false,
}: {
  value: GuestValue
  onChange: (v: GuestValue) => void
  /** Show "Số khác" errors even when the field is empty (after a submit attempt). */
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
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="grid grid-cols-6 gap-1.5">
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
              onClick={() => onChange({ mode: "quick", party: n, otherText: "" })}
            >
              {n}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          id={`${id}-other`}
          className="tnum h-11 w-full rounded-sm border border-strong bg-background px-3 text-base outline-none placeholder:text-tx-3 focus:border-foreground aria-[invalid=true]:border-st-noshow"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          autoComplete="off"
          placeholder="số khác..."
          value={value.mode === "other" ? value.otherText : ""}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            const text = e.target.value
            const p = parseOtherGuests(text)
            onChange({
              mode: "other",
              otherText: text,
              party: p.ok ? p.value : value.party,
            })
          }}
        />
        {error ? (
          <span id={`${id}-err`} role="alert" className="text-xs text-st-noshow-ink">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  )
}


const WHEEL_ITEM = 44

/**
 * One wheel column on native scroll-snap. The column is the spinbutton (keyboard and screen readers);
 * the numbers are only touch targets. Scrolling picks a value only after the user touched the wheel,
 * so opening it never changes a saved time.
 */
function Wheel({
  label,
  items,
  value,
  onPick,
  isDisabled,
}: {
  label: string
  items: readonly string[]
  value: string
  onPick: (item: string) => void
  isDisabled: (item: string) => boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const touched = useRef(false)
  const settle = useRef<number | undefined>(undefined)
  const index = items.indexOf(value)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && index >= 0 && Math.round(el.scrollTop / WHEEL_ITEM) !== index) el.scrollTop = index * WHEEL_ITEM
  }, [index])
  useEffect(() => () => window.clearTimeout(settle.current), [])

  const onScroll = () => {
    if (!touched.current) return
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const next = items[Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM)))]
      if (isDisabled(next)) {
        if (index >= 0) el.scrollTo({ top: index * WHEEL_ITEM })
      } else {
        touched.current = false
        if (next !== value) onPick(next)
      }
    }, 90)
  }
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const enabled = items.filter((item) => !isDisabled(item))
    const at = enabled.indexOf(value)
    const next =
      event.key === "ArrowDown"
        ? enabled[at + 1]
        : event.key === "ArrowUp"
          ? enabled[at - 1]
          : event.key === "Home"
            ? enabled[0]
            : enabled[enabled.length - 1]
    if (next && next !== value) onPick(next)
  }

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-sm border border-strong bg-background">
      <span className="block pt-1.5 text-center text-xs text-tx-2">{label}</span>
      <div className="relative h-[132px]">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-11 h-11 bg-primary-tint" />
        <div
          ref={ref}
          role="spinbutton"
          tabIndex={0}
          aria-label={label}
          aria-valuenow={Number(value) || 0}
          aria-valuetext={value}
          data-wheel={label}
          onKeyDown={step}
          onScroll={onScroll}
          onPointerDown={() => (touched.current = true)}
          onWheel={() => (touched.current = true)}
          onTouchStart={() => (touched.current = true)}
          className="relative no-scrollbar h-full snap-y snap-mandatory overflow-y-auto overscroll-contain py-11 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {items.map((item) => {
            const on = item === value
            const off = isDisabled(item)
            return (
              <button
                key={item}
                type="button"
                tabIndex={-1}
                aria-hidden
                data-value={item}
                disabled={off}
                onClick={() => {
                  if (!off && item !== value) onPick(item)
                }}
                className={cn(
                  "tnum block h-11 w-full snap-center text-center text-xl",
                  on ? "font-semibold text-tx-strong" : "text-tx-2",
                  off && "text-tx-3 line-through decoration-1",
                )}
              >
                {item}
              </button>
            )
          })}
        </div>
      </div>
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
  quickTimes = [],
  compact = false,
}: {
  date: BusinessDate
  value: string
  now: Date
  onChange: (time: string) => void
  /** From validateBookingTime; shown under the picker. */
  error?: string | null
  /** catalog.venue.settings.quick_times. Without settings no quick button is shown. */
  quickTimes?: readonly string[]
  /** Existing out-of-window value: display it explicitly and preserve it until staff selects a valid time. */
  legacyValue?: string | null
  /** Phone sheet: put the quick times and the wheel toggle on one row. */
  compact?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const quick = usableQuickTimes(quickTimes)
  const [hour = "", minute = ""] = value.split(":")
  const isPast = (hhmm: string) => bookingInstant(date, hhmm).getTime() < now.getTime()
  const pick = (h: string, m: string) => onChange(`${h}:${h === "01" || !BOOKING_MINUTES.includes(m) ? "00" : m}`)
  const valid = isBookingTime(value)

  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="text-xs text-tx-2">
          Giờ khách dự kiến đến
        </span>
        <span className="tnum text-xs text-tx-2">
          {compact ? "19:00 - 01:00" : "19:00 đến 01:00 · phút cách 5"}
        </span>
      </div>
      {legacyValue ? (
        <p className="rounded-sm border border-st-late/40 bg-st-late-tint px-3 py-2 text-xs text-st-late-ink">
          Giờ hiện tại {legacyValue} nằm ngoài khung chọn. Giờ này được giữ nguyên nếu chỉ sửa thông tin khác; chọn giờ
          bên dưới nếu muốn đổi lịch.
        </p>
      ) : null}
      {quick.length ? (
        <div
          role="group"
          aria-label="Giờ nhanh"
          className={cn("grid gap-1.5", compact && quick.length <= 4 ? "grid-cols-5" : "grid-cols-4")}
        >
          {quick.map((time) => (
            <button
              key={time}
              type="button"
              aria-pressed={value === time}
              disabled={isPast(time)}
              className={chip(value === time)}
              onClick={() => onChange(time)}
            >
              {time}
            </button>
          ))}
          {compact && quick.length <= 4 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`Chọn giờ bằng con lăn, đang chọn ${value || "chưa có"}`}
              onClick={() => setOpen((v) => !v)}
              className="flex h-11 items-center justify-center gap-1 rounded-sm border border-strong bg-background text-sm font-medium"
            >
              <Clock className="size-4 text-tx-2" aria-hidden />
              <ChevronDown className={cn("size-3.5 text-tx-2 transition-transform", open && "rotate-180")} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
      {compact && quick.length <= 4 ? null : (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Chọn giờ bằng con lăn, đang chọn ${value || "chưa có"}`}
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 items-center justify-between px-3 rounded-sm border border-strong bg-background text-sm font-medium"
        >
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-tx-2" aria-hidden />
            <span className="tnum text-base font-semibold">{value || "--:--"}</span>
            <span className="text-tx-2">Chọn bằng con lăn</span>
          </div>
          <ChevronDown className={cn("size-4 text-tx-2 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      )}
      {open ? (
        <div className="flex gap-2">
          <Wheel
            label="Giờ"
            items={BOOKING_HOURS}
            value={hour}
            onPick={(h) => pick(h, minute || "00")}
            isDisabled={(h) => isPast(h === "01" ? "01:00" : `${h}:${BOOKING_MINUTES[BOOKING_MINUTES.length - 1]}`)}
          />
          <Wheel
            label="Phút"
            items={BOOKING_MINUTES}
            value={minute}
            onPick={(m) => pick(hour || "19", m)}
            isDisabled={(m) => (hour === "01" && m !== "00") || (!!hour && isPast(`${hour}:${m}`))}
          />
        </div>
      ) : null}
      {valid && !error ? (
        <p className="tnum text-xs text-pretty text-tx-2" aria-live="polite">
          {isAfterMidnight(value)
            ? `${value} là sáng ${fmtDayMonth(bookingCalendarDate(date, value))}, vẫn thuộc ngày kinh doanh ${fmtDayMonth(date)}.`
            : `${value} tối ${fmtDayMonth(date)}.`}
        </p>
      ) : null}
      {error && value ? (
        <span role="alert" className="text-xs text-st-noshow-ink">
          {error}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The HTTP backend now stores reservations.social_platform (migration 0016) and
 * returns it in the booking payload, so the select is shown and required in both
 * modes. The server clears the platform whenever the source is not SOCIAL.
 */
export const socialPlatformSupported = true

export type SocialPlatform = "FB" | "IG" | "TIKTOK" | "THREADS" | "GG_REVIEW"

export const SOCIAL_PLATFORMS: ReadonlyArray<{ value: SocialPlatform; label: string }> = [
  { value: "FB", label: "FB" },
  { value: "IG", label: "IG" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "THREADS", label: "Threads" },
  { value: "GG_REVIEW", label: "GG review" },
]

export const MAIN_SOURCE_BUTTONS: ReadonlyArray<{
  code: BookingSourceCode | null
  label: string
  disabled?: boolean
  disabledReason?: string
}> = [
  { code: null, label: "WK", disabled: true, disabledReason: "Chưa có mã nguồn WK từ API" },
  { code: "HOTLINE", label: "Hotline" },
  { code: "SOCIAL", label: "Social" },
  { code: "SHAREHOLDER", label: "Cổ đông" },
  { code: "STAFF", label: "Nhân sự" },
]

export function handleSourceChange(
  newSource: BookingSourceCode,
  currentSource: BookingSourceCode,
  onSourceChange: (s: BookingSourceCode) => void,
  onPlatformChange: (p: SocialPlatform | "") => void,
) {
  if (newSource === currentSource) return
  onSourceChange(newSource)
  onPlatformChange("")
}

export function validateSocialPlatform(
  source: BookingSourceCode,
  platform?: string | null,
  supported = socialPlatformSupported,
): string | null {
  if (supported && source === "SOCIAL" && !platform) {
    return "Vui lòng chọn nền tảng mạng xã hội."
  }
  return null
}

export interface SourcePickerProps {
  source: BookingSourceCode
  onSourceChange: (source: BookingSourceCode) => void
  platform?: SocialPlatform | string | null
  onPlatformChange: (platform: SocialPlatform | "") => void
  error?: string | null
  supported?: boolean
  id?: string
  className?: string
}

export function SourcePicker({
  source,
  onSourceChange,
  platform,
  onPlatformChange,
  error,
  supported = socialPlatformSupported,
  id: explicitId,
  className,
}: SourcePickerProps) {
  const generatedId = useId()
  const id = explicitId ?? generatedId

  const isMainSource = MAIN_SOURCE_BUTTONS.some((b) => b.code === source)
  const showSelect = supported && source === "SOCIAL"

  const handleSourceClick = (code: BookingSourceCode) => {
    handleSourceChange(code, source, onSourceChange, onPlatformChange)
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div role="radiogroup" aria-label="Nguồn" className="flex flex-wrap gap-1.5">
        {MAIN_SOURCE_BUTTONS.map((btn) => {
          if (!btn.code) {
            return (
              <button
                key="WK"
                type="button"
                disabled
                title={btn.disabledReason}
                className={cn(chip(false), "cursor-not-allowed border-dashed opacity-60")}
                aria-label="WK (chưa hỗ trợ)"
              >
                {btn.label}
              </button>
            )
          }
          const on = source === btn.code
          return (
            <button
              key={btn.code}
              type="button"
              role="radio"
              aria-checked={on}
              className={chip(on)}
              onClick={() => handleSourceClick(btn.code!)}
            >
              {btn.label}
            </button>
          )
        })}

        {/* Old bookings with FANPAGE, ZALO or OTHER keep their value: show as an extra selected chip */}
        {!isMainSource && source ? (
          <button
            key={source}
            type="button"
            role="radio"
            aria-checked={true}
            className={chip(true)}
            onClick={() => {}}
          >
            {SOURCE_LABEL[source] ?? source}
          </button>
        ) : null}
      </div>

      {showSelect ? (
        <div className="flex flex-col gap-1.5 pt-0.5">
          <select
            id={`${id}-platform`}
            aria-label="Chọn nền tảng"
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-platform-error` : undefined}
            value={platform || ""}
            onChange={(e) => onPlatformChange((e.target.value || "") as SocialPlatform | "")}
            className={cn(
              "h-10 w-full rounded-sm border border-strong bg-background px-3 text-sm font-medium outline-none",
              "focus:border-foreground aria-[invalid=true]:border-st-noshow",
              !platform && "text-tx-3",
            )}
          >
            <option value="" disabled>
              Chọn nền tảng
            </option>
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value} className="text-foreground">
                {p.label}
              </option>
            ))}
          </select>
          {error ? (
            <span id={`${id}-platform-error`} role="alert" className="text-xs text-st-noshow-ink">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The HTTP backend now stores star as reservations.is_boss_table and pin as
 * reservations.is_designated (migration 0016), and returns both as iconKeys, so
 * the chips are live in both modes. Sinh nhật still saves through isBirthday.
 */
export const iconKeysSupported = true

/**
 * The HTTP backend now stores reservations.honorific (migration 0016) and returns
 * it in the booking payload and in the floor claim, so Mr/Ms is live in both modes.
 */
export const honorificSupported = true

export type Honorific = "MR" | "MS"

export interface HonorificPickerProps {
  value: Honorific | null | undefined
  onChange: (value: Honorific | null) => void
  disabled?: boolean
  supported?: boolean
  className?: string
  size?: "default" | "lg"
}

export function HonorificPicker({
  value,
  onChange,
  disabled = false,
  supported = honorificSupported,
  className,
  size = "default",
}: HonorificPickerProps) {
  const isMr = value === "MR"
  const isMs = value === "MS"
  const isDisabled = disabled || !supported

  const handleSelect = (choice: Honorific) => {
    if (isDisabled) return
    onChange(value === choice ? null : choice)
  }

  const disabledTitle = !supported ? "Chưa hỗ trợ danh xưng trên HTTP" : undefined

  const btnCls = (on: boolean) =>
    cn(
      "tnum inline-flex shrink-0 items-center justify-center font-medium transition-colors select-none",
      size === "lg"
        ? "h-12 min-w-[44px] px-3 rounded-xl border text-base"
        : "h-11 min-w-[42px] px-2.5 rounded-sm border text-sm",
      on
        ? "border-foreground bg-foreground text-background font-semibold"
        : "border-strong bg-background text-tx-1 hover:border-foreground",
      isDisabled && "cursor-not-allowed opacity-50 border-dashed bg-transparent text-tx-3",
    )

  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", className)} role="group" aria-label="Danh xưng">
      <button
        type="button"
        role="radio"
        aria-checked={isMr}
        disabled={isDisabled}
        title={disabledTitle ?? (isMr ? "Bỏ chọn Mr" : "Chọn Mr")}
        onClick={() => handleSelect("MR")}
        className={btnCls(isMr)}
      >
        Mr
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={isMs}
        disabled={isDisabled}
        title={disabledTitle ?? (isMs ? "Bỏ chọn Ms" : "Chọn Ms")}
        onClick={() => handleSelect("MS")}
        className={btnCls(isMs)}
      >
        Ms
      </button>
    </div>
  )
}

export interface IconPickerProps {
  isBirthday: boolean
  onBirthdayChange: (birthday: boolean) => void
  iconKeys: string[]
  onIconKeysChange: (keys: string[]) => void
  supported?: boolean
  className?: string
}

export function formatBookingIcons(isBirthday?: boolean, iconKeys?: string[]): string {
  const parts: string[] = []
  if (iconKeys?.includes("star")) parts.push("⭐ Bàn sếp")
  if (iconKeys?.includes("pin")) parts.push("📌 Chỉ định")
  if (isBirthday) parts.push("🎂 Sinh nhật")
  return parts.length ? parts.join(" · ") : "Không có"
}

export function IconPicker({
  isBirthday,
  onBirthdayChange,
  iconKeys,
  onIconKeysChange,
  supported = iconKeysSupported,
  className,
}: IconPickerProps) {
  const hasStar = iconKeys.includes("star")
  const hasPin = iconKeys.includes("pin")

  const toggleStar = () => {
    if (!supported) return
    onIconKeysChange(hasStar ? iconKeys.filter((k) => k !== "star") : [...iconKeys, "star"])
  }

  const togglePin = () => {
    if (!supported) return
    onIconKeysChange(hasPin ? iconKeys.filter((k) => k !== "pin") : [...iconKeys, "pin"])
  }

  return (
    <div className={cn("grid grid-cols-3 gap-1.5", className)} role="group" aria-label="Icon">
      <button
        type="button"
        role="checkbox"
        aria-checked={hasStar}
        disabled={!supported}
        title={!supported ? "Chưa hỗ trợ Bàn sếp trên HTTP" : "Bàn sếp"}
        className={cn(
          chip(hasStar),
          "flex h-11 items-center justify-center gap-1.5 px-2 text-sm font-medium",
          hasStar && "border-amber-500 bg-amber-500/15 text-amber-900 dark:text-amber-200 font-semibold",
          !supported && "cursor-not-allowed opacity-50 border-dashed",
        )}
        onClick={toggleStar}
      >
        <span aria-hidden>⭐</span>
        <span className="truncate">Bàn sếp</span>
      </button>

      <button
        type="button"
        role="checkbox"
        aria-checked={hasPin}
        disabled={!supported}
        title={!supported ? "Chưa hỗ trợ Chỉ định trên HTTP" : "Chỉ định"}
        className={cn(
          chip(hasPin),
          "flex h-11 items-center justify-center gap-1.5 px-2 text-sm font-medium",
          hasPin && "border-blue-500 bg-blue-500/15 text-blue-900 dark:text-blue-200 font-semibold",
          !supported && "cursor-not-allowed opacity-50 border-dashed",
        )}
        onClick={togglePin}
      >
        <span aria-hidden>📌</span>
        <span className="truncate">Chỉ định</span>
      </button>

      <button
        type="button"
        role="checkbox"
        aria-checked={isBirthday}
        aria-label="Sinh nhật"
        className={cn(
          chip(isBirthday),
          "flex h-11 items-center justify-center gap-1.5 px-2 text-sm font-medium",
          isBirthday && "border-amber-500 bg-amber-500/15 text-amber-900 dark:text-amber-200 font-semibold",
        )}
        onClick={() => onBirthdayChange(!isBirthday)}
      >
        <span aria-hidden>🎂</span>
        <span className="truncate">Sinh nhật</span>
      </button>
    </div>
  )
}

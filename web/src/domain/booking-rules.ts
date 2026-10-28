/**
 * Booking form rules (approved): one source for every booking form variant.
 *
 * - Guests: quick-pick 1–10, "Khác" for whole numbers above 10 (no upper limit until one is approved;
 *   note the mock server still caps partySize at 500).
 * - Arrival: 19:00 of the selected business date to 01:00 next morning, every 30 minutes, both ends
 *   included (13 slots). Walk-in arrival is "now" and is NOT limited by these slots.
 * - The business day itself stays 17:00 → 05:00 (lib/time.ts). 00:00–01:00 slots use the next calendar
 *   date but keep the selected business date; the API derives business_date from expectedAt.
 */
import { addDays, atBusinessTime, fmtDayMonth, MS, type BusinessDate } from "@/lib/time"

export const GUEST_QUICK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export const BOOKING_SLOT_STEP_MIN = 30
export const BOOKING_FIRST_SLOT = "19:00"
export const BOOKING_LAST_SLOT = "01:00"
export const PAST_GRACE_MIN = 5

const DAY_START = 17 * 60
const pad = (n: number) => String(n).padStart(2, "0")
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

export const isAfterMidnight = (hhmm: string) => toMin(hhmm) < 12 * 60

/** Minutes after the 17:00 business-day start, so 00:30 sorts after 23:30. Never sort "HH:mm" strings. */
export const businessMinute = (hhmm: string) => (isAfterMidnight(hhmm) ? toMin(hhmm) + 1440 : toMin(hhmm)) - DAY_START

export const BOOKING_SLOTS: readonly string[] = (() => {
  const out: string[] = []
  for (let m = businessMinute(BOOKING_FIRST_SLOT); m <= businessMinute(BOOKING_LAST_SLOT); m += BOOKING_SLOT_STEP_MIN) {
    const t = (DAY_START + m) % 1440
    out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`)
  }
  return out
})()

export const isBookingSlot = (hhmm: string | null | undefined): hhmm is string => !!hhmm && BOOKING_SLOTS.includes(hhmm)

/** "19:30" → "7:30 PM", "00:00" → "12:00 AM". */
export function slotLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`
}

export const bookingCalendarDate = (bd: BusinessDate, hhmm: string): BusinessDate =>
  isAfterMidnight(hhmm) ? addDays(bd, 1) : bd

/** UTC instant for the API (`expectedAt`). atBusinessTime maps hours < 12 to the next calendar day in Asia/Ho_Chi_Minh. */
export const bookingInstant = (bd: BusinessDate, hhmm: string): Date => atBusinessTime(bd, hhmm)

export interface BookingSlot {
  time: string
  label: string
  nextDay: boolean
  calendarDate: BusinessDate
  disabled: boolean
  reason: "Đã qua" | null
}

export function bookingSlots(bd: BusinessDate, now: Date, graceMin = PAST_GRACE_MIN): BookingSlot[] {
  return BOOKING_SLOTS.map((time) => {
    const past = bookingInstant(bd, time).getTime() < now.getTime() - graceMin * MS.MIN
    return {
      time,
      label: slotLabel(time),
      nextDay: isAfterMidnight(time),
      calendarDate: bookingCalendarDate(bd, time),
      disabled: past,
      reason: past ? "Đã qua" : null,
    }
  })
}

export function bookingSlotGroups(bd: BusinessDate, now: Date) {
  const all = bookingSlots(bd, now)
  const next = fmtDayMonth(addDays(bd, 1))
  return [
    { key: "evening", title: `Tối ${fmtDayMonth(bd)}`, slots: all.filter((s) => !s.nextDay) },
    { key: "late", title: `Sáng hôm sau, ${next}`, slots: all.filter((s) => s.nextDay) },
  ] as const
}

/** Null when valid. Availability (table conflicts) is NOT decided here; the server stays the final check. */
export function validateBookingTime(
  bd: BusinessDate,
  hhmm: string | null | undefined,
  now: Date,
  graceMin = PAST_GRACE_MIN,
) {
  if (!hhmm) return "Chọn giờ đến."
  if (!isBookingSlot(hhmm)) return "Giờ đặt bàn chỉ từ 7:00 PM đến 1:00 AM, mỗi 30 phút."
  if (bookingInstant(bd, hhmm).getTime() < now.getTime() - graceMin * MS.MIN)
    return `${slotLabel(hhmm)} đã qua ở ngày này. Chọn lại giờ đến.`
  return null
}

export const defaultBookingSlot = (bd: BusinessDate, now: Date): string | null =>
  bookingSlots(bd, now).find((s) => !s.disabled)?.time ?? null

export type GuestParse = { ok: true; value: number; error: null } | { ok: false; value: number | null; error: string }

/** "Khác": whole numbers above 10 only. */
export function parseOtherGuests(text: string): GuestParse {
  const t = text.trim()
  if (!t) return { ok: false, value: null, error: "Nhập số khách, từ 11 trở lên." }
  if (/^-/.test(t)) return { ok: false, value: null, error: "Số khách phải lớn hơn 0." }
  if (/[.,]/.test(t)) return { ok: false, value: null, error: "Chỉ nhập số nguyên, không có phần lẻ." }
  if (!/^\d+$/.test(t)) return { ok: false, value: null, error: "Chỉ nhập chữ số." }
  const v = Number(t)
  if (v === 0) return { ok: false, value: 0, error: "Số khách phải lớn hơn 0." }
  if (v <= 10) return { ok: false, value: v, error: `${v} khách: chạm nút ${v} ở trên. Ô Khác dành cho từ 11 khách.` }
  return { ok: true, value: v, error: null }
}

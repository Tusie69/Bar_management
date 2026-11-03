/**
 * Venue time helpers.
 *
 * The venue runs in Asia/Ho_Chi_Minh (UTC+07:00, no DST). All business logic
 * is computed against that fixed offset so the result does not depend on the
 * timezone of the tablet that renders it. Timestamps are stored as UTC Date
 * objects, exactly like the DATETIME(3) UTC columns in the DDL draft.
 *
 * Business day (ngày kinh doanh): 17:00 -> 05:00 next day.
 * business_date = DATE(local(t) - cutoff), e.g. 01:30 on 21/10 -> 2026-10-20.
 */

export const VENUE_TZ = "Asia/Ho_Chi_Minh"
export const VENUE_OFFSET_MIN = 7 * 60
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export type BusinessDate = string // "YYYY-MM-DD"

export interface VenueParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  weekday: number // 0 = Sunday
}

export function venueParts(t: Date): VenueParts {
  const shifted = new Date(t.getTime() + VENUE_OFFSET_MIN * MIN)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  }
}

const pad = (n: number) => String(n).padStart(2, "0")

export function venueDateString(t: Date): BusinessDate {
  const p = venueParts(t)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Build a UTC Date from a venue-local calendar date + "HH:mm". */
export function fromVenueLocal(date: BusinessDate, hhmm: string): Date {
  const [y, m, d] = date.split("-").map(Number)
  const [hh, mm] = hhmm.split(":").map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - VENUE_OFFSET_MIN * MIN)
}

export function addDays(date: BusinessDate, n: number): BusinessDate {
  const t = fromVenueLocal(date, "12:00")
  return venueDateString(new Date(t.getTime() + n * DAY))
}

export function businessDateOf(t: Date, cutoffHour = 5): BusinessDate {
  return venueDateString(new Date(t.getTime() - cutoffHour * HOUR))
}

/**
 * A wall-clock time inside a business day. Times before noon belong to the
 * following calendar day (00:00-05:00 is still "tonight").
 */
export function atBusinessTime(bd: BusinessDate, hhmm: string): Date {
  const hour = Number(hhmm.split(":")[0])
  const calendar = hour < 12 ? addDays(bd, 1) : bd
  return fromVenueLocal(calendar, hhmm)
}

export function businessDayBounds(bd: BusinessDate, startHour = 17, cutoffHour = 5) {
  return {
    start: fromVenueLocal(bd, `${pad(startHour)}:00`),
    end: fromVenueLocal(addDays(bd, 1), `${pad(cutoffHour)}:00`),
  }
}

/** 15-minute slots from opening to cutoff, as "HH:mm" in business order. */
export function businessSlots(stepMin = 15, startHour = 17, cutoffHour = 5): string[] {
  const out: string[] = []
  const total = (24 - startHour + cutoffHour) * 60
  for (let m = 0; m < total; m += stepMin) {
    const minutes = (startHour * 60 + m) % (24 * 60)
    out.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`)
  }
  return out
}

export function fmtTime(t: Date | null | undefined): string {
  if (!t) return "--:--"
  const p = venueParts(t)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** Mobile V1 shows 12h clock: "7:15 PM". */
export function fmtTime12(t: Date): string {
  const p = venueParts(t)
  return `${p.hour % 12 || 12}:${pad(p.minute)} ${p.hour < 12 ? "AM" : "PM"}`
}

const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"]
const WEEKDAYS_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]

export function fmtBusinessDate(bd: BusinessDate, style: "long" | "short" = "long"): string {
  const p = venueParts(fromVenueLocal(bd, "12:00"))
  const wd = style === "long" ? WEEKDAYS[p.weekday] : WEEKDAYS_SHORT[p.weekday]
  return `${wd}, ${pad(p.day)}/${pad(p.month)}`
}

export function fmtDayMonth(bd: BusinessDate): string {
  const [, m, d] = bd.split("-")
  return `${d}/${m}`
}

/** "25'" below an hour, "1h05" above (never "1:05", which reads like a countdown). */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MIN))
  if (total < 60) return `${total}'`
  return `${Math.floor(total / 60)}h${pad(total % 60)}`
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / MIN)
}

export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}

export const MS = { MIN, HOUR, DAY }

/** Business date <-> device-local Date (for calendar widgets). */
export function toLocalDate(bd: BusinessDate): Date {
  const [y, m, d] = bd.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function fromLocalDate(d: Date): BusinessDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

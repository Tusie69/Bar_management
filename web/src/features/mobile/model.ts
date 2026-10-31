/** Pure helpers for Mobile V1: tone, chip text, attention order. Same rules as the round-2 prototype. */
import type { ReservationView, WaitlistEntryView } from "@/domain/models"
import { fmtBusinessDate, fmtTime12, MS } from "@/lib/time"
import type { FloorModel } from "../floor/use-floor-model"

export type Tone = "reserved" | "late" | "noshow" | "seated" | null
export interface Thresholds {
  late: number
  noshow: number
}

export const toneStyle = (t: Tone) =>
  t
    ? { background: `var(--st-${t}-tint)`, color: `var(--st-${t}-ink)` }
    : { background: "var(--surface-3)", color: "var(--tx-2)" }

export const lateOf = (r: ReservationView, now: Date) =>
  r.status === "BOOKED" ? Math.max(0, Math.floor((now.getTime() - r.expectedAt.getTime()) / MS.MIN)) : 0

/** 0 = trễ 30', 1 = trễ 15', 2 = chưa có bàn, 9 = ổn. 21GAM has no "chờ xác nhận". */
export const levelOf = (r: ReservationView) =>
  r.warning === "noshow" ? 0 : r.warning === "late" ? 1 : !r.tableIds.length ? 2 : 9

export function toneOf(r: ReservationView): Tone {
  if (r.status === "CHECKED_IN") return "seated"
  if (r.status === "NO_SHOW") return "noshow"
  if (r.status === "CANCELLED") return null
  return r.warning ?? "reserved"
}

export function chipOf(r: ReservationView, now: Date): string {
  if (r.status === "CHECKED_IN") return "Đã nhận bàn"
  if (r.status === "NO_SHOW") return "Không đến"
  if (r.status === "CANCELLED") return "Đã hủy"
  const late = lateOf(r, now)
  return late ? `Trễ ${late} phút` : "Sắp đến"
}

export function subOf(r: ReservationView, now: Date, th: Thresholds): string {
  if (r.status === "CHECKED_IN") return r.checkedInAt ? `Đến lúc ${fmtTime12(r.checkedInAt)}` : ""
  if (r.status !== "BOOKED") return ""
  if (r.warning === "noshow") return `Quá mốc ${th.noshow} phút. Bàn vẫn đang giữ.`
  if (r.warning === "late") return `Quá mốc ${th.late} phút`
  if (!r.tableIds.length) return "Cần xếp bàn trước giờ khách đến"
  const left = Math.floor((r.expectedAt.getTime() - now.getTime()) / MS.MIN)
  return left >= 0 && left <= 60 ? `Còn ${left} phút` : ""
}

export const codesOf = (ids: number[], model: FloorModel) => ids.map((id) => model.label(id)).join(" + ")

export const tableText = (ids: number[], model: FloorModel) =>
  ids.length ? `Bàn ${codesOf(ids, model)}` : "Chưa có bàn"

export const fmtShort = (bd: string) => fmtBusinessDate(bd, "short").replace(",", "")

export const byTime = (a: ReservationView, b: ReservationView) => a.expectedAt.getTime() - b.expectedAt.getTime()

export function splitShift(list: ReservationView[]) {
  const booked = list.filter((r) => r.status === "BOOKED")
  return {
    booked,
    attention: booked.filter((r) => levelOf(r) < 9).sort((a, b) => levelOf(a) - levelOf(b) || byTime(a, b)),
    upcoming: booked.filter((r) => levelOf(r) === 9).sort(byTime),
    seated: list.filter((r) => r.status === "CHECKED_IN").sort(byTime),
    live: list.filter((r) => r.status !== "CANCELLED"),
  }
}

export const isOpenEntry = (e: WaitlistEntryView) =>
  e.status !== "SEATED" && e.status !== "CANCELLED" && e.status !== "DECLINED"

export function duration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / MS.MIN))
  return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${String(m % 60).padStart(2, "0")} phút`
}

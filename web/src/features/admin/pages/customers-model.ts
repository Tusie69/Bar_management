/**
 * Trang Khách hàng (Admin) — logic thuần, không React, để test không cần DOM.
 *
 * Chỉ dùng những gì `CustomerSummary` / `CustomerProfile` thật sự có. Chi tiêu
 * và phân hạng chưa có nguồn (chưa có hóa đơn), nên không có hàm nào bịa ra.
 */
import type { CustomerStatus, ReservationStatus, VisitOrigin } from "@/domain/enums"
import type { CustomerProfile, CustomerSummary, ReservationView, VisitView } from "@/domain/models"
import { venueDateString } from "@/lib/time"

/** Nhãn mock trả về khi `display_name` null. Không phải tên thật nên hiện nhạt. */
export const UNNAMED_LABEL = "Khách ẩn danh"

export function hasRealName(name: string | null | undefined): boolean {
  const value = name?.trim() ?? ""
  return value !== "" && value !== UNNAMED_LABEL
}

/** Mã hiển thị từ `customers.id`. Chỉ là cách viết id, không phải cột mới. */
export function customerCode(id: number): string {
  return `KH-${String(id).padStart(4, "0")}`
}

/** Số ngày lịch (giờ quán) giữa hai thời điểm; 0 = cùng ngày. */
export function daysBetween(from: Date, to: Date): number {
  const [a, b] = [venueDateString(from), venueDateString(to)].map((bd) => {
    const [y, m, d] = bd.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  })
  return Math.round((b - a) / 86_400_000)
}

export function relativeDays(at: Date | null, now: Date): string | null {
  if (!at) return null
  const days = daysBetween(at, now)
  if (days <= 0) return "Hôm nay"
  if (days === 1) return "Hôm qua"
  if (days < 60) return `${days} ngày trước`
  return `${Math.floor(days / 30)} tháng trước`
}

export function fmtDate(at: Date): string {
  const [y, m, d] = venueDateString(at).split("-")
  return `${d}/${m}/${y}`
}

/* ---------------- Bộ lọc danh sách ---------------- */

export type CustomerSegment = "all" | "recent30" | "returning" | "noVisit"

/**
 * Chỉ lọc theo dữ kiện (số lượt, ngày ghé). Ngưỡng VIP / khách quen / nguy cơ
 * mất khách chưa được chốt nghiệp vụ nên chưa có ở đây.
 */
export const SEGMENTS: readonly { id: CustomerSegment; label: string; hint: string }[] = [
  { id: "all", label: "Tất cả", hint: "Mọi hồ sơ đang hoạt động" },
  { id: "recent30", label: "Ghé trong 30 ngày", hint: "Có lượt ghé trong 30 ngày gần nhất" },
  { id: "returning", label: "Đã quay lại", hint: "Từ 2 lượt ghé trở lên" },
  { id: "noVisit", label: "Chưa có lượt ghé", hint: "Có hồ sơ nhưng chưa ngồi bàn lần nào" },
]

export function isSegment(value: string | null): value is CustomerSegment {
  return SEGMENTS.some((segment) => segment.id === value)
}

export function matchesSegment(customer: CustomerSummary, segment: CustomerSegment, now: Date): boolean {
  switch (segment) {
    case "all":
      return true
    case "recent30":
      return customer.lastVisitAt !== null && daysBetween(customer.lastVisitAt, now) < 30
    case "returning":
      return customer.visitCount >= 2
    case "noVisit":
      return customer.visitCount === 0
  }
}

/* ---------------- Hồ sơ ---------------- */

/**
 * `CustomerProfile` hiện chưa trả `status`. Khi backend trả thêm, trang tự
 * hiện đúng trạng thái gộp / ẩn danh mà không cần sửa lại.
 */
export type ProfileWithStatus = CustomerProfile & {
  status?: CustomerStatus
  mergedIntoCustomerId?: number | null
}

export type ProfileNotice = { kind: "merged"; targetId: number | null } | { kind: "anonymized" } | null

export function profileNotice(profile: ProfileWithStatus): ProfileNotice {
  if (profile.status === "MERGED") return { kind: "merged", targetId: profile.mergedIntoCustomerId ?? null }
  if (profile.status === "ANONYMIZED") return { kind: "anonymized" }
  return null
}

/** Trung bình lượt/tháng trên 90 ngày gần nhất; null khi chưa có lượt nào. */
export function visitsPerMonth(profile: CustomerProfile): number | null {
  if (profile.visitCount === 0) return null
  return Math.round((profile.visits90d / 3) * 10) / 10
}

/* ---------------- Lịch sử ---------------- */

export type HistoryEvent =
  { kind: "visit"; at: Date; visit: VisitView } | { kind: "booking"; at: Date; booking: ReservationView }

export type HistoryFilter = "all" | "visit" | "booking"

/**
 * Gộp lượt ghé và booking thành một dòng thời gian, mới nhất trước. Booking đã
 * check-in vẫn là một mục riêng: booking là lời hẹn, lượt ghé là lúc khách thật sự ngồi.
 */
export function buildHistory(profile: CustomerProfile, filter: HistoryFilter = "all"): HistoryEvent[] {
  const events: HistoryEvent[] = []
  if (filter !== "booking")
    for (const visit of profile.visits) events.push({ kind: "visit", at: visit.startedAt, visit })
  if (filter !== "visit")
    for (const booking of profile.reservations) events.push({ kind: "booking", at: booking.expectedAt, booking })
  return events.sort((a, b) => b.at.getTime() - a.at.getTime())
}

/** Nhóm theo "Tháng 11/2026" để quét nhanh. Giữ thứ tự đầu vào. */
export function groupByMonth(events: HistoryEvent[]): { key: string; label: string; events: HistoryEvent[] }[] {
  const groups: { key: string; label: string; events: HistoryEvent[] }[] = []
  for (const event of events) {
    const [y, m] = venueDateString(event.at).split("-")
    const key = `${y}-${m}`
    const last = groups.at(-1)
    if (last?.key === key) last.events.push(event)
    else groups.push({ key, label: `Tháng ${Number(m)}/${y}`, events: [event] })
  }
  return groups
}

export type Tone = "blue" | "green" | "amber" | "red" | "neutral"

export const VISIT_ORIGIN_TEXT: Record<VisitOrigin, string> = {
  RESERVATION: "Lượt ghé từ booking",
  WALK_IN: "Lượt walk-in",
  WAITLIST: "Lượt từ danh sách chờ",
}

export function visitState(visit: VisitView): { label: string; tone: Tone } {
  if (!visit.endedAt) return { label: "Đang ngồi", tone: "green" }
  if (visit.endReason === "ENTRY_ERROR") return { label: "Nhập sai", tone: "red" }
  if (visit.endReason === "MERGED") return { label: "Đã gộp lượt", tone: "neutral" }
  return { label: "Hoàn tất", tone: "neutral" }
}

export const BOOKING_TONE: Record<ReservationStatus, Tone> = {
  BOOKED: "blue",
  CHECKED_IN: "green",
  CANCELLED: "neutral",
  NO_SHOW: "red",
}

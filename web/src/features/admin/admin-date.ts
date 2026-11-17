/**
 * TU-39 — Ngày kinh doanh hiện trên header Admin.
 *
 * Quán chạy ca 17:00 → 05:00, nên 02:00 vẫn thuộc đêm hôm trước. Dùng
 * `businessDateOf` của `lib/time` chứ không lấy ngày lịch của máy: nếu lấy
 * ngày lịch, header sẽ nhảy sang ngày mới lúc 00:00 giữa ca và mọi con số
 * trên màn hình đọc sai một đêm.
 */
import { businessDateOf, fromVenueLocal, venueParts, type BusinessDate } from "@/lib/time"

export const ADMIN_SHIFT_LABEL = "Ca 17:00 → 05:00"

const WEEKDAYS_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]
const pad = (n: number) => String(n).padStart(2, "0")

/**
 * "T5 · 12/11/2026" — đúng định dạng trong Figma. `fmtBusinessDate` của
 * `lib/time` không có năm, mà header Admin đứng cạnh các báo cáo nhiều tháng
 * nên năm là thông tin cần thiết.
 */
export function fmtAdminBusinessDate(bd: BusinessDate): string {
  const p = venueParts(fromVenueLocal(bd, "12:00"))
  return `${WEEKDAYS_SHORT[p.weekday]} · ${pad(p.day)}/${pad(p.month)}/${p.year}`
}

/** Ngày kinh doanh của một thời điểm, đã định dạng sẵn cho header. */
export function adminBusinessDateLabel(now: Date): string {
  return fmtAdminBusinessDate(businessDateOf(now))
}

/**
 * TU-39 — Ngày kinh doanh hiện trên header Admin.
 *
 * Quán chạy ca qua nửa đêm, nên 02:00 vẫn thuộc đêm hôm trước. Mốc cắt lấy từ cấu hình
 * địa điểm (TU-38). Dùng `businessDateOf` của `lib/time` chứ không lấy ngày lịch của máy: nếu lấy
 * ngày lịch, header sẽ nhảy sang ngày mới lúc 00:00 giữa ca và mọi con số
 * trên màn hình đọc sai một đêm.
 */
import {
  businessDateOf,
  FALLBACK_BUSINESS_SHIFT,
  fmtBusinessShift,
  fromVenueLocal,
  shiftHour,
  venueParts,
  type BusinessDate,
  type BusinessShift,
} from "@/lib/time"

/**
 * TU-38 — the header's shift label, built from the venue row instead of a fixed string.
 * `useBusinessShift` supplies the shift; the fallback only covers the first render before
 * the catalog has loaded.
 */
export function adminShiftLabel(shift: BusinessShift = FALLBACK_BUSINESS_SHIFT): string {
  return `Ca ${fmtBusinessShift(shift)}`
}

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

/**
 * Ngày kinh doanh của một thời điểm, đã định dạng sẵn cho header.
 * `shift` đến từ cấu hình địa điểm; mặc định chỉ dùng cho lần render đầu.
 */
export function adminBusinessDateLabel(now: Date, shift: BusinessShift = FALLBACK_BUSINESS_SHIFT): string {
  return fmtAdminBusinessDate(businessDateOf(now, shiftHour(shift.cutoffLocal)))
}

/**
 * TU-35 — Định dạng một dòng nhật ký cho màn Quản trị.
 *
 * Hàm thuần, tách khỏi component để test được mà không cần DOM.
 */
import { venueParts } from "@/lib/time"

const pad = (value: number) => String(value).padStart(2, "0")

/**
 * Giờ của quán, không phải giờ máy đang mở trang.
 *
 * Nhật ký được đọc để đối chiếu với lời kể của nhân viên ("lúc 23:12 tôi
 * đang…"), nên nó phải cùng múi giờ với đồng hồ treo tường trong quán. Một
 * chiếc laptop đặt sai múi giờ không được phép làm lệch bằng chứng.
 */
export function fmtAuditTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "—"
  const parts = venueParts(parsed)
  const seconds = pad(parsed.getUTCSeconds())
  return `${pad(parts.day)}/${pad(parts.month)} ${pad(parts.hour)}:${pad(parts.minute)}:${seconds}`
}

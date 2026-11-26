import { env } from '../config/env.js'

/**
 * Đồng hồ nghiệp vụ dùng chung của API.
 *
 * Ba chế độ, theo thứ tự ưu tiên:
 *   1. E2E đóng băng giờ (`E2E_FIXED_NOW`, chỉ NODE_ENV=test + database _test).
 *   2. TU-42: bản Dev cộng thêm một độ lệch do SuperAdmin chọn (APP_ENV=dev).
 *   3. Mọi nơi khác, kể cả Production: giờ thật, không đọc độ lệch nào.
 *
 * Phía SQL đi theo cùng đồng hồ nhờ `SET timestamp` trên từng kết nối (xem
 * database/pool.ts), nên `UTC_TIMESTAMP()`, `NOW()` và giá trị mặc định
 * `CURRENT_TIMESTAMP` trong ~150 câu SQL không phải sửa.
 *
 * Những gì KHÔNG được đi theo đồng hồ này — vì chúng đo thời gian thật của con
 * người chứ không phải giờ của quán — dùng `realNow()`: hạn phiên đăng nhập,
 * giới hạn tần suất, TTL bộ nhớ đệm. Nhảy đồng hồ lên 14 tiếng không được làm
 * cả nhóm bị đăng xuất vì phiên 12 tiếng "đã hết hạn".
 */

let devOffsetMs = 0

/** Giới hạn độ lệch: đủ để thử bất kỳ ca nào trong một tháng, không đủ để trôi vào năm khác. */
export const DEV_CLOCK_MAX_OFFSET_MS = 31 * 86_400_000

export function realNow(): Date {
  return new Date()
}

export function applicationNow(): Date {
  if (env.test.fixedNow) return new Date(env.test.fixedNow.getTime())
  return new Date(Date.now() + devOffsetMs)
}

/** True khi đồng hồ nghiệp vụ có thể khác giờ thật (chỉ bản Dev). */
export function devClockEnabled(): boolean {
  return env.appEnv === 'dev'
}

export function getDevClockOffsetMs(): number {
  return devOffsetMs
}

/**
 * Chốt chặn ở tầng thấp nhất: dù route nào gọi nhầm, ngoài bản Dev độ lệch
 * vẫn luôn là 0. Ẩn nút trên giao diện không phải là bảo vệ.
 */
export function setDevClockOffsetMs(offsetMs: number): void {
  if (!devClockEnabled()) throw new Error('Đồng hồ giả lập chỉ dùng được khi APP_ENV=dev')
  if (!Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > DEV_CLOCK_MAX_OFFSET_MS) {
    throw new RangeError('Độ lệch đồng hồ giả lập vượt giới hạn 31 ngày')
  }
  devOffsetMs = offsetMs
}

/**
 * Câu lệnh đặt giờ cho một kết nối MySQL vừa được mượn từ pool.
 * Độ lệch 0 → trả MySQL về đồng hồ thật của nó (`DEFAULT`) thay vì đóng băng
 * ở một con số, để kết nối giữ lâu vẫn chạy giờ thật.
 */
export function mysqlSessionTimestampSql(nowMs = Date.now()): string {
  if (devOffsetMs === 0) return 'SET timestamp = DEFAULT'
  const seconds = (nowMs + devOffsetMs) / 1000
  return `SET timestamp = ${seconds.toFixed(3)}`
}

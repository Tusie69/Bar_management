import { env } from '../../config/env.js'
import { AppError } from '../../errors/app-error.js'

interface Entry { count: number; resetsAt: number }

export class PhoneRevealRateLimiter {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly maximum: number, private readonly windowMs: number) {}

  /**
   * `subject` là booking id với đường booking, hoặc `w<id>` / `v<id>` với đơn
   * chờ và lượt ghé: ba không gian id riêng biệt, không được đếm chung ô.
   */
  assertAllowed(userId: number, subject: number | string, now = Date.now()): void {
    const key = `${userId}:${subject}`
    const current = this.entries.get(key)
    if (!current || current.resetsAt <= now) {
      this.entries.set(key, { count: 1, resetsAt: now + this.windowMs })
      return
    }
    if (current.count >= this.maximum) {
      throw new AppError(429, 'PHONE_REVEAL_RATE_LIMITED', 'Đã mở số điện thoại quá nhiều lần. Vui lòng thử lại sau.')
    }
    current.count += 1
  }
}

/**
 * `whenUnconfigured` quyết định việc thiếu cấu hình rate limit có chặn hay không.
 *
 * Mở số cho người dùng đọc (`booking.phone.reveal`) thì vẫn chặn: không có
 * hạn mức thì không được tiết lộ số. Nhưng bấm gọi thì cho đi qua - thiếu hai
 * biến môi trường PHONE_REVEAL_RATE_LIMIT_* từng làm cả quán không gọi được
 * khách suốt đêm với lỗi 503, trong khi mỗi lần gọi đều đã ghi log đầy đủ.
 */
export function assertPhoneDisclosureAllowed(
  limiter: PhoneRevealRateLimiter | null,
  userId: number,
  subject: number | string,
  whenUnconfigured: 'block' | 'allow' = 'block',
): void {
  if (!limiter) {
    if (whenUnconfigured === 'allow') return
    throw new AppError(503, 'PHONE_REVEAL_POLICY_UNAVAILABLE', 'Chức năng gọi khách chưa được cấu hình đầy đủ.')
  }
  limiter.assertAllowed(userId, subject)
}

/**
 * Một bộ đếm duy nhất cho cả quá trình: booking, đơn chờ và lượt ghé dùng
 * chung, nếu không mỗi router lại có hạn mức riêng và con số 10 lần trong 10
 * phút hóa ra 30.
 */
export const phoneDisclosureLimiter: PhoneRevealRateLimiter | null =
  env.phone.revealRateLimitMax && env.phone.revealRateLimitWindowMs
    ? new PhoneRevealRateLimiter(env.phone.revealRateLimitMax, env.phone.revealRateLimitWindowMs)
    : null

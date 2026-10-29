import { AppError } from '../../errors/app-error.js'

interface Entry { count: number; resetsAt: number }

export class PhoneRevealRateLimiter {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly maximum: number, private readonly windowMs: number) {}

  assertAllowed(userId: number, bookingId: number, now = Date.now()): void {
    const key = `${userId}:${bookingId}`
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

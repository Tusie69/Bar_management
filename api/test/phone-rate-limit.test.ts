import { describe, expect, it } from 'vitest'

import { AppError } from '../src/errors/app-error.js'
import { assertPhoneDisclosureAllowed, PhoneRevealRateLimiter } from '../src/modules/bookings/phone-rate-limit.js'

describe('phone reveal rate limiter', () => {
  it('limits per user and booking and resets after its configured window', () => {
    const limiter = new PhoneRevealRateLimiter(2, 1_000)
    limiter.assertAllowed(1, 10, 100)
    limiter.assertAllowed(1, 10, 101)
    expect(() => limiter.assertAllowed(1, 10, 102)).toThrow(AppError)
    expect(() => limiter.assertAllowed(1, 11, 102)).not.toThrow()
    expect(() => limiter.assertAllowed(2, 10, 102)).not.toThrow()
    expect(() => limiter.assertAllowed(1, 10, 1_101)).not.toThrow()
  })

  it('keeps booking, waitlist and visit ids in separate buckets', () => {
    // Ba dãy id độc lập: nếu đếm chung ô thì gọi booking 10 vài lần là khóa
    // luôn mục chờ 10 và lượt ghé 10, hai người hoàn toàn khác.
    const limiter = new PhoneRevealRateLimiter(1, 1_000)
    limiter.assertAllowed(1, 10, 100)
    expect(() => limiter.assertAllowed(1, 10, 101)).toThrow(AppError)
    expect(() => limiter.assertAllowed(1, 'w10', 101)).not.toThrow()
    expect(() => limiter.assertAllowed(1, 'v10', 101)).not.toThrow()
  })

  it('fails closed when the phone disclosure policy is unavailable', () => {
    expect(() => assertPhoneDisclosureAllowed(null, 1, 10)).toThrow(expect.objectContaining({
      status: 503,
      code: 'PHONE_REVEAL_POLICY_UNAVAILABLE',
    }))
  })

  it('lets a call through when no limit is configured, so a missing env never silences the phone', () => {
    expect(() => assertPhoneDisclosureAllowed(null, 1, 'w10', 'allow')).not.toThrow()
  })
})

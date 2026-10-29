import { describe, expect, it } from 'vitest'

import { AppError } from '../src/errors/app-error.js'
import { PhoneRevealRateLimiter } from '../src/modules/bookings/phone-rate-limit.js'

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
})

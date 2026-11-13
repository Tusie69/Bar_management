import { describe, expect, it } from 'vitest'

import { canCallBooking } from '../src/modules/bookings/booking-call.js'

describe('booking call eligibility', () => {
  it('cho gọi bất cứ khi nào booking còn số điện thoại', () => {
    expect(canCallBooking({ hasPhone: true })).toBe(true)
  })

  it('không gọi được khi booking không có số', () => {
    expect(canCallBooking({ hasPhone: false })).toBe(false)
  })
})

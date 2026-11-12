import { describe, expect, it } from 'vitest'

import { canCallBooking } from '../src/modules/bookings/booking-call.js'

const expectedAt = '2026-11-02T14:30:00.000Z'
const base = {
  status: 'BOOKED' as const,
  expectedAt,
  businessDate: '2026-11-02',
  lateConfirmedAt: null,
  hasPhone: true,
  hasActiveClaim: true,
  thresholds: { upcomingMinutes: 10, lateAfterMinutes: 15, noShowAfterMinutes: 30 },
}

describe('booking call eligibility', () => {
  it.each([
    ['21:19', '2026-11-02T14:19:00.000Z', false],
    ['21:20', '2026-11-02T14:20:00.000Z', true],
    ['21:30', '2026-11-02T14:30:00.000Z', true],
    ['late', '2026-11-02T14:46:00.000Z', true],
    ['no-show threshold', '2026-11-02T15:00:00.000Z', false],
  ])('%s', (_label, now, expected) => {
    expect(canCallBooking({ ...base, now: new Date(now) })).toBe(expected)
  })

  it('allows an existing late confirmation before the no-show threshold', () => {
    expect(canCallBooking({
      ...base,
      lateConfirmedAt: '2026-11-02T14:42:00.000Z',
      now: new Date('2026-11-02T14:50:00.000Z'),
    })).toBe(true)
  })

  it.each([
    { hasPhone: false },
    { hasActiveClaim: false },
    { status: 'CHECKED_IN' as const },
    { status: 'CANCELLED' as const },
    { status: 'NO_SHOW' as const },
  ])('rejects ineligible booking %#', (patch) => {
    expect(canCallBooking({ ...base, ...patch, now: new Date('2026-11-02T14:30:00.000Z') })).toBe(false)
  })

  it('handles an after-midnight booking in the same business date', () => {
    expect(canCallBooking({
      ...base,
      expectedAt: '2026-11-02T17:30:00.000Z',
      now: new Date('2026-11-02T17:20:00.000Z'),
    })).toBe(true)
  })
})

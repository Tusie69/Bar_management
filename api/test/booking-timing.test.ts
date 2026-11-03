import { describe, expect, it } from 'vitest'

import { deriveBookingTiming } from '../src/modules/bookings/booking-timing.js'

const expectedAt = '2026-10-24T14:00:00.000Z'

describe('booking display timing', () => {
  it.each([
    ['2026-10-24T13:49:59.999Z', 'UPCOMING', 0, false],
    ['2026-10-24T13:50:00.000Z', 'UPCOMING', 0, false],
    ['2026-10-24T14:00:00.000Z', 'UPCOMING', 0, false],
    ['2026-10-24T14:15:00.000Z', 'UPCOMING', 15, false],
    ['2026-10-24T14:15:00.001Z', 'LATE', 15, false],
    ['2026-10-24T14:29:59.999Z', 'LATE', 29, false],
    ['2026-10-24T14:30:00.000Z', 'NO_SHOW', 30, false],
  ] as const)('derives the boundary at %s', (now, displayStatus, minutesLate, autoNoShowDue) => {
    expect(deriveBookingTiming('BOOKED', expectedAt, new Date(now))).toEqual({
      displayStatus,
      minutesLate,
      autoNoShowDue,
    })
  })

  it.each(['CHECKED_IN', 'CANCELLED', 'NO_SHOW'] as const)('does not derive lateness for %s', (status) => {
    expect(deriveBookingTiming(status, expectedAt, new Date('2026-10-24T15:00:00Z'))).toEqual({
      displayStatus: status,
      minutesLate: 0,
      autoNoShowDue: false,
    })
  })
})

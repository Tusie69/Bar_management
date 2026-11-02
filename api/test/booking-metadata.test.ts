import { describe, expect, it } from 'vitest'

import { guestTypeFrom, resolveClassification } from '../src/modules/bookings/booking-metadata.js'
import { validMinuteThreshold, validQuickTimes } from '../src/modules/venues/venue-settings.repository.js'

describe('NA-14 metadata compatibility', () => {
  it('maps legacy classifications and defaults without inferring from phone/customer history', () => {
    expect(['RETURNING', 'NEW', 'UNCLASSIFIED', null].map((value) => guestTypeFrom(value as Parameters<typeof guestTypeFrom>[0])))
      .toEqual(['REGULAR', 'NEW', 'NEW', 'NEW'])
    expect(resolveClassification({})).toBe('NEW')
    expect(resolveClassification({ guestType: 'REGULAR' })).toBe('RETURNING')
    expect(resolveClassification({}, 'UNCLASSIFIED')).toBe('UNCLASSIFIED')
    expect(resolveClassification({ guestType: 'NEW', classification: 'UNCLASSIFIED' })).toBe('UNCLASSIFIED')
    expect(() => resolveClassification({ guestType: 'NEW', classification: 'RETURNING' })).toThrow()
  })

  it('validates settings as JSON values without coercing strings or fractional minutes', () => {
    expect(validQuickTimes(['21:00', '21:30', '22:00', '22:30'])).toBe(true)
    for (const value of [[], ['24:00'], ['21:60'], ['9:00'], ['21:00', '21:00'], '21:00', [2100]]) {
      expect(validQuickTimes(value)).toBe(false)
    }
    expect(validMinuteThreshold(10)).toBe(true)
    expect(validMinuteThreshold(720)).toBe(true)
    for (const value of [0, -1, 1.5, '30', null, 721, true]) expect(validMinuteThreshold(value)).toBe(false)
  })
})

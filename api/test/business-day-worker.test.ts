import { describe, expect, it } from 'vitest'

import { businessDayEndInstant } from '../src/modules/visits/business-day.worker.js'

describe('business-day end scheduling', () => {
  it('ends a business date at 05:00 Asia/Ho_Chi_Minh on the next calendar day', () => {
    expect(businessDayEndInstant('2026-10-31', 'Asia/Ho_Chi_Minh', '05:00:00').toISOString())
      .toBe('2026-10-31T22:00:00.000Z')
  })

  it('rejects an unsupported venue timezone instead of guessing an offset', () => {
    expect(() => businessDayEndInstant('2026-10-31', 'UTC', '05:00:00'))
      .toThrow('BUSINESS_DAY_TIMEZONE_UNSUPPORTED')
  })
})

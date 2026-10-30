import { describe, expect, it } from 'vitest'

import { assertCurrentBusinessDate, currentBusinessDate, validateBookingSchedule, validateCalendarDate } from '../src/modules/bookings/business-date.js'

describe('booking business date validation', () => {
  it('keeps evening arrivals on the same business date', () => {
    const result = validateBookingSchedule('2026-10-24T19:00:00+07:00', '2026-10-24')
    expect(result.expectedAtUtc.toISOString()).toBe('2026-10-24T12:00:00.000Z')
    expect(result.businessDate).toBe('2026-10-24')
  })

  it('maps 00:30 to the previous business date', () => {
    const result = validateBookingSchedule('2026-10-25T00:30:00+07:00', '2026-10-24')
    expect(result.businessDate).toBe('2026-10-24')
    expect(result.mysqlExpectedAt).toBe('2026-10-24 17:30:00.000')
  })

  it.each([
    ['01:01', '2026-10-25'],
    ['10:00', '2026-10-24'],
    ['18:59', '2026-10-24'],
  ])('rejects %s outside booking hours', (time, calendarDate) => {
    expect(() => validateBookingSchedule(`${calendarDate}T${time}:00+07:00`, '2026-10-24'))
      .toThrowError(expect.objectContaining({ code: 'EXPECTED_AT_OUTSIDE_BOOKING_WINDOW' }))
  })

  it.each([
    ['19:00', '2026-10-24'],
    ['21:00', '2026-10-24'],
    ['23:30', '2026-10-24'],
    ['00:30', '2026-10-25'],
    ['01:00', '2026-10-25'],
  ])('accepts booking boundary %s', (time, calendarDate) => {
    expect(validateBookingSchedule(`${calendarDate}T${time}:00+07:00`, '2026-10-24').businessDate)
      .toBe('2026-10-24')
  })

  it('rejects a business date that disagrees with an after-midnight arrival', () => {
    expect(() => validateBookingSchedule('2026-10-25T00:30:00+07:00', '2026-10-25'))
      .toThrowError(expect.objectContaining({ code: 'BUSINESS_DATE_MISMATCH' }))
  })

  it('rejects a timestamp whose offset does not represent Vietnam local time', () => {
    expect(() => validateBookingSchedule('2026-10-24T21:00:00Z', '2026-10-24'))
      .toThrowError(expect.objectContaining({ code: 'EXPECTED_AT_TIMEZONE_MISMATCH' }))
  })

  it('rejects a nonexistent expected-at calendar date', () => {
    expect(() => validateBookingSchedule('2026-02-29T21:00:00+07:00', '2026-02-28'))
      .toThrowError(expect.objectContaining({ code: 'INVALID_EXPECTED_AT' }))
  })

  it.each(['2026-02-29', '2026-13-01', 'not-a-date'])('rejects invalid calendar date %s', (date) => {
    expect(() => validateCalendarDate(date))
      .toThrowError(expect.objectContaining({ code: 'INVALID_BUSINESS_DATE' }))
  })

  it('uses the previous business date at 04:59 Vietnam time', () => {
    const now = new Date('2026-10-24T21:59:00.000Z')
    expect(currentBusinessDate(now)).toBe('2026-10-24')
    expect(assertCurrentBusinessDate('2026-10-24', now)).toBe('2026-10-24')
  })

  it('starts a new business date at 17:00 Vietnam time', () => {
    const now = new Date('2026-10-25T10:00:00.000Z')
    expect(currentBusinessDate(now)).toBe('2026-10-25')
  })

  it.each(['2026-10-25T00:00:00.000Z', '2026-10-25T08:00:00.000Z'])('rejects walk-in outside the shift at %s', (nowValue) => {
    expect(() => assertCurrentBusinessDate('2026-10-25', new Date(nowValue)))
      .toThrowError(expect.objectContaining({ code: 'WALK_IN_OUTSIDE_BUSINESS_HOURS' }))
  })
})

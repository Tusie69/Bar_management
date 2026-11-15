import { describe, expect, it } from 'vitest'

import { parseGuestCountUpdate } from '../src/modules/reception/guest-count.route.js'

const valid = {
  businessDate: '2026-11-15',
  version: 3,
  arrivedBefore: 2,
  arrivedAfter: 0,
  arrivedTotal: 99,
  bookedTables: 6,
  bookedGuests: 8,
  returningGuests: 1,
}

describe('reception guest-count payload', () => {
  it('accepts all six independent non-negative integers', () => {
    expect(parseGuestCountUpdate(valid)).toEqual({
      businessDate: valid.businessDate,
      expectedVersion: 3,
      arrivedBefore: 2,
      arrivedAfter: 0,
      arrivedTotal: 99,
      bookedTables: 6,
      bookedGuests: 8,
      returningGuests: 1,
    })
  })

  it.each([
    { ...valid, bookedTables: -1 },
    { ...valid, bookedTables: 1.5 },
    { ...valid, bookedTables: '' },
    { ...valid, version: '3' },
    { ...valid, returningGuests: undefined },
  ])('rejects invalid or missing values', (payload) => {
    expect(() => parseGuestCountUpdate(payload)).toThrow()
  })

  it('rejects unknown fields so updates remain atomic and explicit', () => {
    expect(() => parseGuestCountUpdate({ ...valid, partySize: 10 })).toThrow()
  })
})

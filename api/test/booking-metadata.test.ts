import { describe, expect, it } from 'vitest'

import { guestTypeFrom, resolveBookingMetadata } from '../src/modules/bookings/booking-metadata.js'

describe('NA-14 booking metadata compatibility', () => {
  it('does not silently turn an unclassified booking into a new guest', () => {
    expect(resolveBookingMetadata({})).toEqual({ classification: 'UNCLASSIFIED', guestType: null })
    expect(guestTypeFrom('UNCLASSIFIED')).toBeNull()
  })

  it('maps only explicit classifications to guest types', () => {
    expect(resolveBookingMetadata({ classification: 'RETURNING' })).toEqual({
      classification: 'RETURNING',
      guestType: 'REGULAR',
    })
    expect(resolveBookingMetadata({ guestType: 'NEW' })).toEqual({ classification: 'NEW', guestType: 'NEW' })
  })

  it('rejects inconsistent dual metadata', () => {
    expect(() => resolveBookingMetadata({ classification: 'RETURNING', guestType: 'NEW' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICTING_GUEST_TYPE' }),
    )
  })
})

import { deriveTableDisplayState, type TableStateThresholds } from '../tables/table-display-state.js'

export interface BookingCallEligibility {
  status: 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW'
  expectedAt: Date | string
  businessDate: string
  lateConfirmedAt?: Date | string | null
  hasPhone: boolean
  hasActiveClaim: boolean
  now: Date
  thresholds: TableStateThresholds
}

export function canCallBooking(input: BookingCallEligibility): boolean {
  if (!input.hasPhone || !input.hasActiveClaim || input.status !== 'BOOKED') return false
  const state = deriveTableDisplayState({
    catalogState: 'ACTIVE',
    isSpare: false,
    activeVisit: null,
    reservation: {
      status: input.status,
      expectedAt: input.expectedAt,
      businessDate: input.businessDate,
      ...(input.lateConfirmedAt === undefined ? {} : { lateConfirmedAt: input.lateConfirmedAt }),
    },
    businessDate: input.businessDate,
    now: input.now,
    thresholds: input.thresholds,
  }).displayState
  // NO_SHOW is in the list on purpose. It is the display state a booking lands
  // in once it is past the no-show threshold while the table is still held, and
  // it is exactly when the receptionist needs to ring the guest to find out
  // whether they are still coming. Leaving it out took the Gọi khách button
  // away from the latest - and usually largest - party on the floor.
  // The reservation status is still BOOKED here; a reservation actually closed
  // as NO_SHOW fails the status check above and stays uncallable.
  return state === 'UPCOMING' || state === 'LATE' || state === 'LATE_CONFIRMED' || state === 'NO_SHOW'
}

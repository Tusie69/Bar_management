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
  return state === 'UPCOMING' || state === 'LATE' || state === 'LATE_CONFIRMED'
}

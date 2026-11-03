import type { BookingStatus } from './booking.repository.js'

export type BookingDisplayStatus = 'UPCOMING' | 'WAITING' | 'LATE' | 'NO_SHOW' | 'CHECKED_IN' | 'CANCELLED'

export interface BookingTiming {
  displayStatus: BookingDisplayStatus
  minutesLate: number
  autoNoShowDue: boolean
}

export interface BookingTimingThresholds {
  upcomingMinutes: number
  lateAfterMinutes: number
  noShowAfterMinutes: number
}

export function deriveBookingTiming(
  status: BookingStatus,
  expectedAt: Date | string,
  now: Date,
  thresholds: BookingTimingThresholds = {
    upcomingMinutes: 10,
    lateAfterMinutes: 15,
    noShowAfterMinutes: 30,
  },
): BookingTiming {
  if (status !== 'BOOKED') {
    return {
      displayStatus: status,
      minutesLate: 0,
      autoNoShowDue: false,
    }
  }

  const expected = expectedAt instanceof Date ? expectedAt : new Date(expectedAt)
  const elapsedMilliseconds = now.getTime() - expected.getTime()
  const minutesLate = Math.max(0, Math.floor(elapsedMilliseconds / 60_000))
  if (elapsedMilliseconds < -thresholds.upcomingMinutes * 60_000) {
    // Keep the legacy enum stable: BOOKED is represented as UPCOMING until Phase 2
    // introduces the atomic floor projection with its dedicated displayState.
    return { displayStatus: 'UPCOMING', minutesLate: 0, autoNoShowDue: false }
  }
  if (elapsedMilliseconds >= thresholds.noShowAfterMinutes * 60_000) {
    return { displayStatus: 'NO_SHOW', minutesLate, autoNoShowDue: false }
  }
  if (elapsedMilliseconds > thresholds.lateAfterMinutes * 60_000) {
    return { displayStatus: 'LATE', minutesLate, autoNoShowDue: false }
  }
  return {
    displayStatus: 'UPCOMING',
    minutesLate,
    // Manual policy: crossing the display threshold never authorizes automatic closure.
    autoNoShowDue: false,
  }
}

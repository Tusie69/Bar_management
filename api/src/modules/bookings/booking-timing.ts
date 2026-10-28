import type { BookingStatus } from './booking.repository.js'

export type BookingDisplayStatus = 'UPCOMING' | 'WAITING' | 'LATE' | 'NO_SHOW' | 'CHECKED_IN' | 'CANCELLED'

export interface BookingTiming {
  displayStatus: BookingDisplayStatus
  minutesLate: number
  autoNoShowDue: boolean
}

export function deriveBookingTiming(
  status: BookingStatus,
  expectedAt: Date | string,
  now: Date,
  lateMinutes = 15,
  noShowMinutes = 30,
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
  if (elapsedMilliseconds < 0) {
    return { displayStatus: 'UPCOMING', minutesLate: 0, autoNoShowDue: false }
  }

  const minutesLate = Math.floor(elapsedMilliseconds / 60_000)
  return {
    displayStatus: minutesLate < lateMinutes ? 'WAITING' : 'LATE',
    minutesLate,
    // This flag only says the worker is due. It never presents a BOOKED row as NO_SHOW.
    autoNoShowDue: minutesLate >= noShowMinutes,
  }
}

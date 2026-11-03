export type TableDisplayState =
  | 'EMPTY'
  | 'BOOKED'
  | 'UPCOMING'
  | 'LATE'
  | 'LATE_CONFIRMED'
  | 'NO_SHOW'
  | 'IN_USE'
  | 'OUT_OF_SERVICE'

export type ArrivalPhase = 'SCHEDULED' | 'ARRIVING' | 'WAITING' | 'LATE' | 'LATE_CONFIRMED' | 'NO_SHOW' | null

export interface TableStateThresholds {
  upcomingMinutes: number
  lateAfterMinutes: number
  noShowAfterMinutes: number
}

export interface TableDisplayStateInput {
  catalogState: 'ACTIVE' | 'OUT_OF_SERVICE' | 'RETIRED'
  isSpare: boolean
  activeVisit: { active: boolean } | null
  activeHold?: { active: boolean } | null
  reservation: {
    status: 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW'
    expectedAt: Date | string
    businessDate: string
    lateConfirmedAt?: Date | string | null
  } | null
  businessDate: string
  now: Date
  thresholds: TableStateThresholds
}

export interface DerivedTableDisplayState {
  displayState: TableDisplayState
  arrivalPhase: ArrivalPhase
  minutesLate: number
  isSpare: boolean
}

function assertThresholds(thresholds: TableStateThresholds): void {
  if (
    !Number.isInteger(thresholds.upcomingMinutes)
    || thresholds.upcomingMinutes <= 0
    || !Number.isInteger(thresholds.lateAfterMinutes)
    || thresholds.lateAfterMinutes <= 0
    || !Number.isInteger(thresholds.noShowAfterMinutes)
    || thresholds.noShowAfterMinutes <= thresholds.lateAfterMinutes
  ) {
    throw new Error('TABLE_STATE_THRESHOLDS_INVALID')
  }
}

/**
 * Pure business-state engine. It never mutates reservation/allocation lifecycle data.
 * Group membership, selection and spare-table presentation are independent overlays.
 */
export function deriveTableDisplayState(input: TableDisplayStateInput): DerivedTableDisplayState {
  assertThresholds(input.thresholds)

  if (input.catalogState !== 'ACTIVE') {
    return { displayState: 'OUT_OF_SERVICE', arrivalPhase: null, minutesLate: 0, isSpare: input.isSpare }
  }
  if (input.activeVisit?.active) {
    return { displayState: 'IN_USE', arrivalPhase: null, minutesLate: 0, isSpare: input.isSpare }
  }
  if (input.activeHold?.active) {
    return { displayState: 'BOOKED', arrivalPhase: null, minutesLate: 0, isSpare: input.isSpare }
  }

  const reservation = input.reservation
  if (!reservation || reservation.status !== 'BOOKED' || reservation.businessDate !== input.businessDate) {
    return { displayState: 'EMPTY', arrivalPhase: null, minutesLate: 0, isSpare: input.isSpare }
  }

  const expectedAt = reservation.expectedAt instanceof Date
    ? reservation.expectedAt
    : new Date(reservation.expectedAt)
  if (Number.isNaN(expectedAt.getTime()) || Number.isNaN(input.now.getTime())) {
    throw new Error('TABLE_STATE_TIMESTAMP_INVALID')
  }

  const elapsedMs = input.now.getTime() - expectedAt.getTime()
  const upcomingMs = input.thresholds.upcomingMinutes * 60_000
  const lateAfterMs = input.thresholds.lateAfterMinutes * 60_000
  const noShowAfterMs = input.thresholds.noShowAfterMinutes * 60_000
  const minutesLate = Math.max(0, Math.floor(elapsedMs / 60_000))

  if (elapsedMs < -upcomingMs) {
    return { displayState: 'BOOKED', arrivalPhase: 'SCHEDULED', minutesLate: 0, isSpare: input.isSpare }
  }
  if (elapsedMs >= noShowAfterMs) {
    // TU-12 Option A: the no-show threshold always wins over a prior late confirmation.
    return { displayState: 'NO_SHOW', arrivalPhase: 'NO_SHOW', minutesLate, isSpare: input.isSpare }
  }
  if (reservation.lateConfirmedAt && elapsedMs >= 0) {
    return {
      displayState: 'LATE_CONFIRMED',
      arrivalPhase: 'LATE_CONFIRMED',
      minutesLate,
      isSpare: input.isSpare,
    }
  }
  if (elapsedMs > lateAfterMs) {
    return { displayState: 'LATE', arrivalPhase: 'LATE', minutesLate, isSpare: input.isSpare }
  }
  return {
    displayState: 'UPCOMING',
    arrivalPhase: elapsedMs <= 0 ? 'ARRIVING' : 'WAITING',
    minutesLate,
    isSpare: input.isSpare,
  }
}

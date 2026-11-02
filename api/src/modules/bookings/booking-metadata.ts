import { AppError } from '../../errors/app-error.js'

export type BookingClassification = 'RETURNING' | 'NEW' | 'UNCLASSIFIED'
export type GuestType = 'REGULAR' | 'NEW'

export function guestTypeFrom(classification: BookingClassification | null): GuestType {
  return classification === 'RETURNING' ? 'REGULAR' : 'NEW'
}

export function resolveClassification(input: { guestType?: GuestType; classification?: BookingClassification }, fallback: BookingClassification = 'NEW'): BookingClassification {
  if (input.guestType !== undefined && input.guestType !== 'REGULAR' && input.guestType !== 'NEW') {
    throw new AppError(400, 'INVALID_GUEST_TYPE', 'Loại khách không hợp lệ.')
  }
  if (input.guestType !== undefined && input.classification !== undefined && guestTypeFrom(input.classification) !== input.guestType) {
    throw new AppError(400, 'CONFLICTING_GUEST_TYPE', 'Loại khách không khớp phân loại cũ.')
  }
  return input.classification ?? (input.guestType === undefined ? fallback : input.guestType === 'REGULAR' ? 'RETURNING' : 'NEW')
}

import { AppError } from '../../errors/app-error.js'

export type BookingClassification = 'RETURNING' | 'NEW' | 'UNCLASSIFIED'
export type GuestType = 'REGULAR' | 'NEW'

export function guestTypeFrom(classification: BookingClassification | null): GuestType | null {
  if (classification === 'RETURNING') return 'REGULAR'
  if (classification === 'NEW') return 'NEW'
  return null
}

export function resolveBookingMetadata(
  input: { guestType?: GuestType | null; classification?: BookingClassification },
  fallback: BookingClassification = 'UNCLASSIFIED',
): { classification: BookingClassification; guestType: GuestType | null } {
  if (input.guestType !== undefined && input.guestType !== null && input.guestType !== 'REGULAR' && input.guestType !== 'NEW') {
    throw new AppError(400, 'INVALID_GUEST_TYPE', 'Loại khách không hợp lệ.')
  }
  const classification = input.classification
    ?? (input.guestType === 'REGULAR' ? 'RETURNING' : input.guestType === 'NEW' ? 'NEW' : fallback)
  const derived = guestTypeFrom(classification)
  if (input.guestType !== undefined && input.guestType !== derived) {
    throw new AppError(400, 'CONFLICTING_GUEST_TYPE', 'Loại khách không khớp phân loại hiện tại.')
  }
  return { classification, guestType: derived }
}

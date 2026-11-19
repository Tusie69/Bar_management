import { CANCEL_REASONS, type BookingCancelReason } from "@/domain/enums"
import { NOTE_PHONE_ERROR } from "@/lib/text"
import { noteHasNormalizedPhoneNumber } from "./note-phone-privacy"

export const CANCEL_NOTE_MAX_LENGTH = 300
export const CANCEL_NOTE_TOO_LONG_ERROR = "Lý do hủy không được vượt quá 300 ký tự."

export const DEFAULT_CANCEL_REASON: BookingCancelReason = CANCEL_REASONS[0]?.value ?? "CUSTOMER_REQUEST"

export interface CancelBookingValidation {
  trimmedNote: string
  hasPhone: boolean
  tooLong: boolean
  missingRequiredNote: boolean
  error: string | null
  canSubmit: boolean
}

/** Validates cancel reason and optional note using the same rules as POST /bookings/:id/cancel. */
export function validateCancelBookingInput(reason: BookingCancelReason, note: string): CancelBookingValidation {
  const trimmedNote = note.trim()
  const hasPhone = noteHasNormalizedPhoneNumber(note)
  const tooLong = trimmedNote.length > CANCEL_NOTE_MAX_LENGTH
  const missingRequiredNote = reason === "OTHER" && trimmedNote.length === 0

  let error: string | null = null
  if (hasPhone) error = NOTE_PHONE_ERROR
  else if (tooLong) error = CANCEL_NOTE_TOO_LONG_ERROR

  return {
    trimmedNote,
    hasPhone,
    tooLong,
    missingRequiredNote,
    error,
    canSubmit: !hasPhone && !tooLong && !missingRequiredNote,
  }
}

/**
 * Produces validated arguments for `api.cancelReservation(id, version, reason, note)`
 * matching desktop `ConfirmAction` and `http-api.ts` payload semantics (`note || reason`).
 */
export function buildCancelBookingArgs(
  reason: BookingCancelReason,
  note: string,
): { reason: BookingCancelReason; note: string } {
  const validation = validateCancelBookingInput(reason, note)
  if (validation.error) throw new Error(validation.error)
  if (validation.missingRequiredNote) throw new Error("Ghi rõ lý do khác.")
  return { reason, note: validation.trimmedNote }
}

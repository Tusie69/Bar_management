import { noteHasPhoneNumber } from "@/lib/text"

/**
 * Checks whether a cancel note contains a Vietnamese local, +84, or 0084 phone number.
 * Mirrors the API rule (`assertNoteHasNoPhoneNumber` via `noteHasPhoneNumber`) on either
 * the trimmed raw note or its NFKC form (which folds full-width digits to ASCII).
 */
export function noteHasNormalizedPhoneNumber(note: string): boolean {
  const trimmed = note.trim()
  if (!trimmed) return false
  if (noteHasPhoneNumber(trimmed)) return true
  const nfkc = trimmed.normalize("NFKC")
  return nfkc !== trimmed && noteHasPhoneNumber(nfkc)
}

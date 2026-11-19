import { noteHasPhoneNumber } from "@/lib/text"

const UNICODE_DECIMAL_DIGIT_RE = /\p{Nd}/gu
const SINGLE_UNICODE_DECIMAL_DIGIT_RE = /^\p{Nd}$/u
const UNICODE_DASH_LOOKALIKE_RE = /[\u00AD\u2010-\u2015\u2043\u2212\uFE58\uFE63\uFF0D]/g
const UNICODE_SPACE_LOOKALIKE_RE = /[\u00A0\u1680\u180E\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g
const UNICODE_DOT_LOOKALIKE_RE = /[\u00B7\u2024\u2027\u3002\uFE52\uFF0E]/g

function foldUnicodeDecimalDigit(ch: string): string {
  const cp = ch.codePointAt(0)
  if (cp === undefined || (cp >= 0x30 && cp <= 0x39)) return ch
  let offset = 0
  while (cp - offset > 0 && SINGLE_UNICODE_DECIMAL_DIGIT_RE.test(String.fromCodePoint(cp - offset - 1))) {
    offset++
  }
  return String(offset % 10)
}

/**
 * Normalizes Unicode compatibility forms, Unicode decimal digits (\p{Nd}),
 * and dash/space/dot look-alikes before running the local/+84/0084 phone check.
 * Kept local to mobile reception cancel-note validation until consolidated.
 */
export function normalizeNoteForPhoneCheck(note: string): string {
  return note
    .normalize("NFKC")
    .replace(UNICODE_DECIMAL_DIGIT_RE, foldUnicodeDecimalDigit)
    .replace(UNICODE_DASH_LOOKALIKE_RE, "-")
    .replace(UNICODE_SPACE_LOOKALIKE_RE, " ")
    .replace(UNICODE_DOT_LOOKALIKE_RE, ".")
}

/**
 * Checks whether a note contains a Vietnamese local, +84, or 0084 phone number
 * after normalizing Unicode digits and separator look-alikes.
 */
export function noteHasNormalizedPhoneNumber(note: string): boolean {
  return noteHasPhoneNumber(normalizeNoteForPhoneCheck(note))
}

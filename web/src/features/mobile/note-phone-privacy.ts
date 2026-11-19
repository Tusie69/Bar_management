import { noteHasPhoneNumber } from "@/lib/text"

const UNICODE_DECIMAL_DIGIT_RE = /\p{Nd}/gu
const SINGLE_UNICODE_DECIMAL_DIGIT_RE = /^\p{Nd}$/u
const UNICODE_DASH_LOOKALIKE_RE = /[\u00AD\u2010-\u2015\u2043\u2212\uFE58\uFE63\uFF0D]/g
const UNICODE_SPACE_LOOKALIKE_RE = /[\u00A0\u1680\u180E\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g
const UNICODE_DOT_LOOKALIKE_RE = /[\u00B7\u2024\u2027\u3002\uFE52\uFF0E]/g

const FIELD_PREFIX = String.raw`(?:^[\s()\-]*|[^\d\s.()\-]\.?[\s()\-]*)`
const TIME_EXPR = String.raw`(?<!\d)(?<!\d\.)(?:[01]?\d|2[0-3])[.:][0-5]\d(?!\d)(?!\.\d)`
const TIME_RANGE = String.raw`${TIME_EXPR}\s*-\s*${TIME_EXPR}`
const LABELLED_TIME = String.raw`(?<![\p{L}\d])(?:lúc|khung|giờ|ca|từ|đến|tới|sang|hẹn)\s+${TIME_EXPR}`
const LABELLED_TIME_RANGE = String.raw`(?<![\p{L}\d])(?:lúc|khung|giờ|ca|từ|đến|tới|sang|hẹn)\s+${TIME_RANGE}`
const PARTY_SIZE = String.raw`(?<![\d.])\d{1,3}(?:\s*-\s*\d{1,3})?\s*(?:khách|người|pax|bạn|bé|trẻ)(?![\p{L}\d])`
const TABLE_CODE = String.raw`(?<![\p{L}\d])(?:(?:bàn|phòng|khu|tầng|lầu)\s+(?:[\p{L}]+\s*)?\d{1,3}(?:\s*[-+/&]\s*(?:[\p{L}]+\s*)?\d{1,3})?|[a-z]{1,3}\d{1,2})(?![\p{L}\d])`
const LABELLED_DATE = String.raw`(?<![\p{L}\d])(?:ngày|hôm)\s+(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])(?:[./-](?:20\d{2}|\d{2}))?(?!\d)(?!\.\d)`
const FIELD_GAP = String.raw`[\s.()\-]*`

const SEPARABLE_FIELD_PAIRS: readonly RegExp[] = [
  new RegExp(
    String.raw`(${FIELD_PREFIX}${TABLE_CODE})(${FIELD_GAP})(?=${TIME_RANGE}|${LABELLED_TIME}|${PARTY_SIZE}|${LABELLED_DATE})`,
    "giu",
  ),
  new RegExp(
    String.raw`(${FIELD_PREFIX}${LABELLED_DATE})(${FIELD_GAP})(?=${TIME_RANGE}|${LABELLED_TIME}|${PARTY_SIZE}|${TABLE_CODE})`,
    "giu",
  ),
  new RegExp(String.raw`(${FIELD_PREFIX}${LABELLED_TIME_RANGE})(${FIELD_GAP})(?=${TIME_RANGE})`, "giu"),
  new RegExp(
    String.raw`(${FIELD_PREFIX}(?:${TIME_RANGE}|${LABELLED_TIME}))(${FIELD_GAP})(?=${PARTY_SIZE}|${TABLE_CODE}|${LABELLED_DATE})`,
    "giu",
  ),
]

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
 * Isolates adjacent bounded, labelled fields (table codes, dates, time ranges, party sizes)
 * in the normalized string so their digits cannot coalesce into a false 10-digit match.
 */
function separateBoundedLabelledFields(normalized: string): string {
  let result = normalized
  for (const pattern of SEPARABLE_FIELD_PAIRS) {
    result = result.replace(pattern, "$1, $2")
  }
  return result
}

/**
 * Checks whether a note contains a Vietnamese local, +84, or 0084 phone number.
 * Runs the raw API-equivalent check on the untouched trimmed note first so Unicode
 * folding cannot mask boundary digits/plus signs, then checks the normalized text
 * with bounded, labelled booking fields treated as separate fields.
 */
export function noteHasNormalizedPhoneNumber(note: string): boolean {
  const trimmed = note.trim()
  if (noteHasPhoneNumber(trimmed)) return true
  const normalized = normalizeNoteForPhoneCheck(trimmed)
  return noteHasPhoneNumber(separateBoundedLabelledFields(normalized))
}

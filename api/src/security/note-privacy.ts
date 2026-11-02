import { AppError } from '../errors/app-error.js'

const separator = String.raw`[\s.()\-]*`
const localPhone = new RegExp(String.raw`(?<!\d)0(?:${separator}\d){9}(?!\d)`, 'g')
const internationalPhone = new RegExp(String.raw`(?<![\d+])(?:\+84|0084)(?:${separator}\d){9}(?!\d)`, 'g')

function digits(value: string): string {
  return value.replace(/\D/g, '')
}

function replacement(value: string): string {
  const compact = digits(value)
  return `•••• ••• ${compact.slice(-3)}`
}

export function noteContainsPhoneNumber(note: string): boolean {
  localPhone.lastIndex = 0
  internationalPhone.lastIndex = 0
  return localPhone.test(note) || internationalPhone.test(note)
}

export function assertNoteHasNoPhoneNumber(note: string | null | undefined): void {
  if (note && noteContainsPhoneNumber(note)) {
    throw new AppError(422, 'PHONE_IN_NOTE_FORBIDDEN', 'Không ghi số điện thoại vào ghi chú.')
  }
}

/** Historical notes stay unchanged in MySQL; every API view always receives this redacted copy. */
export function redactPhoneNumbersInNote(note: string | null | undefined): string | null {
  if (!note) return null
  internationalPhone.lastIndex = 0
  localPhone.lastIndex = 0
  return note.replace(internationalPhone, replacement).replace(localPhone, replacement)
}

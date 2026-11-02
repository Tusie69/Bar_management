import { describe, expect, it } from 'vitest'

import {
  assertNoteHasNoPhoneNumber,
  noteContainsPhoneNumber,
  redactPhoneNumbersInNote,
} from '../src/security/note-privacy.js'

describe('note phone privacy', () => {
  it.each([
    '0987654321',
    '0987 654 321',
    '0987.654.321',
    '0987-654-321',
    '(0987) 654-321',
    '+84 987 654 321',
    '0084 987 654 321',
    'Gọi khách theo số 0987 654 321 giúp em',
  ])('detects %s', (value) => {
    expect(noteContainsPhoneNumber(value)).toBe(true)
    expect(() => assertNoteHasNoPhoneNumber(value)).toThrowError(expect.objectContaining({ code: 'PHONE_IN_NOTE_FORBIDDEN' }))
  })

  it.each([
    'Ngày 20261029',
    'Mã đơn 12345678',
    'Bàn A12 lúc 21:30',
    'Khách đi 4 người, cọc 500000',
    'Mã 1234567890',
  ])('does not treat %s as a phone number', (value) => {
    expect(noteContainsPhoneNumber(value)).toBe(false)
  })

  it('redacts every historical phone candidate without changing the stored source string', () => {
    const source = 'Gọi 0987 654 321 hoặc +84 912 345 678'
    expect(redactPhoneNumbersInNote(source)).toBe('Gọi •••• ••• 321 hoặc •••• ••• 678')
    expect(source).toBe('Gọi 0987 654 321 hoặc +84 912 345 678')
  })
})

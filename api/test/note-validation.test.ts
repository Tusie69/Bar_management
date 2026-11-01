import { describe, expect, it } from 'vitest'

import { assertNoPhoneInNote, containsPhoneNumber } from '../src/modules/bookings/note-validation.js'

describe('FX-03 phone number in note', () => {
  it.each([
    'khách VIP 0987654321',
    'gọi lại 0987 654 321 trước 20h',
    'SĐT 0987.654.321',
    'số 0987-654-321',
    'liên hệ (098) 7654321',
    '+84 987 654 321',
    '84987654321',
    '02838123456',
  ])('detects a phone number in "%s"', (note) => {
    expect(containsPhoneNumber(note)).toBe(true)
    expect(() => assertNoPhoneInNote(note)).toThrowError(expect.objectContaining({
      status: 422,
      code: 'PHONE_IN_NOTE_FORBIDDEN',
      message: 'Không ghi số điện thoại vào ghi chú.',
    }))
  })

  it.each([
    'Khách VIP, sinh nhật 30 tuổi',
    'đến 21:30, 6 người, cần ghế trẻ em',
    'bàn gần sân khấu, mã giảm giá 1234567',
    'đặt cọc 500.000đ',
    '',
  ])('keeps a normal note "%s"', (note) => {
    expect(containsPhoneNumber(note)).toBe(false)
    expect(() => assertNoPhoneInNote(note)).not.toThrow()
  })

  it('accepts an absent note', () => {
    expect(() => assertNoPhoneInNote(undefined)).not.toThrow()
  })
})

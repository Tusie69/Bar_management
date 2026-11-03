import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { AppError } from '../src/errors/app-error.js'
import {
  normalizePhoneNumber,
  protectPhoneNumber,
  revealPhoneNumber,
  type PhoneKeyRing,
} from '../src/modules/bookings/phone-security.js'

function keys(): PhoneKeyRing {
  return {
    activeEncryptionKeyId: 7,
    encryptionKeys: new Map([[7, randomBytes(32)]]),
    activeHmacKeyId: 9,
    hmacKeys: new Map([[9, randomBytes(32)]]),
  }
}

describe('booking phone security', () => {
  it.each([
    ['0987 654 321', '+84987654321'],
    ['0987.654.321', '+84987654321'],
    ['(0987) 654-321', '+84987654321'],
  ])('normalizes valid local input %s for encrypted storage', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)',
    '123456789',
    '1234567890',
    '+84987654321',
    '0084987654321',
    '+12025550123',
    '09876543210',
    '0987abc654321',
  ])('rejects non-local or non-10-digit input %s', (input) => {
    expect(() => normalizePhoneNumber(input)).toThrow(AppError)
  })

  it('encrypts with a random nonce, HMACs separately, and decrypts by key id', () => {
    const ring = keys()
    const first = protectPhoneNumber('0987654321', ring)
    const second = protectPhoneNumber('0987654321', ring)
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false)
    expect(first.hmac.equals(second.hmac)).toBe(true)
    expect(first.last3).toBe('321')
    expect(revealPhoneNumber(first.ciphertext, first.encryptionKeyId, ring)).toBe('+84987654321')
  })

  it('fails closed when an active encryption or HMAC key is unavailable', () => {
    const ring = keys()
    expect(() => protectPhoneNumber('0987654321', { ...ring, encryptionKeys: new Map() }))
      .toThrowError(/chưa được cấu hình/)
    expect(() => protectPhoneNumber('0987654321', { ...ring, hmacKeys: new Map() }))
      .toThrowError(/chưa được cấu hình/)
  })

  it('fails closed for a wrong key and an invalid authentication tag', () => {
    const ring = keys()
    const protectedPhone = protectPhoneNumber('0987654321', ring)
    expect(() => revealPhoneNumber(protectedPhone.ciphertext, 99, ring)).toThrowError(/Không thể mở/)
    const tampered = Buffer.from(protectedPhone.ciphertext)
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1
    expect(() => revealPhoneNumber(tampered, protectedPhone.encryptionKeyId, ring)).toThrowError(/Không thể mở/)
  })
})


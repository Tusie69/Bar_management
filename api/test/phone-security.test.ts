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
    ['+84 (987) 654-321', '+84987654321'],
    ['0084987654321', '+84987654321'],
    ['+12025550123', '+12025550123'],
  ])('normalizes %s without guessing unknown country codes', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected)
  })

  it.each(['javascript:alert(1)', '123456789', '+84123456789', '+84abc987654321'])('rejects %s', (input) => {
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

  it('fails closed for a wrong key and an invalid authentication tag', () => {
    const ring = keys()
    const protectedPhone = protectPhoneNumber('0987654321', ring)
    expect(() => revealPhoneNumber(protectedPhone.ciphertext, 99, ring)).toThrowError(/Không thể mở/)
    const tampered = Buffer.from(protectedPhone.ciphertext)
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1
    expect(() => revealPhoneNumber(tampered, protectedPhone.encryptionKeyId, ring)).toThrowError(/Không thể mở/)
  })
})


import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

import { AppError } from '../../errors/app-error.js'

const vietnameseSubscriber = /^[35789]\d{8}$/
const e164 = /^\+[1-9]\d{7,14}$/

export interface PhoneKeyRing {
  activeEncryptionKeyId: number
  encryptionKeys: ReadonlyMap<number, Buffer>
  activeHmacKeyId: number
  hmacKeys: ReadonlyMap<number, Buffer>
}

export interface ProtectedPhone {
  ciphertext: Buffer
  encryptionKeyId: number
  hmac: Buffer
  hmacKeyId: number
  last3: string
}

export function normalizePhoneNumber(input: string): string {
  const trimmed = input.trim()
  if (!trimmed || /[^+\d\s().-]/.test(trimmed)) {
    throw new AppError(422, 'INVALID_PHONE_NUMBER', 'Số điện thoại không hợp lệ.')
  }
  let compact = trimmed.replace(/[\s().-]/g, '')
  if (compact.startsWith('0084')) compact = `+84${compact.slice(4)}`
  else if (compact.startsWith('0')) compact = `+84${compact.slice(1)}`

  if (!e164.test(compact)) throw new AppError(422, 'INVALID_PHONE_NUMBER', 'Số điện thoại không hợp lệ.')
  if (compact.startsWith('+84') && !vietnameseSubscriber.test(compact.slice(3))) {
    throw new AppError(422, 'INVALID_PHONE_NUMBER', 'Số điện thoại Việt Nam không hợp lệ.')
  }
  return compact
}

export function protectPhoneNumber(phoneNumber: string, keys: PhoneKeyRing): ProtectedPhone {
  const normalized = normalizePhoneNumber(phoneNumber)
  const encryptionKey = keys.encryptionKeys.get(keys.activeEncryptionKeyId)
  const hmacKey = keys.hmacKeys.get(keys.activeHmacKeyId)
  if (!encryptionKey || !hmacKey) throw new AppError(503, 'PHONE_KEYS_UNAVAILABLE', 'Chức năng số điện thoại chưa được cấu hình.')
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce)
  const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()])
  return {
    ciphertext: Buffer.concat([nonce, encrypted, cipher.getAuthTag()]),
    encryptionKeyId: keys.activeEncryptionKeyId,
    hmac: createHmac('sha256', hmacKey).update(normalized, 'utf8').digest(),
    hmacKeyId: keys.activeHmacKeyId,
    last3: normalized.slice(-3),
  }
}

export function revealPhoneNumber(ciphertext: Buffer, keyId: number, keys: PhoneKeyRing): string {
  const key = keys.encryptionKeys.get(keyId)
  if (!key) throw new AppError(500, 'PHONE_KEY_NOT_FOUND', 'Không thể mở số điện thoại đã lưu.')
  if (ciphertext.length < 29) throw new AppError(500, 'PHONE_CIPHERTEXT_INVALID', 'Không thể mở số điện thoại đã lưu.')
  try {
    const nonce = ciphertext.subarray(0, 12)
    const tag = ciphertext.subarray(ciphertext.length - 16)
    const encrypted = ciphertext.subarray(12, ciphertext.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    return normalizePhoneNumber(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'))
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(500, 'PHONE_DECRYPTION_FAILED', 'Không thể mở số điện thoại đã lưu.')
  }
}


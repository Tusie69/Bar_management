import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

const keyLength = 64
const cost = 65_536
const blockSize = 8
const parallelization = 1
const maxmem = 128 * 1024 * 1024
const dummySalt = randomBytes(16)

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem,
    }, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await derive(password, salt)
  return `$scrypt$v=1$ln=16,r=8,p=1$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split('$')
  if (
    parts.length !== 6
    || parts[1] !== 'scrypt'
    || parts[2] !== 'v=1'
    || parts[3] !== 'ln=16,r=8,p=1'
  ) {
    await derive(password, dummySalt)
    return false
  }
  try {
    const salt = Buffer.from(parts[4] ?? '', 'base64url')
    const expected = Buffer.from(parts[5] ?? '', 'base64url')
    if (salt.length !== 16 || expected.length !== keyLength) {
      await derive(password, dummySalt)
      return false
    }
    const actual = await derive(password, salt)
    return timingSafeEqual(actual, expected)
  } catch {
    await derive(password, dummySalt)
    return false
  }
}

/**
 * TU-34 — mật khẩu tạm cho tài khoản mới và cho reset.
 *
 * Sinh ở server chứ không để người quản trị tự nghĩ: mật khẩu do người nghĩ
 * ra trong lúc tạo tài khoản giữa ca luôn là "21gam2026". Bảng chữ bỏ các ký
 * tự dễ đọc nhầm (0/O, 1/l/I) vì chuỗi này được đọc to qua điện thoại hoặc
 * chép tay cho nhân viên. Chỉ hiện một lần, không bao giờ ghi log.
 */
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const TEMP_PASSWORD_LENGTH = 16

export function generateTemporaryPassword(): string {
  const alphabet = TEMP_PASSWORD_ALPHABET
  // Rejection sampling: lấy modulo thẳng trên byte ngẫu nhiên sẽ lệch về
  // những ký tự đầu bảng chữ.
  const limit = Math.floor(256 / alphabet.length) * alphabet.length
  let out = ''
  while (out.length < TEMP_PASSWORD_LENGTH) {
    for (const byte of randomBytes(TEMP_PASSWORD_LENGTH)) {
      if (byte >= limit) continue
      out += alphabet[byte % alphabet.length]
      if (out.length === TEMP_PASSWORD_LENGTH) break
    }
  }
  return out
}

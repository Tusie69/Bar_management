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

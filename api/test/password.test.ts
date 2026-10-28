import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from '../src/auth/password.js'

describe('scrypt password storage', () => {
  it('uses a random salt and verifies only the matching password', async () => {
    const first = await hashPassword('A-secure-test-password')
    const second = await hashPassword('A-secure-test-password')

    expect(first).toMatch(/^\$scrypt\$v=1\$ln=16,r=8,p=1\$/)
    expect(second).not.toBe(first)
    await expect(verifyPassword('A-secure-test-password', first)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', first)).resolves.toBe(false)
  })

  it.each(['plain text', '!', '!DEMO_NO_LOGIN', '$scrypt$invalid'])('rejects legacy or malformed hash %s', async (stored) => {
    await expect(verifyPassword('anything', stored)).resolves.toBe(false)
  })
})

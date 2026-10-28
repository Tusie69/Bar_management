import { describe, expect, it } from 'vitest'

import {
  createCsrfToken,
  createSessionToken,
  hashSessionToken,
  verifyCsrfToken,
} from '../src/auth/session-security.js'

describe('session and CSRF token security', () => {
  it('creates opaque random session tokens and stores a fixed-length digest', () => {
    const first = createSessionToken()
    const second = createSessionToken()
    expect(first).not.toBe(second)
    expect(hashSessionToken(first)).toHaveLength(32)
    expect(hashSessionToken(first).toString('hex')).not.toContain(first)
  })

  it('binds each CSRF token to one session token', () => {
    const firstSession = createSessionToken()
    const secondSession = createSessionToken()
    const csrf = createCsrfToken(firstSession)
    expect(verifyCsrfToken(firstSession, csrf)).toBe(true)
    expect(verifyCsrfToken(secondSession, csrf)).toBe(false)
    expect(verifyCsrfToken(firstSession, `${csrf}x`)).toBe(false)
  })
})

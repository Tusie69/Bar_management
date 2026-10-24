import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { CookieOptions, Request, Response } from 'express'

import { env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'

const developmentCsrfSecret = randomBytes(32)

function csrfSecret(): Buffer {
  if (env.session.csrfSecret) return Buffer.from(env.session.csrfSecret, 'utf8')
  if (env.nodeEnv === 'production') {
    throw new Error('Thiếu biến môi trường SESSION_CSRF_SECRET trong production')
  }
  return developmentCsrfSecret
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/api/v1',
    maxAge: env.session.ttlHours * 60 * 60 * 1000,
  }
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function createCsrfToken(sessionToken: string): string {
  return createHmac('sha256', csrfSecret()).update(sessionToken, 'utf8').digest('base64url')
}

export function verifyCsrfToken(sessionToken: string, suppliedToken: string): boolean {
  const expected = Buffer.from(createCsrfToken(sessionToken), 'utf8')
  const supplied = Buffer.from(suppliedToken, 'utf8')
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

export function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.cookie
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    if (name !== env.session.cookieName) continue
    const value = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return null
    }
  }
  return null
}

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(env.session.cookieName, token, cookieOptions())
}

export function clearSessionCookie(response: Response): void {
  const options = cookieOptions()
  delete options.maxAge
  response.clearCookie(env.session.cookieName, options)
}

export function requireCsrfHeader(request: Request, sessionToken: string): void {
  const supplied = request.header('x-csrf-token')
  if (!supplied || !verifyCsrfToken(sessionToken, supplied)) {
    throw new AppError(403, 'CSRF_TOKEN_INVALID', 'Phiên xác nhận thao tác không hợp lệ. Vui lòng tải lại.')
  }
}

import { Router } from 'express'

import { AppError } from '../errors/app-error.js'
import { attachAuthentication, getAuthentication, requireAuthenticatedActor } from './authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection } from './auth.middleware.js'
import { listPermissions, login, logoutSession } from './auth.service.js'
import { clearSessionCookie, createCsrfToken, setSessionCookie } from './session-security.js'

export const authRouter = Router()

const loginWindowMs = 15 * 60 * 1000
const maxLoginAttempts = 5
const attempts = new Map<string, { count: number; resetsAt: number }>()

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu gửi lên không hợp lệ.')
  }
  return value as Record<string, unknown>
}

function attemptKey(ip: string | undefined, username: string): string {
  return `${ip ?? 'unknown'}:${username.toLocaleLowerCase('en-US')}`
}

function assertLoginAllowed(key: string): void {
  const now = Date.now()
  const current = attempts.get(key)
  if (!current || current.resetsAt <= now) {
    attempts.set(key, { count: 0, resetsAt: now + loginWindowMs })
    return
  }
  if (current.count >= maxLoginAttempts) {
    throw new AppError(429, 'LOGIN_RATE_LIMITED', 'Đăng nhập thất bại quá nhiều lần. Vui lòng thử lại sau.')
  }
}

function recordFailure(key: string): void {
  const current = attempts.get(key)
  const now = Date.now()
  if (!current || current.resetsAt <= now) {
    attempts.set(key, { count: 1, resetsAt: now + loginWindowMs })
    return
  }
  current.count += 1
}

async function authPayload(request: Parameters<typeof getAuthentication>[0]) {
  const authentication = getAuthentication(request)
  if (!authentication) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  const permissions = await listPermissions(authentication.actor)
  return {
    user: {
      id: authentication.actor.userId,
      username: authentication.username,
      displayName: authentication.displayName,
      organizationId: authentication.actor.organizationId,
      venueId: authentication.actor.venueId,
    },
    permissions,
    csrfToken: createCsrfToken(authentication.sessionToken),
  }
}

authRouter.post('/login', async (request, response) => {
  const body = objectBody(request.body)
  if (typeof body.username !== 'string' || !body.username.trim() || body.username.length > 80) {
    throw new AppError(400, 'INVALID_USERNAME', 'Tên đăng nhập không hợp lệ.')
  }
  if (typeof body.password !== 'string' || !body.password || body.password.length > 1024) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Mật khẩu không hợp lệ.')
  }
  const username = body.username.trim()
  const key = attemptKey(request.ip, username)
  assertLoginAllowed(key)
  try {
    const result = await login(username, body.password, request.header('user-agent'))
    attempts.delete(key)
    setSessionCookie(response, result.authentication.sessionToken)
    attachAuthentication(request, result.authentication)
    response.json({
      ...(await authPayload(request)),
      expiresAt: result.expiresAt,
    })
  } catch (error) {
    if (error instanceof AppError && error.code === 'INVALID_CREDENTIALS') recordFailure(key)
    throw error
  }
})

authRouter.get('/me', requireAuthentication, async (request, response) => {
  response.json(await authPayload(request))
})

authRouter.post('/logout', requireAuthentication, requireCsrfProtection, async (request, response) => {
  await logoutSession(requireAuthenticatedActor(request))
  clearSessionCookie(response)
  response.status(204).end()
})

import { Router } from 'express'

import { AppError } from '../errors/app-error.js'
import { isAuthPortal } from './auth-portal.js'
import { attachAuthentication, getAuthentication, requireAuthenticatedActor } from './authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from './auth.middleware.js'
import { getAdminAccessLevel, listPermissions, listRoles, login, logoutSession } from './auth.service.js'
import { DEVICE_ID_HEADER } from './device-identity.js'
import { forceLogoutSession, listActiveSessions } from './session-directory.js'
import { clearSessionCookie, createCsrfToken, setSessionCookie } from './session-security.js'
import { recordAuthAudit } from './auth-audit.js'

export const authRouter: Router = Router()

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
  const [permissions, roles, accessLevel] = await Promise.all([
    listPermissions(authentication.actor),
    listRoles(authentication.actor),
    getAdminAccessLevel(authentication.actor),
  ])
  return {
    user: {
      id: authentication.actor.userId,
      username: authentication.username,
      displayName: authentication.displayName,
      organizationId: authentication.actor.organizationId,
      venueId: authentication.actor.venueId,
      roles,
      accessLevel,
    },
    permissions,
    csrfToken: createCsrfToken(authentication.sessionToken),
    portal: authentication.portal,
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
  if (!isAuthPortal(body.portal)) {
    await recordAuthAudit({ action: 'AUTH_LOGIN_FAILED', reasonCode: 'INVALID_PORTAL' })
    throw new AppError(400, 'INVALID_PORTAL', 'Cổng đăng nhập không hợp lệ.')
  }
  const username = body.username.trim()
  const key = attemptKey(request.ip, username)
  try {
    assertLoginAllowed(key)
  } catch (error) {
    if (error instanceof AppError && error.code === 'LOGIN_RATE_LIMITED') {
      await recordAuthAudit({ action: 'AUTH_LOGIN_FAILED', portal: body.portal, reasonCode: error.code })
    }
    throw error
  }
  try {
    const result = await login(
      username,
      body.password,
      body.portal,
      request.header('user-agent'),
      request.header(DEVICE_ID_HEADER),
    )
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

/**
 * TU-33 — các phiên đang hoạt động trong phạm vi organization.
 *
 * Quyền `session.read` tách riêng khỏi `session.revoke`: xem danh sách là chẩn
 * đoán, buộc đăng xuất là thao tác đẩy người ra khỏi hệ thống.
 *
 * Không trả token, không trả digest của token.
 */
authRouter.get(
  '/sessions',
  requireAuthentication,
  requirePermission('session.read'),
  async (request, response) => {
    const sessions = await listActiveSessions(requireAuthenticatedActor(request))
    response.set('Cache-Control', 'no-store')
    response.json({ sessions })
  },
)

/**
 * TU-33 — buộc đăng xuất một phiên.
 *
 * Thẩm quyền chi tiết nằm trong repository: OWNER không bị ai buộc đăng xuất,
 * ADMIN chỉ chạm được tài khoản nhân viên, và không ai buộc đăng xuất chính
 * mình qua đường này.
 */
authRouter.post(
  '/sessions/:id/revoke',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('session.revoke'),
  async (request, response) => {
    const sessionId = Number(request.params.id)
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      throw new AppError(400, 'INVALID_SESSION_ID', 'Mã phiên không hợp lệ.')
    }
    response.json(await forceLogoutSession(requireAuthenticatedActor(request), sessionId))
  },
)

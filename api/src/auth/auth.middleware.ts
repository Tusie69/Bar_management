import type { RequestHandler } from 'express'

import { AppError } from '../errors/app-error.js'
import { env } from '../config/env.js'
import {
  attachAuthentication,
  getAuthentication,
  requireAuthenticatedActor,
} from './authenticated-actor.js'
import { authenticateSession, hasPermission } from './auth.service.js'
import { readSessionCookie, requireCsrfHeader } from './session-security.js'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

export const requireTrustedOrigin: RequestHandler = (request, _response, next) => {
  if (safeMethods.has(request.method)) {
    next()
    return
  }
  const origin = request.header('origin')
  if (origin !== env.webOrigin) {
    throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Nguồn gửi yêu cầu không được phép.')
  }
  next()
}

export const requireAuthentication: RequestHandler = async (request, _response, next) => {
  const token = readSessionCookie(request)
  if (!token) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  const authentication = await authenticateSession(token)
  if (!authentication) throw new AppError(401, 'SESSION_INVALID', 'Phiên đăng nhập đã hết hạn hoặc bị thu hồi.')
  attachAuthentication(request, authentication)
  next()
}

export const requireCsrfProtection: RequestHandler = (request, _response, next) => {
  const authentication = getAuthentication(request)
  if (!authentication) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  requireCsrfHeader(request, authentication.sessionToken)
  next()
}

export function requirePermission(permissionCode: string): RequestHandler {
  return async (request, _response, next) => {
    const actor = requireAuthenticatedActor(request)
    if (!await hasPermission(actor, permissionCode)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Tài khoản không có quyền thực hiện thao tác này.')
    }
    next()
  }
}

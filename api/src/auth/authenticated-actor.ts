import type { Request } from 'express'

import { AppError } from '../errors/app-error.js'

export interface AuthenticatedActor {
  userId: number
  membershipId: number
  organizationId: number
  venueId: number
  authSessionId?: number
}

export interface AuthenticatedSession {
  actor: AuthenticatedActor
  username: string
  displayName: string
  sessionToken: string
}

interface RequestWithAuthentication extends Request {
  authentication?: AuthenticatedSession
}

export function attachAuthentication(request: Request, authentication: AuthenticatedSession): void {
  ;(request as RequestWithAuthentication).authentication = authentication
}

export function getAuthentication(request: Request): AuthenticatedSession | undefined {
  return (request as RequestWithAuthentication).authentication
}

/**
 * Authentication middleware must attach this context after verifying a server-side
 * session. Never populate it from user-controlled headers or request JSON.
 */
export function requireAuthenticatedActor(request: Request): AuthenticatedActor {
  const actor = getAuthentication(request)?.actor
  if (!actor) {
    throw new AppError(
      401,
      'AUTHENTICATION_REQUIRED',
      'Chức năng trả bàn chỉ hoạt động sau khi hệ thống đăng nhập được kích hoạt.',
    )
  }
  return actor
}

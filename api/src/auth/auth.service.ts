import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { env } from '../config/env.js'
import { databasePool } from '../database/pool.js'
import { AppError } from '../errors/app-error.js'
import type { AuthenticatedActor, AuthenticatedSession } from './authenticated-actor.js'
import { verifyPassword } from './password.js'
import { createSessionToken, hashSessionToken } from './session-security.js'

interface LoginRow extends RowDataPacket {
  user_id: number
  username: string
  display_name: string
  password_hash: string
  user_status: 'ACTIVE' | 'DISABLED'
  membership_id: number | null
  membership_status: 'ACTIVE' | 'SUSPENDED' | 'ENDED' | null
}

interface SessionRow extends RowDataPacket {
  session_id: number
  organization_id: number
  membership_id: number
  user_id: number
  username: string
  display_name: string
}

export interface LoginResult {
  authentication: AuthenticatedSession
  expiresAt: string
}

export async function login(username: string, password: string, deviceLabel?: string): Promise<LoginResult> {
  const [rows] = await databasePool.execute<LoginRow[]>(
    `SELECT u.id AS user_id, u.username, u.display_name, u.password_hash,
       u.status AS user_status, m.id AS membership_id, m.status AS membership_status
     FROM users AS u
     LEFT JOIN memberships AS m
       ON m.user_id = u.id AND m.organization_id = ?
     WHERE u.username = ?
     LIMIT 1`,
    [env.organizationId, username],
  )
  const user = rows[0]
  const passwordValid = await verifyPassword(password, user?.password_hash ?? '')
  if (
    !user
    || !passwordValid
    || user.user_status !== 'ACTIVE'
    || user.membership_id === null
    || user.membership_status !== 'ACTIVE'
  ) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không hợp lệ.')
  }

  const [venueRows] = await databasePool.execute<RowDataPacket[]>(
    `SELECT 1 FROM venues
     WHERE organization_id = ? AND id = ? AND status = 'ACTIVE'`,
    [env.organizationId, env.venueId],
  )
  if (!venueRows[0]) throw new AppError(403, 'VENUE_ACCESS_UNAVAILABLE', 'Địa điểm vận hành không khả dụng.')

  const token = createSessionToken()
  const expiresAt = new Date(Date.now() + env.session.ttlHours * 60 * 60 * 1000)
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO auth_sessions
      (organization_id, membership_id, user_id, token_hash, device_label, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      env.organizationId,
      user.membership_id,
      user.user_id,
      hashSessionToken(token),
      deviceLabel?.slice(0, 100) || null,
      expiresAt,
    ],
  )
  return {
    authentication: {
      actor: {
        userId: Number(user.user_id),
        membershipId: Number(user.membership_id),
        organizationId: env.organizationId,
        venueId: env.venueId,
        authSessionId: result.insertId,
      },
      username: user.username,
      displayName: user.display_name,
      sessionToken: token,
    },
    expiresAt: expiresAt.toISOString(),
  }
}

export async function authenticateSession(sessionToken: string): Promise<AuthenticatedSession | null> {
  const [rows] = await databasePool.execute<SessionRow[]>(
    `SELECT s.id AS session_id, s.organization_id, s.membership_id, s.user_id,
       u.username, u.display_name
     FROM auth_sessions AS s
     JOIN memberships AS m
       ON m.organization_id = s.organization_id AND m.id = s.membership_id AND m.user_id = s.user_id
     JOIN users AS u ON u.id = s.user_id
     JOIN venues AS v ON v.organization_id = s.organization_id AND v.id = ?
     WHERE s.organization_id = ? AND s.token_hash = ?
       AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
       AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND v.status = 'ACTIVE'
     LIMIT 1`,
    [env.venueId, env.organizationId, hashSessionToken(sessionToken)],
  )
  const row = rows[0]
  if (!row) return null
  return {
    actor: {
      userId: Number(row.user_id),
      membershipId: Number(row.membership_id),
      organizationId: Number(row.organization_id),
      venueId: env.venueId,
      authSessionId: Number(row.session_id),
    },
    username: row.username,
    displayName: row.display_name,
    sessionToken,
  }
}

export async function listPermissions(actor: AuthenticatedActor): Promise<string[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & { code: string })[]>(
    `SELECT DISTINCT p.code
     FROM memberships AS m
     JOIN membership_roles AS mr
       ON mr.organization_id = m.organization_id AND mr.membership_id = m.id
     JOIN role_permissions AS rp ON rp.role_id = mr.role_id
     JOIN permissions AS p ON p.id = rp.permission_id
     WHERE m.organization_id = ? AND m.id = ? AND m.user_id = ? AND m.status = 'ACTIVE'
       AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
     ORDER BY p.code`,
    [actor.organizationId, actor.membershipId, actor.userId, actor.venueId],
  )
  return rows.map((row) => row.code)
}

export async function hasPermission(actor: AuthenticatedActor, permissionCode: string): Promise<boolean> {
  const permissions = await listPermissions(actor)
  return permissions.includes(permissionCode)
}

export async function logoutSession(actor: AuthenticatedActor): Promise<void> {
  if (!actor.authSessionId) return
  await databasePool.execute(
    `UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'LOGOUT'
     WHERE organization_id = ? AND id = ? AND user_id = ? AND revoked_at IS NULL`,
    [actor.organizationId, actor.authSessionId, actor.userId],
  )
}

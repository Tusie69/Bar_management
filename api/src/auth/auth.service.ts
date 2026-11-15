import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { env } from '../config/env.js'
import { databasePool } from '../database/pool.js'
import { AppError } from '../errors/app-error.js'
import type { AuthenticatedActor, AuthenticatedSession } from './authenticated-actor.js'
import { isAuthPortal, rolesForPortal, type AuthPortal } from './auth-portal.js'
import { verifyPassword } from './password.js'
import { createSessionToken, hashSessionToken } from './session-security.js'
import { recordAuthAudit } from './auth-audit.js'
import { notifySessionsRevoked, type SessionEndCode } from './session-lifecycle.js'

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
  portal: string
  session_revoked: number
  revoke_reason: string | null
  session_expired: number
  user_status: 'ACTIVE' | 'DISABLED'
  membership_status: 'ACTIVE' | 'SUSPENDED' | 'ENDED'
  venue_status: string
  portal_role_active: number
}

export type SessionInspection =
  | { ok: true; authentication: AuthenticatedSession }
  | { ok: false; code: SessionEndCode; message: string }

export interface LoginResult {
  authentication: AuthenticatedSession
  expiresAt: string
}

export async function login(
  username: string,
  password: string,
  portal: AuthPortal,
  deviceLabel?: string,
): Promise<LoginResult> {
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
    await recordAuthAudit({
      action: 'AUTH_LOGIN_FAILED',
      ...(user ? { userId: Number(user.user_id) } : {}),
      portal,
      reasonCode: user?.user_status === 'DISABLED' ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
    })
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không hợp lệ.')
  }

  const portalRoles = rolesForPortal(portal)
  const rolePlaceholders = portalRoles.map(() => '?').join(', ')
  const [venueRows] = await databasePool.execute<RowDataPacket[]>(
    `SELECT 1 FROM venues AS v
     WHERE v.organization_id = ? AND v.id = ? AND v.status = 'ACTIVE'
       AND EXISTS (
         SELECT 1 FROM membership_roles AS mr
         JOIN roles AS r ON r.id = mr.role_id
         WHERE mr.organization_id = ? AND mr.membership_id = ?
           AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
           AND r.code IN (${rolePlaceholders})
           AND (r.code <> 'ADMIN' OR mr.access_level IN ('WRITE', 'READ_ONLY'))
       )`,
    [env.organizationId, env.venueId, env.organizationId, user.membership_id, env.venueId, ...portalRoles],
  )
  if (!venueRows[0]) {
    await recordAuthAudit({
      action: 'AUTH_LOGIN_FAILED', userId: Number(user.user_id), portal,
      reasonCode: 'PORTAL_ACCESS_DENIED',
    })
    throw new AppError(403, 'PORTAL_ACCESS_DENIED', 'Tài khoản không được phép đăng nhập tại cổng này.')
  }

  const token = createSessionToken()
  const expiresAt = new Date(Date.now() + env.session.ttlHours * 60 * 60 * 1000)
  const connection = await databasePool.getConnection()
  let sessionId: number
  let replacedSessionIds: number[]
  try {
    await connection.beginTransaction()

    // Serializes every successful login for this user. A password/portal failure
    // returns before this transaction and therefore cannot disturb a live session.
    const lockedUser = await selectLoginUser(connection, username, true)
    if (
      !lockedUser
      || Number(lockedUser.user_id) !== Number(user.user_id)
      || lockedUser.user_status !== 'ACTIVE'
      || lockedUser.membership_id === null
      || lockedUser.membership_status !== 'ACTIVE'
    ) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không hợp lệ.')
    }
    if (!await portalAllowed(connection, Number(lockedUser.membership_id), portal)) {
      throw new AppError(403, 'PORTAL_ACCESS_DENIED', 'Tài khoản không được phép đăng nhập tại cổng này.')
    }

    const [activeRows] = await connection.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM auth_sessions
       WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL
         AND expires_at > UTC_TIMESTAMP(3)`,
      [env.organizationId, user.user_id],
    )
    replacedSessionIds = activeRows.map((row) => Number(row.id))
    if (replacedSessionIds.length) {
      await connection.execute(
        `UPDATE auth_sessions
         SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'SESSION_REPLACED'
         WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL
           AND expires_at > UTC_TIMESTAMP(3)`,
        [env.organizationId, user.user_id],
      )
    }

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO auth_sessions
        (organization_id, membership_id, user_id, token_hash, device_label, expires_at, portal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        env.organizationId,
        lockedUser.membership_id,
        lockedUser.user_id,
        hashSessionToken(token),
        deviceLabel?.slice(0, 100) || null,
        expiresAt,
        portal,
      ],
    )
    sessionId = result.insertId
    await connection.execute(
      'UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?',
      [lockedUser.user_id],
    )
    if (replacedSessionIds.length) {
      await recordAuthAudit({
        action: 'AUTH_SESSION_REVOKED', userId: Number(user.user_id), portal,
        reasonCode: 'SESSION_REPLACED', metadata: { revokedSessions: replacedSessionIds.length },
      }, connection)
    }
    await recordAuthAudit({
      action: 'AUTH_LOGIN_SUCCEEDED', userId: Number(user.user_id),
      membershipId: Number(lockedUser.membership_id), sessionId, portal,
      reasonCode: 'LOGIN_SUCCESS', metadata: { replacedSessions: replacedSessionIds.length },
    }, connection)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    if (error instanceof AppError) {
      await recordAuthAudit({
        action: 'AUTH_LOGIN_FAILED', userId: Number(user.user_id), portal, reasonCode: error.code,
      })
    }
    throw error
  } finally {
    connection.release()
  }

  if (replacedSessionIds.length) {
    notifySessionsRevoked({
      sessionIds: replacedSessionIds,
      userId: Number(user.user_id),
      code: 'SESSION_REPLACED',
    })
  }
  return {
    authentication: {
      actor: {
        userId: Number(user.user_id),
        membershipId: Number(user.membership_id),
        organizationId: env.organizationId,
        venueId: env.venueId,
        authSessionId: sessionId,
        portal,
      },
      username: user.username,
      displayName: user.display_name,
      sessionToken: token,
      portal,
    },
    expiresAt: expiresAt.toISOString(),
  }
}

async function selectLoginUser(
  connection: Pick<PoolConnection, 'execute'>,
  username: string,
  lock = false,
): Promise<LoginRow | undefined> {
  const [rows] = await connection.execute<LoginRow[]>(
    `SELECT u.id AS user_id, u.username, u.display_name, u.password_hash,
       u.status AS user_status, m.id AS membership_id, m.status AS membership_status
     FROM users AS u
     LEFT JOIN memberships AS m
       ON m.user_id = u.id AND m.organization_id = ?
     WHERE u.username = ?
     LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [env.organizationId, username],
  )
  return rows[0]
}

async function portalAllowed(
  connection: Pick<PoolConnection, 'execute'>,
  membershipId: number,
  portal: AuthPortal,
): Promise<boolean> {
  const portalRoles = rolesForPortal(portal)
  const rolePlaceholders = portalRoles.map(() => '?').join(', ')
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM venues AS v
     WHERE v.organization_id = ? AND v.id = ? AND v.status = 'ACTIVE'
       AND EXISTS (
         SELECT 1 FROM membership_roles AS mr
         JOIN roles AS r ON r.id = mr.role_id
         WHERE mr.organization_id = ? AND mr.membership_id = ?
           AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
           AND r.code IN (${rolePlaceholders})
           AND (r.code <> 'ADMIN' OR mr.access_level IN ('WRITE', 'READ_ONLY'))
       )`,
    [env.organizationId, env.venueId, env.organizationId, membershipId, env.venueId, ...portalRoles],
  )
  return Boolean(rows[0])
}

export async function inspectSession(sessionToken: string): Promise<SessionInspection> {
  const [rows] = await databasePool.execute<SessionRow[]>(
    `SELECT s.id AS session_id, s.organization_id, s.membership_id, s.user_id,
       u.username, u.display_name, s.portal,
       (s.revoked_at IS NOT NULL) AS session_revoked, s.revoke_reason,
       (s.expires_at <= UTC_TIMESTAMP(3)) AS session_expired,
       u.status AS user_status, m.status AS membership_status, v.status AS venue_status,
       EXISTS (
         SELECT 1 FROM membership_roles AS mr
         JOIN roles AS r ON r.id = mr.role_id
         WHERE mr.organization_id = s.organization_id AND mr.membership_id = s.membership_id
           AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
           AND (
             (s.portal = 'admin' AND (r.code = 'OWNER' OR (r.code = 'ADMIN' AND mr.access_level IN ('WRITE', 'READ_ONLY'))))
             OR (s.portal = 'receptionist' AND r.code = 'RECEPTIONIST')
             OR (s.portal = 'customer-care' AND r.code = 'CUSTOMER_CARE')
             OR (s.portal = 'cashier' AND r.code = 'CASHIER')
           )
       ) AS portal_role_active
     FROM auth_sessions AS s
     JOIN memberships AS m
       ON m.organization_id = s.organization_id AND m.id = s.membership_id AND m.user_id = s.user_id
     JOIN users AS u ON u.id = s.user_id
     JOIN venues AS v ON v.organization_id = s.organization_id AND v.id = ?
     WHERE s.organization_id = ? AND s.token_hash = ?
     LIMIT 1`,
    [env.venueId, env.venueId, env.organizationId, hashSessionToken(sessionToken)],
  )
  const row = rows[0]
  if (!row || !isAuthPortal(row.portal)) {
    return { ok: false, code: 'SESSION_INVALID', message: 'Phiên đăng nhập không hợp lệ.' }
  }
  if (Number(row.session_revoked) === 1) {
    if (row.revoke_reason === 'SESSION_REPLACED') {
      return {
        ok: false,
        code: 'SESSION_REPLACED',
        message: 'Tài khoản của bạn đã được đăng nhập trên một thiết bị khác. Phiên hiện tại đã kết thúc.',
      }
    }
    if (row.revoke_reason === 'ACCOUNT_LOCKED') {
      return { ok: false, code: 'ACCOUNT_LOCKED', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' }
    }
    return { ok: false, code: 'SESSION_REVOKED', message: 'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.' }
  }
  if (Number(row.session_expired) === 1) {
    return { ok: false, code: 'SESSION_EXPIRED', message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' }
  }
  if (row.user_status === 'DISABLED') {
    return { ok: false, code: 'ACCOUNT_LOCKED', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' }
  }
  if (
    row.membership_status !== 'ACTIVE'
    || row.venue_status !== 'ACTIVE'
    || Number(row.portal_role_active) !== 1
  ) {
    return { ok: false, code: 'SESSION_REVOKED', message: 'Quyền truy cập của phiên đã bị thu hồi.' }
  }
  return {
    ok: true,
    authentication: {
      actor: {
        userId: Number(row.user_id),
        membershipId: Number(row.membership_id),
        organizationId: Number(row.organization_id),
        venueId: env.venueId,
        authSessionId: Number(row.session_id),
        portal: row.portal,
      },
      username: row.username,
      displayName: row.display_name,
      sessionToken,
      portal: row.portal,
    },
  }
}

export async function authenticateSession(sessionToken: string): Promise<AuthenticatedSession | null> {
  const inspection = await inspectSession(sessionToken)
  return inspection.ok ? inspection.authentication : null
}

export async function listRoles(actor: AuthenticatedActor): Promise<string[]> {
  if (!actor.portal) return []
  const portalRoles = rolesForPortal(actor.portal)
  const rolePlaceholders = portalRoles.map(() => '?').join(', ')
  const [rows] = await databasePool.execute<(RowDataPacket & { code: string })[]>(
    `SELECT DISTINCT r.code
     FROM memberships AS m
     JOIN membership_roles AS mr
       ON mr.organization_id = m.organization_id AND mr.membership_id = m.id
     JOIN roles AS r ON r.id = mr.role_id
     WHERE m.organization_id = ? AND m.id = ? AND m.user_id = ? AND m.status = 'ACTIVE'
       AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
       AND r.code IN (${rolePlaceholders})
       AND (r.code <> 'ADMIN' OR mr.access_level IN ('WRITE', 'READ_ONLY'))
     ORDER BY r.code`,
    [actor.organizationId, actor.membershipId, actor.userId, actor.venueId, ...portalRoles],
  )
  return rows.map((row) => row.code)
}

export async function listPermissions(actor: AuthenticatedActor): Promise<string[]> {
  if (!actor.portal) return []
  const portalRoles = rolesForPortal(actor.portal)
  const rolePlaceholders = portalRoles.map(() => '?').join(', ')
  const [rows] = await databasePool.execute<(RowDataPacket & { code: string })[]>(
    `SELECT DISTINCT p.code
     FROM memberships AS m
     JOIN membership_roles AS mr
       ON mr.organization_id = m.organization_id AND mr.membership_id = m.id
     JOIN roles AS r ON r.id = mr.role_id
     JOIN role_permissions AS rp ON rp.role_id = mr.role_id
     JOIN permissions AS p ON p.id = rp.permission_id
     WHERE m.organization_id = ? AND m.id = ? AND m.user_id = ? AND m.status = 'ACTIVE'
       AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
       AND r.code IN (${rolePlaceholders})
       AND (
         r.code <> 'ADMIN'
         OR mr.access_level = 'WRITE'
         OR p.code IN (
           'customer.view_masked', 'customer.phone.reveal', 'booking.phone.reveal',
           'audit.read', 'report.read', 'user.read'
         )
       )
     ORDER BY p.code`,
    [actor.organizationId, actor.membershipId, actor.userId, actor.venueId, ...portalRoles],
  )
  return rows.map((row) => row.code)
}

export async function getAdminAccessLevel(actor: AuthenticatedActor): Promise<'WRITE' | 'READ_ONLY' | null> {
  if (actor.portal !== 'admin') return null
  const [rows] = await databasePool.execute<(RowDataPacket & {
    code: 'OWNER' | 'ADMIN'; access_level: 'WRITE' | 'READ_ONLY' | null
  })[]>(
    `SELECT r.code, mr.access_level
     FROM membership_roles AS mr
     JOIN roles AS r ON r.id = mr.role_id
     WHERE mr.organization_id = ? AND mr.membership_id = ? AND r.code IN ('OWNER', 'ADMIN')
       AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
     ORDER BY FIELD(r.code, 'OWNER', 'ADMIN') LIMIT 1`,
    [actor.organizationId, actor.membershipId, actor.venueId],
  )
  return rows[0]?.code === 'ADMIN' ? rows[0].access_level : null
}

export async function hasPermission(actor: AuthenticatedActor, permissionCode: string): Promise<boolean> {
  const permissions = await listPermissions(actor)
  return permissions.includes(permissionCode)
}

export async function logoutSession(actor: AuthenticatedActor): Promise<void> {
  if (!actor.authSessionId) return
  const connection = await databasePool.getConnection()
  let revoked = false
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM auth_sessions
       WHERE organization_id = ? AND id = ? AND user_id = ? AND revoked_at IS NULL
       FOR UPDATE`,
      [actor.organizationId, actor.authSessionId, actor.userId],
    )
    if (rows[0]) {
      await connection.execute(
        `UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'LOGOUT'
         WHERE organization_id = ? AND id = ? AND user_id = ? AND revoked_at IS NULL`,
        [actor.organizationId, actor.authSessionId, actor.userId],
      )
      revoked = true
      await recordAuthAudit({
        action: 'AUTH_LOGOUT', userId: actor.userId, membershipId: actor.membershipId,
        sessionId: actor.authSessionId, ...(actor.portal ? { portal: actor.portal } : {}), reasonCode: 'LOGOUT',
      }, connection)
      await recordAuthAudit({
        action: 'AUTH_SESSION_REVOKED', userId: actor.userId, sessionId: actor.authSessionId,
        ...(actor.portal ? { portal: actor.portal } : {}),
        reasonCode: 'LOGOUT', metadata: { revokedSessions: 1 },
      }, connection)
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  if (revoked) {
    notifySessionsRevoked({ sessionIds: [actor.authSessionId], userId: actor.userId, code: 'SESSION_REVOKED' })
  }
}

import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { env } from '../config/env.js'
import { databasePool } from '../database/pool.js'
import { AppError } from '../errors/app-error.js'
import type { AuthenticatedActor, AuthenticatedSession } from './authenticated-actor.js'
import { isAuthPortal, portalRoleMatchSql, rolesForPortal, type AuthPortal } from './auth-portal.js'
import { verifyPassword } from './password.js'
import { createSessionToken, hashSessionToken } from './session-security.js'
import { describeDevice, resolveDeviceId, shortDeviceId } from './device-identity.js'
import { recordAuthAudit } from './auth-audit.js'
import { notifySessionsRevoked, type SessionEndCode } from './session-lifecycle.js'
import { READ_ONLY_ADMIN_PERMISSIONS } from './read-only-permissions.js'
import { OWNER_ONLY_PERMISSIONS } from '../modules/accounts/permission-model.js'
import { realNow } from '../time/application-clock.js'

interface LoginRow extends RowDataPacket {
  user_id: number
  username: string
  display_name: string
  password_hash: string
  user_status: 'ACTIVE' | 'DISABLED'
  must_change_password: number
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
  must_change_password: number
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
  /**
   * TU-33: mã thiết bị do client khai. Chỉ dùng để quản lý/hiển thị thiết bị,
   * KHÔNG BAO GIỜ là yếu tố xác thực — quyền truy cập vẫn do cookie session
   * quyết định. Thiếu hoặc không hợp lệ thì `resolveDeviceId` sinh mã mới.
   */
  deviceId?: string,
): Promise<LoginResult> {
  const [rows] = await databasePool.execute<LoginRow[]>(
    `SELECT u.id AS user_id, u.username, u.display_name, u.password_hash,
       u.status AS user_status, u.must_change_password, m.id AS membership_id, m.status AS membership_status
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
  const resolvedDeviceId = resolveDeviceId(deviceId)
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

    // Đọc kèm device_id/device_label: audit của TU-33 phải nói được THIẾT BỊ
    // NÀO bị thay thế, không chỉ "đã thu hồi n phiên". Khi một nhân viên gọi
    // lên báo "tôi bị đẩy ra", con số n không giúp gì; mã thiết bị thì giúp.
    const [activeRows] = await connection.execute<(RowDataPacket & {
      id: number; device_id: string | null; device_label: string | null
    })[]>(
      `SELECT id, device_id, device_label FROM auth_sessions
       WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL
         AND expires_at > ?`,
      [env.organizationId, user.user_id, realNow()],
    )
    replacedSessionIds = activeRows.map((row) => Number(row.id))
    const replacedDevices = activeRows.map((row) => ({
      sessionId: Number(row.id),
      deviceRef: shortDeviceId(row.device_id),
      deviceLabel: row.device_label,
    }))
    if (replacedSessionIds.length) {
      await connection.execute(
        `UPDATE auth_sessions
         SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'SESSION_REPLACED'
         WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL
           AND expires_at > ?`,
        [env.organizationId, user.user_id, realNow()],
      )
    }

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO auth_sessions
        (organization_id, membership_id, user_id, token_hash, device_label, device_id, expires_at, portal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        env.organizationId,
        lockedUser.membership_id,
        lockedUser.user_id,
        hashSessionToken(token),
        // Nhãn thiết bị được rút gọn về mức "Chrome trên Android" thay vì lưu
        // nguyên User-Agent: nhân viên chỉ cần nhận ra máy nào là máy mình, và
        // chuỗi UA đầy đủ mang nhiều thông tin hơn mức đó.
        describeDevice(deviceLabel)?.slice(0, 100) ?? null,
        resolvedDeviceId,
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
        reasonCode: 'SESSION_REPLACED',
        metadata: {
          revokedSessions: replacedSessionIds.length,
          // Thiết bị bị thay thế và thiết bị vừa đăng nhập, cả hai ở dạng mã
          // ngắn. Không ghi token, cookie hay User-Agent gốc.
          replacedDevices,
          newSessionId: sessionId,
          newDeviceRef: shortDeviceId(resolvedDeviceId),
        },
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
      mustChangePassword: Number(user.must_change_password) === 1,
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
       u.status AS user_status, u.must_change_password, m.id AS membership_id, m.status AS membership_status
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
  const portalRoleMatch = portalRoleMatchSql('s.portal')
  const [rows] = await databasePool.execute<SessionRow[]>(
    `SELECT s.id AS session_id, s.organization_id, s.membership_id, s.user_id,
       u.username, u.display_name, s.portal, u.must_change_password,
       (s.revoked_at IS NOT NULL) AS session_revoked, s.revoke_reason,
       (s.expires_at <= ?) AS session_expired,
       u.status AS user_status, m.status AS membership_status, v.status AS venue_status,
       EXISTS (
         SELECT 1 FROM membership_roles AS mr
         JOIN roles AS r ON r.id = mr.role_id
         WHERE mr.organization_id = s.organization_id AND mr.membership_id = s.membership_id
           AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
           AND ${portalRoleMatch.sql}
       ) AS portal_role_active
     FROM auth_sessions AS s
     JOIN memberships AS m
       ON m.organization_id = s.organization_id AND m.id = s.membership_id AND m.user_id = s.user_id
     JOIN users AS u ON u.id = s.user_id
     JOIN venues AS v ON v.organization_id = s.organization_id AND v.id = ?
     WHERE s.organization_id = ? AND s.token_hash = ?
     LIMIT 1`,
    // TU-42: tham số đầu là giờ THẬT cho `session_expired` — hạn phiên không đi theo đồng hồ giả lập.
    [realNow(), env.venueId, ...portalRoleMatch.parameters, env.venueId, env.organizationId, hashSessionToken(sessionToken)],
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
        // Câu chữ do TU-33 chốt; web dùng đúng câu này trong
        // `sessionEndMessage` để nhân viên gặp một câu duy nhất ở mọi nơi.
        message: 'Tài khoản này vừa được đăng nhập trên thiết bị khác. Phiên đăng nhập hiện tại đã kết thúc.',
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
      mustChangePassword: Number(row.must_change_password) === 1,
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
  const readOnlyPlaceholders = READ_ONLY_ADMIN_PERMISSIONS.map(() => '?').join(', ')
  const ownerOnlyPlaceholders = [...OWNER_ONLY_PERMISSIONS].map(() => '?').join(', ')
  const ownerOnly = [...OWNER_ONLY_PERMISSIONS]

  // TU-32/TU-34: quyen hieu dung = (quyen vai tro ∪ override bat) ∩ tran.
  //
  // Day la CHO DUY NHAT tinh quyen hieu dung, nen moi endpoint di qua
  // requirePermission deu chiu dung mot luat — khong chi man Quan tri.
  //
  // Nhanh 1: quyen tu vai tro, tru nhung quyen bi tat rieng.
  // Nhanh 2: quyen SuperAdmin cap them, cat theo tran cua tai khoan.
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
         OR p.code IN (${readOnlyPlaceholders})
       )
       AND NOT EXISTS (
         SELECT 1 FROM user_permission_overrides AS o
         WHERE o.organization_id = m.organization_id AND o.user_id = m.user_id
           AND o.permission_id = p.id AND o.is_enabled = 0
       )

     UNION

     SELECT DISTINCT p.code
     FROM memberships AS m
     JOIN membership_roles AS mr
       ON mr.organization_id = m.organization_id AND mr.membership_id = m.id
     JOIN roles AS r ON r.id = mr.role_id
     JOIN user_permission_overrides AS o
       ON o.organization_id = m.organization_id AND o.user_id = m.user_id AND o.is_enabled = 1
     JOIN permissions AS p ON p.id = o.permission_id
     WHERE m.organization_id = ? AND m.id = ? AND m.user_id = ? AND m.status = 'ACTIVE'
       AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
       AND r.code IN (${rolePlaceholders})
       -- Tran 1: viec cua rieng cap 1 thi khong cap le cho ai.
       AND p.code NOT IN (${ownerOnlyPlaceholders})
       -- Tran 2: Admin Read-Only chi nhan them quyen doc.
       AND (
         r.code <> 'ADMIN'
         OR mr.access_level = 'WRITE'
         OR p.code IN (${readOnlyPlaceholders})
       )
     ORDER BY code`,
    [
      actor.organizationId, actor.membershipId, actor.userId, actor.venueId,
      ...portalRoles, ...READ_ONLY_ADMIN_PERMISSIONS,
      actor.organizationId, actor.membershipId, actor.userId, actor.venueId,
      ...portalRoles, ...ownerOnly, ...READ_ONLY_ADMIN_PERMISSIONS,
    ],
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

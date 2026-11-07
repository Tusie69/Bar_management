/**
 * BA-022 — Account Management (US-11).
 *
 * Approved scope only. US-11 and its role matrix approve, for an Admin with
 * edit rights: creating an Admin account, creating a staff account, and locking
 * or unlocking an account (TU-09). Those are the three mutations here, plus the
 * listing they need, all behind the baseline sensitive permission `user.manage`.
 *
 * Deliberately NOT implemented, because no approved contract exists:
 *   - SuperAdmin as a distinct role, and Admin "Sửa" vs "Chỉ xem" access levels.
 *     `docs/backlog/admin-portal-rbac.md` records these as deferred by the owner,
 *     with no authorized RBAC migration, and US-11 N6 still asks what SuperAdmin
 *     may do. No role is created here.
 *   - Changing an existing account's role. The matrix approves only
 *     "Đổi quyền Admin Sửa ↔ Chỉ xem" for SuperAdmin, and those levels do not
 *     exist, so there is no approved role-change semantics for staff.
 *   - Password reset. US-11 does not mention it at all.
 *   - Viewing another account's screen (impersonation).
 * See fix-reports/BA-022_ACCOUNT_MANAGEMENT.md.
 *
 * Roles are restricted to the four that migration 0001 already seeds. Nothing
 * grants a permission beyond what the role already has.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { hashPassword } from '../../auth/password.js'
import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

/** Same limits as the bootstrap-admin tool, so accounts stay consistent. */
const USERNAME_MAX = 80
const DISPLAY_NAME_MAX = 120
const PASSWORD_MIN = 12

export type AccountStatus = 'ACTIVE' | 'DISABLED'

export interface AccountSummary {
  id: number
  username: string
  displayName: string
  status: AccountStatus
  membershipStatus: string
  roles: string[]
  lastLoginAt: string | null
  version: number
}

export interface CreateAccountInput {
  username: string
  displayName: string
  password: string
  roleCode: string
}

export interface AccountStatusResult {
  account: AccountSummary
  /** Sessions revoked by this change; a lock ends the account's sessions now. */
  revokedSessions: number
}

interface AccountRow extends RowDataPacket {
  id: number
  username: string
  display_name: string
  status: AccountStatus
  membership_status: string
  last_login_at: Date | null
  version: number
  role_codes: string | null
}

function toSummary(row: AccountRow): AccountSummary {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    membershipStatus: row.membership_status,
    roles: row.role_codes ? row.role_codes.split(',').filter(Boolean).sort() : [],
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    version: Number(row.version),
  }
}

/**
 * Accounts are scoped by membership in the actor's organization, and the roles
 * reported are those effective at the actor's venue (venue_id NULL = all venues).
 */
async function selectAccounts(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  userId?: number,
  lock = false,
): Promise<AccountRow[]> {
  const [rows] = await connection.execute<AccountRow[]>(
    `SELECT u.id, u.username, u.display_name, u.status, u.last_login_at, u.version,
       m.status AS membership_status,
       (SELECT GROUP_CONCAT(r.code ORDER BY r.code)
          FROM membership_roles AS mr
          JOIN roles AS r ON r.id = mr.role_id
         WHERE mr.organization_id = m.organization_id AND mr.membership_id = m.id
           AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
       ) AS role_codes
     FROM memberships AS m
     JOIN users AS u ON u.id = m.user_id
     WHERE m.organization_id = ?${userId === undefined ? '' : ' AND u.id = ?'}
     ORDER BY u.username${lock ? ' FOR UPDATE' : ''}`,
    userId === undefined
      ? [actor.venueId, actor.organizationId]
      : [actor.venueId, actor.organizationId, userId],
  )
  return rows
}

export async function listAccounts(actor: AuthenticatedActor): Promise<AccountSummary[]> {
  const connection = await databasePool.getConnection()
  try {
    return (await selectAccounts(connection, actor)).map(toSummary)
  } finally {
    connection.release()
  }
}

/** Audit row for an account change. No venue change_seq: this is not floor state. */
async function recordAccountAudit(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  action: string,
  targetUserId: number,
  versionBefore: number | null,
  versionAfter: number | null,
  changes: Record<string, unknown>,
): Promise<void> {
  await connection.execute(
    `INSERT INTO operation_log
      (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
       action, entity_type, entity_id, entity_version_before, entity_version_after, changes,
       reason_code, is_undoable)
     VALUES (?, ?, 'USER', ?, ?, ?, ?, 'user', ?, ?, ?, CAST(? AS JSON), 'MANUAL', 0)`,
    [actor.organizationId, actor.venueId, actor.userId, actor.membershipId,
      actor.authSessionId ?? null, action, targetUserId, versionBefore, versionAfter,
      JSON.stringify([{ type: 'account', ...changes }])],
  )
}

export async function createAccount(
  actor: AuthenticatedActor,
  input: CreateAccountInput,
): Promise<AccountSummary> {
  const username = input.username.trim()
  const displayName = input.displayName.trim()
  if (!username || username.length > USERNAME_MAX) {
    throw new AppError(400, 'INVALID_USERNAME', 'Tên đăng nhập không hợp lệ.')
  }
  if (!displayName || displayName.length > DISPLAY_NAME_MAX) {
    throw new AppError(400, 'INVALID_DISPLAY_NAME', 'Tên hiển thị không hợp lệ.')
  }
  if (typeof input.password !== 'string' || input.password.length < PASSWORD_MIN) {
    throw new AppError(400, 'WEAK_PASSWORD', `Mật khẩu phải có ít nhất ${PASSWORD_MIN} ký tự.`)
  }

  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()

    // Only a role the baseline already seeds. No role is created here.
    const [roleRows] = await connection.execute<(RowDataPacket & { id: number; code: string })[]>(
      'SELECT id, code FROM roles WHERE code = ? LIMIT 1',
      [input.roleCode],
    )
    const role = roleRows[0]
    if (!role) throw new AppError(400, 'ROLE_NOT_FOUND', 'Vai trò không tồn tại trong hệ thống.')

    const [existing] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM users WHERE username = ? FOR UPDATE',
      [username],
    )
    if (existing.length) {
      throw new AppError(409, 'USERNAME_TAKEN', 'Tên đăng nhập này đã được dùng.')
    }

    // Hash before insert; the plaintext never leaves this call and is never logged.
    const passwordHash = await hashPassword(input.password)
    const [userResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO users (username, display_name, password_hash, status)
       VALUES (?, ?, ?, 'ACTIVE')`,
      [username, displayName, passwordHash],
    )
    const [membershipResult] = await connection.execute<ResultSetHeader>(
      'INSERT INTO memberships (organization_id, user_id) VALUES (?, ?)',
      [actor.organizationId, userResult.insertId],
    )
    await connection.execute(
      `INSERT INTO membership_roles
        (organization_id, membership_id, role_id, venue_id, granted_by_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [actor.organizationId, membershipResult.insertId, role.id, actor.venueId, actor.userId],
    )
    await recordAccountAudit(
      connection, actor, 'USER_ACCOUNT_CREATED', userResult.insertId, null, 1,
      { username, roleCode: role.code, venueId: actor.venueId },
    )

    const rows = await selectAccounts(connection, actor, userResult.insertId)
    await connection.commit()
    return toSummary(rows[0]!)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function setAccountStatus(
  actor: AuthenticatedActor,
  userId: number,
  expectedVersion: number,
  status: AccountStatus,
): Promise<AccountStatusResult> {
  // Fail closed: an admin must not lock themselves out of account management.
  if (userId === actor.userId) {
    throw new AppError(409, 'CANNOT_LOCK_SELF', 'Không thể tự khóa tài khoản đang đăng nhập.')
  }

  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const locked = await selectAccounts(connection, actor, userId, true)
    const current = locked[0]
    if (!current) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản.')
    if (Number(current.version) !== expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Tài khoản vừa được thay đổi, hãy tải lại.')
    }
    if (current.status === status) {
      throw new AppError(409, 'ACCOUNT_STATUS_UNCHANGED', 'Tài khoản đã ở trạng thái này.')
    }

    // Fail closed: never leave the organization without a usable admin.
    if (status === 'DISABLED') {
      const [remaining] = await connection.execute<(RowDataPacket & { total: number })[]>(
        `SELECT COUNT(*) AS total
         FROM memberships AS m
         JOIN users AS u ON u.id = m.user_id
         JOIN membership_roles AS mr ON mr.organization_id = m.organization_id AND mr.membership_id = m.id
         JOIN roles AS r ON r.id = mr.role_id
         WHERE m.organization_id = ? AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'
           AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
           AND r.code = 'OWNER_ADMIN' AND u.id <> ?`,
        [actor.organizationId, actor.venueId, userId],
      )
      if (!Number(remaining[0]?.total)) {
        throw new AppError(409, 'LAST_ADMIN_PROTECTED',
          'Đây là tài khoản Chủ quán / Admin hoạt động cuối cùng, không thể khóa.')
      }
    }

    await connection.execute(
      `UPDATE users SET status = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND version = ?`,
      [status, userId, expectedVersion],
    )

    // A locked account's sessions end immediately. authenticateSession already
    // re-checks user status on every request; revoking makes it explicit and
    // leaves an auditable trace.
    let revokedSessions = 0
    if (status === 'DISABLED') {
      const [revoked] = await connection.execute<ResultSetHeader>(
        `UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'ACCOUNT_LOCKED'
         WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL`,
        [actor.organizationId, userId],
      )
      revokedSessions = revoked.affectedRows
    }

    await recordAccountAudit(
      connection, actor,
      status === 'DISABLED' ? 'USER_ACCOUNT_LOCKED' : 'USER_ACCOUNT_UNLOCKED',
      userId, expectedVersion, expectedVersion + 1,
      { username: current.username, from: current.status, to: status, revokedSessions },
    )

    const rows = await selectAccounts(connection, actor, userId)
    await connection.commit()
    return { account: toSummary(rows[0]!), revokedSessions }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

/** Role codes an account may be created with: exactly what the baseline seeds. */
export async function listAssignableRoles(): Promise<{ code: string; name: string }[]> {
  const connection = await databasePool.getConnection()
  try {
    const [rows] = await connection.execute<(RowDataPacket & { code: string; name: string })[]>(
      'SELECT code, name FROM roles WHERE is_system = 1 ORDER BY code',
    )
    return rows.map((row) => ({ code: row.code, name: row.name }))
  } finally {
    connection.release()
  }
}

/** Single-tenant guard: the configured organization is the only one served. */
export function assertConfiguredOrganization(actor: AuthenticatedActor): void {
  if (actor.organizationId !== env.organizationId) {
    throw new AppError(403, 'ORGANIZATION_MISMATCH', 'Không có quyền trên tổ chức này.')
  }
}

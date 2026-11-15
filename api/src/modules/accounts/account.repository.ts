import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { recordAuthAudit } from '../../auth/auth-audit.js'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import { notifySessionsRevoked } from '../../auth/session-lifecycle.js'
import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

const USERNAME_MAX = 80
const DISPLAY_NAME_MAX = 120
const PASSWORD_MIN = 12
const PASSWORD_MAX = 1024
// TU-32: WAITER (Phục vụ) là cấp 6 và thuộc nhóm nhân viên, nên ADMIN WRITE
// quản lý được tài khoản Phục vụ giống Lễ tân và Thu ngân. Thiếu nó ở đây thì
// `listAssignableRoles` không trả về WAITER và không ai tạo được tài khoản
// Phục vụ, kể cả OWNER.
const STAFF_ROLES = new Set(['RECEPTIONIST', 'CUSTOMER_CARE', 'CASHIER', 'WAITER'])

export type AccountStatus = 'ACTIVE' | 'DISABLED'
export type AdminAccessLevel = 'WRITE' | 'READ_ONLY'

export interface AccountSummary {
  id: number
  username: string
  displayName: string
  status: AccountStatus
  membershipStatus: string
  roles: string[]
  accessLevel: AdminAccessLevel | null
  lastLoginAt: string | null
  version: number
}

export interface CreateAccountInput {
  username: string
  displayName: string
  password: string
  roleCode: string
  accessLevel?: AdminAccessLevel
}

export interface AccountStatusResult {
  account: AccountSummary
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
  admin_access_level: AdminAccessLevel | null
}

interface Authority {
  role: 'OWNER' | 'ADMIN'
  accessLevel: AdminAccessLevel | null
}

function toSummary(row: AccountRow): AccountSummary {
  return {
    id: Number(row.id), username: row.username, displayName: row.display_name,
    status: row.status, membershipStatus: row.membership_status,
    roles: row.role_codes ? row.role_codes.split(',').filter(Boolean).sort() : [],
    accessLevel: row.admin_access_level,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    version: Number(row.version),
  }
}

function assertNewPassword(password: string): void {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new AppError(400, 'WEAK_PASSWORD', `Mật khẩu phải có từ ${PASSWORD_MIN} đến ${PASSWORD_MAX} ký tự.`)
  }
}

async function selectAccounts(
  connection: Pick<PoolConnection, 'execute'>,
  actor: AuthenticatedActor,
  userId?: number,
  lock = false,
): Promise<AccountRow[]> {
  const [rows] = await connection.execute<AccountRow[]>(
    `SELECT u.id, u.username, u.display_name, u.status, u.last_login_at, u.version,
       m.status AS membership_status,
       (SELECT GROUP_CONCAT(r.code ORDER BY r.code)
          FROM membership_roles AS mr JOIN roles AS r ON r.id = mr.role_id
         WHERE mr.organization_id = m.organization_id AND mr.membership_id = m.id
           AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)) AS role_codes,
       (SELECT mr.access_level
          FROM membership_roles AS mr JOIN roles AS r ON r.id = mr.role_id
         WHERE mr.organization_id = m.organization_id AND mr.membership_id = m.id
           AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
           AND r.code = 'ADMIN' LIMIT 1) AS admin_access_level
     FROM memberships AS m JOIN users AS u ON u.id = m.user_id
     WHERE m.organization_id = ?
       AND EXISTS (
         SELECT 1 FROM membership_roles AS scoped_mr
         WHERE scoped_mr.organization_id = m.organization_id AND scoped_mr.membership_id = m.id
           AND scoped_mr.revoked_at IS NULL
           AND (scoped_mr.venue_id IS NULL OR scoped_mr.venue_id = ?)
       )${userId === undefined ? '' : ' AND u.id = ?'}
     ORDER BY u.username${lock ? ' FOR UPDATE' : ''}`,
    userId === undefined
      ? [actor.venueId, actor.venueId, actor.organizationId, actor.venueId]
      : [actor.venueId, actor.venueId, actor.organizationId, actor.venueId, userId],
  )
  return rows
}

async function authority(connection: Pick<PoolConnection, 'execute'>, actor: AuthenticatedActor): Promise<Authority> {
  const [rows] = await connection.execute<(RowDataPacket & {
    code: 'OWNER' | 'ADMIN'; access_level: AdminAccessLevel | null
  })[]>(
    `SELECT r.code, mr.access_level
     FROM membership_roles AS mr JOIN roles AS r ON r.id = mr.role_id
     WHERE mr.organization_id = ? AND mr.membership_id = ?
       AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
       AND r.code IN ('OWNER', 'ADMIN')
     ORDER BY FIELD(r.code, 'OWNER', 'ADMIN') LIMIT 1`,
    [actor.organizationId, actor.membershipId, actor.venueId],
  )
  const row = rows[0]
  if (!row) throw new AppError(403, 'ACCOUNT_MANAGEMENT_DENIED', 'Không có quyền quản lý tài khoản.')
  return { role: row.code, accessLevel: row.access_level }
}

function requireWrite(value: Authority): void {
  if (value.role === 'ADMIN' && value.accessLevel !== 'WRITE') {
    throw new AppError(403, 'READ_ONLY_ACCOUNT', 'Tài khoản chỉ có quyền xem, không thể thực hiện thay đổi.')
  }
}

function targetKind(account: AccountSummary): 'OWNER' | 'ADMIN' | 'STAFF' | 'UNKNOWN' {
  if (account.roles.includes('OWNER')) return 'OWNER'
  if (account.roles.includes('ADMIN')) return 'ADMIN'
  if (account.roles.some((role) => STAFF_ROLES.has(role))) return 'STAFF'
  return 'UNKNOWN'
}

function assertTargetAllowed(actor: AuthenticatedActor, value: Authority, account: AccountSummary): void {
  if (account.id === actor.userId) {
    throw new AppError(409, 'CANNOT_MANAGE_SELF', 'Không thể tự thay đổi quyền hoặc trạng thái tài khoản.')
  }
  const kind = targetKind(account)
  if (kind === 'OWNER') throw new AppError(403, 'OWNER_PROTECTED', 'Không được phép quản lý tài khoản OWNER.')
  if (value.role === 'ADMIN' && kind !== 'STAFF') {
    throw new AppError(403, 'ADMIN_TARGET_DENIED', 'ADMIN chỉ được quản lý tài khoản nhân viên.')
  }
  if (kind === 'UNKNOWN') throw new AppError(403, 'TARGET_ROLE_DENIED', 'Vai trò mục tiêu không thuộc phạm vi quản lý.')
}

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

async function revokeSessions(
  connection: PoolConnection,
  organizationId: number,
  userId: number,
  reason: string,
): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM auth_sessions
     WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL FOR UPDATE`,
    [organizationId, userId],
  )
  const ids = rows.map((row) => Number(row.id))
  if (ids.length) {
    await connection.execute(
      `UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = ?
       WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL`,
      [reason, organizationId, userId],
    )
    await recordAuthAudit({
      action: 'AUTH_SESSION_REVOKED', userId, reasonCode: reason,
      metadata: { revokedSessions: ids.length },
    }, connection)
  }
  return ids
}

function notifyRevoked(ids: number[], userId: number, locked = false): void {
  if (ids.length) {
    notifySessionsRevoked({ sessionIds: ids, userId, code: locked ? 'ACCOUNT_LOCKED' : 'SESSION_REVOKED' })
  }
}

export async function listAccounts(actor: AuthenticatedActor): Promise<AccountSummary[]> {
  const connection = await databasePool.getConnection()
  try {
    await authority(connection, actor)
    return (await selectAccounts(connection, actor)).map(toSummary)
  } finally {
    connection.release()
  }
}

export async function createAccount(actor: AuthenticatedActor, input: CreateAccountInput): Promise<AccountSummary> {
  const username = input.username.trim()
  const displayName = input.displayName.trim()
  if (!username || username.length > USERNAME_MAX) throw new AppError(400, 'INVALID_USERNAME', 'Tên đăng nhập không hợp lệ.')
  if (!displayName || displayName.length > DISPLAY_NAME_MAX) throw new AppError(400, 'INVALID_DISPLAY_NAME', 'Tên hiển thị không hợp lệ.')
  assertNewPassword(input.password)
  if (input.roleCode === 'OWNER') throw new AppError(403, 'OWNER_CREATION_DENIED', 'Không thể tạo OWNER qua API.')
  const passwordHash = await hashPassword(input.password)
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const acting = await authority(connection, actor)
    requireWrite(acting)
    if (input.roleCode === 'ADMIN') {
      if (acting.role !== 'OWNER') throw new AppError(403, 'ADMIN_CREATION_DENIED', 'Chỉ OWNER được tạo ADMIN.')
      if (!input.accessLevel || !['WRITE', 'READ_ONLY'].includes(input.accessLevel)) {
        throw new AppError(400, 'INVALID_ACCESS_LEVEL', 'Cấp truy cập ADMIN không hợp lệ.')
      }
    } else if (!STAFF_ROLES.has(input.roleCode)) {
      throw new AppError(400, 'ROLE_NOT_ASSIGNABLE', 'Vai trò không được phép tạo.')
    }

    const [roleRows] = await connection.execute<(RowDataPacket & { id: number; code: string })[]>(
      'SELECT id, code FROM roles WHERE code = ? LIMIT 1', [input.roleCode],
    )
    const role = roleRows[0]
    if (!role) throw new AppError(400, 'ROLE_NOT_FOUND', 'Vai trò không tồn tại trong hệ thống.')
    const [existing] = await connection.execute<RowDataPacket[]>('SELECT id FROM users WHERE username = ? FOR UPDATE', [username])
    if (existing.length) throw new AppError(409, 'USERNAME_TAKEN', 'Tên đăng nhập này đã được dùng.')

    const [userResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO users (username, display_name, password_hash, status) VALUES (?, ?, ?, 'ACTIVE')`,
      [username, displayName, passwordHash],
    )
    const [membershipResult] = await connection.execute<ResultSetHeader>(
      'INSERT INTO memberships (organization_id, user_id) VALUES (?, ?)',
      [actor.organizationId, userResult.insertId],
    )
    await connection.execute(
      `INSERT INTO membership_roles
        (organization_id, membership_id, role_id, venue_id, access_level, granted_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actor.organizationId, membershipResult.insertId, role.id, actor.venueId,
        input.roleCode === 'ADMIN' ? (input.accessLevel ?? null) : null, actor.userId],
    )
    await recordAccountAudit(connection, actor, 'USER_ACCOUNT_CREATED', userResult.insertId, null, 1, {
      roleCode: role.code, accessLevel: input.roleCode === 'ADMIN' ? input.accessLevel : null, venueId: actor.venueId,
    })
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
  actor: AuthenticatedActor, userId: number, expectedVersion: number, status: AccountStatus,
): Promise<AccountStatusResult> {
  const connection = await databasePool.getConnection()
  let revokedIds: number[] = []
  try {
    await connection.beginTransaction()
    const acting = await authority(connection, actor)
    requireWrite(acting)
    const currentRow = (await selectAccounts(connection, actor, userId, true))[0]
    if (!currentRow) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản.')
    const current = toSummary(currentRow)
    assertTargetAllowed(actor, acting, current)
    if (current.version !== expectedVersion) throw new AppError(409, 'VERSION_CONFLICT', 'Tài khoản vừa được thay đổi, hãy tải lại.')
    if (current.status === status) throw new AppError(409, 'ACCOUNT_STATUS_UNCHANGED', 'Tài khoản đã ở trạng thái này.')

    await connection.execute(
      `UPDATE users SET status = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND version = ?`, [status, userId, expectedVersion],
    )
    if (status === 'DISABLED') revokedIds = await revokeSessions(connection, actor.organizationId, userId, 'ACCOUNT_LOCKED')
    await recordAccountAudit(
      connection, actor, status === 'DISABLED' ? 'USER_ACCOUNT_LOCKED' : 'USER_ACCOUNT_UNLOCKED',
      userId, expectedVersion, expectedVersion + 1,
      { from: current.status, to: status, revokedSessions: revokedIds.length },
    )
    const rows = await selectAccounts(connection, actor, userId)
    await connection.commit()
    notifyRevoked(revokedIds, userId, true)
    return { account: toSummary(rows[0]!), revokedSessions: revokedIds.length }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function setAdminAccessLevel(
  actor: AuthenticatedActor, userId: number, expectedVersion: number, accessLevel: AdminAccessLevel,
): Promise<AccountStatusResult> {
  const connection = await databasePool.getConnection()
  let revokedIds: number[]
  try {
    await connection.beginTransaction()
    const acting = await authority(connection, actor)
    if (acting.role !== 'OWNER') throw new AppError(403, 'ADMIN_ACCESS_DENIED', 'Chỉ OWNER được đổi cấp truy cập ADMIN.')
    const currentRow = (await selectAccounts(connection, actor, userId, true))[0]
    if (!currentRow) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản.')
    const current = toSummary(currentRow)
    assertTargetAllowed(actor, acting, current)
    if (targetKind(current) !== 'ADMIN') throw new AppError(409, 'TARGET_NOT_ADMIN', 'Tài khoản mục tiêu không phải ADMIN.')
    if (current.version !== expectedVersion) throw new AppError(409, 'VERSION_CONFLICT', 'Tài khoản vừa được thay đổi, hãy tải lại.')
    if (current.accessLevel === accessLevel) throw new AppError(409, 'ACCESS_LEVEL_UNCHANGED', 'Cấp truy cập không thay đổi.')

    await connection.execute(
      `UPDATE membership_roles AS mr JOIN roles AS r ON r.id = mr.role_id
       JOIN memberships AS m ON m.organization_id = mr.organization_id AND m.id = mr.membership_id
       SET mr.access_level = ?
       WHERE mr.organization_id = ? AND m.user_id = ? AND r.code = 'ADMIN'
         AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)`,
      [accessLevel, actor.organizationId, userId, actor.venueId],
    )
    await connection.execute(
      'UPDATE users SET version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND version = ?',
      [userId, expectedVersion],
    )
    revokedIds = await revokeSessions(connection, actor.organizationId, userId, 'ACCESS_LEVEL_CHANGED')
    await recordAccountAudit(connection, actor, 'ADMIN_ACCESS_LEVEL_CHANGED', userId, expectedVersion, expectedVersion + 1, {
      from: current.accessLevel, to: accessLevel, revokedSessions: revokedIds.length,
    })
    const rows = await selectAccounts(connection, actor, userId)
    await connection.commit()
    notifyRevoked(revokedIds, userId)
    return { account: toSummary(rows[0]!), revokedSessions: revokedIds.length }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function resetAccountPassword(
  actor: AuthenticatedActor, userId: number, expectedVersion: number, newPassword: string,
): Promise<AccountStatusResult> {
  assertNewPassword(newPassword)
  const passwordHash = await hashPassword(newPassword)
  const connection = await databasePool.getConnection()
  let revokedIds: number[]
  try {
    await connection.beginTransaction()
    const acting = await authority(connection, actor)
    requireWrite(acting)
    const currentRow = (await selectAccounts(connection, actor, userId, true))[0]
    if (!currentRow) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản.')
    const current = toSummary(currentRow)
    assertTargetAllowed(actor, acting, current)
    if (current.version !== expectedVersion) throw new AppError(409, 'VERSION_CONFLICT', 'Tài khoản vừa được thay đổi, hãy tải lại.')
    await connection.execute(
      `UPDATE users SET password_hash = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND version = ?`, [passwordHash, userId, expectedVersion],
    )
    revokedIds = await revokeSessions(connection, actor.organizationId, userId, 'PASSWORD_RESET')
    await recordAccountAudit(connection, actor, 'USER_PASSWORD_RESET', userId, expectedVersion, expectedVersion + 1, {
      revokedSessions: revokedIds.length,
    })
    const rows = await selectAccounts(connection, actor, userId)
    await connection.commit()
    notifyRevoked(revokedIds, userId)
    return { account: toSummary(rows[0]!), revokedSessions: revokedIds.length }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function changeOwnPassword(
  actor: AuthenticatedActor, currentPassword: string, newPassword: string,
): Promise<{ revokedSessions: number }> {
  assertNewPassword(newPassword)
  if (currentPassword.length > PASSWORD_MAX) throw new AppError(401, 'CURRENT_PASSWORD_INVALID', 'Mật khẩu hiện tại không chính xác.')
  const connection = await databasePool.getConnection()
  let revokedIds: number[]
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<(RowDataPacket & { password_hash: string; version: number })[]>(
      'SELECT password_hash, version FROM users WHERE id = ? FOR UPDATE', [actor.userId],
    )
    const user = rows[0]
    if (!user || !await verifyPassword(currentPassword, user.password_hash)) {
      throw new AppError(401, 'CURRENT_PASSWORD_INVALID', 'Mật khẩu hiện tại không chính xác.')
    }
    if (await verifyPassword(newPassword, user.password_hash)) {
      throw new AppError(409, 'PASSWORD_UNCHANGED', 'Mật khẩu mới phải khác mật khẩu hiện tại.')
    }
    const passwordHash = await hashPassword(newPassword)
    await connection.execute(
      'UPDATE users SET password_hash = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
      [passwordHash, actor.userId],
    )
    revokedIds = await revokeSessions(connection, actor.organizationId, actor.userId, 'PASSWORD_CHANGED')
    await recordAccountAudit(connection, actor, 'USER_PASSWORD_CHANGED', actor.userId,
      Number(user.version), Number(user.version) + 1, { revokedSessions: revokedIds.length })
    await connection.commit()
    notifyRevoked(revokedIds, actor.userId)
    return { revokedSessions: revokedIds.length }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listAssignableRoles(actor: AuthenticatedActor): Promise<{ code: string; name: string }[]> {
  const connection = await databasePool.getConnection()
  try {
    const acting = await authority(connection, actor)
    const codes = acting.role === 'OWNER'
      ? ['ADMIN', ...STAFF_ROLES]
      : acting.accessLevel === 'WRITE' ? [...STAFF_ROLES] : []
    if (!codes.length) return []
    const [rows] = await connection.execute<(RowDataPacket & { code: string; name: string })[]>(
      `SELECT code, name FROM roles WHERE code IN (${codes.map(() => '?').join(', ')}) ORDER BY code`, codes,
    )
    return rows.map((row) => ({ code: row.code, name: row.name }))
  } finally {
    connection.release()
  }
}

export function assertConfiguredOrganization(actor: AuthenticatedActor): void {
  if (actor.organizationId !== env.organizationId) {
    throw new AppError(403, 'ORGANIZATION_MISMATCH', 'Không có quyền trên tổ chức này.')
  }
}

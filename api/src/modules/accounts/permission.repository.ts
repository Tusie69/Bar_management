/**
 * TU-34 — Đọc và ghi quyền riêng của từng tài khoản.
 *
 * Quyền nền (trần cứng) = role_permissions của vai trò tài khoản, lọc theo
 * access_level nếu là ADMIN. Override chỉ tắt bớt trong trần đó. Việc áp dụng
 * khi KIỂM quyền nằm ở `auth.service.listPermissions`, nên mọi endpoint đều
 * chịu cùng một luật; file này chỉ lo đọc để hiện checkbox và ghi thay đổi.
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { READ_ONLY_ADMIN_PERMISSIONS } from '../../auth/read-only-permissions.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import {
  authority,
  recordAccountAudit,
  selectAccounts,
  targetKind,
  toSummary,
  type AccountRow,
  type AccountSummary,
} from './account.repository.js'
import {
  assertCanEditPermissions,
  permissionViews,
  planOverrideChanges,
  type PermissionView,
} from './permission-model.js'

export interface AccountPermissionsResult {
  account: AccountSummary
  /** Mọi permission của hệ thống, kèm trạng thái cho tài khoản này. */
  permissions: PermissionView[]
}

function toSummaryRow(rows: readonly AccountRow[], userId: number): AccountSummary {
  const row = rows[0]
  if (!row) throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Không tìm thấy tài khoản ${userId}.`)
  return toSummary(row)
}

async function allPermissionCodes(connection: Pick<PoolConnection, 'execute'>): Promise<string[]> {
  const [rows] = await connection.execute<(RowDataPacket & { code: string })[]>(
    'SELECT code FROM permissions ORDER BY code',
  )
  return rows.map((row) => row.code)
}

/**
 * Quyền nền của MỘT tài khoản khác (không phải của actor).
 *
 * Dùng chung đúng bộ lọc Admin Read-Only với `listPermissions`, qua
 * `READ_ONLY_ADMIN_PERMISSIONS`; hai bản sao của danh sách đó sẽ lệch nhau.
 */
async function basePermissions(
  connection: Pick<PoolConnection, 'execute'>,
  actor: AuthenticatedActor,
  userId: number,
): Promise<string[]> {
  const readOnly = READ_ONLY_ADMIN_PERMISSIONS.map(() => '?').join(', ')
  const [rows] = await connection.execute<(RowDataPacket & { code: string })[]>(
    `SELECT DISTINCT p.code
     FROM memberships AS m
     JOIN membership_roles AS mr
       ON mr.organization_id = m.organization_id AND mr.membership_id = m.id
     JOIN roles AS r ON r.id = mr.role_id
     JOIN role_permissions AS rp ON rp.role_id = mr.role_id
     JOIN permissions AS p ON p.id = rp.permission_id
     WHERE m.organization_id = ? AND m.user_id = ? AND m.status = 'ACTIVE'
       AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
       AND (r.code <> 'ADMIN' OR mr.access_level = 'WRITE' OR p.code IN (${readOnly}))
     ORDER BY p.code`,
    [actor.organizationId, userId, actor.venueId, ...READ_ONLY_ADMIN_PERMISSIONS],
  )
  return rows.map((row) => row.code)
}

async function overridesOf(
  connection: Pick<PoolConnection, 'execute'>,
  organizationId: number,
  userId: number,
): Promise<Map<string, boolean>> {
  const [rows] = await connection.execute<(RowDataPacket & { code: string; is_enabled: number })[]>(
    `SELECT p.code, o.is_enabled
     FROM user_permission_overrides AS o
     JOIN permissions AS p ON p.id = o.permission_id
     WHERE o.organization_id = ? AND o.user_id = ?`,
    [organizationId, userId],
  )
  return new Map(rows.map((row) => [row.code, Number(row.is_enabled) === 1]))
}

export async function getAccountPermissions(
  actor: AuthenticatedActor,
  userId: number,
): Promise<AccountPermissionsResult> {
  const connection = await databasePool.getConnection()
  try {
    await authority(connection, actor)
    const account = toSummaryRow(await selectAccounts(connection, actor, userId), userId)
    const [all, base, overrides] = await Promise.all([
      allPermissionCodes(connection),
      basePermissions(connection, actor, userId),
      overridesOf(connection, actor.organizationId, userId),
    ])
    return { account, permissions: permissionViews(all, base, overrides) }
  } finally {
    connection.release()
  }
}

export interface UpdatePermissionsResult extends AccountPermissionsResult {
  changed: number
}

/**
 * Ghi override cho một tài khoản.
 *
 * Không thu hồi phiên của tài khoản đó: quyền được tính lại trên từng request
 * trong `listPermissions`, nên thay đổi có hiệu lực ngay ở request kế tiếp mà
 * không đẩy ai ra khỏi hệ thống giữa ca.
 */
export async function updateAccountPermissions(
  actor: AuthenticatedActor,
  userId: number,
  expectedVersion: number,
  requested: ReadonlyMap<string, boolean>,
): Promise<UpdatePermissionsResult> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const acting = await authority(connection, actor)
    const account = toSummaryRow(await selectAccounts(connection, actor, userId, true), userId)
    assertCanEditPermissions(actor.userId, acting.role, acting.accessLevel, {
      id: account.id,
      kind: targetKind(account),
    })
    if (account.version !== expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Tài khoản vừa được thay đổi, hãy tải lại.')
    }

    const base = await basePermissions(connection, actor, userId)
    const overrides = await overridesOf(connection, actor.organizationId, userId)
    const changes = planOverrideChanges(requested, base, overrides)

    if (changes.length) {
      const [permissionRows] = await connection.execute<(RowDataPacket & { id: number; code: string })[]>(
        `SELECT id, code FROM permissions WHERE code IN (${changes.map(() => '?').join(', ')})`,
        changes.map((change) => change.code),
      )
      const idByCode = new Map(permissionRows.map((row) => [row.code, Number(row.id)]))
      for (const change of changes) {
        const permissionId = idByCode.get(change.code)
        if (permissionId === undefined) {
          throw new AppError(400, 'PERMISSION_NOT_FOUND', `Quyền "${change.code}" không tồn tại.`)
        }
        await connection.execute(
          `INSERT INTO user_permission_overrides
            (organization_id, user_id, permission_id, is_enabled, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled),
             updated_by_user_id = VALUES(updated_by_user_id), updated_at = UTC_TIMESTAMP(3)`,
          [actor.organizationId, userId, permissionId, change.to ? 1 : 0, actor.userId],
        )
      }
      await connection.execute(
        'UPDATE users SET version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND version = ?',
        [userId, expectedVersion],
      )
      await recordAccountAudit(
        connection, actor, 'USER_PERMISSIONS_CHANGED', userId, expectedVersion, expectedVersion + 1,
        {
          // old/new cho từng quyền, để nhật ký trả lời được "ai bỏ quyền này".
          permissions: changes.map((change) => ({ code: change.code, from: change.from, to: change.to })),
        },
      )
    }

    const account2 = toSummaryRow(await selectAccounts(connection, actor, userId), userId)
    const [all, base2, overrides2] = await Promise.all([
      allPermissionCodes(connection),
      basePermissions(connection, actor, userId),
      overridesOf(connection, actor.organizationId, userId),
    ])
    await connection.commit()
    return { account: account2, permissions: permissionViews(all, base2, overrides2), changed: changes.length }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

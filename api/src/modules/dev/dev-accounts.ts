/**
 * TU-43 — tài khoản mẫu ĐĂNG NHẬP ĐƯỢC cho mọi vai đang có, CHỈ trên bản Dev.
 *
 * Vì sao không nằm trong `database/seeds/demo.sql`: repo là công khai, một mật
 * khẩu viết trong code là mật khẩu ai cũng biết. Mật khẩu chung của bản Dev
 * (Hưng chọn 26/11: một mật khẩu cố định để cả nhóm demo) nằm trong biến môi
 * trường `DEV_DEMO_PASSWORD` của `/srv/21gam-dev/api/.env`, không có giá trị
 * mặc định, và không bao giờ bị in ra.
 *
 * An toàn, theo đúng thứ tự kiểm:
 *  1. `APP_ENV=dev` (config/app-env.ts đã buộc DB_NAME kết thúc bằng `_dev`).
 *  2. Hỏi chính MySQL `SELECT DATABASE()` — phải kết thúc bằng `_dev`.
 *  3. Mật khẩu tối thiểu 12 ký tự (cùng ngưỡng với auth:bootstrap).
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { env } from '../../config/env.js'
import { AppError } from '../../errors/app-error.js'
import { hashPassword } from '../../auth/password.js'

export interface DevAccount {
  username: string
  displayName: string
  roleCode: string
  accessLevel: 'WRITE' | 'READ_ONLY' | null
  /** Đường dẫn đăng nhập trên web, để in ra bảng hướng dẫn. */
  loginPath: string
  label: string
}

/**
 * Đủ mọi vai trong bảng `roles` mà một cổng đăng nhập chấp nhận
 * (auth-portal.ts PORTAL_ROLE_CODES). ADMIN tách hai cấp như biên bản 15/11.
 */
export const DEV_ACCOUNTS: readonly DevAccount[] = [
  { username: 'superadmin_dev', displayName: 'SuperAdmin (Dev)', roleCode: 'OWNER', accessLevel: null, loginPath: '/admin', label: 'SuperAdmin' },
  { username: 'adminedit_dev', displayName: 'Admin Edit (Dev)', roleCode: 'ADMIN', accessLevel: 'WRITE', loginPath: '/admin', label: 'Admin Edit' },
  { username: 'adminview_dev', displayName: 'Admin Read-Only (Dev)', roleCode: 'ADMIN', accessLevel: 'READ_ONLY', loginPath: '/admin', label: 'Admin Read-Only (Cổ đông)' },
  { username: 'letan_dev', displayName: 'Lễ tân (Dev)', roleCode: 'RECEPTIONIST', accessLevel: null, loginPath: '/letan', label: 'Lễ tân' },
  { username: 'phucvu_dev', displayName: 'Phục vụ (Dev)', roleCode: 'WAITER', accessLevel: null, loginPath: '/phucvu', label: 'Phục vụ' },
  { username: 'bartender_dev', displayName: 'Bartender (Dev)', roleCode: 'BAR', accessLevel: null, loginPath: '/chebien, /phucvu', label: 'Bartender' },
  { username: 'bep_dev', displayName: 'Bếp (Dev)', roleCode: 'KITCHEN', accessLevel: null, loginPath: '/chebien', label: 'Bếp' },
  { username: 'thungan_dev', displayName: 'Thu ngân (Dev)', roleCode: 'CASHIER', accessLevel: null, loginPath: '/thungan', label: 'Thu ngân' },
  { username: 'cskh_dev', displayName: 'CSKH (Dev)', roleCode: 'CUSTOMER_CARE', accessLevel: null, loginPath: '/customer-care', label: 'Chăm sóc khách' },
]

export const DEV_PASSWORD_MIN_LENGTH = 12

export function devDemoPassword(): string | null {
  const value = process.env.DEV_DEMO_PASSWORD?.trim()
  return value ? value : null
}

/** Chốt chặn dùng chung cho mọi thao tác ghi dữ liệu mẫu. Ném lỗi, không trả về false. */
export async function assertDevDatabase(connection: PoolConnection): Promise<void> {
  if (env.appEnv !== 'dev') {
    throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy.')
  }
  const [rows] = await connection.query<(RowDataPacket & { name: string | null })[]>('SELECT DATABASE() AS name')
  const name = rows[0]?.name ?? ''
  if (!/_dev$/.test(name)) {
    throw new AppError(409, 'DEV_DATABASE_REQUIRED', 'Dữ liệu mẫu chỉ ghi được vào database kết thúc bằng _dev.')
  }
}

export interface DevAccountResult {
  username: string
  label: string
  loginPath: string
  action: 'created' | 'updated' | 'kept'
}

/**
 * Tạo (hoặc sửa cho đúng) tài khoản mẫu cho mọi vai. Idempotent theo username.
 *
 * `resetPassword`: true = đặt lại mật khẩu của tài khoản đã có về DEV_DEMO_PASSWORD
 * (dùng ở lệnh `pnpm dev:accounts`); false = chỉ tạo tài khoản còn thiếu, không
 * đụng mật khẩu ai đó vừa đổi trên Dev (dùng khi bấm nút kịch bản).
 */
export async function ensureDevAccounts(
  connection: PoolConnection,
  organizationId: number,
  venueId: number,
  password: string,
  resetPassword: boolean,
): Promise<DevAccountResult[]> {
  await assertDevDatabase(connection)
  if (password.length < DEV_PASSWORD_MIN_LENGTH) {
    throw new AppError(400, 'DEV_PASSWORD_TOO_SHORT', `DEV_DEMO_PASSWORD phải có ít nhất ${DEV_PASSWORD_MIN_LENGTH} ký tự.`)
  }
  const passwordHash = await hashPassword(password)
  const results: DevAccountResult[] = []

  for (const account of DEV_ACCOUNTS) {
    const [roleRows] = await connection.execute<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM roles WHERE code = ?',
      [account.roleCode],
    )
    const roleId = roleRows[0]?.id
    // Một vai chưa có trong schema (migration cũ hơn) thì bỏ qua, không bịa vai.
    if (roleId === undefined) continue

    const [userRows] = await connection.execute<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM users WHERE username = ? FOR UPDATE',
      [account.username],
    )
    let userId = userRows[0]?.id
    let action: DevAccountResult['action'] = 'kept'
    if (userId === undefined) {
      const [inserted] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (username, display_name, password_hash, status, must_change_password)
         VALUES (?, ?, ?, 'ACTIVE', 0)`,
        [account.username, account.displayName, passwordHash],
      )
      userId = Number(inserted.insertId)
      action = 'created'
    } else if (resetPassword) {
      await connection.execute(
        `UPDATE users SET password_hash = ?, status = 'ACTIVE', must_change_password = 0,
           version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [passwordHash, userId],
      )
      action = 'updated'
    } else {
      await connection.execute(
        `UPDATE users SET status = 'ACTIVE' WHERE id = ? AND status <> 'ACTIVE'`,
        [userId],
      )
    }

    const [membershipRows] = await connection.execute<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM memberships WHERE organization_id = ? AND user_id = ?',
      [organizationId, userId],
    )
    let membershipId = membershipRows[0]?.id
    if (membershipId === undefined) {
      const [inserted] = await connection.execute<ResultSetHeader>(
        'INSERT INTO memberships (organization_id, user_id) VALUES (?, ?)',
        [organizationId, userId],
      )
      membershipId = Number(inserted.insertId)
    } else {
      await connection.execute(
        `UPDATE memberships SET status = 'ACTIVE' WHERE organization_id = ? AND id = ? AND status <> 'ACTIVE'`,
        [organizationId, membershipId],
      )
    }

    const [roleGrantRows] = await connection.execute<(RowDataPacket & { id: number; access_level: string | null })[]>(
      `SELECT id, access_level FROM membership_roles
       WHERE organization_id = ? AND membership_id = ? AND role_id = ? AND venue_id = ? AND revoked_at IS NULL`,
      [organizationId, membershipId, roleId, venueId],
    )
    const grant = roleGrantRows[0]
    if (!grant) {
      await connection.execute(
        `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id, access_level)
         VALUES (?, ?, ?, ?, ?)`,
        [organizationId, membershipId, roleId, venueId, account.accessLevel],
      )
      if (action === 'kept') action = 'updated'
    } else if (grant.access_level !== account.accessLevel) {
      await connection.execute(
        'UPDATE membership_roles SET access_level = ? WHERE id = ?',
        [account.accessLevel, grant.id],
      )
      if (action === 'kept') action = 'updated'
    }
    results.push({ username: account.username, label: account.label, loginPath: account.loginPath, action })
  }
  return results
}

/** Membership của một tài khoản mẫu, để kịch bản dữ liệu ghi đúng người thao tác. */
export async function devActorFor(
  connection: PoolConnection,
  organizationId: number,
  venueId: number,
  username: string,
): Promise<{ userId: number; membershipId: number; organizationId: number; venueId: number } | null> {
  const [rows] = await connection.execute<(RowDataPacket & { user_id: number; membership_id: number })[]>(
    `SELECT u.id AS user_id, m.id AS membership_id
       FROM users AS u
       JOIN memberships AS m ON m.user_id = u.id AND m.organization_id = ?
      WHERE u.username = ? AND u.status = 'ACTIVE'
      LIMIT 1`,
    [organizationId, username],
  )
  const row = rows[0]
  return row ? { userId: Number(row.user_id), membershipId: Number(row.membership_id), organizationId, venueId } : null
}

import type { RowDataPacket } from 'mysql2/promise'
import { databasePool } from './pool.js'
import { hashPassword } from '../auth/password.js'

export const DEV_PASSWORD = '21gam@Dev2026'

const ACCOUNTS = [
  { username: 'demo_owner', displayName: 'Chủ quán', roleCode: 'OWNER_ADMIN' },
  { username: 'demo_reception1', displayName: 'Lễ tân 1', roleCode: 'RECEPTIONIST' },
  { username: 'demo_reception2', displayName: 'Lễ tân 2', roleCode: 'RECEPTIONIST' },
  { username: 'demo_care', displayName: 'CSKH', roleCode: 'CUSTOMER_CARE' },
  { username: 'demo_cashier', displayName: 'Thu ngân', roleCode: 'CASHIER' },
]

interface IdRow extends RowDataPacket {
  id: number
}

async function seedDevAccounts(): Promise<void> {
  const passwordHash = await hashPassword(DEV_PASSWORD)
  const connection = await databasePool.getConnection()

  try {
    await connection.beginTransaction()

    const organizationId = 1
    const venueId = 1

    for (const acc of ACCOUNTS) {
      // 1. Update or Insert User
      await connection.execute(
        `INSERT INTO users (username, display_name, password_hash, status)
         VALUES (?, ?, ?, 'ACTIVE')
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name),
           password_hash = VALUES(password_hash),
           status = 'ACTIVE'`,
        [acc.username, acc.displayName, passwordHash],
      )

      // Fetch user ID
      const [userRows] = await connection.execute<IdRow[]>(
        'SELECT id FROM users WHERE username = ?',
        [acc.username],
      )
      const userId = userRows[0]?.id
      if (!userId) continue

      // 2. Ensure membership
      await connection.execute(
        `INSERT INTO memberships (organization_id, user_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE organization_id = VALUES(organization_id)`,
        [organizationId, userId],
      )

      const [membershipRows] = await connection.execute<IdRow[]>(
        'SELECT id FROM memberships WHERE organization_id = ? AND user_id = ?',
        [organizationId, userId],
      )
      const membershipId = membershipRows[0]?.id
      if (!membershipId) continue

      // 3. Ensure role
      const [roleRows] = await connection.execute<IdRow[]>(
        'SELECT id FROM roles WHERE code = ?',
        [acc.roleCode],
      )
      const roleId = roleRows[0]?.id
      if (roleId) {
        await connection.execute(
          `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)`,
          [organizationId, membershipId, roleId, venueId],
        )
      }
    }

    await connection.commit()
    console.log('Đã cập nhật mật khẩu và kích hoạt tài khoản dev thành công!')
    console.log(`Mật khẩu dùng chung cho tất cả tài khoản dev: ${DEV_PASSWORD}`)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
    await databasePool.end()
  }
}

seedDevAccounts().catch((error) => {
  console.error('Lỗi khi seed tài khoản dev:', error)
  process.exit(1)
})

/**
 * L6 — tài khoản ĐĂNG NHẬP ĐƯỢC cho ba vai Phục vụ, Bar và Bếp, dùng để chạy
 * luồng Gọi món – Chế biến – Duyệt hủy trên trình duyệt thật.
 *
 * Vì sao không nằm trong `database/seeds/demo.sql`: seed là một file SQL đi theo
 * repo ra mọi máy và mọi môi trường, nên một mật khẩu viết trong đó là một mật
 * khẩu dùng chung mà ai đọc repo cũng biết. Chín tài khoản trong demo.sql vì thế
 * đều DISABLED và mang password marker `!DEMO_NO_LOGIN`. Mật khẩu thật đi qua
 * script này, lấy từ biến môi trường, và chỉ ghi vào database `*_test`.
 *
 * An toàn, theo đúng thứ tự script kiểm:
 *  1. Từ chối mọi database không kết thúc bằng `_test`, kiểm cả `DB_NAME` lẫn
 *     câu trả lời của chính server (`SELECT DATABASE()`), nên một DB_NAME trỏ
 *     một nơi mà connection trỏ nơi khác không lọt được.
 *  2. Từ chối NODE_ENV=production.
 *  3. Mật khẩu lấy từ môi trường, không có giá trị mặc định, và không bao giờ
 *     được in ra — kể cả trong thông báo lỗi.
 *  4. Idempotent: mọi lần ghi là upsert trên các id cố định dưới đây.
 *  5. Không tạo org/venue/bàn. Nó đòi dữ liệu đó có sẵn (từ `db:seed`) và dừng
 *     nếu thiếu, thay vì dựng một địa điểm thứ hai bên cạnh dữ liệu demo.
 *
 * Cách chạy (PowerShell), với một file env riêng không nằm trong Git:
 *   cd Bar_management/api
 *   node --env-file=.env.e2e.local --import tsx scripts/seed-e2e-staff.ts
 *
 * File env cần: DB_NAME, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD và ba cặp
 * E2E_WAITER_USERNAME / E2E_WAITER_PASSWORD, E2E_BAR_*, E2E_KITCHEN_*.
 */
import mysql from 'mysql2/promise'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { hashPassword, verifyPassword } from '../src/auth/password.js'

const organizationId = Number(process.env.ORGANIZATION_ID ?? 1)
const venueId = Number(process.env.VENUE_ID ?? 1)

/** Id cố định, nằm trên dải 95xx mà các fixture E2E khác đang dùng. */
const staff = [
  { roleCode: 'WAITER', userId: 9511, prefix: 'E2E_WAITER', fallbackName: 'E2E Phục vụ' },
  { roleCode: 'BAR', userId: 9512, prefix: 'E2E_BAR', fallbackName: 'E2E Bartender' },
  { roleCode: 'KITCHEN', userId: 9513, prefix: 'E2E_KITCHEN', fallbackName: 'E2E Bếp' },
  // v1.1: cần một người DUYỆT để chạy hết luồng "Hủy đơn?" trên trình duyệt.
  // Phục vụ cố ý không có `order.cancel.approve`, nên không có tài khoản này
  // thì yêu cầu hủy gửi đi rồi nằm đó không ai quyết định được.
  { roleCode: 'CASHIER', userId: 9514, prefix: 'E2E_CASHIER', fallbackName: 'E2E Thu ngân' },
  // Lễ tân: để kiểm bằng mắt cả hai đầu của một tối — người xếp bàn và người
  // gọi món — trên cùng một bộ dữ liệu. Chín tài khoản trong demo.sql đều
  // DISABLED, nên trước đây không có đường nào đăng nhập vào màn Lễ tân.
  { roleCode: 'RECEPTIONIST', userId: 9515, prefix: 'E2E_RECEPTIONIST', fallbackName: 'E2E Lễ tân' },
  // Chủ quán: màn Cấu hình là nơi duy nhất đổi được ca vận hành từ giao diện.
  // `seed-e2e-owner.ts` cũng tạo một OWNER, nhưng nó bị ghim vào đúng một
  // database và tự dựng khu/bàn riêng, nên không dùng được cho một database
  // demo đã có sẵn mặt bằng thật.
  { roleCode: 'OWNER', userId: 9510, prefix: 'E2E_OWNER', fallbackName: 'E2E Chủ quán' },
] as const

function fail(message: string): never {
  console.error(`seed-e2e-staff: ${message}`)
  process.exit(1)
}

const databaseName = process.env.DB_NAME ?? ''
if (process.env.NODE_ENV === 'production') fail('không chạy được với NODE_ENV=production.')
if (!/_test$/.test(databaseName)) {
  fail(`chỉ chạy trên database kết thúc bằng _test; DB_NAME hiện tại là ${databaseName || '(trống)'}.`)
}

interface Account {
  roleCode: string
  userId: number
  username: string
  displayName: string
  password: string
}

const accounts: Account[] = staff.map((entry) => {
  const username = process.env[`${entry.prefix}_USERNAME`]?.trim()
  const password = process.env[`${entry.prefix}_PASSWORD`]
  const displayName = process.env[`${entry.prefix}_DISPLAY_NAME`]?.trim() || entry.fallbackName
  if (!username) fail(`thiếu ${entry.prefix}_USERNAME.`)
  if (!password || password.length < 12) fail(`thiếu ${entry.prefix}_PASSWORD, hoặc ngắn hơn 12 ký tự.`)
  return { roleCode: entry.roleCode, userId: entry.userId, username, displayName, password }
})

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: databaseName,
  charset: 'utf8mb4',
})

try {
  const [currentRows] = await connection.query<(RowDataPacket & { current: string })[]>(
    'SELECT DATABASE() AS current',
  )
  const current = currentRows[0]?.current ?? ''
  if (!/_test$/.test(current)) {
    fail(`kết nối đang ở ${current || '(không rõ)'}, không phải một database _test.`)
  }

  const [venues] = await connection.query<RowDataPacket[]>(
    'SELECT 1 FROM venues WHERE organization_id = ? AND id = ?',
    [organizationId, venueId],
  )
  if (!venues.length) {
    fail(`chưa có venue ${venueId} trong organization ${organizationId}; chạy db:migrate và db:seed trước.`)
  }

  await connection.beginTransaction()
  for (const account of accounts) {
    const [roleRows] = await connection.query<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM roles WHERE code = ?',
      [account.roleCode],
    )
    const role = roleRows[0]
    if (!role) fail(`không tìm thấy vai trò ${account.roleCode}; migration chưa chạy xong.`)

    const passwordHash = await hashPassword(account.password)
    // Chứng minh hash vừa tạo là hash mà đường đăng nhập thật chấp nhận, TRƯỚC
    // khi ghi — một hash sai định dạng chỉ lộ ra ở màn đăng nhập, rất muộn.
    if (!(await verifyPassword(account.password, passwordHash))) {
      fail(`hash mật khẩu của ${account.roleCode} không tự xác thực được.`)
    }

    await connection.execute<ResultSetHeader>(
      `INSERT INTO users (id, username, display_name, password_hash, status)
       VALUES (?, ?, ?, ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE
         username = VALUES(username), display_name = VALUES(display_name),
         password_hash = VALUES(password_hash), status = 'ACTIVE'`,
      [account.userId, account.username, account.displayName, passwordHash],
    )
    await connection.execute<ResultSetHeader>(
      `INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE organization_id = VALUES(organization_id)`,
      [account.userId, organizationId, account.userId],
    )
    await connection.execute<ResultSetHeader>(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), revoked_at = NULL`,
      [organizationId, account.userId, Number(role.id), venueId],
    )
  }
  await connection.commit()

  console.log(`seed-e2e-staff: OK trên ${current}`)
  for (const account of accounts) {
    console.log(`  ${account.roleCode}: ${account.username} (id ${account.userId}), venue ${venueId}`)
  }
  console.log('  mật khẩu không được in ra; nó nằm trong file env đã bị .gitignore bỏ qua.')
  console.log('  cổng đăng nhập: WAITER và BAR → /phucvu/login; BAR và KITCHEN → /chebien/login.')
} catch (error) {
  await connection.rollback()
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`seed-e2e-staff: thất bại — ${detail}`)
  process.exit(1)
} finally {
  await connection.end()
}

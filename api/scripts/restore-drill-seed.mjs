// Seed tối thiểu để NGHIỆM THU một bản phục hồi (TU-31 mục 8.2).
//
// Chỉ chạy trên database kết thúc bằng `_test`. Mật khẩu nhận qua biến môi
// trường DRILL_PASSWORD, không hardcode và không in ra.
import mysql from 'mysql2/promise'

const database = process.env.DB_NAME ?? ''
if (!/_test$/.test(database)) {
  throw new Error(`Từ chối seed vào '${database}': chỉ cho phép database _test.`)
}
const password = process.env.DRILL_PASSWORD
if (!password) throw new Error('Thiếu DRILL_PASSWORD.')

const { hashPassword } = await import('../src/auth/password.ts')
const hash = await hashPassword(password)

const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database,
  multipleStatements: true,
})
try {
  await connection.execute("INSERT INTO organizations (id, code, name) VALUES (1, 'DRILL', 'Drill')")
  await connection.execute(
    `INSERT INTO venues (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local)
     VALUES (1, 1, 'HOME', 'Home', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00')`,
  )
  // DRILL_ROLES: danh sách 'username:ROLE' cách nhau bằng dấu phẩy. Mặc định
  // một tài khoản OWNER, đủ để nghiệm thu một bản phục hồi.
  const accounts = (process.env.DRILL_ROLES ?? `${process.env.DRILL_USERNAME ?? 'drill_owner'}:OWNER`)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [username, role] = entry.split(':')
      if (!username || !role) throw new Error(`DRILL_ROLES sai định dạng ở '${entry}', cần 'username:ROLE'.`)
      return { username, role }
    })

  let id = 0
  for (const account of accounts) {
    id += 1
    await connection.execute(
      'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)',
      [id, account.username, account.username, hash],
    )
    await connection.execute('INSERT INTO memberships (id, organization_id, user_id) VALUES (?, 1, ?)', [id, id])
    const [granted] = await connection.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
       SELECT 1, ?, id, 1 FROM roles WHERE code = ?`,
      [id, account.role],
    )
    if (granted.affectedRows !== 1) throw new Error(`Không có role '${account.role}' trong database.`)
  }
  await connection.execute("INSERT INTO zones (id, organization_id, venue_id, code, name) VALUES (1, 1, 1, 'A', 'A')")
  await connection.execute(
    `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (1, 1, 1, 1, 'A1', 'A1', 'TABLE', 4, 10, 10)`,
  )
  console.info(`Seed nghiệm thu xong trong ${database}.`)
} finally {
  await connection.end()
}

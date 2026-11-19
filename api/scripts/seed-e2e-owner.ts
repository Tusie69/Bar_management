/**
 * TU-38 — seeds an OWNER account plus the minimum venue it needs, for driving the Cấu hình
 * screen in a real browser.
 *
 * Written in TypeScript and run with tsx so it can import the application's own
 * `hashPassword`. An earlier draft reimplemented the scrypt format in plain Node and got it
 * wrong; the hash a login must verify is not a thing worth having two copies of.
 *
 * Safety, in the order the script enforces it:
 *  1. Refuses to run against any database other than `gam21_platform_it_test` — the database
 *     the integration fixture already owns and wipes, so nothing here can reach dev or
 *     production data. Checked against `SELECT DATABASE()`, not just against the variable.
 *  2. Refuses to run with NODE_ENV=production.
 *  3. Takes the credentials from the environment. Nothing is hardcoded, and the password is
 *     never printed or logged — only the username and what was created.
 *  4. Idempotent: every write is an upsert on the fixed ids below, so re-running repairs the
 *     seed instead of duplicating or deleting anything.
 *
 * Usage (PowerShell):
 *   cd Bar_management/api
 *   node --env-file=.env.e2e.local --import tsx scripts/seed-e2e-owner.ts
 *
 * `.env.e2e.local` holds DB_NAME, E2E_OWNER_USERNAME and E2E_OWNER_PASSWORD and is covered by
 * the repository's `.env.*` ignore rule, so the credential never reaches Git.
 */
import mysql from 'mysql2/promise'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { hashPassword, verifyPassword } from '../src/auth/password.js'

const allowedDatabase = 'gam21_platform_it_test'

/** Fixed ids so re-running upserts the same rows instead of growing the seed. */
const organizationId = Number(process.env.ORGANIZATION_ID ?? 1)
const venueId = Number(process.env.VENUE_ID ?? 1)
const zoneId = 9001
const firstTableId = 9101
const userId = 9501
const membershipId = 9501

const username = process.env.E2E_OWNER_USERNAME?.trim()
const password = process.env.E2E_OWNER_PASSWORD
const displayName = process.env.E2E_OWNER_DISPLAY_NAME?.trim() || 'E2E Chủ quán'

function fail(message: string): never {
  console.error(`seed-e2e-owner: ${message}`)
  process.exit(1)
}

if (process.env.NODE_ENV === 'production') fail('không chạy được với NODE_ENV=production.')
if (process.env.DB_NAME !== allowedDatabase) {
  fail(`chỉ chạy trên ${allowedDatabase}; DB_NAME hiện tại là ${process.env.DB_NAME ?? '(trống)'}.`)
}
if (!username) fail('thiếu E2E_OWNER_USERNAME.')
if (!password || password.length < 12) fail('thiếu E2E_OWNER_PASSWORD, hoặc ngắn hơn 12 ký tự.')

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: allowedDatabase,
  charset: 'utf8mb4',
})

try {
  // Re-assert the guard against the server's own answer, so a DB_NAME that names one database
  // while the connection points at another cannot slip through.
  const [currentRows] = await connection.query<(RowDataPacket & { current: string })[]>(
    'SELECT DATABASE() AS current',
  )
  if (currentRows[0]?.current !== allowedDatabase) {
    fail(`kết nối đang ở ${currentRows[0]?.current ?? '(không rõ)'}, không phải ${allowedDatabase}.`)
  }

  const passwordHash = await hashPassword(password)
  // Proves the stored hash is one the real login path accepts, before anything is written.
  if (!(await verifyPassword(password, passwordHash))) fail('hash mật khẩu không tự xác thực được.')

  await connection.beginTransaction()

  await connection.execute<ResultSetHeader>(
    `INSERT INTO organizations (id, code, name) VALUES (?, 'E2E', 'E2E Organization')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [organizationId],
  )
  await connection.execute<ResultSetHeader>(
    `INSERT INTO venues (id, organization_id, code, name, timezone,
       business_day_start_local, business_day_cutoff_local, status)
     VALUES (?, ?, 'E2E', 'E2E Venue', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00', 'ACTIVE')
     ON DUPLICATE KEY UPDATE status = 'ACTIVE'`,
    [venueId, organizationId],
  )
  await connection.execute<ResultSetHeader>(
    `INSERT INTO zones (id, organization_id, venue_id, code, name) VALUES (?, ?, ?, 'A', 'Khu A')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [zoneId, organizationId, venueId],
  )
  for (let index = 0; index < 4; index++) {
    const code = `A${index + 1}`
    // pos/width/height are all four required: the web catalog adapter refuses a table with
    // partial geometry (CATALOG_GEOMETRY_MISSING) rather than guessing where to draw it.
    await connection.execute<ResultSetHeader>(
      `INSERT INTO dining_tables
         (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity,
          seq_no, pos_x, pos_y, width, height)
       VALUES (?, ?, ?, ?, ?, ?, 'TABLE', 4, ?, ?, 40, 80, 80)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name), seq_no = VALUES(seq_no),
         pos_x = VALUES(pos_x), pos_y = VALUES(pos_y),
         width = VALUES(width), height = VALUES(height)`,
      [firstTableId + index, organizationId, venueId, zoneId, code, code,
        index + 1, 40 + index * 120],
    )
  }
  await connection.execute<ResultSetHeader>(
    `INSERT INTO booking_sources (organization_id, code, name) VALUES (?, 'HOTLINE', 'Hotline')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [organizationId],
  )

  await connection.execute<ResultSetHeader>(
    `INSERT INTO users (id, username, display_name, password_hash, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       username = VALUES(username), display_name = VALUES(display_name),
       password_hash = VALUES(password_hash), status = 'ACTIVE'`,
    [userId, username, displayName, passwordHash],
  )
  await connection.execute<ResultSetHeader>(
    `INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE organization_id = VALUES(organization_id)`,
    [membershipId, organizationId, userId],
  )
  const [roleRows] = await connection.query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM roles WHERE code = 'OWNER'`,
  )
  if (!roleRows.length) fail('không tìm thấy vai trò OWNER; migration chưa chạy xong.')
  await connection.execute<ResultSetHeader>(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)`,
    [organizationId, membershipId, roleRows[0]!.id, venueId],
  )

  await connection.commit()
  // The username is safe to show; the password deliberately is not printed anywhere.
  console.log(`seed-e2e-owner: OK trên ${allowedDatabase}`)
  console.log(`  tài khoản OWNER: ${username} (id ${userId}), org ${organizationId}, venue ${venueId}`)
  console.log('  ca vận hành khởi tạo: 17:00:00 → 05:00:00, 4 bàn A1–A4')
  console.log('  mật khẩu không được in ra; nó nằm trong .env.e2e.local (đã bị .gitignore bỏ qua).')
} catch (error) {
  await connection.rollback()
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`seed-e2e-owner: thất bại — ${detail}`)
  process.exit(1)
} finally {
  await connection.end()
}

import { hashPassword } from '../../src/auth/password.js'
import { databasePool } from '../../src/database/pool.js'
import { env } from '../../src/config/env.js'
import { initializeFixture, resetFixture } from './integration-fixture.js'

const password = process.env.E2E_PASSWORD ?? 'Browser-E2E-Pass-2026!'

if (env.nodeEnv !== 'test' || !env.database.name.endsWith('_test')) {
  throw new Error('Refusing to prepare browser fixture outside an isolated test database')
}

await initializeFixture()
await resetFixture()

const passwordHash = await hashPassword(password)
await databasePool.execute('UPDATE users SET password_hash = ?', [passwordHash])
await databasePool.execute('UPDATE dining_tables SET width = 46, height = 32 WHERE organization_id = ?', [env.organizationId])
await databasePool.execute(
  `INSERT INTO dining_tables
     (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y, width, height)
   VALUES (9810, ?, ?, 9801, 'A2', 'A2', 'TABLE', 4, 70, 10, 46, 32)`,
  [env.organizationId, env.venueId],
)

for (const [id, username, accessLevel] of [
  [9810, 'browser_admin_write', 'WRITE'],
  [9811, 'browser_admin_read', 'READ_ONLY'],
] as const) {
  await databasePool.execute(
    'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)',
    [id, username, username, passwordHash],
  )
  await databasePool.execute(
    'INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)',
    [id, env.organizationId, id],
  )
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id, access_level)
     SELECT ?, ?, id, ?, ? FROM roles WHERE code = 'ADMIN'`,
    [env.organizationId, id, env.venueId, accessLevel],
  )
}

await databasePool.end()
console.info(`Security E2E fixture prepared in ${env.database.name}`)

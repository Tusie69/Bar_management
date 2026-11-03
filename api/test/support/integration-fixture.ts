import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import request from 'supertest'

import { app } from '../../src/app.js'
import { hashPassword } from '../../src/auth/password.js'
import { env } from '../../src/config/env.js'
import { databasePool } from '../../src/database/pool.js'

export const actor = { organizationId: env.organizationId, venueId: env.venueId, userId: 9801, membershipId: 9801 }
export const otherVenueId = 9802
export const otherOrganizationId = 9803
export const tableId = 9801
export const foreignTableId = 9802
export const businessDate = '2030-10-24'
const password = randomBytes(24).toString('base64url')
let passwordHash: string

export async function initializeFixture(): Promise<void> {
  passwordHash = await hashPassword(password)
}

export async function clearFixture(): Promise<void> {
  if (env.database.name !== 'gam21_platform_it_test') throw new Error('Refusing destructive fixture outside integration database')
  await measureFixture('clearFixture', async () => {
    for (const table of ['operation_log', 'table_allocations', 'table_groups', 'table_holds',
      'waitlist_table_preferences', 'waitlist_contact_attempts', 'waitlist_entries', 'reservations', 'visits',
      'customers', 'table_combination_members', 'table_combinations', 'table_adjacencies', 'dining_tables',
      'zones', 'floors', 'auth_sessions', 'membership_roles', 'memberships', 'users', 'booking_sources', 'venues', 'organizations']) {
      await databasePool.execute(`DELETE FROM ${table}`)
    }
  })
}

async function measureFixture(name: string, operation: () => Promise<void>): Promise<void> {
  const started = performance.now()
  const warning = setTimeout(() => {
    console.warn(`[integration fixture] ${name} still running durationMs=${Math.round(performance.now() - started)}`)
  }, 9_000)
  let completed = false
  try {
    await operation()
    completed = true
  } finally {
    clearTimeout(warning)
    if (process.env.MEASURE_INTEGRATION_FIXTURE === '1' || !completed) {
      console.info(`[integration fixture] ${name} durationMs=${Math.round(performance.now() - started)} completed=${completed}`)
    }
  }
}

export async function resetFixture(): Promise<void> {
  await measureFixture('resetFixture', populateFixture)
}

async function populateFixture(): Promise<void> {
  await clearFixture()
  await databasePool.execute("INSERT INTO organizations (id, code, name) VALUES (?, 'INTEGRATION', 'Integration'), (?, 'FOREIGN', 'Foreign')",
    [actor.organizationId, otherOrganizationId])
  await databasePool.execute(
    `INSERT INTO venues (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local)
     VALUES (?, ?, 'HOME', 'Home', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00'),
       (?, ?, 'OTHER', 'Other', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00'),
       (?, ?, 'FOREIGN', 'Foreign', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00')`,
    [actor.venueId, actor.organizationId, otherVenueId, actor.organizationId, otherOrganizationId, otherOrganizationId],
  )
  for (const [id, username, role] of [[9801, 'integration_reception', 'RECEPTIONIST'],
    [9802, 'integration_owner', 'OWNER_ADMIN'], [9803, 'integration_care', 'CUSTOMER_CARE']] as const) {
    await databasePool.execute("INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)",
      [id, username, username, passwordHash])
    await databasePool.execute('INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)', [id, actor.organizationId, id])
    await databasePool.execute(
      'INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id) SELECT ?, ?, id, ? FROM roles WHERE code = ?',
      [actor.organizationId, id, actor.venueId, role],
    )
  }
  await databasePool.execute(
    "INSERT INTO zones (id, organization_id, venue_id, code, name) VALUES (?, ?, ?, 'A', 'A'), (?, ?, ?, 'B', 'B')",
    [tableId, actor.organizationId, actor.venueId, foreignTableId, actor.organizationId, otherVenueId],
  )
  await databasePool.execute(
    `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'A1', 'A1', 'TABLE', 4, 10, 10), (?, ?, ?, ?, 'B1', 'B1', 'TABLE', 4, 10, 10)`,
    [tableId, actor.organizationId, actor.venueId, tableId, foreignTableId, actor.organizationId, otherVenueId, foreignTableId],
  )
  await databasePool.execute("INSERT INTO booking_sources (organization_id, code, name) VALUES (?, 'HOTLINE', 'Hotline')", [actor.organizationId])
}

export async function login(username = 'integration_reception') {
  const agent = request.agent(app)
  const response = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin).send({ username, password })
  if (response.status !== 200) throw new Error(`Fixture login failed: ${response.status}`)
  return { agent, csrfToken: (response.body as { csrfToken: string }).csrfToken }
}

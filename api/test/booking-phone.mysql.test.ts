import type { RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import type { AuthenticatedActor } from '../src/auth/authenticated-actor.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createBooking, revealBookingPhone, updateBooking } from '../src/modules/bookings/booking.repository.js'

const integrationEnabled = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
const mysqlDescribe = integrationEnabled ? describe : describe.skip
const password = 'Phone integration password'
const organizationId = env.organizationId
const venueId = env.venueId
const otherVenueId = 9702
const receptionistId = 9701
const cashierId = 9702
const ownerId = 9703
const receptionistActor: AuthenticatedActor = {
  organizationId,
  venueId,
  userId: receptionistId,
  membershipId: 9701,
  authSessionId: 9701,
}
const ownerActor: AuthenticatedActor = { organizationId, venueId, userId: ownerId, membershipId: ownerId }
let passwordHash = ''
interface AuthBody { csrfToken: string }
interface RevealBody { phoneNumber: string }

async function clearFixture(): Promise<void> {
  for (const statement of [
    'DELETE FROM operation_log',
    'DELETE FROM table_allocations',
    'DELETE FROM table_groups',
    'DELETE FROM table_holds',
    'DELETE FROM waitlist_table_preferences',
    'DELETE FROM waitlist_contact_attempts',
    'DELETE FROM waitlist_entries',
    'DELETE FROM reservations',
    'DELETE FROM visits',
    'DELETE FROM customers',
    'DELETE FROM table_combination_members',
    'DELETE FROM table_combinations',
    'DELETE FROM table_adjacencies',
    'DELETE FROM dining_tables',
    'DELETE FROM zones',
    'DELETE FROM floors',
    'DELETE FROM auth_sessions',
    'DELETE FROM membership_roles',
    'DELETE FROM memberships',
    'DELETE FROM users',
    'DELETE FROM booking_sources',
    'DELETE FROM venues',
    'DELETE FROM organizations',
  ]) await databasePool.execute(statement)
}

async function resetFixture(): Promise<void> {
  await clearFixture()
  await databasePool.execute('INSERT INTO organizations (id, code, name) VALUES (?, ?, ?)', [organizationId, 'PHONE_TEST', 'Phone test'])
  await databasePool.execute(
    `INSERT INTO venues (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local)
     VALUES (?, ?, 'PHONE', 'Phone venue', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00'),
            (?, ?, 'OTHER', 'Other venue', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00')`,
    [venueId, organizationId, otherVenueId, organizationId],
  )
  await databasePool.execute(
    `INSERT INTO users (id, username, display_name, password_hash, status) VALUES
      (?, 'phone_reception', 'Phone reception', ?, 'ACTIVE'),
      (?, 'phone_cashier', 'Phone cashier', ?, 'ACTIVE'),
      (?, 'phone_owner', 'Phone owner', ?, 'ACTIVE')`,
    [receptionistId, passwordHash, cashierId, passwordHash, ownerId, passwordHash],
  )
  await databasePool.execute(
    `INSERT INTO memberships (id, organization_id, user_id, status) VALUES
      (9701, ?, ?, 'ACTIVE'), (9702, ?, ?, 'ACTIVE'), (9703, ?, ?, 'ACTIVE')`,
    [organizationId, receptionistId, organizationId, cashierId, organizationId, ownerId],
  )
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     SELECT ?, 9701, id, ? FROM roles WHERE code = 'RECEPTIONIST'
     UNION ALL
     SELECT ?, 9702, id, ? FROM roles WHERE code = 'CASHIER'
     UNION ALL
     SELECT ?, 9703, id, ? FROM roles WHERE code = 'OWNER_ADMIN'`,
    [organizationId, venueId, organizationId, venueId, organizationId, venueId],
  )
  await databasePool.execute(
    `INSERT INTO booking_sources (id, organization_id, code, name) VALUES (9701, ?, 'HOTLINE', 'Hotline')`,
    [organizationId],
  )
}

function input(phoneNumber?: string | null) {
  return {
    guestName: 'Phone test guest', partySize: 2,
    expectedAt: '2030-10-24T20:00:00+07:00', businessDate: '2030-10-24',
    sourceCode: 'HOTLINE', note: 'Phone integration',
    ...(phoneNumber === undefined ? {} : { phoneNumber }),
  }
}

async function login(username: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin).send({ username, password })
  expect(response.status).toBe(200)
  return { agent, csrfToken: (response.body as AuthBody).csrfToken }
}

mysqlDescribe('booking phone MySQL integration', () => {
  beforeAll(async () => { passwordHash = await hashPassword(password) })
  beforeEach(resetFixture)
  afterAll(clearFixture)

  it('persists ciphertext only, retains/updates/removes the phone with explicit semantics, and audits reveal', async () => {
    const created = await createBooking(receptionistActor, input('0987 654 321'))
    expect(created.phoneLast3).toBe('321')
    const [storedRows] = await databasePool.execute<(RowDataPacket & { phone_ciphertext: Buffer; phone_last3: string })[]>(
      'SELECT phone_ciphertext, phone_last3 FROM reservations WHERE id = ?', [created.id],
    )
    expect(storedRows[0]?.phone_ciphertext).toBeInstanceOf(Buffer)
    expect(storedRows[0]?.phone_ciphertext.toString('utf8')).not.toContain('987654321')

    const retained = await updateBooking(receptionistActor, created.id, {
      ...input(), guestName: 'Retained phone', expectedVersion: created.version,
    })
    expect(retained.phoneLast3).toBe('321')
    const updated = await updateBooking(receptionistActor, created.id, {
      ...input('0912 345 678'), guestName: 'Updated phone', expectedVersion: retained.version,
    })
    expect(updated.phoneLast3).toBe('678')
    expect(await revealBookingPhone(ownerActor, created.id)).toBe('+84912345678')
    const [audit] = await databasePool.execute<RowDataPacket[]>(
      `SELECT action, reason_code, changes FROM operation_log
       WHERE action = 'CUSTOMER_PHONE_REVEAL' AND entity_id = ?`, [created.id],
    )
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit[0])).not.toContain('84912345678')

    const removed = await updateBooking(receptionistActor, created.id, {
      ...input(null), guestName: 'Removed phone', expectedVersion: updated.version,
    })
    expect(removed.phoneLast3).toBeNull()
    await expect(revealBookingPhone(ownerActor, created.id)).rejects.toMatchObject({ status: 422 })
  })

  it('enforces session, CSRF, role, venue scope, rate limit, and no-store headers', async () => {
    const created = await createBooking(receptionistActor, input('0987 654 321'))
    expect((await request(app).post(`/api/v1/bookings/${created.id}/phone:reveal`).set('Origin', env.webOrigin)).status).toBe(401)

    const receptionist = await login('phone_reception')
    expect((await receptionist.agent.post(`/api/v1/bookings/${created.id}/phone:reveal`).set('Origin', env.webOrigin)).status).toBe(403)
    const deniedReceptionist = await receptionist.agent.post(`/api/v1/bookings/${created.id}/phone:reveal`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', receptionist.csrfToken).send({})
    expect(deniedReceptionist.status).toBe(403)
    const [deniedAudit] = await databasePool.execute<RowDataPacket[]>(
      `SELECT id FROM operation_log WHERE action = 'CUSTOMER_PHONE_REVEAL'`,
    )
    expect(deniedAudit).toHaveLength(0)

    const owner = await login('phone_owner')
    const reveal = await owner.agent.post(`/api/v1/bookings/${created.id}/phone:reveal`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', owner.csrfToken).send({})
    expect(reveal.status).toBe(200)
    expect(reveal.headers['cache-control']).toContain('no-store')
    expect((reveal.body as RevealBody).phoneNumber).toBe('+84987654321')
    const [ownerAudit] = await databasePool.execute<RowDataPacket[]>(
      `SELECT actor_user_id FROM operation_log WHERE action = 'CUSTOMER_PHONE_REVEAL' AND entity_id = ?`, [created.id],
    )
    expect(ownerAudit).toHaveLength(1)
    expect(Number(ownerAudit[0]?.actor_user_id)).toBe(ownerId)

    const cashier = await login('phone_cashier')
    const denied = await cashier.agent.post(`/api/v1/bookings/${created.id}/phone:reveal`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', cashier.csrfToken).send({})
    expect(denied.status).toBe(403)

    const otherVenueActor = { ...receptionistActor, venueId: otherVenueId }
    await expect(revealBookingPhone(otherVenueActor, created.id)).rejects.toMatchObject({ status: 404 })

    const maximum = env.phone.revealRateLimitMax ?? 0
    for (let count = 1; count < maximum; count += 1) {
      expect((await owner.agent.post(`/api/v1/bookings/${created.id}/phone:reveal`)
        .set('Origin', env.webOrigin).set('X-CSRF-Token', owner.csrfToken).send({})).status).toBe(200)
    }
    expect((await owner.agent.post(`/api/v1/bookings/${created.id}/phone:reveal`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', owner.csrfToken).send({})).status).toBe(429)
  })

  it('does not return a phone when audit persistence fails', async () => {
    const created = await createBooking(receptionistActor, input('0987 654 321'))
    await expect(revealBookingPhone({ ...receptionistActor, userId: 999_999 }, created.id)).rejects.toBeTruthy()
    const [rows] = await databasePool.execute<RowDataPacket[]>(
      `SELECT id FROM operation_log WHERE action = 'CUSTOMER_PHONE_REVEAL' AND entity_id = ?`, [created.id],
    )
    expect(rows).toHaveLength(0)
  })
})

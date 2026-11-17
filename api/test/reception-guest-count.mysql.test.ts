import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'

const enabled = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
const mysqlDescribe = enabled ? describe : describe.skip
const date = '2026-11-15'
const origin = env.webOrigin
const suffix = `${process.pid}_${Date.now().toString(36)}`

async function user(role: 'RECEPTIONIST' | 'CASHIER' | 'ADMIN', accessLevel: 'READ_ONLY' | null = null) {
  const username = `r1_${role.toLowerCase()}_${suffix}`
  const [created] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)`,
    [username, username, await hashPassword('Correct horse battery staple')],
  )
  const [membership] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO memberships (organization_id, user_id) VALUES (?, ?)`,
    [env.organizationId, created.insertId],
  )
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id, access_level)
     SELECT ?, ?, id, ?, ? FROM roles WHERE code = ?`,
    [env.organizationId, membership.insertId, env.venueId, accessLevel, role],
  )
  return { username, userId: created.insertId }
}

async function signIn(username: string, portal: 'receptionist' | 'cashier' | 'admin') {
  const agent = request.agent(app)
  const response = await agent.post('/api/v1/auth/login').set('Origin', origin).send({
    username,
    password: 'Correct horse battery staple',
    portal,
  })
  expect(response.status).toBe(200)
  return { agent, csrf: (response.body as { csrfToken: string }).csrfToken }
}

const payload = {
  businessDate: date,
  version: 0,
  arrivedBefore: 2,
  arrivedAfter: 3,
  arrivedTotal: 99,
  bookedTables: 6,
  bookedGuests: 12,
  returningGuests: 4,
}

interface GuestCountResponse {
  guestCount: typeof payload & { updatedAt: string | null }
}

interface ErrorResponse {
  error: { code: string }
}

mysqlDescribe('reception guest counts MySQL integration', () => {
  let receptionist: Awaited<ReturnType<typeof user>>
  let cashier: Awaited<ReturnType<typeof user>>
  let readOnlyAdmin: Awaited<ReturnType<typeof user>>

  beforeAll(async () => {
    await databasePool.execute(
      `INSERT INTO organizations (id, code, name) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [env.organizationId, `R1_${env.organizationId}`, 'R1 isolated test'],
    )
    await databasePool.execute(
      `INSERT INTO venues (id, organization_id, code, name) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [env.venueId, env.organizationId, `R1_${env.venueId}`, 'R1 isolated venue'],
    )
    receptionist = await user('RECEPTIONIST')
    cashier = await user('CASHIER')
    readOnlyAdmin = await user('ADMIN', 'READ_ONLY')
  })

  it('requires authentication', async () => {
    expect((await request(app).get(`/api/v1/reception/guest-counts?date=${date}`)).status).toBe(401)
  })

  it('returns zero without inserting, then saves all six values atomically with audit and version', async () => {
    const { agent, csrf } = await signIn(receptionist.username, 'receptionist')
    const empty = await agent.get(`/api/v1/reception/guest-counts?date=${date}`)
    expect(empty.status).toBe(200)
    expect((empty.body as GuestCountResponse).guestCount).toMatchObject({ version: 0, arrivedBefore: 0, arrivedTotal: 0 })
    const [before] = await databasePool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM reception_guest_counts WHERE business_date = ?`, [date],
    )
    expect(Number(before[0]?.total)).toBe(0)

    const saved = await agent.put('/api/v1/reception/guest-counts').set('Origin', origin).set('X-CSRF-Token', csrf).send(payload)
    expect(saved.status).toBe(200)
    expect((saved.body as GuestCountResponse).guestCount).toMatchObject({ ...payload, version: 1 })
    const reloaded = await agent.get(`/api/v1/reception/guest-counts?date=${date}`)
    expect((reloaded.body as GuestCountResponse).guestCount).toMatchObject({ arrivedBefore: 2, arrivedAfter: 3, arrivedTotal: 99, version: 1 })

    const [audit] = await databasePool.execute<RowDataPacket[]>(
      `SELECT action FROM operation_log WHERE actor_user_id = ? AND entity_type = 'guest_count' ORDER BY id DESC LIMIT 1`,
      [receptionist.userId],
    )
    expect(audit[0]?.action).toBe('RECEPTION_GUEST_COUNT_UPDATED')
  })

  it('rejects a stale concurrent update instead of silently overwriting', async () => {
    const { agent, csrf } = await signIn(receptionist.username, 'receptionist')
    const response = await agent.put('/api/v1/reception/guest-counts').set('Origin', origin).set('X-CSRF-Token', csrf).send(payload)
    expect(response.status).toBe(409)
    expect((response.body as ErrorResponse).error.code).toBe('GUEST_COUNT_VERSION_CONFLICT')
  })

  it('allows view but denies update to users without mutation permission and READ_ONLY admin', async () => {
    for (const [account, portal] of [[cashier, 'cashier'], [readOnlyAdmin, 'admin']] as const) {
      const { agent, csrf } = await signIn(account.username, portal)
      expect((await agent.get(`/api/v1/reception/guest-counts?date=${date}`)).status).toBe(200)
      expect((await agent.put('/api/v1/reception/guest-counts').set('Origin', origin).set('X-CSRF-Token', csrf).send({ ...payload, version: 1 })).status).toBe(403)
    }
  })
})

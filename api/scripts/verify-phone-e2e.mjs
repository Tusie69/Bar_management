import assert from 'node:assert/strict'
import { randomBytes, randomInt } from 'node:crypto'

import request from 'supertest'

if (process.env.DB_NAME !== 'gam21_platform_e2e_test') {
  throw new Error('Phone verification requires DB_NAME=gam21_platform_e2e_test')
}

// Use an isolated synthetic tenant; never replace existing test keys or fixtures.
process.env.NODE_ENV = 'test'
process.env.ORGANIZATION_ID = String(randomInt(100_000_000, 2_000_000_000))
process.env.VENUE_ID = process.env.ORGANIZATION_ID
process.env.SESSION_COOKIE_SECURE = 'false'
process.env.SESSION_COOKIE_SAME_SITE = 'lax'
process.env.SESSION_CSRF_SECRET = randomBytes(48).toString('base64url')
process.env.PHONE_ENCRYPTION_KEYS = `1:${randomBytes(32).toString('base64')}`
process.env.PHONE_HMAC_KEYS = `1:${randomBytes(32).toString('base64')}`
process.env.PHONE_ACTIVE_ENCRYPTION_KEY_ID = '1'
process.env.PHONE_ACTIVE_HMAC_KEY_ID = '1'
process.env.PHONE_REVEAL_RATE_LIMIT_MAX = '3'
process.env.PHONE_REVEAL_RATE_LIMIT_WINDOW_MS = '60000'
process.env.NO_SHOW_WORKER_ENABLED = 'false'

const { env } = await import('../src/config/env.ts')
const { databasePool } = await import('../src/database/pool.ts')
const { hashPassword } = await import('../src/auth/password.ts')
const { app } = await import('../src/app.ts')
const password = randomBytes(24).toString('base64url')
const suffix = String(env.organizationId)

async function login(username) {
  const agent = request.agent(app)
  const response = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin).send({ username, password })
  assert.ok(response.status === 200, 'Synthetic login failed')
  return { agent, csrfToken: response.body.csrfToken }
}

try {
  const [target] = await databasePool.query('SELECT DATABASE() AS name')
  assert.ok(target[0]?.name === 'gam21_platform_e2e_test', 'Unexpected connection target')
  await databasePool.execute('INSERT INTO organizations (id, code, name) VALUES (?, ?, ?)',
    [env.organizationId, `PHONE_${suffix}`, 'Synthetic phone verification'])
  await databasePool.execute(
    `INSERT INTO venues (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local)
     VALUES (?, ?, 'PHONE', 'Synthetic phone venue', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00')`,
    [env.venueId, env.organizationId],
  )
  const passwordHash = await hashPassword(password)
  const users = {}
  for (const [label, role] of [['reception', 'RECEPTIONIST'], ['owner', 'OWNER_ADMIN']]) {
    const username = `final_phone_${label}_${suffix}`
    const [user] = await databasePool.execute(
      'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)', [username, `Synthetic ${label}`, passwordHash],
    )
    const [membership] = await databasePool.execute(
      'INSERT INTO memberships (organization_id, user_id) VALUES (?, ?)', [env.organizationId, user.insertId],
    )
    const [assignment] = await databasePool.execute(
      'INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id) SELECT ?, ?, id, ? FROM roles WHERE code = ?',
      [env.organizationId, membership.insertId, env.venueId, role],
    )
    assert.ok(assignment.affectedRows === 1, 'Synthetic role assignment failed')
    users[label] = { username, id: user.insertId }
  }
  await databasePool.execute(
    "INSERT INTO booking_sources (organization_id, code, name) VALUES (?, 'HOTLINE', 'Synthetic hotline')", [env.organizationId],
  )
  const receptionist = await login(users.reception.username)
  const create = await receptionist.agent.post('/api/v1/bookings')
    .set('Origin', env.webOrigin).set('X-CSRF-Token', receptionist.csrfToken).send({
      guestName: 'Synthetic phone guest', partySize: 2, phoneNumber: '0900000123',
      expectedAt: '2030-10-24T20:00:00+07:00', businessDate: '2030-10-24', sourceCode: 'HOTLINE',
    })
  assert.ok(create.status === 201, 'Synthetic booking creation failed')
  const booking = create.body.booking
  assert.ok(booking.phoneLast3 === '123', 'Masked booking suffix mismatch')
  const [stored] = await databasePool.execute(
    'SELECT phone_ciphertext, phone_key_id, phone_hmac_key_id FROM reservations WHERE id = ? AND organization_id = ?',
    [booking.id, env.organizationId],
  )
  const ciphertext = stored[0]?.phone_ciphertext
  assert.ok(Buffer.isBuffer(ciphertext) && ciphertext.length > 28, 'Ciphertext missing')
  assert.ok(!ciphertext.includes(Buffer.from('0900000123')) && !ciphertext.includes(Buffer.from('+84900000123')), 'Plaintext persisted')
  assert.ok(stored[0].phone_key_id === 1 && stored[0].phone_hmac_key_id === 1, 'Key ids mismatch')
  for (const endpoint of ['/api/v1/bookings', '/api/v1/bookings/search']) {
    const response = await receptionist.agent.get(endpoint).query({ date: '2030-10-24', q: '123' })
    assert.ok(response.status === 200, 'Masked query failed')
    assert.ok(response.body.bookings.some(item => item.id === booking.id && item.phoneLast3 === '123'), 'Masked query omitted synthetic booking')
    assert.ok(!/0900000123|\+84900000123|phoneNumber|phone_ciphertext|phone_hash/.test(response.text), 'Masked response leaked phone material')
  }
  const denied = await receptionist.agent.post(`/api/v1/bookings/${booking.id}/phone:reveal`)
    .set('Origin', env.webOrigin).set('X-CSRF-Token', receptionist.csrfToken).send({})
  assert.ok(denied.status === 403, 'Receptionist reveal was not denied')
  const owner = await login(users.owner.username)
  const reveal = await owner.agent.post(`/api/v1/bookings/${booking.id}/phone:reveal`)
    .set('Origin', env.webOrigin).set('X-CSRF-Token', owner.csrfToken).send({})
  assert.ok(reveal.status === 200 && reveal.body.phoneNumber === '+84900000123', 'Owner reveal failed')
  assert.ok(reveal.headers['cache-control']?.includes('no-store') && reveal.headers.pragma === 'no-cache', 'Reveal caching headers missing')
  const [audit] = await databasePool.execute(
    "SELECT actor_user_id, reason_code, changes FROM operation_log WHERE organization_id = ? AND entity_id = ? AND action = 'CUSTOMER_PHONE_REVEAL'",
    [env.organizationId, booking.id],
  )
  assert.ok(audit.length === 1 && Number(audit[0].actor_user_id) === users.owner.id, 'Reveal audit missing or misattributed')
  assert.ok(!/0900000123|\+84900000123/.test(JSON.stringify(audit)), 'Audit leaked plaintext')
  console.log(JSON.stringify({ result: 'PASS', database: env.database.name, organizationId: env.organizationId,
    venueId: env.venueId, bookingId: booking.id, ciphertextStored: true, maskedListAndSearch: true,
    receptionistReveal: 403, ownerReveal: 200, noStore: true, auditWithoutPlaintext: true }))
} catch {
  console.error('Phone E2E verification failed; response bodies, credentials and phone values withheld.')
  process.exitCode = 1
} finally {
  await databasePool.end()
}

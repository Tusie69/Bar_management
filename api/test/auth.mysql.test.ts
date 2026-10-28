import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'

const integrationEnabled = process.env.RUN_MYSQL_INTEGRATION === '1'
  && /_test$/.test(process.env.DB_NAME ?? '')
const mysqlDescribe = integrationEnabled ? describe : describe.skip
const origin = env.webOrigin
const organizationId = env.organizationId
const venueId = env.venueId
const otherVenueId = venueId + 1
let validPasswordHash = ''

interface ErrorResponse {
  error: { code: string; message: string }
}

interface AuthResponse {
  user: { username: string }
  permissions: string[]
  csrfToken: string
}

function responseBody<T>(response: { text: string }): T {
  return JSON.parse(response.text) as T
}

async function createUser(
  username: string,
  options: {
    passwordHash?: string
    userStatus?: 'ACTIVE' | 'DISABLED'
    membershipStatus?: 'ACTIVE' | 'SUSPENDED' | 'ENDED'
    roleCode?: string
    roleVenueId?: number | null
  } = {},
): Promise<{ userId: number; membershipId: number }> {
  const [userResult] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO users (username, display_name, password_hash, status)
     VALUES (?, ?, ?, ?)`,
    [username, username, options.passwordHash ?? validPasswordHash, options.userStatus ?? 'ACTIVE'],
  )
  const membershipStatus = options.membershipStatus ?? 'ACTIVE'
  const [membershipResult] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO memberships (organization_id, user_id, status, ended_at)
     VALUES (?, ?, ?, ?)`,
    [organizationId, userResult.insertId, membershipStatus, membershipStatus === 'ENDED' ? new Date() : null],
  )
  if (options.roleCode) {
    await databasePool.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
       SELECT ?, ?, id, ? FROM roles WHERE code = ?`,
      [organizationId, membershipResult.insertId, options.roleVenueId ?? venueId, options.roleCode],
    )
  }
  return { userId: userResult.insertId, membershipId: membershipResult.insertId }
}

async function login(agent: ReturnType<typeof request.agent>, username: string, password = 'Correct horse battery staple') {
  return agent.post('/api/v1/auth/login').set('Origin', origin).send({ username, password })
}

async function grantRole(membershipId: number, roleCode: string, scopedVenueId = venueId): Promise<void> {
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     SELECT ?, ?, id, ? FROM roles WHERE code = ?`,
    [organizationId, membershipId, scopedVenueId, roleCode],
  )
}

mysqlDescribe('session authentication and RBAC MySQL integration', () => {
  beforeAll(async () => {
    validPasswordHash = await hashPassword('Correct horse battery staple')
    await databasePool.execute(
      `INSERT INTO organizations (id, code, name) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [organizationId, `AUTH_${organizationId}`, 'Authentication integration test'],
    )
    await databasePool.execute(
      `INSERT INTO venues (id, organization_id, code, name) VALUES
        (?, ?, ?, 'Primary venue'), (?, ?, ?, 'Other venue')
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [venueId, organizationId, `AUTH_${venueId}`, otherVenueId, organizationId, `AUTH_${otherVenueId}`],
    )
  })

  it('rejects a mutation whose Origin is not explicitly allowed', async () => {
    const response = await request(app).post('/api/v1/auth/login').set('Origin', 'https://evil.example').send({
      username: 'nobody',
      password: 'irrelevant',
    })
    expect(response.status).toBe(403)
    expect(responseBody<ErrorResponse>(response).error.code).toBe('ORIGIN_NOT_ALLOWED')
  })

  it('rejects plaintext/seed markers and returns the same credential error', async () => {
    await createUser('marker_user', { passwordHash: '!DEMO_NO_LOGIN', roleCode: 'RECEPTIONIST' })
    const existing = await login(request.agent(app), 'marker_user', 'anything')
    const missing = await login(request.agent(app), 'missing_user', 'anything')
    expect(existing.status).toBe(401)
    expect(missing.status).toBe(401)
    expect(responseBody<ErrorResponse>(existing).error).toEqual(responseBody<ErrorResponse>(missing).error)
  })

  it('rejects disabled users and inactive memberships during login', async () => {
    await createUser('disabled_user', { userStatus: 'DISABLED', roleCode: 'RECEPTIONIST' })
    await createUser('suspended_member', { membershipStatus: 'SUSPENDED', roleCode: 'RECEPTIONIST' })
    expect((await login(request.agent(app), 'disabled_user')).status).toBe(401)
    expect((await login(request.agent(app), 'suspended_member')).status).toBe(401)
  })

  it('creates an HttpOnly session cookie, returns a session-bound CSRF token and never exposes the raw token', async () => {
    await createUser('valid_user', { roleCode: 'RECEPTIONIST' })
    const agent = request.agent(app)
    const response = await login(agent, 'valid_user')
    expect(response.status).toBe(200)
    const body = responseBody<AuthResponse>(response)
    expect(body.permissions).toContain('visit.end')
    expect(body.csrfToken).toEqual(expect.any(String))
    expect(body).not.toHaveProperty('sessionToken')
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly')
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax')
    const me = await agent.get('/api/v1/auth/me')
    expect(me.status).toBe(200)
    expect(responseBody<AuthResponse>(me).user.username).toBe('valid_user')

    const [rows] = await databasePool.execute<(RowDataPacket & { length: number })[]>(
      `SELECT OCTET_LENGTH(token_hash) AS length FROM auth_sessions AS s
       JOIN users AS u ON u.id = s.user_id WHERE u.username = ?`,
      ['valid_user'],
    )
    expect(Number(rows[0]?.length)).toBe(32)
  })

  it('requires the correct session-bound CSRF token and invalidates it on logout', async () => {
    await createUser('csrf_user', { roleCode: 'RECEPTIONIST' })
    const agent = request.agent(app)
    const response = await login(agent, 'csrf_user')
    const csrfToken = responseBody<AuthResponse>(response).csrfToken

    expect((await agent.post('/api/v1/auth/logout').set('Origin', origin)).status).toBe(403)
    expect((await agent.post('/api/v1/auth/logout').set('Origin', origin).set('X-CSRF-Token', 'wrong')).status).toBe(403)
    expect((await agent.post('/api/v1/auth/logout').set('Origin', origin).set('X-CSRF-Token', csrfToken)).status).toBe(204)
    const afterLogout = await agent.get('/api/v1/auth/me')
    expect(afterLogout.status).toBe(401)
  })

  it('rejects a database-revoked session on the next request', async () => {
    const fixture = await createUser('revoked_session_user', { roleCode: 'RECEPTIONIST' })
    const agent = request.agent(app)
    expect((await login(agent, 'revoked_session_user')).status).toBe(200)
    await databasePool.execute(
      `UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'ADMIN_REVOKED'
       WHERE user_id = ? AND revoked_at IS NULL`,
      [fixture.userId],
    )
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401)
  })

  it('rejects an expired session on the next request', async () => {
    const fixture = await createUser('expired_session_user', { roleCode: 'RECEPTIONIST' })
    const agent = request.agent(app)
    expect((await login(agent, 'expired_session_user')).status).toBe(200)
    await databasePool.execute(
      `UPDATE auth_sessions
       SET created_at = UTC_TIMESTAMP(3) - INTERVAL 2 SECOND,
           expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND
       WHERE user_id = ?`,
      [fixture.userId],
    )
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401)
  })

  it('rejects a disabled membership on the next request', async () => {
    const fixture = await createUser('disabled_membership_user', { roleCode: 'RECEPTIONIST' })
    const agent = request.agent(app)
    expect((await login(agent, 'disabled_membership_user')).status).toBe(200)
    await databasePool.execute("UPDATE memberships SET status = 'SUSPENDED' WHERE id = ?", [fixture.membershipId])
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401)
  })

  it('observes permission revocation after login without a permission cache', async () => {
    const fixture = await createUser('revoked_permission_user', { roleCode: 'RECEPTIONIST' })
    await grantRole(fixture.membershipId, 'CUSTOMER_CARE')
    const agent = request.agent(app)
    const signedIn = await login(agent, 'revoked_permission_user')
    const signedInBody = responseBody<AuthResponse>(signedIn)
    expect(signedInBody.permissions).toContain('visit.end')
    await databasePool.execute(
      `UPDATE membership_roles SET revoked_at = UTC_TIMESTAMP(3), revoked_by_user_id = ?
       WHERE membership_id = ? AND role_id = (SELECT id FROM roles WHERE code = 'RECEPTIONIST')
         AND revoked_at IS NULL`,
      [fixture.userId, fixture.membershipId],
    )
    const denied = await agent
      .post('/api/v1/visits/1/close')
      .set('Origin', origin)
      .set('X-CSRF-Token', signedInBody.csrfToken)
      .send({ version: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    expect(denied.status).toBe(403)
    expect(responseBody<ErrorResponse>(denied).error.code).toBe('PERMISSION_DENIED')
  })

  it('closes a visit through the authenticated endpoint and records the authenticated user', async () => {
    const fixture = await createUser('close_endpoint_user', { roleCode: 'RECEPTIONIST' })
    const zoneId = venueId + 20_000
    const tableId = venueId + 20_001
    await databasePool.execute(
      'INSERT INTO zones (id, organization_id, venue_id, code, name) VALUES (?, ?, ?, ?, ?)',
      [zoneId, organizationId, venueId, `AUTH_ZONE_${venueId}`, 'Auth zone'],
    )
    await databasePool.execute(
      `INSERT INTO dining_tables
        (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
       VALUES (?, ?, ?, ?, ?, 'Auth table', 'TABLE', 4, 10, 10)`,
      [tableId, organizationId, venueId, zoneId, `AUTH_T_${venueId}`],
    )
    const [visitResult] = await databasePool.execute<ResultSetHeader>(
      `INSERT INTO visits
        (organization_id, venue_id, origin, contact_name, guest_count, started_at, business_date, created_by_user_id)
       VALUES (?, ?, 'WALK_IN', 'Auth close', 2, UTC_TIMESTAMP(3), '2026-10-24', ?)`,
      [organizationId, venueId, fixture.userId],
    )
    await databasePool.execute(
      `INSERT INTO table_allocations
        (organization_id, venue_id, table_id, kind, visit_id, starts_at, business_date, created_by_user_id)
       VALUES (?, ?, ?, 'USAGE', ?, UTC_TIMESTAMP(3), '2026-10-24', ?)`,
      [organizationId, venueId, tableId, visitResult.insertId, fixture.userId],
    )
    const agent = request.agent(app)
    const signedIn = responseBody<AuthResponse>(await login(agent, 'close_endpoint_user'))
    const closed = await agent
      .post(`/api/v1/visits/${visitResult.insertId}/close`)
      .set('Origin', origin)
      .set('X-CSRF-Token', signedIn.csrfToken)
      .send({ version: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    expect(closed.status).toBe(200)
    const [rows] = await databasePool.execute<RowDataPacket[]>(
      'SELECT ended_by_user_id FROM visits WHERE id = ?',
      [visitResult.insertId],
    )
    expect(Number(rows[0]?.ended_by_user_id)).toBe(fixture.userId)
  })

  it('rejects an authenticated user without visit.end', async () => {
    await createUser('no_close_permission_user', { roleCode: 'CUSTOMER_CARE' })
    const agent = request.agent(app)
    const signedIn = responseBody<AuthResponse>(await login(agent, 'no_close_permission_user'))
    const denied = await agent
      .post('/api/v1/visits/1/close')
      .set('Origin', origin)
      .set('X-CSRF-Token', signedIn.csrfToken)
      .send({ version: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    expect(denied.status).toBe(403)
    expect(responseBody<ErrorResponse>(denied).error.code).toBe('PERMISSION_DENIED')
  })

  it('does not allow a role scoped to another venue to establish a session for this venue', async () => {
    await createUser('cross_venue_user', {
      roleCode: 'RECEPTIONIST',
      roleVenueId: otherVenueId,
    })
    const agent = request.agent(app)
    const denied = await login(agent, 'cross_venue_user')
    expect(denied.status).toBe(403)
    expect(responseBody<ErrorResponse>(denied).error.code).toBe('VENUE_ACCESS_UNAVAILABLE')
  })

  it('rate-limits repeated failed logins for the same IP and username', async () => {
    await createUser('rate_limited_user')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(request.agent(app), 'rate_limited_user', 'wrong')
      expect(response.status).toBe(401)
    }
    const blocked = await login(request.agent(app), 'rate_limited_user', 'wrong')
    expect(blocked.status).toBe(429)
    expect(responseBody<ErrorResponse>(blocked).error.code).toBe('LOGIN_RATE_LIMITED')
  })
})

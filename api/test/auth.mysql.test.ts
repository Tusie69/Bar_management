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
const usernameSuffix = `${process.pid}_${Date.now().toString(36)}`

function testUsername(base: string): string {
  return `${base}_${usernameSuffix}`
}

interface ErrorResponse {
  error: { code: string; message: string }
}

interface AuthResponse {
  user: { username: string; roles: string[] }
  permissions: string[]
  csrfToken: string
  portal: string
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
  const actualUsername = testUsername(username)
  const [userResult] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO users (username, display_name, password_hash, status)
     VALUES (?, ?, ?, ?)`,
    [actualUsername, actualUsername, options.passwordHash ?? validPasswordHash, options.userStatus ?? 'ACTIVE'],
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

async function login(
  agent: ReturnType<typeof request.agent>,
  username: string,
  password = 'Correct horse battery staple',
  portal = 'receptionist',
) {
  return agent.post('/api/v1/auth/login').set('Origin', origin).send({
    username: testUsername(username), password, portal,
  })
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
      portal: 'receptionist',
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
    const revoked = await createUser('revoked_role_user', { roleCode: 'RECEPTIONIST' })
    await databasePool.execute(
      `UPDATE membership_roles SET revoked_at = UTC_TIMESTAMP(3), revoked_by_user_id = ?
       WHERE membership_id = ? AND revoked_at IS NULL`,
      [revoked.userId, revoked.membershipId],
    )
    expect((await login(request.agent(app), 'disabled_user')).status).toBe(401)
    expect((await login(request.agent(app), 'suspended_member')).status).toBe(401)
    expect((await login(request.agent(app), 'revoked_role_user')).status).toBe(403)
  })

  it('validates portal and never creates a session for invalid credentials or a denied portal', async () => {
    await createUser('portal_receptionist', { roleCode: 'RECEPTIONIST' })
    const [beforeRows] = await databasePool.execute<(RowDataPacket & { count: number })[]>(
      `SELECT COUNT(*) AS count FROM auth_sessions AS s
       JOIN users AS u ON u.id = s.user_id WHERE u.username = ?`,
      [testUsername('portal_receptionist')],
    )
    const invalidPortal = await request(app).post('/api/v1/auth/login').set('Origin', origin).send({
      username: testUsername('portal_receptionist'), password: 'Correct horse battery staple', portal: 'unknown',
    })
    expect(invalidPortal.status).toBe(400)
    expect(responseBody<ErrorResponse>(invalidPortal).error.code).toBe('INVALID_PORTAL')
    expect((await login(request.agent(app), 'portal_receptionist', 'wrong')).status).toBe(401)
    const wrongPortal = await login(request.agent(app), 'portal_receptionist', undefined, 'admin')
    expect(wrongPortal.status).toBe(403)
    expect(responseBody<ErrorResponse>(wrongPortal).error.code).toBe('PORTAL_ACCESS_DENIED')
    const [afterRows] = await databasePool.execute<(RowDataPacket & { count: number })[]>(
      `SELECT COUNT(*) AS count FROM auth_sessions AS s
       JOIN users AS u ON u.id = s.user_id WHERE u.username = ?`,
      [testUsername('portal_receptionist')],
    )
    expect(Number(afterRows[0]?.count)).toBe(Number(beforeRows[0]?.count))
  })

  it('binds multi-role sessions to one portal without unioning permissions', async () => {
    const fixture = await createUser('multi_portal_user', { roleCode: 'RECEPTIONIST' })
    await grantRole(fixture.membershipId, 'OWNER_ADMIN')

    const receptionAgent = request.agent(app)
    const reception = responseBody<AuthResponse>(
      await login(receptionAgent, 'multi_portal_user', undefined, 'receptionist'),
    )
    expect(reception.portal).toBe('receptionist')
    expect(reception.user.roles).toEqual(['RECEPTIONIST'])
    expect(reception.permissions).not.toContain('venue.configure')
    expect(reception.permissions).not.toContain('customer.phone.reveal')
    const deniedAdminWrite = await receptionAgent.patch('/api/v1/tables/1/configuration')
      .set('Origin', origin).set('X-CSRF-Token', reception.csrfToken).send({})
    expect(deniedAdminWrite.status).toBe(403)
    expect(responseBody<ErrorResponse>(deniedAdminWrite).error.code).toBe('PERMISSION_DENIED')

    const admin = responseBody<AuthResponse>(await login(request.agent(app), 'multi_portal_user', undefined, 'admin'))
    expect(admin.portal).toBe('admin')
    expect(admin.user.roles).toEqual(['OWNER_ADMIN'])
    expect(admin.permissions).toContain('venue.configure')
    expect(admin.permissions).toContain('customer.phone.reveal')
  })

  it('allows an owner only through the admin portal', async () => {
    await createUser('portal_owner', { roleCode: 'OWNER_ADMIN' })
    expect((await login(request.agent(app), 'portal_owner', undefined, 'receptionist')).status).toBe(403)
    const accepted = await login(request.agent(app), 'portal_owner', undefined, 'admin')
    expect(accepted.status).toBe(200)
    expect(responseBody<AuthResponse>(accepted).portal).toBe('admin')
  })

  it('creates an HttpOnly session cookie, returns a session-bound CSRF token and never exposes the raw token', async () => {
    await createUser('valid_user', { roleCode: 'RECEPTIONIST' })
    const agent = request.agent(app)
    const response = await login(agent, 'valid_user')
    expect(response.status).toBe(200)
    const body = responseBody<AuthResponse>(response)
    expect(body.user.roles).toEqual(['RECEPTIONIST'])
    expect(body.portal).toBe('receptionist')
    expect(body.permissions).toContain('visit.end')
    expect(body.csrfToken).toEqual(expect.any(String))
    expect(body).not.toHaveProperty('sessionToken')
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly')
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax')
    const me = await agent.get('/api/v1/auth/me')
    expect(me.status).toBe(200)
    expect(responseBody<AuthResponse>(me).user.username).toBe(testUsername('valid_user'))
    expect(responseBody<AuthResponse>(me).user.roles).toEqual(['RECEPTIONIST'])
    expect(responseBody<AuthResponse>(me).portal).toBe('receptionist')

    const [rows] = await databasePool.execute<(RowDataPacket & { length: number; portal: string })[]>(
      `SELECT OCTET_LENGTH(token_hash) AS length, portal FROM auth_sessions AS s
       JOIN users AS u ON u.id = s.user_id WHERE u.username = ?`,
      [testUsername('valid_user')],
    )
    expect(Number(rows[0]?.length)).toBe(32)
    expect(rows[0]?.portal).toBe('receptionist')
  })

  it('returns current venue and organization-wide role codes, excluding foreign and revoked grants', async () => {
    const fixture = await createUser('role_payload_user', { roleCode: 'OWNER_ADMIN' })
    await grantRole(fixture.membershipId, 'CASHIER', otherVenueId)
    await grantRole(fixture.membershipId, 'RECEPTIONIST')
    await databasePool.execute(
      `UPDATE membership_roles SET revoked_at = UTC_TIMESTAMP(3), revoked_by_user_id = ?
       WHERE membership_id = ? AND role_id = (SELECT id FROM roles WHERE code = 'RECEPTIONIST')`,
      [fixture.userId, fixture.membershipId],
    )
    await databasePool.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
       SELECT ?, ?, id, NULL FROM roles WHERE code = 'CUSTOMER_CARE'`,
      [organizationId, fixture.membershipId],
    )
    const agent = request.agent(app)
    const signedIn = await login(agent, 'role_payload_user', undefined, 'admin')
    expect(signedIn.status).toBe(200)
    expect(responseBody<AuthResponse>(signedIn).user.roles).toEqual(['OWNER_ADMIN'])
    await databasePool.execute(
      `UPDATE membership_roles SET revoked_at = UTC_TIMESTAMP(3), revoked_by_user_id = ?
       WHERE membership_id = ? AND role_id = (SELECT id FROM roles WHERE code = 'OWNER_ADMIN')`,
      [fixture.userId, fixture.membershipId],
    )
    const me = await agent.get('/api/v1/auth/me')
    expect(me.status).toBe(401)
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

  it('invalidates a portal session when its portal role is revoked', async () => {
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
    expect(denied.status).toBe(401)
    expect(responseBody<ErrorResponse>(denied).error.code).toBe('SESSION_INVALID')
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
    const signedIn = responseBody<AuthResponse>(await login(agent, 'no_close_permission_user', undefined, 'customer-care'))
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
    expect(responseBody<ErrorResponse>(denied).error.code).toBe('PORTAL_ACCESS_DENIED')
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

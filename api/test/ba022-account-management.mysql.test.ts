import type { RowDataPacket } from 'mysql2/promise'
import request, { type Agent } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { verifyPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  actor, clearFixture, initializeFixture, login, loginAtPortal, otherVenueId, resetFixture,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const strongPassword = 'TU09-Strong-Password-0001'
const changedPassword = 'TU09-Changed-Password-0002'
const resetPassword = 'TU09-Reset-Password-0003'

interface AccountView {
  id: number
  username: string
  status: 'ACTIVE' | 'DISABLED'
  roles: string[]
  accessLevel: 'WRITE' | 'READ_ONLY' | null
  version: number
}

interface SignedIn {
  agent: Agent
  csrfToken: string
  body: { user: { roles: string[]; accessLevel: 'WRITE' | 'READ_ONLY' | null }; permissions: string[] }
}

async function signIn(username: string, password: string, portal = 'admin'): Promise<SignedIn> {
  const agent = request.agent(app)
  const response = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin)
    .send({ username, password, portal })
  expect(response.status).toBe(200)
  const body = response.body as unknown as SignedIn['body'] & { csrfToken: string }
  return { agent, csrfToken: body.csrfToken, body }
}

function post(session: SignedIn, path: string, body: Record<string, unknown>) {
  return session.agent.post(path).set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send(body)
}

async function owner(): Promise<SignedIn> {
  const fixture = await login('integration_owner')
  const me = await fixture.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
  return { agent: fixture.agent, csrfToken: fixture.csrfToken, body: me.body as SignedIn['body'] }
}

async function createAccount(session: SignedIn, body: Record<string, unknown>): Promise<AccountView> {
  const response = await post(session, '/api/v1/accounts', body)
  expect(response.status).toBe(201)
  return (response.body as { account: AccountView }).account
}

async function createAdmin(session: SignedIn, username: string, accessLevel: 'WRITE' | 'READ_ONLY'): Promise<AccountView> {
  return createAccount(session, {
    username, displayName: username, password: strongPassword, roleCode: 'ADMIN', accessLevel,
  })
}

mysqlDescribe('TU-07/TU-08/TU-09 account and admin access model', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  it('has migrated OWNER in place and exposes the approved role model only', async () => {
    const [roles] = await databasePool.execute<(RowDataPacket & { id: number; code: string })[]>(
      'SELECT id, code FROM roles ORDER BY id',
    )
    expect(roles.map((row) => row.code).sort()).toEqual(['ADMIN', 'CASHIER', 'CUSTOMER_CARE', 'OWNER', 'RECEPTIONIST'])
    expect(roles.some((row) => row.code === 'OWNER_ADMIN')).toBe(false)
    expect(Number(roles.find((row) => row.code === 'OWNER')?.id)).toBe(1)
    const [columns] = await databasePool.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'membership_roles' AND column_name = 'access_level'`,
    )
    expect(columns).toHaveLength(1)
  })

  it('allows OWNER and both ADMIN levels at /admin but denies a receptionist', async () => {
    const ownerSession = await owner()
    expect(ownerSession.body.user.roles).toEqual(['OWNER'])
    expect(ownerSession.body.user.accessLevel).toBeNull()
    const write = await createAdmin(ownerSession, 'tu_admin_write', 'WRITE')
    const readOnly = await createAdmin(ownerSession, 'tu_admin_read', 'READ_ONLY')
    expect(write.accessLevel).toBe('WRITE')
    expect(readOnly.accessLevel).toBe('READ_ONLY')

    const writeLogin = await signIn('tu_admin_write', strongPassword)
    expect(writeLogin.body.user.roles).toEqual(['ADMIN'])
    expect(writeLogin.body.user.accessLevel).toBe('WRITE')
    expect(writeLogin.body.permissions).toContain('user.manage')
    expect(writeLogin.body.permissions).toContain('customer.phone.reveal')

    const readLogin = await signIn('tu_admin_read', strongPassword)
    expect(readLogin.body.user.accessLevel).toBe('READ_ONLY')
    expect(readLogin.body.permissions).toContain('user.read')
    expect(readLogin.body.permissions).toContain('customer.phone.reveal')
    expect(readLogin.body.permissions).not.toContain('user.manage')
    expect(readLogin.body.permissions).not.toContain('reservation.create')

    const denied = await loginAtPortal('integration_reception', 'admin')
    expect(denied.status).toBe(403)
    expect((denied.body as { error: { code: string } }).error.code).toBe('PORTAL_ACCESS_DENIED')
    const receptionist = await login('integration_reception')
    expect((await receptionist.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)).status).toBe(403)
  })

  it('lets OWNER create ADMIN, lets ADMIN WRITE create staff, and blocks delegated ADMIN creation', async () => {
    const ownerSession = await owner()
    await createAdmin(ownerSession, 'tu_delegated_admin', 'WRITE')
    const admin = await signIn('tu_delegated_admin', strongPassword)

    const staff = await createAccount(admin, {
      username: 'tu_staff', displayName: 'TU Staff', password: strongPassword, roleCode: 'RECEPTIONIST',
    })
    expect(staff.roles).toEqual(['RECEPTIONIST'])

    const denied = await post(admin, '/api/v1/accounts', {
      username: 'tu_illegal_admin', displayName: 'Illegal', password: strongPassword,
      roleCode: 'ADMIN', accessLevel: 'WRITE',
    })
    expect(denied.status).toBe(403)
    expect((denied.body as { error: { code: string } }).error.code).toBe('ADMIN_CREATION_DENIED')

    const ownerDenied = await post(ownerSession, '/api/v1/accounts', {
      username: 'tu_illegal_owner', displayName: 'Illegal', password: strongPassword, roleCode: 'OWNER',
    })
    expect(ownerDenied.status).toBe(403)
    expect((ownerDenied.body as { error: { code: string } }).error.code).toBe('OWNER_CREATION_DENIED')
  })

  it('blocks every delegated mutation for ADMIN READ_ONLY while preserving self password change', async () => {
    const ownerSession = await owner()
    const readAccount = await createAdmin(ownerSession, 'tu_read_only', 'READ_ONLY')
    const readOnly = await signIn('tu_read_only', strongPassword)

    const list = await readOnly.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
    expect(list.status).toBe(200)
    const mutation = await post(readOnly, `/api/v1/accounts/${readAccount.id}/status`, {
      version: readAccount.version, status: 'DISABLED',
    })
    expect(mutation.status).toBe(403)

    const changed = await post(readOnly, '/api/v1/accounts/me/password', {
      currentPassword: strongPassword, newPassword: changedPassword,
    })
    expect(changed.status).toBe(200)
    expect((await readOnly.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status).toBe(401)
    await signIn('tu_read_only', changedPassword)
  })

  it('lets OWNER change ADMIN access and revokes the old session immediately', async () => {
    const ownerSession = await owner()
    const account = await createAdmin(ownerSession, 'tu_access_change', 'WRITE')
    const oldAdmin = await signIn('tu_access_change', strongPassword)
    expect(oldAdmin.body.permissions).toContain('reservation.create')

    const changed = await post(ownerSession, `/api/v1/accounts/${account.id}/access-level`, {
      version: account.version, accessLevel: 'READ_ONLY',
    })
    expect(changed.status).toBe(200)
    expect((changed.body as { account: AccountView }).account.accessLevel).toBe('READ_ONLY')
    const ended = await oldAdmin.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
    expect(ended.status).toBe(401)
    expect((ended.body as { error: { code: string } }).error.code).toBe('SESSION_REVOKED')
    const fresh = await signIn('tu_access_change', strongPassword)
    expect(fresh.body.permissions).not.toContain('reservation.create')
  })

  it('enforces the status target matrix for OWNER and ADMIN WRITE', async () => {
    const ownerSession = await owner()
    const adminAccount = await createAdmin(ownerSession, 'tu_status_admin', 'WRITE')
    const admin = await signIn('tu_status_admin', strongPassword)
    const staff = await createAccount(admin, {
      username: 'tu_status_staff', displayName: 'Staff', password: strongPassword, roleCode: 'CASHIER',
    })

    const lockedStaff = await post(admin, `/api/v1/accounts/${staff.id}/status`, {
      version: staff.version, status: 'DISABLED',
    })
    expect(lockedStaff.status).toBe(200)
    const unlockedStaff = await post(admin, `/api/v1/accounts/${staff.id}/status`, {
      version: (lockedStaff.body as { account: AccountView }).account.version, status: 'ACTIVE',
    })
    expect(unlockedStaff.status).toBe(200)

    const adminLocksAdmin = await post(admin, `/api/v1/accounts/${adminAccount.id}/status`, {
      version: adminAccount.version, status: 'DISABLED',
    })
    expect(adminLocksAdmin.status).toBe(409) // self-management is rejected first
    const secondAdmin = await createAdmin(ownerSession, 'tu_status_admin_2', 'WRITE')
    const denied = await post(admin, `/api/v1/accounts/${secondAdmin.id}/status`, {
      version: secondAdmin.version, status: 'DISABLED',
    })
    expect(denied.status).toBe(403)

    const ownerLocksAdmin = await post(ownerSession, `/api/v1/accounts/${secondAdmin.id}/status`, {
      version: secondAdmin.version, status: 'DISABLED',
    })
    expect(ownerLocksAdmin.status).toBe(200)
    const ownerUnlocksAdmin = await post(ownerSession, `/api/v1/accounts/${secondAdmin.id}/status`, {
      version: (ownerLocksAdmin.body as { account: AccountView }).account.version, status: 'ACTIVE',
    })
    expect(ownerUnlocksAdmin.status).toBe(200)
  })

  it('resets staff passwords without returning a secret and revokes old sessions', async () => {
    const ownerSession = await owner()
    await createAdmin(ownerSession, 'tu_reset_admin', 'WRITE')
    const admin = await signIn('tu_reset_admin', strongPassword)
    const staff = await createAccount(admin, {
      username: 'tu_reset_staff', displayName: 'Staff', password: strongPassword, roleCode: 'RECEPTIONIST',
    })
    const staffSession = await signIn('tu_reset_staff', strongPassword, 'receptionist')

    const reset = await post(admin, `/api/v1/accounts/${staff.id}/password-reset`, {
      version: staff.version, newPassword: resetPassword,
    })
    expect(reset.status).toBe(200)
    expect(JSON.stringify(reset.body)).not.toContain(resetPassword)
    expect((await staffSession.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status).toBe(401)
    const oldPasswordLogin = await request(app).post('/api/v1/auth/login').set('Origin', env.webOrigin)
      .send({ username: 'tu_reset_staff', password: strongPassword, portal: 'receptionist' })
    expect(oldPasswordLogin.status).toBe(401)
    expect((oldPasswordLogin.body as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS')
    await signIn('tu_reset_staff', resetPassword, 'receptionist')

    const [rows] = await databasePool.execute<(RowDataPacket & { password_hash: string })[]>(
      'SELECT password_hash FROM users WHERE id = ?', [staff.id],
    )
    expect(await verifyPassword(resetPassword, rows[0]!.password_hash)).toBe(true)
    expect(rows[0]!.password_hash).not.toContain(resetPassword)
  })

  it('protects OWNER and records redacted account/role/password audit events', async () => {
    const ownerSession = await owner()
    const adminAccount = await createAdmin(ownerSession, 'tu_audit_admin', 'WRITE')
    const admin = await signIn('tu_audit_admin', strongPassword)
    const ownerListResponse = await ownerSession.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
    const ownerList = ownerListResponse.body as unknown as { accounts: AccountView[] }
    const ownerRow = ownerList.accounts.find((account) => account.roles.includes('OWNER'))!

    const denied = await post(admin, `/api/v1/accounts/${ownerRow.id}/status`, {
      version: ownerRow.version, status: 'DISABLED',
    })
    expect(denied.status).toBe(403)

    await post(ownerSession, `/api/v1/accounts/${adminAccount.id}/access-level`, {
      version: adminAccount.version, accessLevel: 'READ_ONLY',
    })
    const [audits] = await databasePool.execute<(RowDataPacket & { action: string; changes: string })[]>(
      `SELECT action, CAST(changes AS CHAR) changes FROM operation_log
       WHERE entity_type = 'user' ORDER BY id`,
    )
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining([
      'USER_ACCOUNT_CREATED', 'ADMIN_ACCESS_LEVEL_CHANGED',
    ]))
    const serialized = JSON.stringify(audits)
    expect(serialized).not.toContain(strongPassword)
    expect(serialized).not.toContain('password_hash')
    expect(serialized).not.toContain('token')
  })

  it('does not list or mutate an account scoped only to another venue', async () => {
    const foreignVenueUser = 9891
    await databasePool.execute(
      `INSERT INTO users (id, username, display_name, password_hash) VALUES (?, 'other_venue_admin', 'Other venue', 'x')`,
      [foreignVenueUser],
    )
    await databasePool.execute(
      'INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)',
      [foreignVenueUser, actor.organizationId, foreignVenueUser],
    )
    await databasePool.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id, access_level)
       SELECT ?, ?, id, ?, 'WRITE' FROM roles WHERE code = 'ADMIN'`,
      [actor.organizationId, foreignVenueUser, otherVenueId],
    )
    const ownerSession = await owner()
    const listed = await ownerSession.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
    expect((listed.body as { accounts: AccountView[] }).accounts.some((account) => account.id === foreignVenueUser)).toBe(false)
    const denied = await post(ownerSession, `/api/v1/accounts/${foreignVenueUser}/status`, {
      version: 1, status: 'DISABLED',
    })
    expect(denied.status).toBe(404)
  })
})

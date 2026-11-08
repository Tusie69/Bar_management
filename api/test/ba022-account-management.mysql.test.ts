import type { RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { setAccountStatus } from '../src/modules/accounts/account.repository.js'
import { getUndoState } from '../src/modules/operations/operation.repository.js'
import {
  actor,
  clearFixture,
  initializeFixture,
  login,
  otherOrganizationId,
  resetFixture,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const receptionUserId = 9801
const ownerUserId = 9802
const strongPassword = 'ba022-Strong-Pass-0001'

interface AccountView {
  id: number
  username: string
  displayName: string
  status: 'ACTIVE' | 'DISABLED'
  roles: string[]
  version: number
}

/** Owner agent plus the CSRF token every mutation needs. */
async function ownerAgent() {
  const owner = await login('integration_owner')
  return {
    list: async () => {
      const response = await owner.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
      expect(response.status).toBe(200)
      return response.body as { accounts: AccountView[]; roles: { code: string }[] }
    },
    create: (body: Record<string, unknown>) => owner.agent.post('/api/v1/accounts')
      .set('Origin', env.webOrigin).set('X-CSRF-Token', owner.csrfToken).send(body),
    status: (id: number, body: Record<string, unknown>) => owner.agent.post(`/api/v1/accounts/${id}/status`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', owner.csrfToken).send(body),
    agent: owner.agent,
    csrfToken: owner.csrfToken,
  }
}

async function accountVersion(userId: number): Promise<number> {
  const [rows] = await databasePool.execute<(RowDataPacket & { version: number })[]>(
    'SELECT version FROM users WHERE id = ?',
    [userId],
  )
  return Number(rows[0]!.version)
}

async function auditActions(): Promise<string[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & { action: string })[]>(
    "SELECT action FROM operation_log WHERE entity_type = 'user' ORDER BY id",
  )
  return rows.map((row) => row.action)
}

mysqlDescribe('BA-022 account management', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  // ACC-01: the listing is scoped to the actor's organization and reports roles.
  it('lists only accounts of the actor organization with their roles', async () => {
    // A user in another organization must never appear.
    await databasePool.execute(
      "INSERT INTO users (id, username, display_name, password_hash) VALUES (9890, 'foreign_user', 'Foreign', 'x')",
    )
    await databasePool.execute(
      'INSERT INTO memberships (id, organization_id, user_id) VALUES (9890, ?, 9890)',
      [otherOrganizationId],
    )

    const owner = await ownerAgent()
    const { accounts, roles } = await owner.list()

    expect(accounts.map((a) => a.username).sort())
      .toEqual(['integration_care', 'integration_owner', 'integration_reception'])
    expect(accounts.find((a) => a.id === ownerUserId)?.roles).toEqual(['OWNER_ADMIN'])
    expect(accounts.find((a) => a.id === receptionUserId)?.roles).toEqual(['RECEPTIONIST'])
    // Only the four roles the baseline seeds are assignable; none is invented.
    expect(roles.map((r) => r.code).sort())
      .toEqual(['CASHIER', 'CUSTOMER_CARE', 'OWNER_ADMIN', 'RECEPTIONIST'])
    // No credential material is ever exposed.
    expect(JSON.stringify(accounts)).not.toContain('password')
  })

  // ACC-02 / US-11-K7: a created staff account logs in at its own portal only.
  it('creates a staff account that logs in at its own portal and nowhere else', async () => {
    const owner = await ownerAgent()
    const created = await owner.create({
      username: 'ba022_reception',
      displayName: 'BA022 Lễ tân',
      password: strongPassword,
      roleCode: 'RECEPTIONIST',
    })
    expect(created.status).toBe(201)
    const account = (created.body as { account: AccountView }).account
    expect(account.roles).toEqual(['RECEPTIONIST'])
    expect(account.status).toBe('ACTIVE')
    expect(JSON.stringify(created.body)).not.toContain(strongPassword)

    const own = await request(app).post('/api/v1/auth/login').set('Origin', env.webOrigin)
      .send({ username: 'ba022_reception', password: strongPassword, portal: 'receptionist' })
    expect(own.status).toBe(200)

    const foreignPortal = await request(app).post('/api/v1/auth/login').set('Origin', env.webOrigin)
      .send({ username: 'ba022_reception', password: strongPassword, portal: 'admin' })
    expect(foreignPortal.status).toBe(403)
    expect((foreignPortal.body as { error: { code: string } }).error.code).toBe('PORTAL_ACCESS_DENIED')

    // The stored hash is scrypt, never the plaintext.
    const [rows] = await databasePool.execute<(RowDataPacket & { password_hash: string })[]>(
      'SELECT password_hash FROM users WHERE username = ?', ['ba022_reception'],
    )
    expect(rows[0]?.password_hash.startsWith('$scrypt$')).toBe(true)
    expect(rows[0]?.password_hash).not.toContain(strongPassword)
  })

  // ACC-03/04/05: input the contract rejects, with nothing written.
  it('rejects a duplicate username, a weak password and an unknown role', async () => {
    const owner = await ownerAgent()
    const base = { displayName: 'BA022', password: strongPassword, roleCode: 'RECEPTIONIST' }

    const duplicate = await owner.create({ ...base, username: 'integration_reception' })
    expect(duplicate.status).toBe(409)
    expect((duplicate.body as { error: { code: string } }).error.code).toBe('USERNAME_TAKEN')

    const weak = await owner.create({ ...base, username: 'ba022_weak', password: 'short' })
    expect(weak.status).toBe(400)
    expect((weak.body as { error: { code: string } }).error.code).toBe('WEAK_PASSWORD')

    // An unapproved role name must not create a role or an account.
    const unknownRole = await owner.create({ ...base, username: 'ba022_super', roleCode: 'SUPER_ADMIN' })
    expect(unknownRole.status).toBe(400)
    expect((unknownRole.body as { error: { code: string } }).error.code).toBe('ROLE_NOT_FOUND')

    const { accounts } = await owner.list()
    expect(accounts).toHaveLength(3)
    const [roleCount] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM roles',
    )
    expect(Number(roleCount[0]?.total)).toBe(4)
  })

  // ACC-06 / US-11-K5 / K8: locking ends the sessions and blocks login.
  it('locks an account, revokes its live sessions and refuses its login', async () => {
    const receptionist = await login()
    expect((await receptionist.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status).toBe(200)

    const owner = await ownerAgent()
    const locked = await owner.status(receptionUserId, {
      version: await accountVersion(receptionUserId), status: 'DISABLED',
    })
    expect(locked.status).toBe(200)
    const body = locked.body as { account: AccountView; revokedSessions: number }
    expect(body.account.status).toBe('DISABLED')
    expect(body.revokedSessions).toBeGreaterThanOrEqual(1)

    // The live session stops working on the very next request.
    expect((await receptionist.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status).toBe(401)
    // And the account can no longer log in at all.
    await expect(login()).rejects.toThrow()

    const [sessions] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL',
      [receptionUserId],
    )
    expect(Number(sessions[0]?.total)).toBe(0)
  })

  // ACC-07: unlocking restores login, and the audit chain records both steps.
  it('unlocks an account and records an append-only account audit trail', async () => {
    const owner = await ownerAgent()
    await owner.status(receptionUserId, { version: await accountVersion(receptionUserId), status: 'DISABLED' })
    await expect(login()).rejects.toThrow()

    const unlocked = await owner.status(receptionUserId, {
      version: await accountVersion(receptionUserId), status: 'ACTIVE',
    })
    expect(unlocked.status).toBe(200)
    expect((unlocked.body as { account: AccountView }).account.status).toBe('ACTIVE')
    await expect(login()).resolves.toBeTruthy()

    expect(await auditActions()).toEqual(['USER_ACCOUNT_LOCKED', 'USER_ACCOUNT_UNLOCKED'])
    const [audit] = await databasePool.execute<(RowDataPacket & {
      is_undoable: number; actor_user_id: number; venue_id: number; entity_id: number
    })[]>(
      "SELECT is_undoable, actor_user_id, venue_id, entity_id FROM operation_log WHERE entity_type = 'user' ORDER BY id LIMIT 1",
    )
    expect(Number(audit[0]?.is_undoable)).toBe(0)
    expect(Number(audit[0]?.actor_user_id)).toBe(ownerUserId)
    expect(Number(audit[0]?.venue_id)).toBe(actor.venueId)
    expect(Number(audit[0]?.entity_id)).toBe(receptionUserId)
  })

  // ACC-08/09: preconditions and the self-lock guard.
  it('enforces the version precondition, the self-lock guard and a no-op change', async () => {
    const owner = await ownerAgent()

    const stale = await owner.status(receptionUserId, { version: 999, status: 'DISABLED' })
    expect(stale.status).toBe(409)
    expect((stale.body as { error: { code: string } }).error.code).toBe('VERSION_CONFLICT')

    const self = await owner.status(ownerUserId, { version: await accountVersion(ownerUserId), status: 'DISABLED' })
    expect(self.status).toBe(409)
    expect((self.body as { error: { code: string } }).error.code).toBe('CANNOT_LOCK_SELF')

    const unchanged = await owner.status(receptionUserId, {
      version: await accountVersion(receptionUserId), status: 'ACTIVE',
    })
    expect(unchanged.status).toBe(409)
    expect((unchanged.body as { error: { code: string } }).error.code).toBe('ACCOUNT_STATUS_UNCHANGED')

    // Nothing was written by any of the three refusals.
    expect(await accountVersion(receptionUserId)).toBe(1)
    expect(await auditActions()).toEqual([])
  })

  // Two admins: locking one is allowed, and the remaining one stays usable.
  it('allows locking an admin while another active admin remains', async () => {
    const owner = await ownerAgent()
    const second = await owner.create({
      username: 'ba022_admin2', displayName: 'BA022 Admin 2',
      password: strongPassword, roleCode: 'OWNER_ADMIN',
    })
    expect(second.status).toBe(201)
    const secondId = (second.body as { account: AccountView }).account.id

    const locked = await owner.status(secondId, {
      version: await accountVersion(secondId), status: 'DISABLED',
    })
    expect(locked.status).toBe(200)
    expect((locked.body as { account: AccountView }).account.status).toBe('DISABLED')
    // The acting admin is untouched and still able to manage accounts.
    expect((await owner.list()).accounts.find((a) => a.id === ownerUserId)?.status).toBe('ACTIVE')
  })

  /**
   * ACC-10: the last-admin guard is defence in depth. Over HTTP it cannot be
   * reached today, because only OWNER_ADMIN holds user.manage: an acting admin
   * is itself active, so either the target is itself (CANNOT_LOCK_SELF) or a
   * second active admin exists. The guard is therefore exercised at the
   * repository level, which is also what protects the organization if
   * user.manage is ever granted to another role.
   */
  it('refuses at the repository level to lock the last active admin', async () => {
    const nonAdminActor = { ...actor, userId: receptionUserId, membershipId: receptionUserId }
    await expect(setAccountStatus(nonAdminActor, ownerUserId, await accountVersion(ownerUserId), 'DISABLED'))
      .rejects.toMatchObject({ code: 'LAST_ADMIN_PROTECTED' })

    // The admin is still active and its sessions still work.
    const owner = await ownerAgent()
    expect((await owner.list()).accounts.find((a) => a.id === ownerUserId)?.status).toBe('ACTIVE')
    expect(await auditActions()).toEqual([])
  })

  // ACC-11 / US-11-K3 / K4: transport and RBAC are enforced on every route.
  it('enforces authentication, RBAC and CSRF on every account route', async () => {
    expect((await request(app).get('/api/v1/accounts').set('Origin', env.webOrigin)).status).toBe(401)
    expect((await request(app).post('/api/v1/accounts').set('Origin', env.webOrigin).send({})).status).toBe(401)

    // A receptionist has no user.manage, so account management is invisible to it.
    const receptionist = await login()
    expect((await receptionist.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)).status).toBe(403)
    expect((await receptionist.agent.post('/api/v1/accounts').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', receptionist.csrfToken)
      .send({ username: 'ba022_x', displayName: 'x', password: strongPassword, roleCode: 'RECEPTIONIST' }))
      .status).toBe(403)
    expect((await receptionist.agent.post(`/api/v1/accounts/${ownerUserId}/status`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', receptionist.csrfToken)
      .send({ version: 1, status: 'DISABLED' })).status).toBe(403)

    // An owner without the CSRF header is refused before anything is written.
    const owner = await login('integration_owner')
    expect((await owner.agent.post('/api/v1/accounts').set('Origin', env.webOrigin)
      .send({ username: 'ba022_nocsrf', displayName: 'x', password: strongPassword, roleCode: 'RECEPTIONIST' }))
      .status).toBe(403)
    const [created] = await databasePool.execute<RowDataPacket[]>(
      "SELECT id FROM users WHERE username IN ('ba022_x', 'ba022_nocsrf')",
    )
    expect(created).toEqual([])
  })

  // A malformed body is a 400, and BA-020 stays closed over account changes.
  it('rejects a malformed body and never offers an account change as undoable', async () => {
    const owner = await ownerAgent()
    const bad = await owner.status(receptionUserId, { version: 1, status: 'NOPE' })
    expect(bad.status).toBe(400)
    expect((bad.body as { error: { code: string } }).error.code).toBe('INVALID_ACCOUNT_STATUS')

    await owner.status(receptionUserId, { version: await accountVersion(receptionUserId), status: 'DISABLED' })
    // The owner's own session sees no undoable operation: account work is not
    // compensable, so BA-020 fails closed rather than offering a false undo.
    const [sessionRow] = await databasePool.execute<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',
      [ownerUserId],
    )
    const state = await getUndoState({
      ...actor, userId: ownerUserId, membershipId: ownerUserId,
      authSessionId: Number(sessionRow[0]!.id),
    })
    expect(state).toEqual({ undo: null, redo: null })
  })
})

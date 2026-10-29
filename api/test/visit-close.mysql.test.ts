import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import type { AuthenticatedActor } from '../src/auth/authenticated-actor.js'
import { databasePool } from '../src/database/pool.js'
import { listTables } from '../src/modules/tables/table.repository.js'
import { closeVisit } from '../src/modules/visits/visit.repository.js'

const integrationEnabled = process.env.RUN_MYSQL_INTEGRATION === '1'
  && /_test$/.test(process.env.DB_NAME ?? '')
const mysqlDescribe = integrationEnabled ? describe : describe.skip

const organizationId = 9101
const venueId = 9101
const userId = 9101
const membershipId = 9101
const tableIds = [9101, 9102] as const

const actor: AuthenticatedActor = { organizationId, venueId, userId, membershipId }
const actorWithoutPermission: AuthenticatedActor = {
  organizationId,
  venueId,
  userId: 9102,
  membershipId: 9102,
}

interface FixtureOptions {
  origin?: 'RESERVATION' | 'WALK_IN'
  tableCount?: 1 | 2
  withReservation?: boolean
  paid?: boolean
  closed?: boolean
}

const cleanupStatements = [
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
]

async function clearFixture(): Promise<void> {
  for (const sql of cleanupStatements) await databasePool.execute(sql)
}

async function resetFixture(): Promise<void> {
  await clearFixture()

  await databasePool.execute(
    'INSERT INTO organizations (id, code, name) VALUES (?, ?, ?)',
    [organizationId, 'CLOSE_TEST', 'Close visit integration test'],
  )
  await databasePool.execute(
    'INSERT INTO venues (id, organization_id, code, name) VALUES (?, ?, ?, ?)',
    [venueId, organizationId, 'CLOSE_TEST', 'Close visit integration test'],
  )
  await databasePool.execute(
    `INSERT INTO users (id, username, display_name, password_hash, status) VALUES
      (?, 'close_test_allowed', 'Allowed user', '!', 'ACTIVE'),
      (?, 'close_test_denied', 'Denied user', '!', 'ACTIVE')`,
    [userId, 9102],
  )
  await databasePool.execute(
    `INSERT INTO memberships (id, organization_id, user_id) VALUES
      (?, ?, ?), (?, ?, ?)`,
    [membershipId, organizationId, userId, 9102, organizationId, 9102],
  )
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     SELECT ?, ?, id, ? FROM roles WHERE code = 'CASHIER'`,
    [organizationId, membershipId, venueId],
  )
  await databasePool.execute(
    `INSERT INTO zones (id, organization_id, venue_id, code, name)
     VALUES (9101, ?, ?, 'MAIN', 'Main')`,
    [organizationId, venueId],
  )
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES
      (?, ?, ?, 9101, 'T1', 'Table 1', 'TABLE', 4, 10, 10),
      (?, ?, ?, 9101, 'T2', 'Table 2', 'TABLE', 4, 20, 20)`,
    [tableIds[0], organizationId, venueId, tableIds[1], organizationId, venueId],
  )
  await databasePool.execute(
    `INSERT INTO booking_sources (id, organization_id, code, name)
     VALUES (9101, ?, 'TEST', 'Test')`,
    [organizationId],
  )
}

async function createOpenVisit(options: FixtureOptions = {}): Promise<number> {
  const origin = options.origin ?? 'WALK_IN'
  const endColumns = options.closed
    ? ', ended_at, ended_by_user_id, end_reason'
    : ''
  const endValues = options.closed
    ? ", UTC_TIMESTAMP(3), 9101, 'GUEST_LEFT'"
    : ''
  const paidColumns = options.paid ? ', paid_marked_at, paid_marked_by_user_id' : ''
  const paidValues = options.paid ? ', UTC_TIMESTAMP(3), 9101' : ''
  const [visitResult] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO visits
      (organization_id, venue_id, origin, contact_name, guest_count, started_at,
       business_date, created_by_user_id${endColumns}${paidColumns})
     VALUES (?, ?, ?, 'Test guest', 2, UTC_TIMESTAMP(3), '2026-10-24', ?${endValues}${paidValues})`,
    [organizationId, venueId, origin, userId],
  )
  const visitId = visitResult.insertId

  if (options.withReservation) {
    await databasePool.execute(
      `INSERT INTO reservations
        (organization_id, venue_id, contact_name, contact_name_search, source_id, party_size,
         expected_at, business_date, status, visit_id, checked_in_at, checked_in_by_user_id,
         created_by_user_id)
       VALUES (?, ?, 'Test guest', 'test guest', 9101, 2, UTC_TIMESTAMP(3), '2026-10-24',
         'CHECKED_IN', ?, UTC_TIMESTAMP(3), ?, ?)`,
      [organizationId, venueId, visitId, userId, userId],
    )
  }

  if (!options.closed) {
    for (const tableId of tableIds.slice(0, options.tableCount ?? 1)) {
      await databasePool.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, starts_at,
           business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, UTC_TIMESTAMP(3), '2026-10-24', ?)`,
        [organizationId, venueId, tableId, visitId, userId],
      )
    }
  }
  return visitId
}

async function visitRow(visitId: number): Promise<RowDataPacket> {
  const [rows] = await databasePool.execute<RowDataPacket[]>(
    'SELECT * FROM visits WHERE venue_id = ? AND id = ?',
    [venueId, visitId],
  )
  const row = rows[0]
  if (!row) throw new Error('Missing visit fixture')
  return row
}

mysqlDescribe('closeVisit MySQL integration', () => {
  beforeEach(async () => {
    await resetFixture()
  })
  afterAll(clearFixture)

  it('closes a checked-in reservation, releases one table and preserves history', async () => {
    const visitId = await createOpenVisit({ origin: 'RESERVATION', withReservation: true })

    const result = await closeVisit(actor, {
      visitId,
      expectedVersion: 1,
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
      note: 'Guest left',
    })

    expect(result.status).toBe('CLOSED')
    expect(result.version).toBe(2)
    expect(result.releasedTables).toEqual([{ id: tableIds[0], code: 'T1' }])
    const [reservationRows] = await databasePool.execute<RowDataPacket[]>(
      'SELECT status, visit_id FROM reservations WHERE venue_id = ? AND visit_id = ?',
      [venueId, visitId],
    )
    expect(reservationRows[0]?.status).toBe('CHECKED_IN')
    expect(Number(reservationRows[0]?.visit_id)).toBe(visitId)
    const [allocationRows] = await databasePool.execute<RowDataPacket[]>(
      'SELECT released_at, release_reason FROM table_allocations WHERE venue_id = ? AND visit_id = ?',
      [venueId, visitId],
    )
    expect(allocationRows).toHaveLength(1)
    expect(allocationRows[0]?.released_at).not.toBeNull()
    expect(allocationRows[0]?.release_reason).toBe('GUEST_LEFT')
    const tables = await listTables(actor, '2026-10-24')
    expect(tables.find((table) => table.id === tableIds[0])?.state).toBe('AVAILABLE')
  })

  it('closes a walk-in visit', async () => {
    const visitId = await createOpenVisit()
    const result = await closeVisit(actor, {
      visitId,
      expectedVersion: 1,
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
    })
    expect(result.id).toBe(visitId)
    expect((await visitRow(visitId)).ended_at).not.toBeNull()
  })

  it('releases every open USAGE allocation for a multi-table visit', async () => {
    const visitId = await createOpenVisit({ tableCount: 2 })
    const result = await closeVisit(actor, {
      visitId,
      expectedVersion: 1,
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
    })
    expect(result.releasedTables.map((table) => table.code)).toEqual(['T1', 'T2'])
    const [rows] = await databasePool.execute<(RowDataPacket & { open_count: number })[]>(
      'SELECT COUNT(*) AS open_count FROM table_allocations WHERE visit_id = ? AND released_at IS NULL',
      [visitId],
    )
    expect(Number(rows[0]?.open_count)).toBe(0)
  })

  it('rejects a visit that is already closed', async () => {
    const visitId = await createOpenVisit({ closed: true })
    await expect(closeVisit(actor, {
      visitId,
      expectedVersion: 1,
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
    })).rejects.toMatchObject({ code: 'VISIT_ALREADY_CLOSED' })
  })

  it('rejects a stale version', async () => {
    const visitId = await createOpenVisit()
    await expect(closeVisit(actor, {
      visitId,
      expectedVersion: 2,
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('allows only one of two concurrent close requests', async () => {
    const visitId = await createOpenVisit()
    const input = { visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' } as const
    const results = await Promise.allSettled([closeVisit(actor, input), closeVisit(actor, input)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'VISIT_ALREADY_CLOSED' } })
  })

  it('rejects an authenticated actor without visit.end', async () => {
    const visitId = await createOpenVisit()
    await expect(closeVisit(actorWithoutPermission, {
      visitId,
      expectedVersion: 1,
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
    })).rejects.toMatchObject({ code: 'VISIT_END_FORBIDDEN' })
  })

  it('rejects AFTER_PAYMENT until a trusted verifier exists', async () => {
    const visitId = await createOpenVisit()
    await expect(closeVisit(actor, {
      visitId,
      expectedVersion: 1,
      mode: 'AFTER_PAYMENT',
      reason: 'GUEST_LEFT',
    })).rejects.toMatchObject({ code: 'PAYMENT_VERIFICATION_UNAVAILABLE' })
  })

  it('rolls back visit and allocation updates when a later audit write fails', async () => {
    const visitId = await createOpenVisit()
    await expect(closeVisit(actor, {
      visitId,
      expectedVersion: 1,
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
      note: 'x'.repeat(501),
    })).rejects.toThrow()
    const row = await visitRow(visitId)
    expect(row.ended_at).toBeNull()
    expect(row.version).toBe(1)
    const [allocationRows] = await databasePool.execute<RowDataPacket[]>(
      'SELECT released_at FROM table_allocations WHERE venue_id = ? AND visit_id = ?',
      [venueId, visitId],
    )
    expect(allocationRows[0]?.released_at).toBeNull()
  })

  it('does not change payment markers during a manual close', async () => {
    const visitId = await createOpenVisit({ paid: true })
    const before = await visitRow(visitId)
    await closeVisit(actor, {
      visitId,
      expectedVersion: 1,
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
    })
    const after = await visitRow(visitId)
    expect(after.paid_marked_at).toEqual(before.paid_marked_at)
    expect(after.paid_marked_by_user_id).toBe(before.paid_marked_by_user_id)
  })
})

import { randomBytes } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import type { AuthenticatedActor } from '../src/auth/authenticated-actor.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  assignBookingTables,
  checkInBooking,
  closeBooking,
  createBooking,
  createWalkIn,
  mergeBookingTables,
} from '../src/modules/bookings/booking.repository.js'
import { listActiveTableGroups } from '../src/modules/tables/table.repository.js'
import { closeVisit, mergeVisitTables } from '../src/modules/visits/visit.repository.js'

const integrationEnabled = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
const mysqlDescribe = integrationEnabled ? describe : describe.skip
const organizationId = 1
const venueId = 1
const userId = 9601
const membershipId = 9601
const tableOneId = 9601
const tableTwoId = 9602
const outOfServiceTableId = 9603
const spareTableId = 9604
const lowCapacityTableId = 9605
const barSeatOneId = 9606
const barSeatTwoId = 9607
const tableA7Id = 9608
const tableB3Id = 9609
const tableC1Id = 9610
const tableC2Id = 9611
const barSeat21Id = 9612
const actor: AuthenticatedActor = { organizationId, venueId, userId, membershipId }
const password = randomBytes(24).toString('base64url')
let passwordHash = ''

interface AuthResponse {
  csrfToken: string
  permissions: string[]
}

async function clearFixture(): Promise<void> {
  const statements = [
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
  ]
  for (const statement of statements) await databasePool.execute(statement)
}

async function resetFixture(): Promise<void> {
  await clearFixture()
  await databasePool.execute('INSERT INTO organizations (id, code, name) VALUES (?, ?, ?)', [
    organizationId,
    'ASSIGNMENT_TEST',
    'Assignment integration test',
  ])
  await databasePool.execute(
    `INSERT INTO venues
      (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local)
     VALUES (?, ?, 'ASSIGNMENT_TEST', 'Assignment venue', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00')`,
    [venueId, organizationId],
  )
  await databasePool.execute(
    `INSERT INTO users (id, username, display_name, password_hash, status)
     VALUES (?, 'assignment_reception', 'Assignment reception', ?, 'ACTIVE')`,
    [userId, passwordHash],
  )
  await databasePool.execute(
    `INSERT INTO memberships (id, organization_id, user_id, status) VALUES (?, ?, ?, 'ACTIVE')`,
    [membershipId, organizationId, userId],
  )
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     SELECT ?, ?, id, ? FROM roles WHERE code = 'RECEPTIONIST'`,
    [organizationId, membershipId, venueId],
  )
  await databasePool.execute(
    `INSERT INTO zones (id, organization_id, venue_id, code, name, sort_order)
     VALUES
       (9601, ?, ?, 'A', 'Khu A', 1),
       (9602, ?, ?, 'B', 'Khu B', 2),
       (9603, ?, ?, 'C', 'Khu C', 3),
       (9604, ?, ?, 'BAR', 'Quầy Bar', 4)`,
    [
      organizationId, venueId,
      organizationId, venueId,
      organizationId, venueId,
      organizationId, venueId,
    ],
  )
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, seq_no, pos_x, pos_y, status, is_spare)
     VALUES
      (?, ?, ?, 9601, 'A1', 'Bàn A1', 'TABLE', 4, NULL, 10, 10, 'ACTIVE', 0),
      (?, ?, ?, 9601, 'A2', 'Bàn A2', 'TABLE', 4, NULL, 20, 20, 'ACTIVE', 0),
      (?, ?, ?, 9601, 'A3', 'Bàn A3', 'TABLE', 4, NULL, 30, 30, 'OUT_OF_SERVICE', 0),
      (?, ?, ?, 9601, 'A10', 'Bàn A10', 'TABLE', 4, NULL, 40, 40, 'ACTIVE', 1),
      (?, ?, ?, 9601, 'A4', 'Bàn A4', 'TABLE', 2, NULL, 50, 50, 'ACTIVE', 0),
      (?, ?, ?, 9604, 'BAR01', 'Ghế Bar 1', 'BAR_SEAT', 1, 1, 60, 60, 'ACTIVE', 0),
      (?, ?, ?, 9604, 'BAR02', 'Ghế Bar 2', 'BAR_SEAT', 1, 2, 70, 60, 'ACTIVE', 0),
      (?, ?, ?, 9601, 'A7', 'Bàn A7', 'TABLE', 4, NULL, 500, 500, 'ACTIVE', 0),
      (?, ?, ?, 9602, 'B3', 'Bàn B3', 'TABLE', 4, NULL, 80, 80, 'ACTIVE', 0),
      (?, ?, ?, 9603, 'C1', 'Bàn C1', 'TABLE', 4, NULL, 90, 90, 'ACTIVE', 0),
      (?, ?, ?, 9603, 'C2', 'Bàn C2', 'TABLE', 4, NULL, 600, 600, 'ACTIVE', 0),
      (?, ?, ?, 9604, 'BAR21', 'Ghế Bar 21', 'BAR_SEAT', 1, 21, 700, 700, 'ACTIVE', 0)`,
    [
      tableOneId, organizationId, venueId,
      tableTwoId, organizationId, venueId,
      outOfServiceTableId, organizationId, venueId,
      spareTableId, organizationId, venueId,
      lowCapacityTableId, organizationId, venueId,
      barSeatOneId, organizationId, venueId,
      barSeatTwoId, organizationId, venueId,
      tableA7Id, organizationId, venueId,
      tableB3Id, organizationId, venueId,
      tableC1Id, organizationId, venueId,
      tableC2Id, organizationId, venueId,
      barSeat21Id, organizationId, venueId,
    ],
  )
  await databasePool.execute(
    `INSERT INTO booking_sources (id, organization_id, code, name) VALUES (9601, ?, 'HOTLINE', 'Hotline')`,
    [organizationId],
  )
}

function bookingInput(guestName: string) {
  return {
    guestName,
    partySize: 4,
    expectedAt: '2030-10-24T21:00:00+07:00',
    businessDate: '2030-10-24',
    sourceCode: 'HOTLINE',
  }
}

async function activeTableIds(reservationId: number): Promise<number[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & { table_id: number })[]>(
    `SELECT a.table_id FROM table_allocations a
     JOIN table_holds h ON h.id = a.hold_id
     WHERE h.reservation_id = ? AND h.status = 'ACTIVE' AND a.released_at IS NULL
     ORDER BY a.table_id`,
    [reservationId],
  )
  return rows.map((row) => Number(row.table_id))
}

mysqlDescribe('booking table assignment MySQL integration', () => {
  beforeAll(async () => {
    passwordHash = await hashPassword(password)
  })
  beforeEach(resetFixture)
  afterAll(clearFixture)

  it('assigns multiple tables and reassigns before check-in while preserving history', async () => {
    const created = await createBooking(actor, bookingInput('Assign guest'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId, tableTwoId])
    expect(assigned.tableCodes).toEqual(['A1', 'A2'])
    const reassigned = await assignBookingTables(actor, assigned.id, assigned.version, [tableTwoId])
    expect(reassigned.tableCodes).toEqual(['A2'])
    expect(await activeTableIds(created.id)).toEqual([tableTwoId])
    const [history] = await databasePool.execute<RowDataPacket[]>(
      `SELECT release_reason FROM table_allocations
       WHERE table_id = ? AND released_at IS NOT NULL ORDER BY id`,
      [tableOneId],
    )
    expect(history.at(-1)?.release_reason).toBe('MOVED')
  })

  it('rejects missing, out-of-service, spare, unchanged, and terminal assignments', async () => {
    const created = await createBooking(actor, bookingInput('Validation guest'))
    await expect(assignBookingTables(actor, 999999, 1, [tableOneId]))
      .rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' })
    await expect(assignBookingTables(actor, created.id, created.version, [999999]))
      .rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' })
    await expect(assignBookingTables(actor, created.id, created.version, [outOfServiceTableId]))
      .rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' })
    await expect(assignBookingTables(actor, created.id, created.version, [spareTableId]))
      .rejects.toMatchObject({ code: 'SPARE_TABLE_NOT_BOOKABLE' })
    await expect(assignBookingTables(actor, created.id, created.version, [lowCapacityTableId]))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_TABLE_CAPACITY' })
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId])
    await expect(assignBookingTables(actor, assigned.id, assigned.version, [tableOneId]))
      .rejects.toMatchObject({ code: 'TABLE_ASSIGNMENT_UNCHANGED' })
    const cancelled = await closeBooking(actor, assigned.id, assigned.version, 'CANCELLED')
    await expect(assignBookingTables(actor, cancelled.id, cancelled.version, [tableTwoId]))
      .rejects.toMatchObject({ code: 'BOOKING_NOT_ASSIGNABLE' })
  })

  it('rolls back reassign on table conflict and rejects a stale version', async () => {
    const first = await createBooking(actor, bookingInput('First guest'))
    const firstAssigned = await assignBookingTables(actor, first.id, first.version, [tableOneId])
    const second = await createBooking(actor, bookingInput('Second guest'))
    await assignBookingTables(actor, second.id, second.version, [tableTwoId])
    await expect(assignBookingTables(actor, firstAssigned.id, firstAssigned.version, [tableTwoId]))
      .rejects.toMatchObject({ code: 'TABLE_ALREADY_OCCUPIED' })
    expect(await activeTableIds(first.id)).toEqual([tableOneId])
    await expect(assignBookingTables(actor, firstAssigned.id, first.version, [tableOneId]))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('allows only one concurrent assignment for one booking version', async () => {
    const created = await createBooking(actor, bookingInput('Concurrent guest'))
    const outcomes = await Promise.allSettled([
      assignBookingTables(actor, created.id, created.version, [tableOneId]),
      assignBookingTables(actor, created.id, created.version, [tableTwoId]),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected') expect(rejected.reason).toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(await activeTableIds(created.id)).toHaveLength(1)
  })

  it('merges A1 with distant A7 in the same zone and carries the group through check-in', async () => {
    const created = await createBooking(actor, bookingInput('Merged guest'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId])
    const merged = await mergeBookingTables(actor, assigned.id, assigned.version, [tableOneId, tableA7Id])
    expect(merged.group.tableIds).toEqual([tableOneId, tableA7Id])
    expect(await listActiveTableGroups(actor, '2030-10-24')).toEqual([
      { id: merged.group.id, symbolNo: merged.group.symbolNo, tableIds: [tableOneId, tableA7Id] },
    ])
    await checkInBooking(actor, merged.booking.id, merged.booking.version)
    const [usageRows] = await databasePool.execute<(RowDataPacket & { group_id: number })[]>(
      `SELECT group_id FROM table_allocations
       WHERE visit_id IS NOT NULL AND kind = 'USAGE' AND released_at IS NULL ORDER BY table_id`,
    )
    expect(usageRows.map((row) => Number(row.group_id))).toEqual([merged.group.id, merged.group.id])
  })

  it('rejects A1 + B3 across zones and a same-zone table occupied by another booking', async () => {
    const first = await createBooking(actor, bookingInput('Merge first'))
    const firstAssigned = await assignBookingTables(actor, first.id, first.version, [tableOneId])
    await expect(mergeBookingTables(actor, firstAssigned.id, firstAssigned.version, [tableOneId, tableB3Id]))
      .rejects.toMatchObject({ code: 'TABLE_ZONE_MISMATCH' })
    const second = await createBooking(actor, bookingInput('Merge second'))
    await assignBookingTables(actor, second.id, second.version, [tableTwoId])
    await expect(mergeBookingTables(actor, firstAssigned.id, firstAssigned.version, [tableOneId, tableTwoId]))
      .rejects.toMatchObject({ code: 'TABLE_ALREADY_OCCUPIED' })
    expect(await activeTableIds(first.id)).toEqual([tableOneId])
  })

  it('allows only one merge for a booking version', async () => {
    const created = await createBooking(actor, bookingInput('Concurrent merge'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId])
    const outcomes = await Promise.allSettled([
      mergeBookingTables(actor, assigned.id, assigned.version, [tableOneId, tableTwoId]),
      mergeBookingTables(actor, assigned.id, assigned.version, [tableOneId, tableTwoId]),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
  })

  it('merges distant C1 + C2 for an active visit and dissolves the group after release', async () => {
    const walkIn = await createWalkIn(actor, {
      guestName: 'Visit merge',
      partySize: 3,
      businessDate: '2030-10-24',
      tableIds: [tableC1Id],
    })
    const merged = await mergeVisitTables(actor, {
      visitId: walkIn.visitId,
      expectedVersion: 1,
      tableIds: [tableC1Id, tableC2Id],
    })
    expect(merged.group.tableIds).toEqual([tableC1Id, tableC2Id])
    expect(await listActiveTableGroups(actor, '2030-10-24')).toHaveLength(1)
    await closeVisit(actor, {
      visitId: walkIn.visitId,
      expectedVersion: merged.visit.version,
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
    })
    expect(await listActiveTableGroups(actor, '2030-10-24')).toEqual([])
    const [rows] = await databasePool.execute<(RowDataPacket & { dissolved_at: Date | null })[]>(
      'SELECT dissolved_at FROM table_groups WHERE id = ?', [merged.group.id],
    )
    expect(rows[0]?.dissolved_at).not.toBeNull()
  })

  it('merges Bar 1 + Bar 21 in the Bar zone and rejects a regular table mixed with a Bar seat', async () => {
    const walkIn = await createWalkIn(actor, {
      guestName: 'Bar merge',
      partySize: 1,
      businessDate: '2030-10-24',
      tableIds: [barSeatOneId],
    })
    const merged = await mergeVisitTables(actor, {
      visitId: walkIn.visitId,
      expectedVersion: 1,
      tableIds: [barSeatOneId, barSeat21Id],
    })
    expect(merged.group.tableIds).toEqual([barSeatOneId, barSeat21Id])
    await expect(mergeVisitTables(actor, {
      visitId: walkIn.visitId,
      expectedVersion: merged.visit.version,
      tableIds: [barSeatOneId, tableOneId],
    })).rejects.toMatchObject({ code: 'TABLE_KIND_MISMATCH' })
  })

  it('enforces merge capacity and version without changing allocations', async () => {
    const walkIn = await createWalkIn(actor, {
      guestName: 'Capacity merge',
      partySize: 9,
      businessDate: '2030-10-24',
      tableIds: [tableOneId],
    })
    await expect(mergeVisitTables(actor, {
      visitId: walkIn.visitId,
      expectedVersion: 1,
      tableIds: [tableOneId, tableA7Id],
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_TABLE_CAPACITY' })
    await expect(mergeVisitTables(actor, {
      visitId: walkIn.visitId,
      expectedVersion: 2,
      tableIds: [tableOneId, tableA7Id],
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    const [rows] = await databasePool.execute<(RowDataPacket & { table_id: number })[]>(
      'SELECT table_id FROM table_allocations WHERE visit_id = ? AND released_at IS NULL', [walkIn.visitId],
    )
    expect(rows.map((row) => Number(row.table_id))).toEqual([tableOneId])
  })

  it('rolls back group and allocation writes when the audit insert fails', async () => {
    const created = await createBooking(actor, bookingInput('Rollback merge'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId])
    await databasePool.query(
      `ALTER TABLE operation_log ADD CONSTRAINT ck_test_reject_merge
       CHECK (action <> 'RESERVATION_TABLES_MERGED')`,
    )
    try {
      await expect(mergeBookingTables(actor, assigned.id, assigned.version, [tableOneId, tableA7Id]))
        .rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
    } finally {
      await databasePool.query('ALTER TABLE operation_log DROP CHECK ck_test_reject_merge')
    }
    expect(await activeTableIds(created.id)).toEqual([tableOneId])
    expect(await listActiveTableGroups(actor, '2030-10-24')).toEqual([])
  })

  it('enforces authentication, CSRF, table.assign and visit.combine at the routes', async () => {
    const created = await createBooking(actor, bookingInput('Route guest'))
    const payload = { version: created.version, tableIds: [tableOneId] }
    expect((await request(app).post(`/api/v1/bookings/${created.id}/assign`)
      .set('Origin', env.webOrigin).send(payload)).status).toBe(401)

    const receptionist = request.agent(app)
    const auth = JSON.parse((await receptionist.post('/api/v1/auth/login').set('Origin', env.webOrigin).send({
      username: 'assignment_reception', password,
    })).text) as AuthResponse
    expect(auth.permissions).toContain('table.assign')
    expect((await receptionist.post(`/api/v1/bookings/${created.id}/assign`)
      .set('Origin', env.webOrigin).send(payload)).status).toBe(403)

    const [careUser] = await databasePool.execute<ResultSetHeader>(
      `INSERT INTO users (username, display_name, password_hash, status)
       VALUES ('assignment_care', 'Assignment care', ?, 'ACTIVE')`,
      [passwordHash],
    )
    const [careMembership] = await databasePool.execute<ResultSetHeader>(
      `INSERT INTO memberships (organization_id, user_id, status) VALUES (?, ?, 'ACTIVE')`,
      [organizationId, careUser.insertId],
    )
    await databasePool.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
       SELECT ?, ?, id, ? FROM roles WHERE code = 'CUSTOMER_CARE'`,
      [organizationId, careMembership.insertId, venueId],
    )
    const care = request.agent(app)
    const careAuth = JSON.parse((await care.post('/api/v1/auth/login').set('Origin', env.webOrigin).send({
      username: 'assignment_care', password,
    })).text) as AuthResponse
    expect(careAuth.permissions).not.toContain('table.assign')
    expect((await care.post(`/api/v1/bookings/${created.id}/assign`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', careAuth.csrfToken).send(payload)).status).toBe(403)
    expect((await receptionist.post(`/api/v1/bookings/${created.id}/assign`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', auth.csrfToken).send(payload)).status).toBe(200)
    const assigned = await activeTableIds(created.id)
    expect(assigned).toEqual([tableOneId])
    const [versionRows] = await databasePool.execute<(RowDataPacket & { version: number })[]>(
      'SELECT version FROM reservations WHERE id = ?', [created.id],
    )
    const mergePayload = { version: Number(versionRows[0]?.version), tableIds: [tableOneId, tableTwoId] }
    expect((await receptionist.post(`/api/v1/bookings/${created.id}/merge`)
      .set('Origin', env.webOrigin).send(mergePayload)).status).toBe(403)
    expect((await receptionist.post(`/api/v1/bookings/${created.id}/merge`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', auth.csrfToken).send(mergePayload)).status).toBe(200)
  })
})

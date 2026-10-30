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
  getBookingById,
  updateBooking,
  type BookingClassification,
  type BookingView,
} from '../src/modules/bookings/booking.repository.js'
import { closeVisit, moveVisit } from '../src/modules/visits/visit.repository.js'
import {
  listNoShowCandidates,
  processNoShowCandidate,
  runNoShowSweep,
} from '../src/modules/bookings/no-show.worker.js'
import {
  createWaitlistEntry,
  listWaitlist,
  seatWaitlistEntry,
  type WaitlistEntryView,
} from '../src/modules/waitlist/waitlist.repository.js'

const integrationEnabled = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
const mysqlDescribe = integrationEnabled ? describe : describe.skip
const organizationId = env.organizationId
const venueId = env.venueId
const userId = 9301
const membershipId = 9301
const tableOneId = 9301
const tableTwoId = 9302
const tableThreeId = 9304
const sourceId = 9301
const systemUserId = 9399
const automationCutoff = new Date('2000-01-01T00:00:00.000Z')
const actor: AuthenticatedActor = { organizationId, venueId, userId, membershipId }
const password = 'Booking integration password'
let passwordHash = ''

interface AuthResponse {
  csrfToken: string
  permissions: string[]
}

async function clearOperationalData(): Promise<void> {
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
  await clearOperationalData()
  await databasePool.execute(
    'INSERT INTO organizations (id, code, name) VALUES (?, ?, ?)',
    [organizationId, `BOOKING_${organizationId}`, 'Booking lifecycle integration test'],
  )
  await databasePool.execute(
    `INSERT INTO venues
      (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local)
     VALUES (?, ?, ?, ?, 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00')`,
    [venueId, organizationId, `BOOKING_${venueId}`, 'Booking test venue'],
  )
  await databasePool.execute(
    `INSERT INTO users (id, username, display_name, password_hash, status)
     VALUES (?, 'booking_reception', 'Booking reception', ?, 'ACTIVE')`,
    [userId, passwordHash],
  )
  await databasePool.execute(
    `INSERT INTO users (id, username, display_name, password_hash, status)
     VALUES (?, 'system_no_show', 'Automatic no-show worker', ?, 'DISABLED')`,
    [systemUserId, passwordHash],
  )
  await databasePool.execute(
    'INSERT INTO memberships (id, organization_id, user_id, status) VALUES (?, ?, ?, \'ACTIVE\')',
    [membershipId, organizationId, userId],
  )
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     SELECT ?, ?, id, ? FROM roles WHERE code = 'RECEPTIONIST'`,
    [organizationId, membershipId, venueId],
  )
  await databasePool.execute(
    `INSERT INTO zones (id, organization_id, venue_id, code, name)
     VALUES (9301, ?, ?, 'MAIN', 'Main'), (9302, ?, ?, 'OTHER', 'Other')`,
    [organizationId, venueId, organizationId, venueId],
  )
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES
      (?, ?, ?, 9301, 'T1', 'Table 1', 'TABLE', 4, 10, 10),
       (?, ?, ?, 9301, 'T2', 'Table 2', 'TABLE', 4, 20, 20),
       (?, ?, ?, 9302, 'T4', 'Table 4', 'TABLE', 4, 30, 30)`,
    [
      tableOneId, organizationId, venueId,
      tableTwoId, organizationId, venueId,
      tableThreeId, organizationId, venueId,
    ],
  )
  await databasePool.execute(
    `INSERT INTO booking_sources (id, organization_id, code, name, sort_order)
     VALUES (?, ?, 'HOTLINE', 'Hotline', 1), (?, ?, 'OTHER', 'Khác', 2)`,
    [sourceId, organizationId, sourceId + 1, organizationId],
  )
}

function bookingInput(
  date = '2030-10-24',
  time = '21:00',
  guestName = 'Test guest',
  classification: BookingClassification = 'UNCLASSIFIED',
) {
  const calendarDate = time < '05:00' ? '2030-10-25' : date
  return {
    guestName,
    partySize: 4,
    expectedAt: `${calendarDate}T${time}:00+07:00`,
    businessDate: date,
    sourceCode: 'HOTLINE',
    classification,
    note: 'Initial note',
  }
}

async function createAssignedBooking(tableId = tableOneId): Promise<BookingView> {
  const created = await createBooking(actor, bookingInput())
  return assignBookingTables(actor, created.id, created.version, [tableId])
}

async function row(sql: string, values: (string | number)[]): Promise<RowDataPacket> {
  const [rows] = await databasePool.execute<RowDataPacket[]>(sql, values)
  const result = rows[0]
  if (!result) throw new Error('Expected a database row')
  return result
}

function databaseDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

mysqlDescribe('complete booking lifecycle MySQL integration', () => {
  beforeAll(async () => {
    passwordHash = await hashPassword(password)
  })

  beforeEach(async () => {
    await resetFixture()
  })

  afterAll(async () => {
    await clearOperationalData()
  })

  it('runs Create → Assign → Edit → Check-in → Close while preserving allocation history', async () => {
    const created = await createBooking(actor, bookingInput())
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId])
    const holdBefore = await row(
      `SELECT h.id AS hold_id, a.id AS allocation_id FROM table_holds h
       JOIN table_allocations a ON a.hold_id = h.id WHERE h.reservation_id = ? AND a.released_at IS NULL`,
      [created.id],
    )
    const edited = await updateBooking(actor, created.id, {
      ...bookingInput('2030-10-24', '22:15', 'Edited guest'),
      expectedVersion: assigned.version,
    })
    expect(edited.version).toBe(assigned.version + 1)
    const holdAfter = await row(
      `SELECT h.id AS hold_id, a.id AS allocation_id FROM table_holds h
       JOIN table_allocations a ON a.hold_id = h.id WHERE h.reservation_id = ? AND a.released_at IS NULL`,
      [created.id],
    )
    expect(Number(holdAfter.hold_id)).toBe(Number(holdBefore.hold_id))
    expect(Number(holdAfter.allocation_id)).toBe(Number(holdBefore.allocation_id))

    const checkedIn = await checkInBooking(actor, created.id, edited.version)
    const reservation = await row('SELECT visit_id FROM reservations WHERE id = ?', [created.id])
    const visitId = Number(reservation.visit_id)
    expect(checkedIn.status).toBe('CHECKED_IN')
    await closeVisit(actor, { visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })

    const [allocations] = await databasePool.execute<(RowDataPacket & { kind: string; released_at: Date | null })[]>(
      'SELECT kind, released_at FROM table_allocations WHERE table_id = ? ORDER BY id',
      [tableOneId],
    )
    expect(allocations.map((allocation) => allocation.kind)).toEqual(['HOLD', 'USAGE'])
    expect(allocations.every((allocation) => allocation.released_at !== null)).toBe(true)
  })

  it('persists manual O/N classification, supports edits, and keeps legacy NULL rows unclassified', async () => {
    const created = await createBooking(actor, bookingInput('2030-10-24', '20:00', 'Returning guest', 'RETURNING'))
    expect(created.classification).toBe('RETURNING')
    const reread = await row('SELECT customer_classification FROM reservations WHERE id = ?', [created.id])
    expect(reread.customer_classification).toBe('RETURNING')

    const updated = await updateBooking(actor, created.id, {
      ...bookingInput('2030-10-24', '20:00', 'Returning guest', 'NEW'),
      expectedVersion: created.version,
    })
    expect(updated.classification).toBe('NEW')
    const operation = await row(
      `SELECT changes FROM operation_log WHERE entity_type = 'reservation' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
      [created.id],
    )
    expect(JSON.stringify(operation.changes)).toContain('classification')

    await databasePool.execute(
      `UPDATE reservations SET customer_classification = NULL WHERE id = ?`,
      [created.id],
    )
    expect((await request(app).get(`/api/v1/bookings/${created.id}`)).status).toBe(401)
    await expect(getBookingById(actor, created.id)).resolves.toMatchObject({ classification: 'UNCLASSIFIED' })
  })

  it('edits information without replacing or modifying the existing HOLD/allocation identity', async () => {
    const assigned = await createAssignedBooking()
    const before = await row(
      `SELECT h.id AS hold_id, h.version AS hold_version, h.starts_at AS hold_starts_at,
         a.id AS allocation_id, a.starts_at AS allocation_starts_at
       FROM table_holds h JOIN table_allocations a ON a.hold_id = h.id
       WHERE h.reservation_id = ? AND h.status = 'ACTIVE' AND a.released_at IS NULL`,
      [assigned.id],
    )
    const updated = await updateBooking(actor, assigned.id, {
      ...bookingInput('2030-10-24', '21:00', 'Information only'),
      note: 'Updated information only',
      expectedVersion: assigned.version,
    })
    const after = await row(
      `SELECT h.id AS hold_id, h.version AS hold_version, h.starts_at AS hold_starts_at,
         a.id AS allocation_id, a.starts_at AS allocation_starts_at
       FROM table_holds h JOIN table_allocations a ON a.hold_id = h.id
       WHERE h.reservation_id = ? AND h.status = 'ACTIVE' AND a.released_at IS NULL`,
      [assigned.id],
    )
    expect(after).toMatchObject(before)
    expect(updated.tableCodes).toEqual(['T1'])
    const audit = await row(
      `SELECT action, entity_version_before, entity_version_after, change_seq
       FROM operation_log WHERE entity_type = 'reservation' AND entity_id = ? AND action = 'RESERVATION_UPDATED'`,
      [assigned.id],
    )
    expect(audit).toMatchObject({
      action: 'RESERVATION_UPDATED',
      entity_version_before: assigned.version,
      entity_version_after: assigned.version + 1,
    })
    const venue = await row('SELECT change_seq FROM venues WHERE id = ?', [venueId])
    expect(String(venue.change_seq)).toBe(String(audit.change_seq))
  })

  it.each([
    ['CANCELLED', 'RESERVATION_CANCELLED'],
    ['NO_SHOW', 'NO_SHOW'],
  ] as const)('handles the %s branch and releases its HOLD', async (status, releaseReason) => {
    const assigned = await createAssignedBooking()
    const closed = await closeBooking(
      actor,
      assigned.id,
      assigned.version,
      status,
      status === 'CANCELLED' ? 'Customer called to cancel' : undefined,
    )
    expect(closed.status).toBe(status)
    const allocation = await row('SELECT released_at, release_reason FROM table_allocations WHERE table_id = ?', [tableOneId])
    expect(allocation.released_at).not.toBeNull()
    expect(allocation.release_reason).toBe(releaseReason)
    if (status === 'CANCELLED') {
      const reservation = await row('SELECT close_reason_note FROM reservations WHERE id = ?', [assigned.id])
      expect(reservation.close_reason_note).toBe('Customer called to cancel')
    }
  })

  it('runs Walk-in → Close and releases the table', async () => {
    const walkIn = await createWalkIn(actor, {
      guestName: 'Walk-in guest', partySize: 2, businessDate: '2030-10-24', tableIds: [tableTwoId],
    })
    await closeVisit(actor, {
      visitId: walkIn.visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    const allocation = await row('SELECT released_at FROM table_allocations WHERE visit_id = ?', [walkIn.visitId])
    expect(allocation.released_at).not.toBeNull()
  })

  it('stores 00:30 on the next calendar day under the previous business date', async () => {
    const created = await createBooking(actor, bookingInput('2030-10-24', '00:30'))
    expect(created.businessDate).toBe('2030-10-24')
    expect(created.expectedAt).toBe('2030-10-24T17:30:00.000Z')
  })

  it.each(['05:00', '12:00', '16:59'])('rejects booking time %s outside the business window', async (time) => {
    await expect(createBooking(actor, bookingInput('2030-10-24', time)))
      .rejects.toMatchObject({ code: 'EXPECTED_AT_OUTSIDE_BUSINESS_HOURS' })
  })

  it('moves an assigned booking to another business date without changing table, HOLD, or allocation IDs', async () => {
    const assigned = await createAssignedBooking()
    const before = await row(
      `SELECT h.id AS hold_id, a.id AS allocation_id, a.table_id FROM table_holds h
       JOIN table_allocations a ON a.hold_id = h.id WHERE h.reservation_id = ? AND a.released_at IS NULL`,
      [assigned.id],
    )
    const updated = await updateBooking(actor, assigned.id, {
      ...bookingInput('2030-10-25', '21:30'),
      expectedAt: '2030-10-25T21:30:00+07:00',
      expectedVersion: assigned.version,
    })
    const after = await row(
      `SELECT h.id AS hold_id, a.id AS allocation_id, a.table_id, a.business_date FROM table_holds h
       JOIN table_allocations a ON a.hold_id = h.id WHERE h.reservation_id = ? AND a.released_at IS NULL`,
      [assigned.id],
    )
    expect(updated.businessDate).toBe('2030-10-25')
    expect([after.hold_id, after.allocation_id, after.table_id]).toEqual([before.hold_id, before.allocation_id, before.table_id])
    expect(databaseDate(after.business_date)).toBe('2030-10-25')
  })

  it('rolls back a date change when its existing table is occupied on the target date', async () => {
    const first = await createAssignedBooking()
    const secondCreated = await createBooking(actor, {
      ...bookingInput('2030-10-25', '20:00', 'Second guest'),
      expectedAt: '2030-10-25T20:00:00+07:00',
    })
    await assignBookingTables(actor, secondCreated.id, secondCreated.version, [tableOneId])
    const allocationBefore = await row(
      'SELECT id, business_date FROM table_allocations WHERE hold_id IN (SELECT id FROM table_holds WHERE reservation_id = ?) AND released_at IS NULL',
      [first.id],
    )
    await expect(updateBooking(actor, first.id, {
      ...bookingInput('2030-10-25', '22:00'),
      expectedAt: '2030-10-25T22:00:00+07:00',
      expectedVersion: first.version,
    })).rejects.toMatchObject({ code: 'TABLE_ALREADY_OCCUPIED' })
    const reservation = await row('SELECT version, business_date FROM reservations WHERE id = ?', [first.id])
    const allocationAfter = await row('SELECT id, business_date FROM table_allocations WHERE id = ?', [Number(allocationBefore.id)])
    expect(Number(reservation.version)).toBe(first.version)
    expect(databaseDate(reservation.business_date)).toBe('2030-10-24')
    expect(allocationAfter).toMatchObject(allocationBefore)
  })

  it('allows only one of two machines to edit the same version', async () => {
    const created = await createBooking(actor, bookingInput())
    const attempts = await Promise.allSettled([
      updateBooking(actor, created.id, { ...bookingInput('2030-10-24', '21:15', 'Machine A'), expectedVersion: created.version }),
      updateBooking(actor, created.id, { ...bookingInput('2030-10-24', '21:30', 'Machine B'), expectedVersion: created.version }),
    ])
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.find((result) => result.status === 'rejected'))
      .toMatchObject({ status: 'rejected', reason: { code: 'VERSION_CONFLICT' } })
  })

  it('serializes edit against assign, cancel, and check-in mutations', async () => {
    const createdForAssign = await createBooking(actor, bookingInput())
    const editAssign = await Promise.allSettled([
      updateBooking(actor, createdForAssign.id, { ...bookingInput('2030-10-24', '21:15'), expectedVersion: createdForAssign.version }),
      assignBookingTables(actor, createdForAssign.id, createdForAssign.version, [tableOneId]),
    ])
    expect(editAssign.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    await resetFixture()
    const createdForCancel = await createBooking(actor, bookingInput())
    const editCancel = await Promise.allSettled([
      updateBooking(actor, createdForCancel.id, { ...bookingInput('2030-10-24', '21:15'), expectedVersion: createdForCancel.version }),
      closeBooking(actor, createdForCancel.id, createdForCancel.version, 'CANCELLED'),
    ])
    expect(editCancel.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    await resetFixture()
    const assignedForCheckIn = await createAssignedBooking()
    const editCheckIn = await Promise.allSettled([
      updateBooking(actor, assignedForCheckIn.id, { ...bookingInput('2030-10-24', '21:15'), expectedVersion: assignedForCheckIn.version }),
      checkInBooking(actor, assignedForCheckIn.id, assignedForCheckIn.version),
    ])
    expect(editCheckIn.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  it.each(['CHECKED_IN', 'CANCELLED', 'NO_SHOW'] as const)('does not edit a %s reservation', async (status) => {
    const created = await createBooking(actor, bookingInput())
    let finalBooking: BookingView
    if (status === 'CHECKED_IN') {
      const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId])
      finalBooking = await checkInBooking(actor, created.id, assigned.version)
    } else {
      finalBooking = await closeBooking(actor, created.id, created.version, status)
    }
    await expect(updateBooking(actor, created.id, {
      ...bookingInput('2030-10-24', '22:00'), expectedVersion: finalBooking.version,
    }))
      .rejects.toMatchObject({ code: 'BOOKING_NOT_EDITABLE' })
  })

  it('protects edit with authentication, CSRF, and reservation.update', async () => {
    const created = await createBooking(actor, bookingInput())
    const receptionist = request.agent(app)
    const login = await receptionist.post('/api/v1/auth/login').set('Origin', env.webOrigin).send({
      username: 'booking_reception', password,
    })
    const auth = JSON.parse(login.text) as AuthResponse
    const sources = await receptionist.get('/api/v1/bookings/sources')
    expect(sources.status).toBe(200)
    expect(JSON.parse(sources.text)).toEqual({ sources: [
      { code: 'HOTLINE', name: 'Hotline' },
      { code: 'OTHER', name: 'Khác' },
    ] })
    const waitlistPayload = {
      guestName: 'Route waitlist guest', partySize: 2, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    }
    expect((await receptionist.post('/api/v1/waitlist').set('Origin', env.webOrigin).send(waitlistPayload)).status).toBe(403)
    const waitlistCreated = await receptionist.post('/api/v1/waitlist')
      .set('Origin', env.webOrigin).set('X-CSRF-Token', auth.csrfToken).send(waitlistPayload)
    expect(waitlistCreated.status).toBe(201)
    const waitlistBody = JSON.parse(waitlistCreated.text) as { entry: WaitlistEntryView }
    const payload = { ...bookingInput('2030-10-24', '22:00'), version: created.version }
    expect((await receptionist.put(`/api/v1/bookings/${created.id}`).set('Origin', env.webOrigin).send(payload)).status).toBe(403)

    const [careUser] = await databasePool.execute<ResultSetHeader>(
      `INSERT INTO users (username, display_name, password_hash, status)
       VALUES ('booking_care', 'Booking care', ?, 'ACTIVE')`,
      [passwordHash],
    )
    const [careMembership] = await databasePool.execute<ResultSetHeader>(
      'INSERT INTO memberships (organization_id, user_id, status) VALUES (?, ?, \'ACTIVE\')',
      [organizationId, careUser.insertId],
    )
    await databasePool.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
       SELECT ?, ?, id, ? FROM roles WHERE code = 'CUSTOMER_CARE'`,
      [organizationId, careMembership.insertId, venueId],
    )
    const care = request.agent(app)
    const careAuth = JSON.parse((await care.post('/api/v1/auth/login').set('Origin', env.webOrigin).send({
      username: 'booking_care', password,
    })).text) as AuthResponse
    expect(careAuth.permissions).not.toContain('reservation.update')
    const waitlistForbidden = await care.post(`/api/v1/waitlist/${waitlistBody.entry.id}/seat`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', careAuth.csrfToken)
      .send({ version: waitlistBody.entry.version, tableIds: [tableOneId] })
    expect(waitlistForbidden.status).toBe(403)
    const forbidden = await care.put(`/api/v1/bookings/${created.id}`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', careAuth.csrfToken).send(payload)
    expect(forbidden.status).toBe(403)

    const invalidClassification = await receptionist.put(`/api/v1/bookings/${created.id}`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', auth.csrfToken)
      .send({ ...payload, classification: 'INFERRED_FROM_PHONE' })
    expect(invalidClassification.status).toBe(400)
    expect(JSON.parse(invalidClassification.text)).toMatchObject({
      error: { code: 'INVALID_BOOKING_CLASSIFICATION' },
    })

    const allowed = await receptionist.put(`/api/v1/bookings/${created.id}`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', auth.csrfToken).send(payload)
    expect(allowed.status).toBe(200)
    const seated = await receptionist.post(`/api/v1/waitlist/${waitlistBody.entry.id}/seat`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', auth.csrfToken)
      .send({ version: waitlistBody.entry.version, tableIds: [tableOneId] })
    expect(seated.status).toBe(200)
    const seatedBody = JSON.parse(seated.text) as { reservationId: number }
    const waitlistReservation = await row(
      'SELECT customer_classification FROM reservations WHERE id = ?',
      [seatedBody.reservationId],
    )
    expect(waitlistReservation.customer_classification).toBe('UNCLASSIFIED')
  })

  it('protects masked search/detail/export and returns real booking data without full phone fields', async () => {
    const created = await createBooking(actor, bookingInput('2030-10-24', '21:00', 'Nguyễn Minh Search', 'RETURNING'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId, tableTwoId])
    expect((await request(app).get('/api/v1/bookings/search?date=2030-10-24&q=Minh')).status).toBe(401)

    const receptionist = request.agent(app)
    const login = await receptionist.post('/api/v1/auth/login').set('Origin', env.webOrigin).send({
      username: 'booking_reception', password,
    })
    const auth = JSON.parse(login.text) as AuthResponse
    expect(auth.permissions).toContain('customer.view_masked')

    const search = await receptionist.get('/api/v1/bookings/search?date=2030-10-24&q=Minh')
    expect(search.status).toBe(200)
    const searchBody = JSON.parse(search.text) as { bookings: BookingView[] }
    expect(searchBody.bookings.map((booking) => booking.id)).toEqual([assigned.id])
    expect(search.text).not.toContain('phone_ciphertext')
    expect(search.text).not.toContain('phone_hmac')

    const detail = await receptionist.get(`/api/v1/bookings/${assigned.id}`)
    expect(detail.status).toBe(200)
    expect((JSON.parse(detail.text) as { booking: BookingView }).booking).toMatchObject({
      guestName: 'Nguyễn Minh Search', tableCodes: ['T1', 'T2'], phoneLast3: null,
    })
    expect(detail.text).not.toContain('phone_ciphertext')
    expect(detail.text).not.toContain('phone_hmac')

    await createWaitlistEntry(actor, {
      guestName: 'Export wait one', partySize: 2, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    await createWaitlistEntry(actor, {
      guestName: 'Export wait two', partySize: 3, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    const atCutoff = await createBooking(actor, bookingInput('2030-10-24', '21:30', 'New at cutoff', 'NEW'))
    const afterMidnight = await createBooking(actor, {
      ...bookingInput('2030-10-24', '00:30', 'After midnight', 'UNCLASSIFIED'),
      partySize: 2,
    })
    const cancelledDraft = await createBooking(actor, bookingInput('2030-10-24', '22:00', 'Export cancelled', 'NEW'))
    await closeBooking(actor, cancelledDraft.id, cancelledDraft.version, 'CANCELLED')
    await databasePool.execute(
      `INSERT INTO dining_tables
        (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, status, pos_x, pos_y)
       VALUES (9303, ?, ?, 9301, 'T3', 'Table 3', 'TABLE', 4, 'OUT_OF_SERVICE', 30, 30)`,
      [organizationId, venueId],
    )

    const exported = await receptionist.get('/api/v1/bookings/export?date=2030-10-24')
    expect(exported.status).toBe(200)
    expect(exported.headers['content-type']).toContain('text/plain')
    expect(exported.headers['content-disposition']).toContain('21gam-bookings-2030-10-24.txt')
    expect(exported.text).toContain('Danh sách bàn đặt 21Gam thứ Năm, 24/10/2030')
    expect(exported.text).toContain('Nguyễn Minh Search')
    expect(exported.text).toContain('T1+T2: 21:00 · Nguyễn Minh Search · 4 khách 🔥')
    expect(exported.text).toContain('BC (Bàn Chờ +2)')
    expect(exported.text).toMatch(/BÀN OUT\nT3/)
    expect(exported.text).toMatch(/BÀN HUỶ\nChưa gán: 22:00 · Export cancelled/)
    expect(exported.text).toContain('Tổng bàn đặt: 3')
    expect(exported.text).toContain('Tổng khách đặt: 10')
    expect(exported.text).toContain('Khách vào trước 21:30: 4')
    expect(exported.text).toContain('Khách vào sau 21:30: 6')
    expect(exported.text).toContain('Bàn khách quen O: 1')
    expect(exported.text).toContain('Bàn khách mới N: 1')
    expect(exported.text).toContain('Bàn chưa phân loại: 1')
    expect(exported.text.match(/Nguyễn Minh Search/g)).toHaveLength(1)
    expect(atCutoff.classification).toBe('NEW')
    expect(afterMidnight.businessDate).toBe('2030-10-24')
    expect(exported.text).not.toContain('phone')
  })

  it('rolls back HOLD changes when a later database write fails', async () => {
    const assigned = await createAssignedBooking()
    await expect(updateBooking(actor, assigned.id, {
      ...bookingInput('2030-10-25', '21:00', 'x'.repeat(121)),
      expectedAt: '2030-10-25T21:00:00+07:00',
      expectedVersion: assigned.version,
    })).rejects.toThrow()
    const reservation = await row('SELECT version, business_date FROM reservations WHERE id = ?', [assigned.id])
    const allocation = await row(
      'SELECT business_date FROM table_allocations WHERE hold_id IN (SELECT id FROM table_holds WHERE reservation_id = ?) AND released_at IS NULL',
      [assigned.id],
    )
    expect(Number(reservation.version)).toBe(assigned.version)
    expect(databaseDate(reservation.business_date)).toBe('2030-10-24')
    expect(databaseDate(allocation.business_date)).toBe('2030-10-24')
  })

  it('reassigns before check-in, releases the old HOLD allocation and preserves its history', async () => {
    const assigned = await createAssignedBooking(tableOneId)
    const oldAllocation = await row(
      'SELECT id FROM table_allocations WHERE table_id = ? AND released_at IS NULL',
      [tableOneId],
    )
    const reassigned = await assignBookingTables(actor, assigned.id, assigned.version, [tableTwoId])
    expect(reassigned.tableCodes).toEqual(['T2'])
    const oldAfter = await row('SELECT released_at, release_reason FROM table_allocations WHERE id = ?', [Number(oldAllocation.id)])
    expect(oldAfter.released_at).not.toBeNull()
    expect(oldAfter.release_reason).toBe('MOVED')
    const current = await row('SELECT table_id FROM table_allocations WHERE released_at IS NULL', [])
    expect(Number(current.table_id)).toBe(tableTwoId)
    const audit = await row(
      `SELECT action FROM operation_log
       WHERE entity_type = 'reservation' AND entity_id = ? AND action = 'RESERVATION_TABLES_REASSIGNED'`,
      [assigned.id],
    )
    expect(audit.action).toBe('RESERVATION_TABLES_REASSIGNED')
  })

  it('joins multiple physical tables atomically through assign, check-in, and close', async () => {
    const created = await createBooking(actor, bookingInput())
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId, tableTwoId])
    expect(assigned.tableCodes).toEqual(['T1', 'T2'])
    const checkedIn = await checkInBooking(actor, assigned.id, assigned.version)
    const reservation = await row('SELECT visit_id FROM reservations WHERE id = ?', [assigned.id])
    const visitId = Number(reservation.visit_id)
    const [openUsage] = await databasePool.execute<RowDataPacket[]>(
      `SELECT table_id FROM table_allocations
       WHERE visit_id = ? AND kind = 'USAGE' AND released_at IS NULL ORDER BY table_id`,
      [visitId],
    )
    expect(openUsage.map((allocation) => Number(allocation.table_id))).toEqual([tableOneId, tableTwoId])
    await closeVisit(actor, { visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    const [remaining] = await databasePool.execute<RowDataPacket[]>(
      'SELECT id FROM table_allocations WHERE visit_id = ? AND released_at IS NULL',
      [visitId],
    )
    expect(remaining).toHaveLength(0)
    expect(checkedIn.status).toBe('CHECKED_IN')
  })

  it('rolls back an entire multi-table reassign when one selected table conflicts', async () => {
    const first = await createAssignedBooking(tableOneId)
    const second = await createBooking(actor, bookingInput('2030-10-24', '22:00', 'Conflicting guest'))
    await assignBookingTables(actor, second.id, second.version, [tableTwoId])
    await expect(assignBookingTables(actor, first.id, first.version, [tableOneId, tableTwoId]))
      .rejects.toMatchObject({ code: 'TABLE_ALREADY_OCCUPIED' })
    const reservation = await row('SELECT version FROM reservations WHERE id = ?', [first.id])
    expect(Number(reservation.version)).toBe(first.version)
    const active = await row(
      `SELECT a.table_id FROM table_allocations a JOIN table_holds h ON h.id = a.hold_id
       WHERE h.reservation_id = ? AND h.status = 'ACTIVE' AND a.released_at IS NULL`,
      [first.id],
    )
    expect(Number(active.table_id)).toBe(tableOneId)
  })

  it('moves an active visit without closing it and keeps old USAGE history', async () => {
    const assigned = await createAssignedBooking(tableOneId)
    await checkInBooking(actor, assigned.id, assigned.version)
    const reservation = await row('SELECT visit_id FROM reservations WHERE id = ?', [assigned.id])
    const visitId = Number(reservation.visit_id)
    const moved = await moveVisit(actor, { visitId, expectedVersion: 1, tableIds: [tableTwoId] })
    expect(moved.version).toBe(2)
    expect(moved.previousTables.map((table) => table.code)).toEqual(['T1'])
    expect(moved.tables.map((table) => table.code)).toEqual(['T2'])
    const [allocations] = await databasePool.execute<(RowDataPacket & { table_id: number; released_at: Date | null; release_reason: string | null })[]>(
      `SELECT table_id, released_at, release_reason FROM table_allocations
       WHERE visit_id = ? ORDER BY id`,
      [visitId],
    )
    expect(allocations).toHaveLength(2)
    expect(Number(allocations[0]?.table_id)).toBe(tableOneId)
    expect(allocations[0]?.release_reason).toBe('MOVED')
    expect(allocations[0]?.released_at).not.toBeNull()
    expect(Number(allocations[1]?.table_id)).toBe(tableTwoId)
    expect(allocations[1]?.released_at).toBeNull()
  })

  it('rejects an active visit move with insufficient capacity and preserves the source allocation', async () => {
    const assigned = await createAssignedBooking(tableOneId)
    await checkInBooking(actor, assigned.id, assigned.version)
    const reservation = await row('SELECT visit_id FROM reservations WHERE id = ?', [assigned.id])
    const visitId = Number(reservation.visit_id)
    await databasePool.execute('UPDATE dining_tables SET capacity = 2 WHERE id = ?', [tableTwoId])
    await expect(moveVisit(actor, { visitId, expectedVersion: 1, tableIds: [tableTwoId] }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_TABLE_CAPACITY' })
    const active = await row(
      `SELECT table_id FROM table_allocations
       WHERE visit_id = ? AND kind = 'USAGE' AND released_at IS NULL`,
      [visitId],
    )
    expect(Number(active.table_id)).toBe(tableOneId)
    const visit = await row('SELECT version FROM visits WHERE id = ?', [visitId])
    expect(Number(visit.version)).toBe(1)
  })

  it('keeps a waitlist entry unique and creates a booking hold after a table is released', async () => {
    const occupyingVisit = await createWalkIn(actor, {
      guestName: 'Current guest', partySize: 2, businessDate: '2030-10-24', tableIds: [tableOneId],
    })
    const entry = await createWaitlistEntry(actor, {
      guestName: 'Waiting guest', partySize: 3, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    await expect(seatWaitlistEntry(actor, {
      entryId: entry.id, expectedVersion: entry.version, tableIds: [tableOneId],
    })).rejects.toMatchObject({ code: 'TABLE_ALREADY_OCCUPIED' })
    await closeVisit(actor, {
      visitId: occupyingVisit.visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    const assigned = await seatWaitlistEntry(actor, {
      entryId: entry.id, expectedVersion: entry.version, tableIds: [tableOneId],
    })
    expect(assigned.entry.status).toBe('HOLD_ACTIVE')
    expect(assigned.entry.reservationId).toBe(assigned.reservationId)
    expect(assigned.entry.visitId).toBeNull()
    await expect(seatWaitlistEntry(actor, {
      entryId: entry.id, expectedVersion: entry.version, tableIds: [tableOneId],
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    const [visits] = await databasePool.execute<RowDataPacket[]>(
      "SELECT id FROM visits WHERE contact_name = 'Waiting guest'",
    )
    expect(visits).toHaveLength(0)
    const hold = await row(
      `SELECT r.status, r.visit_id, a.kind FROM reservations r
       JOIN table_holds h ON h.reservation_id = r.id
       JOIN table_allocations a ON a.hold_id = h.id
       WHERE r.id = ? AND a.released_at IS NULL`,
      [assigned.reservationId],
    )
    expect(hold).toMatchObject({ status: 'BOOKED', visit_id: null, kind: 'HOLD' })
  })

  it('assigns one waitlist booking to multiple same-zone tables with a persistent group', async () => {
    const entry = await createWaitlistEntry(actor, {
      guestName: 'Multi table waitlist', partySize: 8, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    const assigned = await seatWaitlistEntry(actor, {
      entryId: entry.id, expectedVersion: entry.version, tableIds: [tableTwoId, tableOneId],
    })
    expect(assigned.groupId).not.toBeNull()
    const [reservations] = await databasePool.execute<RowDataPacket[]>(
      "SELECT id FROM reservations WHERE contact_name = 'Multi table waitlist'",
    )
    expect(reservations).toHaveLength(1)
    const [allocations] = await databasePool.execute<RowDataPacket[]>(
      `SELECT table_id, group_id FROM table_allocations
       WHERE hold_id = (SELECT id FROM table_holds WHERE reservation_id = ?) AND released_at IS NULL
       ORDER BY table_id`,
      [assigned.reservationId],
    )
    expect(allocations.map((allocation) => Number(allocation.table_id))).toEqual([tableOneId, tableTwoId])
    expect(new Set(allocations.map((allocation) => Number(allocation.group_id)))).toEqual(new Set([assigned.groupId]))
    const group = await row('SELECT business_date, dissolved_at FROM table_groups WHERE id = ?', [assigned.groupId!])
    expect(databaseDate(group.business_date)).toBe('2030-10-24')
    expect(group.dissolved_at).toBeNull()
  })

  it('rejects multi-table waitlist assignment across zones without partial mutation', async () => {
    const entry = await createWaitlistEntry(actor, {
      guestName: 'Cross zone waitlist', partySize: 5, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    await expect(seatWaitlistEntry(actor, {
      entryId: entry.id, expectedVersion: entry.version, tableIds: [tableOneId, tableThreeId],
    })).rejects.toMatchObject({ code: 'TABLE_ZONE_MISMATCH' })
    expect((await listWaitlist(actor, '2030-10-24')).find((item) => item.id === entry.id))
      .toMatchObject({ status: 'WAITING', reservationId: null, version: 1 })
    const [reservations] = await databasePool.execute<RowDataPacket[]>(
      "SELECT id FROM reservations WHERE contact_name = 'Cross zone waitlist'",
    )
    expect(reservations).toHaveLength(0)
  })

  it('allows only one concurrent assignment of the same waitlist entry', async () => {
    const entry = await createWaitlistEntry(actor, {
      guestName: 'Same entry race', partySize: 5, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    const attempts = await Promise.allSettled([
      seatWaitlistEntry(actor, { entryId: entry.id, expectedVersion: entry.version, tableIds: [tableOneId, tableTwoId] }),
      seatWaitlistEntry(actor, { entryId: entry.id, expectedVersion: entry.version, tableIds: [tableOneId, tableTwoId] }),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    const [reservations] = await databasePool.execute<RowDataPacket[]>(
      "SELECT id FROM reservations WHERE contact_name = 'Same entry race'",
    )
    expect(reservations).toHaveLength(1)
  })

  it('lists the real queue in FIFO order with id tie-breaker and venue scope', async () => {
    const first = await createWaitlistEntry(actor, {
      guestName: 'FIFO first', partySize: 2, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    const second = await createWaitlistEntry(actor, {
      guestName: 'FIFO second', partySize: 3, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    await databasePool.execute(
      'UPDATE waitlist_entries SET queued_at = ? WHERE id IN (?, ?)',
      ['2030-10-24 12:00:00.000', first.id, second.id],
    )
    const otherVenueId = venueId + 1
    await databasePool.execute(
      `INSERT INTO venues
        (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local)
       VALUES (?, ?, 'OTHER_TEST', 'Other test venue', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00')`,
      [otherVenueId, organizationId],
    )
    await createWaitlistEntry({ ...actor, venueId: otherVenueId }, {
      guestName: 'Other venue', partySize: 2, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    const entries = await listWaitlist(actor, '2030-10-24')
    expect(entries.map((entry) => entry.id)).toEqual([first.id, second.id])
  })

  it('encrypts phone data and rejects duplicate active submissions without storing plaintext', async () => {
    const phoneNumber = '0901234567'
    const first = await createWaitlistEntry(actor, {
      guestName: 'Encrypted phone', phoneNumber, partySize: 2,
      businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    expect(first.phoneLast3).toBe('567')
    await expect(createWaitlistEntry(actor, {
      guestName: 'Duplicate phone', phoneNumber, partySize: 2,
      businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })).rejects.toMatchObject({ code: 'WAITLIST_DUPLICATE' })
    const customer = await row(
      `SELECT CAST(phone_ciphertext AS CHAR) AS ciphertext, phone_last3
       FROM customers WHERE id = (SELECT customer_id FROM waitlist_entries WHERE id = ?)`,
      [first.id],
    )
    expect(String(customer.ciphertext)).not.toContain(phoneNumber)
    expect(customer.phone_last3).toBe('567')
    const assigned = await seatWaitlistEntry(actor, {
      entryId: first.id, expectedVersion: first.version, tableIds: [tableOneId],
    })
    const reservation = await row(
      'SELECT customer_id, visit_id FROM reservations WHERE id = ?', [assigned.reservationId],
    )
    expect(Number(reservation.customer_id)).toBeGreaterThan(0)
    expect(reservation.visit_id).toBeNull()
  })

  it('allows exactly one concurrent assignment and keeps audit/counter consistent', async () => {
    const first = await createWaitlistEntry(actor, {
      guestName: 'Concurrent one', partySize: 2, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    const second = await createWaitlistEntry(actor, {
      guestName: 'Concurrent two', partySize: 2, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    const results = await Promise.allSettled([
      seatWaitlistEntry(actor, { entryId: first.id, expectedVersion: first.version, tableIds: [tableTwoId] }),
      seatWaitlistEntry(actor, { entryId: second.id, expectedVersion: second.version, tableIds: [tableTwoId] }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const [active] = await databasePool.execute<RowDataPacket[]>(
      'SELECT id FROM table_allocations WHERE table_id = ? AND released_at IS NULL', [tableTwoId],
    )
    expect(active).toHaveLength(1)
    const waiting = (await listWaitlist(actor, '2030-10-24')).filter((entry) => entry.status === 'WAITING')
    expect(waiting).toHaveLength(1)
    const [audits] = await databasePool.execute<RowDataPacket[]>(
      "SELECT id FROM operation_log WHERE action = 'WAITLIST_ASSIGNED_TO_RESERVATION'",
    )
    expect(audits).toHaveLength(1)
  })

  it('rolls back booking, hold, allocation and waitlist transition when audit fails', async () => {
    const entry = await createWaitlistEntry(actor, {
      guestName: 'Rollback waitlist', partySize: 2, businessDate: '2030-10-24', contactChannel: 'IN_PERSON',
    })
    await databasePool.query(
      `ALTER TABLE operation_log ADD CONSTRAINT ck_test_reject_waitlist_assignment
       CHECK (action <> 'WAITLIST_ASSIGNED_TO_RESERVATION')`,
    )
    try {
      await expect(seatWaitlistEntry(actor, {
        entryId: entry.id, expectedVersion: entry.version, tableIds: [tableTwoId],
      })).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
    } finally {
      await databasePool.query('ALTER TABLE operation_log DROP CHECK ck_test_reject_waitlist_assignment')
    }
    const restored = (await listWaitlist(actor, '2030-10-24')).find((item) => item.id === entry.id)
    expect(restored).toMatchObject({ status: 'WAITING', version: 1, reservationId: null })
    const [reservations] = await databasePool.execute<RowDataPacket[]>("SELECT id FROM reservations WHERE contact_name = 'Rollback waitlist'")
    const [allocations] = await databasePool.execute<RowDataPacket[]>('SELECT id FROM table_allocations WHERE table_id = ?', [tableTwoId])
    expect(reservations).toHaveLength(0)
    expect(allocations).toHaveLength(0)
  })

  it('transitions to automatic NO_SHOW exactly at 30 minutes and releases every HOLD allocation once', async () => {
    const created = await createBooking(actor, bookingInput())
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableOneId, tableTwoId])
    expect(await listNoShowCandidates(organizationId, venueId, new Date('2030-10-24T14:29:59.999Z'), automationCutoff)).toHaveLength(0)
    expect(await listNoShowCandidates(organizationId, venueId, new Date('2030-10-24T14:30:00.000Z'), automationCutoff)).toHaveLength(1)

    const first = await runNoShowSweep({
      organizationId,
      venueId,
      systemUserId,
      now: new Date('2030-10-24T14:30:00.000Z'),
      automationCutoff,
    })
    const second = await runNoShowSweep({
      organizationId,
      venueId,
      systemUserId,
      now: new Date('2030-10-24T14:31:00.000Z'),
      automationCutoff,
    })
    expect(first).toEqual({ closed: 1, skipped: 0 })
    expect(second).toEqual({ closed: 0, skipped: 0 })

    const reservation = await row(
      'SELECT status, version, closed_by_user_id, no_show_warned_at FROM reservations WHERE id = ?',
      [assigned.id],
    )
    expect(reservation.status).toBe('NO_SHOW')
    expect(Number(reservation.version)).toBe(assigned.version + 1)
    expect(Number(reservation.closed_by_user_id)).toBe(systemUserId)
    expect(reservation.no_show_warned_at).not.toBeNull()
    const [allocations] = await databasePool.execute<(RowDataPacket & { released_at: Date | null; released_by_user_id: number })[]>(
      'SELECT released_at, released_by_user_id FROM table_allocations WHERE hold_id IS NOT NULL ORDER BY id',
    )
    expect(allocations).toHaveLength(2)
    expect(allocations.every((allocation) => allocation.released_at !== null && Number(allocation.released_by_user_id) === systemUserId)).toBe(true)
    const audit = await row(
      `SELECT actor_kind, actor_user_id, change_seq FROM operation_log
       WHERE action = 'RESERVATION_AUTO_NO_SHOW' AND entity_id = ?`,
      [assigned.id],
    )
    expect(audit.actor_kind).toBe('SYSTEM')
    expect(audit.actor_user_id).toBeNull()
    const venue = await row('SELECT change_seq FROM venues WHERE id = ?', [venueId])
    expect(String(audit.change_seq)).toBe(String(venue.change_seq))
  })

  it('protects bookings created before the immutable cutoff and processes bookings created at or after it', async () => {
    const protectedBooking = await createBooking(actor, bookingInput('2030-10-24', '21:00', 'Before cutoff'))
    const eligibleBooking = await createBooking(actor, bookingInput('2030-10-24', '21:00', 'After cutoff'))
    await databasePool.execute(
      `UPDATE reservations SET created_at = CASE id
         WHEN ? THEN '2030-10-24 13:29:59.999'
         WHEN ? THEN '2030-10-24 13:30:00.000'
       END WHERE id IN (?, ?)`,
      [protectedBooking.id, eligibleBooking.id, protectedBooking.id, eligibleBooking.id],
    )
    const cutoff = new Date('2030-10-24T13:30:00.000Z')
    const now = new Date('2030-10-24T14:30:00.000Z')
    const candidates = await listNoShowCandidates(organizationId, venueId, now, cutoff)
    expect(candidates.map((candidate) => candidate.id)).toEqual([Number(eligibleBooking.id)])

    const result = await runNoShowSweep({
      organizationId,
      venueId,
      systemUserId,
      now,
      automationCutoff: cutoff,
    })
    expect(result).toEqual({ closed: 1, skipped: 0 })
    const protectedRow = await row('SELECT status, version FROM reservations WHERE id = ?', [protectedBooking.id])
    const eligibleRow = await row('SELECT status, version FROM reservations WHERE id = ?', [eligibleBooking.id])
    expect(protectedRow).toMatchObject({ status: 'BOOKED', version: protectedBooking.version })
    expect(eligibleRow).toMatchObject({ status: 'NO_SHOW', version: eligibleBooking.version + 1 })
  })

  it('skips a stale candidate when expectedAt was edited after the scan', async () => {
    const assigned = await createAssignedBooking()
    const [candidate] = await listNoShowCandidates(organizationId, venueId, new Date('2030-10-24T14:31:00Z'), automationCutoff)
    expect(candidate).toBeDefined()
    await updateBooking(actor, assigned.id, {
      ...bookingInput('2030-10-24', '22:00', 'Rescheduled guest'),
      expectedVersion: assigned.version,
    })
    const result = await processNoShowCandidate(
      organizationId,
      venueId,
      systemUserId,
      candidate!,
      new Date('2030-10-24T14:31:00Z'),
      automationCutoff,
    )
    expect(result).toBe('SKIPPED')
    const reservation = await row('SELECT status, expected_at FROM reservations WHERE id = ?', [assigned.id])
    expect(reservation.status).toBe('BOOKED')
    expect((reservation.expected_at as Date).toISOString()).toBe('2030-10-24T15:00:00.000Z')
  })

  it.each(['CHECKED_IN', 'CANCELLED'] as const)('never auto-closes a %s booking', async (terminalStatus) => {
    const assigned = await createAssignedBooking()
    if (terminalStatus === 'CHECKED_IN') await checkInBooking(actor, assigned.id, assigned.version)
    else await closeBooking(actor, assigned.id, assigned.version, 'CANCELLED', 'Customer called')
    const result = await runNoShowSweep({
      organizationId,
      venueId,
      systemUserId,
      now: new Date('2030-10-24T15:00:00Z'),
      automationCutoff,
    })
    expect(result).toEqual({ closed: 0, skipped: 0 })
    const reservation = await row('SELECT status FROM reservations WHERE id = ?', [assigned.id])
    expect(reservation.status).toBe(terminalStatus)
  })

  it('is race-safe against check-in', async () => {
    const assigned = await createAssignedBooking()
    const [candidate] = await listNoShowCandidates(organizationId, venueId, new Date('2030-10-24T14:30:00Z'), automationCutoff)
    const results = await Promise.allSettled([
      processNoShowCandidate(organizationId, venueId, systemUserId, candidate!, new Date('2030-10-24T14:30:00Z'), automationCutoff),
      checkInBooking(actor, assigned.id, assigned.version),
    ])
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true)
    const reservation = await row('SELECT status FROM reservations WHERE id = ?', [assigned.id])
    expect(['NO_SHOW', 'CHECKED_IN']).toContain(reservation.status)
    const [activeAllocations] = await databasePool.execute<(RowDataPacket & { kind: string })[]>(
      'SELECT kind FROM table_allocations WHERE released_at IS NULL',
    )
    if (reservation.status === 'NO_SHOW') expect(activeAllocations).toHaveLength(0)
    else expect(activeAllocations.map((allocation) => allocation.kind)).toEqual(['USAGE'])
  })

  it('is idempotent and race-safe against manual no-show', async () => {
    const assigned = await createAssignedBooking()
    const [candidate] = await listNoShowCandidates(organizationId, venueId, new Date('2030-10-24T14:30:00Z'), automationCutoff)
    await Promise.allSettled([
      processNoShowCandidate(organizationId, venueId, systemUserId, candidate!, new Date('2030-10-24T14:30:00Z'), automationCutoff),
      closeBooking(actor, assigned.id, assigned.version, 'NO_SHOW'),
    ])
    const reservation = await row('SELECT status FROM reservations WHERE id = ?', [assigned.id])
    expect(reservation.status).toBe('NO_SHOW')
    const [closeAudits] = await databasePool.execute<RowDataPacket[]>(
      `SELECT id FROM operation_log WHERE entity_id = ? AND action IN ('RESERVATION_AUTO_NO_SHOW', 'RESERVATION_NO_SHOW')`,
      [assigned.id],
    )
    expect(closeAudits).toHaveLength(1)
  })
})

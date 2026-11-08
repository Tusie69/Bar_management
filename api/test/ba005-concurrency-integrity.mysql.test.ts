import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  assignBookingTables,
  checkInBooking,
  closeBooking,
  createAndAssignBooking,
  createBooking,
  createWalkIn,
  getBookingById,
  mergeBookingTables,
} from '../src/modules/bookings/booking.repository.js'
import { createWaitlistEntry, seatWaitlistEntry } from '../src/modules/waitlist/waitlist.repository.js'
import {
  actor,
  businessDate,
  clearFixture,
  initializeFixture,
  login,
  resetFixture,
  tableId,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const tableTwoId = 9811
const tableThreeId = 9812
const tableFourId = 9813
const checkInNow = new Date(`${businessDate}T19:00:00+07:00`)

const bookingInput = (guestName: string) => ({
  guestName,
  partySize: 2,
  businessDate,
  expectedAt: `${businessDate}T20:00:00+07:00`,
  sourceCode: 'HOTLINE',
})

async function addTables(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'A2', 'A2', 'TABLE', 4, 20, 10),
       (?, ?, ?, ?, 'A3', 'A3', 'TABLE', 4, 30, 10),
       (?, ?, ?, ?, 'A4', 'A4', 'TABLE', 4, 40, 10)`,
    [
      tableTwoId, actor.organizationId, actor.venueId, tableId,
      tableThreeId, actor.organizationId, actor.venueId, tableId,
      tableFourId, actor.organizationId, actor.venueId, tableId,
    ],
  )
}

async function invariantSnapshot(): Promise<Record<string, number>> {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    overlaps: number
    orphan_allocations: number
    orphan_groups: number | null
    checked_in_without_visit: number
  })[]>(
    `SELECT
      (SELECT COUNT(*) FROM (
        SELECT venue_id, business_date, table_id
        FROM table_allocations WHERE released_at IS NULL
        GROUP BY venue_id, business_date, table_id HAVING COUNT(*) > 1
      ) AS overlaps) AS overlaps,
      (SELECT COUNT(*) FROM table_allocations a
        LEFT JOIN table_holds h ON a.kind = 'HOLD' AND h.id = a.hold_id AND h.venue_id = a.venue_id
        LEFT JOIN visits v ON a.kind = 'USAGE' AND v.id = a.visit_id AND v.venue_id = a.venue_id
        WHERE (a.kind = 'HOLD' AND h.id IS NULL) OR (a.kind = 'USAGE' AND v.id IS NULL)) AS orphan_allocations,
      (SELECT COUNT(*) FROM table_groups g
        LEFT JOIN table_allocations a ON a.group_id = g.id AND a.venue_id = g.venue_id AND a.released_at IS NULL
        WHERE g.dissolved_at IS NULL GROUP BY g.id HAVING COUNT(a.id) = 0 LIMIT 1) AS orphan_groups,
      (SELECT COUNT(*) FROM reservations r
        LEFT JOIN visits v ON v.id = r.visit_id AND v.venue_id = r.venue_id
        WHERE r.status = 'CHECKED_IN' AND v.id IS NULL) AS checked_in_without_visit`,
  )
  const row = rows[0]!
  return {
    overlaps: Number(row.overlaps ?? 0),
    orphanAllocations: Number(row.orphan_allocations ?? 0),
    orphanGroups: Number(row.orphan_groups ?? 0),
    checkedInWithoutVisit: Number(row.checked_in_without_visit ?? 0),
  }
}

async function expectCleanInvariants(): Promise<void> {
  expect(await invariantSnapshot()).toEqual({
    overlaps: 0,
    orphanAllocations: 0,
    orphanGroups: 0,
    checkedInWithoutVisit: 0,
  })
}

async function activeAllocations(): Promise<Array<{ tableId: number; kind: string }>> {
  const [rows] = await databasePool.execute<(RowDataPacket & { table_id: number; kind: string })[]>(
    'SELECT table_id, kind FROM table_allocations WHERE released_at IS NULL ORDER BY table_id',
  )
  return rows.map((row) => ({ tableId: Number(row.table_id), kind: row.kind }))
}

async function createWalkInEntry(index: number) {
  return createWaitlistEntry(actor, {
    guestName: `BA005 wait ${index}`,
    partySize: 2,
    businessDate,
    contactChannel: 'IN_PERSON',
  })
}

mysqlDescribe('BA-005 concurrency and data-integrity audit', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTables()
  })
  afterAll(clearFixture)

  it.each([1, 2, 3])('RACE-01 serializes booking transfer versus cancellation (run %s)', async (run) => {
    const created = await createBooking(actor, bookingInput(`transfer-cancel-${run}`))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    const outcomes = await Promise.allSettled([
      assignBookingTables(actor, assigned.id, assigned.version, [tableTwoId]),
      closeBooking(actor, assigned.id, assigned.version, 'CANCELLED'),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)

    const booking = await getBookingById(actor, assigned.id)
    if (booking.status === 'CANCELLED') expect(await activeAllocations()).toEqual([])
    else {
      expect(booking.status).toBe('BOOKED')
      expect(await activeAllocations()).toEqual([{ tableId: tableTwoId, kind: 'HOLD' }])
    }
    expect(Number((await databasePool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM operation_log',
    ))[0][0]?.total)).toBe(2)
    await expectCleanInvariants()
  })

  it.each([1, 2, 3])('RACE-02 serializes merge versus transfer without partial groups (run %s)', async (run) => {
    const created = await createBooking(actor, bookingInput(`merge-transfer-${run}`))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    const outcomes = await Promise.allSettled([
      mergeBookingTables(actor, assigned.id, assigned.version, [tableId, tableTwoId]),
      assignBookingTables(actor, assigned.id, assigned.version, [tableThreeId]),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const allocations = await activeAllocations()
    expect([
      JSON.stringify([{ tableId, kind: 'HOLD' }, { tableId: tableTwoId, kind: 'HOLD' }]),
      JSON.stringify([{ tableId: tableThreeId, kind: 'HOLD' }]),
    ]).toContain(JSON.stringify(allocations))
    await expectCleanInvariants()
  })

  it('RACE-03 permits exactly one of 20 concurrent seats for the same waitlist entry', async () => {
    const entry = await createWalkInEntry(1)
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => seatWaitlistEntry(actor, {
      entryId: entry.id,
      expectedVersion: entry.version,
      tableIds: [tableId],
      arrived: true,
    }, checkInNow)))
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(19)
    const [counts] = await databasePool.execute<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM visits) AS visits,
        (SELECT COUNT(*) FROM table_allocations WHERE kind = 'USAGE' AND released_at IS NULL) AS usages,
        (SELECT COUNT(*) FROM waitlist_entries WHERE status = 'SEATED') AS seated,
        (SELECT COUNT(*) FROM operation_log WHERE action = 'WAITLIST_SEATED') AS audits`,
    )
    expect(Object.values(counts[0] ?? {}).map(Number)).toEqual([1, 1, 1, 1])
    await expectCleanInvariants()
  })

  it('RACE-04 preserves a confirmed booking against 20 concurrent Walk-ins', async () => {
    const booking = await createAndAssignBooking(actor, { ...bookingInput('priority-booking'), tableIds: [tableId] })
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => createWalkIn(actor, {
      guestName: `losing-walk-in-${index}`,
      partySize: 2,
      businessDate,
      tableIds: [tableId],
    })))
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(0)
    expect(await activeAllocations()).toEqual([{ tableId, kind: 'HOLD' }])
    expect((await getBookingById(actor, booking.id)).status).toBe('BOOKED')
    expect(Number((await databasePool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM visits'))[0][0]?.total)).toBe(0)
    await expectCleanInvariants()
  })

  it.each([1, 2, 3])('RACE-05 serializes check-in versus transfer (run %s)', async (run) => {
    const created = await createBooking(actor, bookingInput(`checkin-transfer-${run}`))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    const outcomes = await Promise.allSettled([
      checkInBooking(actor, assigned.id, assigned.version, checkInNow),
      assignBookingTables(actor, assigned.id, assigned.version, [tableTwoId]),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const booking = await getBookingById(actor, assigned.id)
    if (booking.status === 'CHECKED_IN') {
      expect(await activeAllocations()).toEqual([{ tableId, kind: 'USAGE' }])
      expect(Number((await databasePool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM visits'))[0][0]?.total)).toBe(1)
    } else {
      expect(booking.status).toBe('BOOKED')
      expect(await activeAllocations()).toEqual([{ tableId: tableTwoId, kind: 'HOLD' }])
      expect(Number((await databasePool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM visits'))[0][0]?.total)).toBe(0)
    }
    await expectCleanInvariants()
  })

  it('STRESS-01 permits one of 20 direct bookings competing for one table', async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => createAndAssignBooking(actor, {
      ...bookingInput(`direct-stress-${index}`),
      tableIds: [tableId],
    })))
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(19)
    const [counts] = await databasePool.execute<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM reservations) AS reservations,
        (SELECT COUNT(*) FROM table_holds WHERE status = 'ACTIVE') AS holds,
        (SELECT COUNT(*) FROM table_allocations WHERE released_at IS NULL) AS allocations,
        (SELECT COUNT(*) FROM operation_log) AS audits`,
    )
    expect(Object.values(counts[0] ?? {}).map(Number)).toEqual([1, 1, 1, 1])
    await expectCleanInvariants()
  })

  it('STRESS-02 permits one of 20 different waitlist entries competing for one table', async () => {
    const entries = []
    for (let index = 0; index < 20; index += 1) entries.push(await createWalkInEntry(index))
    const outcomes = await Promise.allSettled(entries.map((entry) => seatWaitlistEntry(actor, {
      entryId: entry.id,
      expectedVersion: entry.version,
      tableIds: [tableId],
      arrived: true,
    }, checkInNow)))
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(19)
    const [counts] = await databasePool.execute<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM visits) AS visits,
        (SELECT COUNT(*) FROM waitlist_entries WHERE status = 'SEATED') AS seated,
        (SELECT COUNT(*) FROM waitlist_entries WHERE status = 'WAITING') AS waiting,
        (SELECT COUNT(*) FROM operation_log WHERE action = 'WAITLIST_SEATED') AS audits`,
    )
    expect(Object.values(counts[0] ?? {}).map(Number)).toEqual([1, 1, 19, 1])
    await expectCleanInvariants()
  })

  it('IDEM-RACE-04 replays a committed direct booking without restoring it after concurrent cancellation', async () => {
    const session = await login()
    const payload = { ...bookingInput('idempotent-cancel'), tableIds: [tableId] }
    const key = 'ba005-replay-cancel-01'
    const first = await session.agent.post('/api/v1/bookings/direct').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).set('Idempotency-Key', key).send(payload)
    expect(first.status).toBe(201)
    const bookingId = Number((first.body as { booking: { id: number } }).booking.id)
    const version = Number((first.body as { booking: { version: number } }).booking.version)
    const [replay, cancelled] = await Promise.all([
      session.agent.post('/api/v1/bookings/direct').set('Origin', env.webOrigin)
        .set('X-CSRF-Token', session.csrfToken).set('Idempotency-Key', key).send(payload),
      closeBooking(actor, bookingId, version, 'CANCELLED'),
    ])
    expect(replay.status).toBe(201)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(cancelled.status).toBe('CANCELLED')
    expect((await getBookingById(actor, bookingId)).status).toBe('CANCELLED')
    expect(Number((await databasePool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM reservations'))[0][0]?.total)).toBe(1)
    expect(await activeAllocations()).toEqual([])
    await expectCleanInvariants()
  })

  it('FAIL-02/03 rolls back allocations, audit and change_seq when reassignment audit fails', async () => {
    const created = await createBooking(actor, bookingInput('fault-reassign'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    await databasePool.query(
      `ALTER TABLE operation_log ADD CONSTRAINT ck_ba005_reject_reassign
       CHECK (action <> 'RESERVATION_TABLES_REASSIGNED')`,
    )
    try {
      await expect(assignBookingTables(actor, assigned.id, assigned.version, [tableTwoId]))
        .rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
    } finally {
      await databasePool.query('ALTER TABLE operation_log DROP CHECK ck_ba005_reject_reassign')
    }
    expect((await getBookingById(actor, assigned.id)).version).toBe(assigned.version)
    expect(await activeAllocations()).toEqual([{ tableId, kind: 'HOLD' }])
    expect(Number((await databasePool.query<RowDataPacket[]>('SELECT change_seq FROM venues WHERE id = ?', [actor.venueId]))[0][0]?.change_seq)).toBe(1)
    expect(Number((await databasePool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM operation_log'))[0][0]?.total)).toBe(1)
    await expectCleanInvariants()
  })

  it('FAIL-04 lets InnoDB resolve a deterministic deadlock with one full rollback and reusable connections', async () => {
    const first = await databasePool.getConnection()
    const second = await databasePool.getConnection()
    const observer = await databasePool.getConnection()
    try {
      await Promise.all([first.beginTransaction(), second.beginTransaction()])
      await first.execute('UPDATE dining_tables SET version = version + 1 WHERE id = ?', [tableTwoId])
      await second.execute('UPDATE dining_tables SET version = version + 1 WHERE id = ?', [tableThreeId])
      const firstWait = first.execute('SELECT id FROM dining_tables WHERE id = ? FOR UPDATE', [tableThreeId])
      // A separate server round-trip yields after the first lock request was sent without using sleeps
      // or requiring PROCESS permission to inspect information_schema.innodb_trx.
      await observer.execute('SELECT 1')
      const secondWait = second.execute('SELECT id FROM dining_tables WHERE id = ? FOR UPDATE', [tableTwoId])
      const outcomes = await Promise.allSettled([firstWait, secondWait])
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
      if (rejected?.status === 'rejected') expect(rejected.reason).toMatchObject({ code: 'ER_LOCK_DEADLOCK' })
      await Promise.allSettled([first.commit(), second.commit()])
    } finally {
      await Promise.allSettled([first.rollback(), second.rollback()])
      first.release()
      second.release()
      observer.release()
    }
    const [versions] = await databasePool.execute<RowDataPacket[]>(
      'SELECT SUM(version) AS total FROM dining_tables WHERE id IN (?, ?)', [tableTwoId, tableThreeId],
    )
    // Each table starts at version 1; exactly one transaction's increment survives the deadlock.
    expect(Number(versions[0]?.total)).toBe(3)
    await createAndAssignBooking(actor, { ...bookingInput('after-deadlock'), tableIds: [tableFourId] })
    await expectCleanInvariants()
  })
})

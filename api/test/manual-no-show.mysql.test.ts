import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { AuthenticatedActor } from '../src/auth/authenticated-actor.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { checkInBooking, closeBooking, confirmBookingLate } from '../src/modules/bookings/booking.repository.js'
import {
  listNoShowCandidates,
  processNoShowCandidate,
  runNoShowSweep,
} from '../src/modules/bookings/no-show.worker.js'
import { getFloorProjection } from '../src/modules/tables/floor-projection.repository.js'

const enabled = process.env.RUN_MANUAL_NO_SHOW_INTEGRATION === '1'
if (enabled && (process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'gam21_platform_test')) {
  throw new Error('Manual no-show integration requires NODE_ENV=test and DB_NAME=gam21_platform_test')
}
const mysqlDescribe = enabled ? describe : describe.skip

const organizationId = 991_020
const venueId = 991_020
const receptionistId = 991_020
const membershipId = 991_020
const systemUserId = 991_021
const sourceId = 991_020
const customerId = 991_020
const zoneId = 991_020
const tableIds = [991_020, 991_021]
const reservationId = 991_020
const holdId = 991_020
const expectedAt = '2026-11-02 14:30:00.000'
const dueAt = new Date('2026-11-02T15:00:00.000Z')
const cutoff = new Date('2000-01-01T00:00:00.000Z')
const actor: AuthenticatedActor = {
  organizationId,
  venueId,
  userId: receptionistId,
  membershipId,
}

async function cleanup(): Promise<void> {
  await databasePool.execute('DELETE FROM operation_log WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM table_allocations WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM table_groups WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM table_holds WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM waitlist_entries WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM booking_call_logs WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM reservations WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM visits WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM customers WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM dining_tables WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM zones WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM booking_sources WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM membership_roles WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM memberships WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM users WHERE id IN (?, ?)', [receptionistId, systemUserId])
  await databasePool.execute('DELETE FROM venues WHERE organization_id = ?', [organizationId])
  await databasePool.execute('DELETE FROM organizations WHERE id = ?', [organizationId])
}

async function resetFixture(): Promise<void> {
  await cleanup()
  await databasePool.execute(
    'INSERT INTO organizations (id, code, name) VALUES (?, ?, ?)',
    [organizationId, 'MANUAL_NO_SHOW_IT', 'Manual no-show integration'],
  )
  await databasePool.execute(
    `INSERT INTO venues
      (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local,
       upcoming_warning_minutes, late_warning_minutes, no_show_warning_minutes)
     VALUES (?, ?, 'MANUAL_NO_SHOW_IT', 'Manual no-show integration', 'Asia/Ho_Chi_Minh',
       '17:00:00', '05:00:00', 10, 15, 30)`,
    [venueId, organizationId],
  )
  await databasePool.execute(
    `INSERT INTO users (id, username, display_name, password_hash, status) VALUES
      (?, 'manual_no_show_reception', 'Reception', 'test-only', 'ACTIVE'),
      (?, 'system_no_show', 'Manual no-show warning worker', 'test-only', 'DISABLED')`,
    [receptionistId, systemUserId],
  )
  await databasePool.execute(
    `INSERT INTO memberships (id, organization_id, user_id, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [membershipId, organizationId, receptionistId],
  )
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     SELECT ?, ?, id, ? FROM roles WHERE code = 'RECEPTIONIST'`,
    [organizationId, membershipId, venueId],
  )
  await databasePool.execute(
    `INSERT INTO booking_sources (id, organization_id, code, name, sort_order)
     VALUES (?, ?, 'MANUAL_IT', 'Manual integration', 1)`,
    [sourceId, organizationId],
  )
  await databasePool.execute(
    `INSERT INTO customers
      (id, organization_id, display_name, phone_ciphertext, phone_key_id, phone_hmac,
       phone_hmac_key_id, phone_last3, created_by_user_id)
     VALUES (?, ?, 'Verified guest', X'01', 1, UNHEX(REPEAT('11', 32)), 1, '123', ?)`,
    [customerId, organizationId, receptionistId],
  )
  await databasePool.execute(
    `INSERT INTO zones (id, organization_id, venue_id, code, name)
     VALUES (?, ?, ?, 'MANUAL_IT', 'Manual integration')`,
    [zoneId, organizationId, venueId],
  )
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES
      (?, ?, ?, ?, 'MNS1', 'Manual no-show 1', 'TABLE', 4, 10, 10),
      (?, ?, ?, ?, 'MNS2', 'Manual no-show 2', 'TABLE', 4, 20, 10)`,
    [tableIds[0]!, organizationId, venueId, zoneId, tableIds[1]!, organizationId, venueId, zoneId],
  )
  await databasePool.execute(
    `INSERT INTO reservations
      (id, organization_id, venue_id, customer_id, contact_name, source_id, party_size, expected_at,
       business_date, customer_classification, status, note, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, 'Manual no-show guest', ?, 6, ?, '2026-11-02', 'RETURNING', 'BOOKED',
       'private note +84901234123', ?, '2026-11-02 13:00:00.000')`,
    [reservationId, organizationId, venueId, customerId, sourceId, expectedAt, receptionistId],
  )
  await databasePool.execute(
    `INSERT INTO table_holds
      (id, organization_id, venue_id, hold_kind, reservation_id, status, starts_at, created_by_user_id)
     VALUES (?, ?, ?, 'RESERVATION', ?, 'ACTIVE', ?, ?)`,
    [holdId, organizationId, venueId, reservationId, expectedAt, receptionistId],
  )
  for (const tableId of tableIds) {
    await databasePool.execute(
      `INSERT INTO table_allocations
        (organization_id, venue_id, table_id, kind, hold_id, starts_at, business_date, created_by_user_id)
       VALUES (?, ?, ?, 'HOLD', ?, ?, '2026-11-02', ?)`,
      [organizationId, venueId, tableId, holdId, expectedAt, receptionistId],
    )
  }
}

mysqlDescribe('manual no-show policy on gam21_platform_test', () => {
  beforeAll(() => {
    expect(env.database.name).toBe('gam21_platform_test')
  })
  beforeEach(resetFixture)
  afterAll(async () => {
    await cleanup()
    await databasePool.end()
  })

  it('records late confirmation once, keeps claims, projects it and permits check-in', async () => {
    const confirmedAt = new Date('2026-11-02T14:42:00.000Z')
    const first = await confirmBookingLate(actor, reservationId, 1, confirmedAt)
    expect(first).toMatchObject({ bookingId: reservationId, lateConfirmed: true, version: 2 })
    expect(first.lateConfirmedAt).toBe(confirmedAt.toISOString())
    expect(Object.keys(first).sort()).toEqual(['bookingId', 'changeSeq', 'lateConfirmed', 'lateConfirmedAt', 'version'])

    const replay = await confirmBookingLate(actor, reservationId, 1, new Date('2026-11-02T14:43:00.000Z'))
    expect(replay).toMatchObject({ version: 2, lateConfirmedAt: confirmedAt.toISOString(), changeSeq: first.changeSeq })
    const [audit] = await databasePool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM operation_log
       WHERE organization_id = ? AND action = 'RESERVATION_LATE_CONFIRMED' AND entity_id = ?`,
      [organizationId, reservationId],
    )
    expect(Number(audit[0]?.count)).toBe(1)
    const [venueRows] = await databasePool.execute<RowDataPacket[]>(
      'SELECT change_seq FROM venues WHERE id = ?', [venueId],
    )
    expect(String(venueRows[0]?.change_seq)).toBe(first.changeSeq)
    const [claims] = await databasePool.execute<RowDataPacket[]>(
      `SELECT h.status, COUNT(a.id) AS allocations FROM table_holds AS h
       JOIN table_allocations AS a ON a.hold_id = h.id AND a.released_at IS NULL
       WHERE h.id = ? GROUP BY h.id`,
      [holdId],
    )
    expect(claims[0]?.status).toBe('ACTIVE')
    expect(Number(claims[0]?.allocations)).toBe(2)

    const projection = await getFloorProjection(actor, '2026-11-02', confirmedAt)
    expect(projection.tables.filter((table) => tableIds.includes(table.id)).every(
      (table) => table.displayState === 'LATE_CONFIRMED' && table.claim?.lateConfirmedAt === confirmedAt.toISOString(),
    )).toBe(true)

    await checkInBooking(actor, reservationId, 2, new Date('2026-11-02T14:44:00.000Z'))
    const checkedIn = await getFloorProjection(actor, '2026-11-02', new Date('2026-11-02T14:44:00.000Z'))
    expect(checkedIn.tables.filter((table) => tableIds.includes(table.id)).every(
      (table) => table.displayState === 'IN_USE',
    )).toBe(true)
  })

  it('rejects stale and post-threshold late confirmations without changing claims', async () => {
    await expect(confirmBookingLate(actor, reservationId, 9, new Date('2026-11-02T14:42:00.000Z')))
      .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    await expect(confirmBookingLate(actor, reservationId, 1, dueAt))
      .rejects.toMatchObject({ status: 409, code: 'LATE_CONFIRM_NO_SHOW_THRESHOLD_REACHED' })
    const [rows] = await databasePool.execute<RowDataPacket[]>(
      `SELECT r.version, r.late_confirmed_at, h.status
       FROM reservations AS r JOIN table_holds AS h ON h.reservation_id = r.id WHERE r.id = ?`,
      [reservationId],
    )
    expect(rows[0]).toMatchObject({ version: 1, late_confirmed_at: null, status: 'ACTIVE' })
  })

  it('serializes two devices so only one confirmation mutation is persisted', async () => {
    const confirmedAt = new Date('2026-11-02T14:42:00.000Z')
    const results = await Promise.all([
      confirmBookingLate(actor, reservationId, 1, confirmedAt),
      confirmBookingLate(actor, reservationId, 1, confirmedAt),
    ])
    expect(results[0]).toEqual(results[1])
    const [rows] = await databasePool.execute<RowDataPacket[]>(
      `SELECT r.version, r.late_confirmed_at,
        (SELECT COUNT(*) FROM operation_log o WHERE o.organization_id = r.organization_id
          AND o.entity_id = r.id AND o.action = 'RESERVATION_LATE_CONFIRMED') AS audit_count
       FROM reservations r WHERE r.id = ?`,
      [reservationId],
    )
    expect(rows[0]?.version).toBe(2)
    expect(Number(rows[0]?.audit_count)).toBe(1)
  })

  it('applies Option A at +30 without closing, releasing or dissolving the confirmed group', async () => {
    const groupId = 991_020
    const confirmedAt = new Date('2026-11-02T14:42:00.000Z')
    await databasePool.execute(
      `INSERT INTO table_groups
       (id, organization_id, venue_id, business_date, symbol_no, formed_at, formed_by_user_id)
       VALUES (?, ?, ?, '2026-11-02', 1, '2026-11-02 14:00:00.000', ?)`,
      [groupId, organizationId, venueId, receptionistId],
    )
    await databasePool.execute(
      'UPDATE table_allocations SET group_id = ? WHERE hold_id = ?',
      [groupId, holdId],
    )
    const confirmation = await confirmBookingLate(actor, reservationId, 1, confirmedAt)
    const projection = await getFloorProjection(actor, '2026-11-02', dueAt)
    const grouped = projection.tables.filter((table) => tableIds.includes(table.id))
    expect(grouped.every((table) =>
      table.displayState === 'NO_SHOW'
      && table.groupId === groupId
      && table.claim?.lateConfirmedAt === confirmedAt.toISOString()
    )).toBe(true)

    const [rows] = await databasePool.execute<RowDataPacket[]>(
      `SELECT r.status AS reservation_status, r.late_confirmed_at, r.late_confirmed_by_user_id,
        r.closed_at, h.status AS hold_status, g.dissolved_at,
        (SELECT COUNT(*) FROM table_allocations a
          WHERE a.hold_id = h.id AND a.released_at IS NULL) AS active_allocations,
        (SELECT COUNT(*) FROM operation_log o
          WHERE o.organization_id = r.organization_id AND o.entity_id = r.id
            AND o.action = 'RESERVATION_LATE_CONFIRMED') AS confirmation_logs,
        v.change_seq
       FROM reservations r
       JOIN table_holds h ON h.reservation_id = r.id AND h.venue_id = r.venue_id
       JOIN table_groups g ON g.id = ? AND g.venue_id = r.venue_id
       JOIN venues v ON v.id = r.venue_id AND v.organization_id = r.organization_id
       WHERE r.id = ?`,
      [groupId, reservationId],
    )
    expect(rows[0]).toMatchObject({
      reservation_status: 'BOOKED',
      closed_at: null,
      hold_status: 'ACTIVE',
      dissolved_at: null,
    })
    expect(Number(rows[0]?.late_confirmed_by_user_id)).toBe(receptionistId)
    expect(rows[0]?.late_confirmed_at).toBeInstanceOf(Date)
    expect((rows[0]?.late_confirmed_at as Date).toISOString()).toBe(confirmedAt.toISOString())
    expect(Number(rows[0]?.active_allocations)).toBe(2)
    expect(Number(rows[0]?.confirmation_logs)).toBe(1)
    expect(String(rows[0]?.change_seq)).toBe(confirmation.changeSeq)

    await checkInBooking(actor, reservationId, 2, new Date('2026-11-02T15:01:00.000Z'))
    const checkedIn = await getFloorProjection(actor, '2026-11-02', new Date('2026-11-02T15:01:00.000Z'))
    expect(checkedIn.tables.filter((table) => tableIds.includes(table.id)).every(
      (table) => table.displayState === 'IN_USE',
    )).toBe(true)
  })

  it('warns once while preserving reservation, hold and every allocation', async () => {
    const [candidate] = await listNoShowCandidates(organizationId, venueId, dueAt, cutoff)
    expect(candidate).toBeDefined()
    expect(await processNoShowCandidate(
      organizationId, venueId, systemUserId, candidate!, dueAt, cutoff,
    )).toBe('WARNED')
    expect(await processNoShowCandidate(
      organizationId, venueId, systemUserId, candidate!, dueAt, cutoff,
    )).toBe('SKIPPED')
    expect(await runNoShowSweep({ organizationId, venueId, systemUserId, now: dueAt, automationCutoff: cutoff }))
      .toEqual({ warned: 0, skipped: 0 })

    const [reservations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT status, version, closed_at, no_show_warned_at FROM reservations WHERE id = ?',
      [reservationId],
    )
    expect(reservations[0]).toMatchObject({ status: 'BOOKED', version: 1, closed_at: null })
    expect(reservations[0]?.no_show_warned_at).not.toBeNull()
    const [holds] = await databasePool.execute<RowDataPacket[]>(
      'SELECT status, released_at FROM table_holds WHERE id = ?', [holdId],
    )
    expect(holds[0]).toMatchObject({ status: 'ACTIVE', released_at: null })
    const [allocations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT released_at FROM table_allocations WHERE hold_id = ? ORDER BY table_id', [holdId],
    )
    expect(allocations).toHaveLength(2)
    expect(allocations.every((allocation) => allocation.released_at === null)).toBe(true)
  })

  it('projects derived NO_SHOW atomically without leaking private fields or mutating GET state', async () => {
    await runNoShowSweep({ organizationId, venueId, systemUserId, now: dueAt, automationCutoff: cutoff })
    const [before] = await databasePool.execute<RowDataPacket[]>(
      `SELECT r.status, r.version, r.no_show_warned_at, h.status AS hold_status,
         (SELECT COUNT(*) FROM table_allocations a WHERE a.hold_id = h.id AND a.released_at IS NULL) active_allocations,
         v.change_seq
       FROM reservations r
       JOIN table_holds h ON h.venue_id = r.venue_id AND h.reservation_id = r.id
       JOIN venues v ON v.organization_id = r.organization_id AND v.id = r.venue_id
       WHERE r.id = ?`,
      [reservationId],
    )
    const projection = await getFloorProjection(actor, '2026-11-02', dueAt)
    const [after] = await databasePool.execute<RowDataPacket[]>(
      `SELECT r.status, r.version, r.no_show_warned_at, h.status AS hold_status,
         (SELECT COUNT(*) FROM table_allocations a WHERE a.hold_id = h.id AND a.released_at IS NULL) active_allocations,
         v.change_seq
       FROM reservations r
       JOIN table_holds h ON h.venue_id = r.venue_id AND h.reservation_id = r.id
       JOIN venues v ON v.organization_id = r.organization_id AND v.id = r.venue_id
       WHERE r.id = ?`,
      [reservationId],
    )
    expect(after[0]).toEqual(before[0])
    expect(projection.serverNow).toBe(dueAt.toISOString())
    expect(projection.tables.map((table) => table.displayState)).toEqual(['NO_SHOW', 'NO_SHOW'])
    expect(projection.tables[0]?.claim).toMatchObject({
      kind: 'RESERVATION',
      reservationId,
      guestName: 'Verified guest',
      phoneLast3: '123',
      flags: ['RETURNING'],
      turnNo: null,
    })
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('private note')
    expect(serialized).not.toContain('+84901234123')
    expect(serialized).not.toContain('ciphertext')
    expect(serialized).not.toContain('hmac')
  })

  it('excludes reservation holds from another business date', async () => {
    const projection = await getFloorProjection(actor, '2026-11-03', dueAt)
    expect(projection.tables.map((table) => table.displayState)).toEqual(['EMPTY', 'EMPTY'])
    expect(projection.tables.every((table) => table.claim === null)).toBe(true)
  })

  it('maps persisted group symbol 27 deterministically on every member', async () => {
    await databasePool.execute(
      `INSERT INTO table_groups
        (id, organization_id, venue_id, business_date, symbol_no, formed_at, formed_by_user_id)
       VALUES (?, ?, ?, '2026-11-02', 27, '2026-11-02 13:00:00.000', ?)`,
      [organizationId, organizationId, venueId, receptionistId],
    )
    await databasePool.execute(
      'UPDATE table_allocations SET group_id = ? WHERE organization_id = ? AND released_at IS NULL',
      [organizationId, organizationId],
    )
    const projection = await getFloorProjection(actor, '2026-11-02', dueAt)
    expect(projection.groups).toEqual([{
      id: organizationId,
      symbolNo: 27,
      displayCode: '◆AA',
      tableIds,
    }])
    expect(projection.tables.every((table) => table.groupId === organizationId
      && table.groupDisplayCode === '◆AA'
      && table.groupMemberTableIds.join(',') === tableIds.join(','))).toBe(true)
  })

  it('projects a deadline-based waitlist offer as an occupied overdue hold', async () => {
    await databasePool.execute('DELETE FROM table_allocations WHERE organization_id = ?', [organizationId])
    await databasePool.execute('DELETE FROM table_holds WHERE organization_id = ?', [organizationId])
    await databasePool.execute(
      `INSERT INTO waitlist_entries
        (id, organization_id, venue_id, kind, contact_name, party_size, contact_channel,
         business_date, queued_at, status, created_by_user_id)
       VALUES (?, ?, ?, 'WALK_IN', 'Waitlist guest', 2, 'IN_PERSON', '2026-11-02',
         '2026-11-02 14:00:00.000', 'HOLD_ACTIVE', ?)`,
      [reservationId, organizationId, venueId, receptionistId],
    )
    await databasePool.execute(
      `INSERT INTO table_holds
        (id, organization_id, venue_id, hold_kind, waitlist_entry_id, status, starts_at,
         customer_confirmed_at, deadline_at, deadline_basis, default_minutes_snapshot, created_by_user_id)
       VALUES (?, ?, ?, 'WAITLIST_OFFER', ?, 'ACTIVE', '2026-11-02 14:00:00.000',
         '2026-11-02 14:00:00.000', '2026-11-02 14:15:00.000', 'DEFAULT', 15, ?)`,
      [holdId, organizationId, venueId, reservationId, receptionistId],
    )
    await databasePool.execute(
      `INSERT INTO table_allocations
        (organization_id, venue_id, table_id, kind, hold_id, starts_at, business_date, created_by_user_id)
       VALUES (?, ?, ?, 'HOLD', ?, '2026-11-02 14:00:00.000', '2026-11-02', ?)`,
      [organizationId, venueId, tableIds[0]!, holdId, receptionistId],
    )
    const projection = await getFloorProjection(actor, '2026-11-02', dueAt)
    expect(projection.tables[0]).toMatchObject({
      displayState: 'BOOKED',
      claim: {
        kind: 'WAITLIST_HOLD',
        waitlistEntryId: reservationId,
        holdId,
        holdOverdue: true,
      },
    })
    expect(projection.tables[1]).toMatchObject({ displayState: 'EMPTY', claim: null })
  })

  it('allows check-in after the warning without orphaning grouped allocations', async () => {
    await runNoShowSweep({ organizationId, venueId, systemUserId, now: dueAt, automationCutoff: cutoff })
    const booking = await checkInBooking(actor, reservationId, 1, dueAt)
    expect(booking.status).toBe('CHECKED_IN')
    const projection = await getFloorProjection(actor, '2026-11-02', dueAt)
    expect(projection.tables.map((table) => table.displayState)).toEqual(['IN_USE', 'IN_USE'])
    const [allocations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT kind, released_at, visit_id FROM table_allocations ORDER BY table_id',
    )
    expect(allocations).toHaveLength(4)
    const activeAllocations = allocations.filter((allocation) => allocation.released_at === null)
    expect(activeAllocations).toHaveLength(2)
    expect(activeAllocations.every((allocation) => allocation.kind === 'USAGE'
      && allocation.released_at === null && allocation.visit_id !== null)).toBe(true)
    expect(allocations.filter((allocation) => allocation.kind === 'HOLD')
      .every((allocation) => allocation.released_at !== null)).toBe(true)
  })

  it('releases every allocation only after an authorized manual no-show action', async () => {
    await runNoShowSweep({ organizationId, venueId, systemUserId, now: dueAt, automationCutoff: cutoff })
    const booking = await closeBooking(actor, reservationId, 1, 'NO_SHOW')
    expect(booking.status).toBe('NO_SHOW')
    const [allocations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT released_at, release_reason FROM table_allocations WHERE hold_id = ? ORDER BY table_id', [holdId],
    )
    expect(allocations).toHaveLength(2)
    expect(allocations.every((allocation) => allocation.released_at !== null
      && allocation.release_reason === 'NO_SHOW')).toBe(true)
    const [holds] = await databasePool.execute<RowDataPacket[]>(
      'SELECT status, release_reason_code FROM table_holds WHERE id = ?', [holdId],
    )
    expect(holds[0]).toMatchObject({ status: 'RELEASED', release_reason_code: 'CUSTOMER_NO_SHOW' })
  })

  it('serializes concurrent staff check-in and manual no-show without partial table state', async () => {
    await runNoShowSweep({ organizationId, venueId, systemUserId, now: dueAt, automationCutoff: cutoff })
    const results = await Promise.allSettled([
      checkInBooking(actor, reservationId, 1, dueAt),
      closeBooking(actor, reservationId, 1, 'NO_SHOW'),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const [reservations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT status FROM reservations WHERE id = ?', [reservationId],
    )
    const status = reservations[0]?.status as string
    expect(['CHECKED_IN', 'NO_SHOW']).toContain(status)
    const [activeAllocations] = await databasePool.execute<(RowDataPacket & { kind: string })[]>(
      'SELECT kind FROM table_allocations WHERE organization_id = ? AND released_at IS NULL ORDER BY table_id',
      [organizationId],
    )
    if (status === 'CHECKED_IN') {
      expect(activeAllocations.map((allocation) => allocation.kind)).toEqual(['USAGE', 'USAGE'])
    } else {
      expect(activeAllocations).toHaveLength(0)
    }
  })

  it('returns a consistent read snapshot while a grouped manual close commits concurrently', async () => {
    const [projectionResult, closeResult] = await Promise.allSettled([
      getFloorProjection(actor, '2026-11-02', dueAt),
      closeBooking(actor, reservationId, 1, 'NO_SHOW'),
    ])
    expect(projectionResult.status).toBe('fulfilled')
    expect(closeResult.status).toBe('fulfilled')
    const projection = (projectionResult as PromiseFulfilledResult<Awaited<ReturnType<typeof getFloorProjection>>>).value
    const states = new Set(projection.tables.map((table) => table.displayState))
    expect(states.size).toBe(1)
    expect(['NO_SHOW', 'EMPTY']).toContain(projection.tables[0]?.displayState)
    if (projection.tables[0]?.displayState === 'NO_SHOW') {
      expect(projection.tables.every((table) => table.claim?.reservationId === reservationId)).toBe(true)
    } else {
      expect(projection.tables.every((table) => table.claim === null)).toBe(true)
    }
  })
})

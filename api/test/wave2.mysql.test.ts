import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WaitlistEntryView } from '../src/modules/waitlist/waitlist.repository.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { assignBookingTables, createBooking, createWalkIn } from '../src/modules/bookings/booking.repository.js'
import { createWaitlistEntry, seatWaitlistEntry } from '../src/modules/waitlist/waitlist.repository.js'
import { actor, businessDate, clearFixture, initializeFixture, login,
  otherVenueId, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const bookingInput = { guestName: 'Advance guest', partySize: 2, businessDate,
  expectedAt: `${businessDate}T20:00:00+07:00`, sourceCode: 'HOTLINE' }
const advanceBody = (reservationId: number) => ({ kind: 'ADVANCE_RESERVATION', reservationId,
  businessDate, contactChannel: 'IN_PERSON' })

mysqlDescribe('Wave 2 owner-approved integration', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterEach(() => vi.useRealTimers())
  afterAll(clearFixture)

  it('revokes receptionist phone reveal and keeps venue configuration owner-only', async () => {
    const [grants] = await databasePool.execute<RowDataPacket[]>(
      `SELECT r.code AS role, p.code AS permission FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code IN ('booking.phone.reveal', 'venue.configure') ORDER BY p.code, r.code`,
    )
    expect(grants).toEqual([{ role: 'OWNER_ADMIN', permission: 'booking.phone.reveal' },
      { role: 'OWNER_ADMIN', permission: 'venue.configure' }])
    const receptionist = await login()
    const me = await receptionist.agent.get('/api/v1/auth/me')
    expect((me.body as { permissions: string[] }).permissions).not.toContain('booking.phone.reveal')
  })

  it('creates advance entries from reservations, prioritizes them over older walk-ins and rejects duplicates', async () => {
    const session = await login()
    const walk = await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ guestName: 'Walk guest', phoneNumber: '0901234567', partySize: 3, businessDate, contactChannel: 'IN_PERSON' })
    expect(walk.status).toBe(201)
    const booking = await createBooking(actor, { ...bookingInput, phoneNumber: '0907654321' })
    const created = await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send(advanceBody(booking.id))
    expect(created.status).toBe(201)
    expect((created.body as { entry: WaitlistEntryView }).entry).toMatchObject({ kind: 'ADVANCE_RESERVATION', reservationId: booking.id,
      guestName: bookingInput.guestName, partySize: 2, reservationExpectedAt: '2030-10-24T13:00:00.000Z' })
    const [creationAudits] = await databasePool.execute<RowDataPacket[]>(
      "SELECT * FROM operation_log WHERE action = 'WAITLIST_ADDED' ORDER BY change_seq",
    )
    expect(creationAudits).toHaveLength(2)
    for (const [index, kind, reason, entryId] of [
      [0, 'WALK_IN', 'WALK_IN_WAITING', (walk.body as { entry: WaitlistEntryView }).entry.id],
      [1, 'ADVANCE_RESERVATION', 'ADVANCE_RESERVATION_WAITING', (created.body as { entry: WaitlistEntryView }).entry.id],
    ] as const) {
      const audit = creationAudits[index]!
      expect(audit).toMatchObject({ entity_id: String(entryId), entity_version_after: 1, reason_code: reason,
        actor_user_id: String(actor.userId), actor_membership_id: String(actor.membershipId) })
      expect(audit.auth_session_id).not.toBeNull()
      expect(audit.changes).toEqual([{ type: 'waitlist_added', kind,
        partySize: kind === 'WALK_IN' ? 3 : null,
        ...(kind === 'ADVANCE_RESERVATION' ? { reservationId: booking.id } : {}) }])
      expect(JSON.stringify(audit)).not.toContain('Walk guest')
      expect(JSON.stringify(audit)).not.toContain(bookingInput.guestName)
      expect(JSON.stringify(audit)).not.toContain('0901234567')
      expect(JSON.stringify(audit)).not.toContain('0907654321')
    }
    // Priority is independent of status as well as arrival time.
    await databasePool.execute("UPDATE waitlist_entries SET status = 'OFFERED', offered_at = UTC_TIMESTAMP(3) WHERE id = ?", [(created.body as { entry: WaitlistEntryView }).entry.id])
    const listed = await session.agent.get(`/api/v1/waitlist?date=${businessDate}`)
    expect((listed.body as { entries: WaitlistEntryView[] }).entries.map((entry: { kind: string }) => entry.kind)).toEqual(['ADVANCE_RESERVATION', 'WALK_IN'])
    const duplicate = await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send(advanceBody(booking.id))
    expect(duplicate.status).toBe(409)
    const [counts] = await databasePool.execute<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM visits) AS visits, (SELECT COUNT(*) FROM table_holds) AS holds')
    expect(Number(counts[0]?.visits)).toBe(0)
    expect(Number(counts[0]?.holds)).toBe(0)
  })

  it('validates advance shape, reservation scope, date, status and existing holds', async () => {
    const booking = await createBooking(actor, bookingInput)
    const foreign = await createBooking({ ...actor, venueId: otherVenueId }, bookingInput)
    const session = await login()
    for (const [body, status] of [
      [{ ...advanceBody(booking.id), guestName: 'Duplicated' }, 400],
      [{ ...advanceBody(booking.id), partySize: 2 }, 400],
      [{ ...advanceBody(booking.id), reservationId: 0 }, 400],
      [{ ...advanceBody(booking.id), kind: 'OTHER' }, 400],
      [{ ...advanceBody(booking.id), businessDate: '2030-10-25' }, 409],
      [advanceBody(foreign.id), 404],
    ] as const) {
      expect((await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
        .set('X-CSRF-Token', session.csrfToken).send(body)).status).toBe(status)
    }
    await assignBookingTables(actor, booking.id, 1, [tableId])
    expect((await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send(advanceBody(booking.id))).status).toBe(409)
    await databasePool.execute("UPDATE reservations SET status = 'CANCELLED', closed_at = UTC_TIMESTAMP(3), closed_by_user_id = ?, close_reason_code = 'CUSTOMER_REQUEST' WHERE id = ?", [actor.userId, foreign.id])
    // Scope takes precedence over state validation.
    expect((await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send(advanceBody(foreign.id))).status).toBe(404)
  })

  it.each(['WAITING', 'CONTACTING', 'OFFERED'])('assigns an advance %s entry to grouped holds, then check-in creates its visit', async (status) => {
    const booking = await createBooking(actor, bookingInput)
    await databasePool.execute(
      `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity)
       VALUES (?, ?, ?, ?, 'A2', 'A2', 'TABLE', 1)`,
      [tableId + 2, actor.organizationId, actor.venueId, tableId],
    )
    await databasePool.execute('UPDATE dining_tables SET capacity = 1 WHERE id = ?', [tableId])
    const session = await login()
    const created = await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send(advanceBody(booking.id))
    expect(created.status).toBe(201)
    const id = (created.body as { entry: WaitlistEntryView }).entry.id
    await databasePool.execute(
      `UPDATE waitlist_entries SET status = ?, claimed_by_user_id = ?, claimed_at = ?,
       claim_expires_at = ?, offered_at = ? WHERE id = ?`,
      [status, status === 'CONTACTING' ? actor.userId : null,
        status === 'CONTACTING' ? '2030-10-24 12:00:00' : null,
        status === 'CONTACTING' ? '2030-10-24 12:05:00' : null,
        status === 'OFFERED' ? '2030-10-24 12:00:00' : null, id],
    )
    const assigned = await session.agent.post(`/api/v1/waitlist/${id}/seat`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 1, tableIds: [tableId, tableId + 2] })
    expect(assigned.status).toBe(200)
    const result = assigned.body as { entry: WaitlistEntryView; reservationId: number; groupId: number }
    expect(result.entry).toMatchObject({ id, kind: 'ADVANCE_RESERVATION', status: 'HOLD_ACTIVE', version: 2, reservationId: booking.id, visitId: null })
    expect(result.reservationId).toBe(booking.id)
    expect(result.groupId).not.toBeNull()
    const [counts] = await databasePool.execute<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM visits) AS visits, (SELECT COUNT(*) FROM reservations) AS reservations')
    expect(Number(counts[0]?.visits)).toBe(0)
    expect(Number(counts[0]?.reservations)).toBe(1)
    const [holds] = await databasePool.execute<RowDataPacket[]>('SELECT status, reservation_id FROM table_holds')
    expect(holds).toEqual([{ status: 'ACTIVE', reservation_id: String(booking.id) }])
    const [allocations] = await databasePool.execute<RowDataPacket[]>('SELECT kind, group_id FROM table_allocations WHERE released_at IS NULL')
    expect(allocations).toEqual([{ kind: 'HOLD', group_id: String(result.groupId) }, { kind: 'HOLD', group_id: String(result.groupId) }])
    const floor = await session.agent.get(`/api/v1/tables?date=${businessDate}`)
    expect((floor.body as { tables: { state: string }[] }).tables.every(table => table.state === 'RESERVED')).toBe(true)
    expect((await session.agent.post(`/api/v1/bookings/${booking.id}/check-in`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 1 })).status).toBe(409)
    const checkedIn = await session.agent.post(`/api/v1/bookings/${booking.id}/check-in`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 2 })
    expect(checkedIn.status).toBe(200)
    const [entries] = await databasePool.execute<RowDataPacket[]>('SELECT status, version, visit_id, claimed_by_user_id FROM waitlist_entries WHERE id = ?', [id])
    expect(entries[0]).toMatchObject({ status: 'SEATED', version: 3, claimed_by_user_id: null })
    expect(entries[0]?.visit_id).not.toBeNull()
    const [visits] = await databasePool.execute<RowDataPacket[]>('SELECT origin FROM visits')
    expect(visits).toEqual([{ origin: 'RESERVATION' }])
    const [audit] = await databasePool.execute<RowDataPacket[]>("SELECT action FROM operation_log WHERE entity_type = 'waitlist_entry' AND entity_id = ? ORDER BY id", [id])
    expect(audit).toEqual([{ action: 'WAITLIST_ADDED' }, { action: 'WAITLIST_ASSIGNED_TO_RESERVATION' }, { action: 'WAITLIST_SEATED' }])
    const [usage] = await databasePool.execute<RowDataPacket[]>('SELECT kind, group_id FROM table_allocations WHERE released_at IS NULL')
    expect(usage).toEqual([{ kind: 'USAGE', group_id: String(result.groupId) }, { kind: 'USAGE', group_id: String(result.groupId) }])
  })

  async function bookingWithLinkedEntries(status: 'CONTACTING' | 'HOLD_ACTIVE') {
    const booking = await createBooking(actor, bookingInput)
    const input = { kind: 'ADVANCE_RESERVATION' as const, reservationId: booking.id, businessDate,
      contactChannel: 'IN_PERSON' as const }
    const seatedVisit = await createWalkIn(actor, { partySize: 1, businessDate, tableIds: [tableId] })
    // Preserve a real terminal entry of each kind linked to this reservation.
    for (const terminal of ['SEATED', 'DECLINED', 'CANCELLED']) {
      const entry = await createWaitlistEntry(actor, input)
      await databasePool.execute(
        `UPDATE waitlist_entries SET status = ?, closed_at = UTC_TIMESTAMP(3), closed_by_user_id = ?,
         close_reason_code = 'OTHER', visit_id = ? WHERE id = ?`,
        [terminal, actor.userId, terminal === 'SEATED' ? seatedVisit.visitId : null, entry.id],
      )
    }
    // End the synthetic visit so the reservation can own a grouped hold.
    await databasePool.execute("UPDATE table_allocations SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?, release_reason = 'GUEST_LEFT' WHERE visit_id = ?",
      [actor.userId, seatedVisit.visitId])
    const entry = await createWaitlistEntry(actor, input)
    const unrelated = await createBooking(actor, bookingInput)
    await createWaitlistEntry(actor, { ...input, reservationId: unrelated.id })
    await databasePool.execute(
      `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity)
       VALUES (?, ?, ?, ?, 'A2', 'A2', 'TABLE', 2)`,
      [tableId + 2, actor.organizationId, actor.venueId, tableId],
    )
    // Waitlist seating creates a group; direct booking assignment leaves tables ungrouped.
    const seated = await seatWaitlistEntry(actor, { entryId: entry.id, expectedVersion: 1, tableIds: [tableId, tableId + 2] })
    expect(seated.groupId).not.toBeNull()
    const [groups] = await databasePool.execute<RowDataPacket[]>('SELECT dissolved_at FROM table_groups WHERE id = ?', [seated.groupId])
    expect(groups).toEqual([{ dissolved_at: null }])
    const [groupAllocations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT table_id FROM table_allocations WHERE group_id = ? AND released_at IS NULL ORDER BY table_id', [seated.groupId],
    )
    expect(groupAllocations).toEqual([{ table_id: String(tableId) }, { table_id: String(tableId + 2) }])
    await databasePool.execute(
      `UPDATE waitlist_entries SET status = ?, version = 4, claimed_by_user_id = ?, claimed_at = ?, claim_expires_at = ? WHERE id = ?`,
      [status, status === 'CONTACTING' ? actor.userId : null,
        status === 'CONTACTING' ? '2030-10-24 12:00:00' : null,
        status === 'CONTACTING' ? '2030-10-24 12:05:00' : null, entry.id],
    )
    return { booking, entry }
  }

  async function closureSnapshot() {
    const snapshot: Record<string, RowDataPacket[]> = {}
    for (const table of ['reservations', 'waitlist_entries', 'table_holds', 'table_allocations', 'table_groups', 'operation_log', 'venues']) {
      const [rows] = await databasePool.execute<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY id`)
      snapshot[table] = rows
    }
    return snapshot
  }

  it.each([
    ['cancel', 'CONTACTING'], ['cancel', 'HOLD_ACTIVE'],
    ['no-show', 'CONTACTING'], ['no-show', 'HOLD_ACTIVE'],
  ] as const)('audits linked %s cancellation from %s and leaves terminal/unrelated entries untouched', async (action, status) => {
    const { booking, entry } = await bookingWithLinkedEntries(status)
    const before = await closureSnapshot()
    const session = await login()
    const [sessions] = await databasePool.execute<(RowDataPacket & { id: string })[]>('SELECT id FROM auth_sessions WHERE user_id = ?', [actor.userId])
    expect((await session.agent.post(`/api/v1/bookings/${booking.id}/${action}`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 2 })).status).toBe(200)
    const after = await closureSnapshot()
    const changed = after.waitlist_entries!.find(row => Number(row.id) === entry.id)!
    expect(changed).toMatchObject({ status: 'CANCELLED', close_reason_code: 'RESERVATION_CANCELLED',
      closed_by_user_id: String(actor.userId), version: 5, claimed_by_user_id: null, claimed_at: null, claim_expires_at: null })
    expect(changed.closed_at).not.toBeNull()
    expect(after.waitlist_entries!.filter(row => Number(row.id) !== entry.id))
      .toEqual(before.waitlist_entries!.filter(row => Number(row.id) !== entry.id))
    const addedAudits = after.operation_log!.filter(row => !before.operation_log!.some(old => old.id === row.id))
    expect(addedAudits).toHaveLength(2)
    const audit = addedAudits.find(row => row.entity_type === 'waitlist_entry')!
    expect(audit).toMatchObject({ action: 'WAITLIST_CANCELLED', entity_id: String(entry.id),
      organization_id: String(actor.organizationId), venue_id: String(actor.venueId),
      actor_kind: 'USER', actor_user_id: String(actor.userId), actor_membership_id: String(actor.membershipId),
      auth_session_id: sessions[0]!.id, reason_code: 'RESERVATION_CANCELLED', entity_version_before: 4, entity_version_after: 5 })
    expect(audit.changes).toEqual([{ type: 'waitlist_cancelled', reservationId: booking.id,
      before: { status, version: 4 }, after: { status: 'CANCELLED', version: 5 } }])
    expect(addedAudits.find(row => row.entity_type === 'reservation')).toMatchObject({ entity_id: String(booking.id),
      action: action === 'cancel' ? 'RESERVATION_CANCELLED' : 'RESERVATION_NO_SHOW', entity_version_before: 2, entity_version_after: 3 })
    expect(after.table_holds).toHaveLength(1)
    expect(after.table_holds![0]).toMatchObject({ status: 'RELEASED' })
    expect(after.table_allocations!.every(row => row.released_at !== null)).toBe(true)
    expect(after.table_groups).toHaveLength(1)
    expect(after.table_groups![0]!.dissolved_at).not.toBeNull()
  })

  it.each(['cancel', 'no-show'] as const)('rolls back %s booking, claims, grouped holds and sequences when the linked entry audit fails', async (action) => {
    const { booking, entry } = await bookingWithLinkedEntries('CONTACTING')
    const [venues] = await databasePool.execute<RowDataPacket[]>('SELECT change_seq FROM venues WHERE id = ?', [actor.venueId])
    await databasePool.execute(
      `INSERT INTO operation_log (organization_id, venue_id, change_seq, actor_kind, actor_user_id, action, entity_type, entity_id)
       VALUES (?, ?, ?, 'USER', ?, 'TEST_AUDIT_FAILURE', 'waitlist_entry', ?)`,
      [actor.organizationId, actor.venueId, (BigInt(venues[0]!.change_seq as string) + 1n).toString(), actor.userId, entry.id],
    )
    const session = await login()
    const before = await closureSnapshot()
    const response = await session.agent.post(`/api/v1/bookings/${booking.id}/${action}`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 2 })
    expect(response.status).toBe(409)
    expect(await closureSnapshot()).toEqual(before)
  })

  it('serializes concurrent duplicate advance submissions', async () => {
    const booking = await createBooking(actor, bookingInput)
    const session = await login()
    const responses = await Promise.all([1, 2].map(() => session.agent.post('/api/v1/waitlist')
      .set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send(advanceBody(booking.id))))
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
  })

  it('closes the advance entry as SEATED_OTHERWISE when checking in through the booking route', async () => {
    const booking = await createBooking(actor, bookingInput)
    const session = await login()
    const created = await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send(advanceBody(booking.id))
    await assignBookingTables(actor, booking.id, 1, [tableId])
    const response = await session.agent.post(`/api/v1/bookings/${booking.id}/check-in`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 2 })
    expect(response.status).toBe(200)
    const [entries] = await databasePool.execute<RowDataPacket[]>('SELECT status, close_reason_code, visit_id FROM waitlist_entries WHERE id = ?', [(created.body as { entry: WaitlistEntryView }).entry.id])
    expect(entries[0]).toMatchObject({ status: 'SEATED', close_reason_code: 'SEATED_OTHERWISE' })
    expect(entries[0]?.visit_id).not.toBeNull()
  })

  it.each(['seat', 'cancel'])('rolls back reservation and waitlist changes if the %s audit fails', async (action) => {
    const booking = await createBooking(actor, bookingInput)
    const session = await login()
    const created = await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send(advanceBody(booking.id))
    const id = (created.body as { entry: WaitlistEntryView }).entry.id
    await databasePool.execute(
      `INSERT INTO operation_log (organization_id, venue_id, change_seq, actor_kind, actor_user_id, action, entity_type, entity_id)
       VALUES (?, ?, ?, 'USER', ?, 'TEST_AUDIT_FAILURE', 'waitlist_entry', ?)`,
      [actor.organizationId, actor.venueId, 2, actor.userId, id],
    )
    const path = action === 'seat' ? `/waitlist/${id}/seat` : `/bookings/${booking.id}/cancel`
    const response = await session.agent.post(`/api/v1${path}`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 1, tableIds: [tableId] })
    expect(response.status).toBe(409)
    const [entries] = await databasePool.execute<RowDataPacket[]>('SELECT status, version FROM waitlist_entries WHERE id = ?', [id])
    const [bookings] = await databasePool.execute<RowDataPacket[]>('SELECT status, version FROM reservations WHERE id = ?', [booking.id])
    const [counts] = await databasePool.execute<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM visits) AS visits, (SELECT COUNT(*) FROM table_holds) AS holds')
    expect(entries[0]).toMatchObject({ status: 'WAITING', version: 1 })
    expect(bookings[0]).toMatchObject({ status: 'BOOKED', version: 1 })
    expect(Number(counts[0]?.visits)).toBe(0)
    expect(Number(counts[0]?.holds)).toBe(0)
  })

  it('allows only the owner to toggle table service with reason, version and audit', async () => {
    const owner = await login('integration_owner')
    const receptionist = await login()
    const body = { version: 1, status: 'OUT_OF_SERVICE', reason: 'Repair damaged chair' }
    const patch = (session: typeof owner, value: object) => session.agent.patch(`/api/v1/tables/${tableId}/configuration`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send(value)
    expect((await patch(receptionist, body)).status).toBe(403)
    expect((await patch(owner, { ...body, reason: '' })).status).toBe(400)
    expect((await patch(owner, { ...body, reason: '   ' })).status).toBe(400)
    expect((await patch(owner, { ...body, status: 'RESERVED' })).status).toBe(400)
    const changed = await patch(owner, body)
    expect(changed.status).toBe(200)
    expect((changed.body as { table: { id: number; status: string; version: number } }).table).toMatchObject({ id: tableId, status: 'OUT_OF_SERVICE', version: 2 })
    expect((await patch(owner, body)).status).toBe(409)
    const floor = await owner.agent.get(`/api/v1/tables?date=${businessDate}`)
    expect((floor.body as { tables: unknown[] }).tables).toEqual(expect.arrayContaining([expect.objectContaining({ id: tableId, state: 'OUT_OF_SERVICE' })]))
    const catalog = await owner.agent.get('/api/v1/tables/catalog')
    expect((catalog.body as { tables: unknown[] }).tables).toEqual(expect.arrayContaining([expect.objectContaining({ id: tableId, status: 'OUT_OF_SERVICE' })]))
    const reopen = { version: 2, status: 'ACTIVE', reason: 'Repair completed' }
    expect((await patch(receptionist, reopen)).status).toBe(403)
    expect((await patch(owner, { ...reopen, reason: '   ' })).status).toBe(400)
    expect((await patch(owner, reopen)).status).toBe(200)
    const [audit] = await databasePool.execute<RowDataPacket[]>("SELECT actor_user_id, reason_note FROM operation_log WHERE action = 'TABLE_CONFIGURATION_UPDATED' ORDER BY id")
    expect(audit).toEqual([{ actor_user_id: '9802', reason_note: body.reason }, { actor_user_id: '9802', reason_note: 'Repair completed' }])
  })

  it.each([
    ['hold', 'OUT_OF_SERVICE'], ['visit', 'OUT_OF_SERVICE'],
    ['hold', 'ACTIVE'], ['visit', 'ACTIVE'],
  ])('rejects configuration with an active %s allocation and requested status %s', async (kind, status) => {
    if (kind === 'hold') {
      const booking = await createBooking(actor, bookingInput)
      await assignBookingTables(actor, booking.id, 1, [tableId])
    } else await createWalkIn(actor, { partySize: 2, businessDate, tableIds: [tableId] })
    const owner = await login('integration_owner')
    const response = await owner.agent.patch(`/api/v1/tables/${tableId}/configuration`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', owner.csrfToken).send({ version: 1, status, reason: 'Repair' })
    expect(response.status).toBe(409)
    expect((response.body as { error: { code: string } }).error.code).toBe('TABLE_HAS_OPEN_ALLOCATION')
    const [audit] = await databasePool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM operation_log WHERE action = 'TABLE_CONFIGURATION_UPDATED'",
    )
    expect(Number(audit[0]?.count)).toBe(0)
  })

  it('rejects assignment, walk-in and both waitlist kinds on OUT_OF_SERVICE tables without partial writes', async () => {
    const session = await login('integration_owner')
    expect((await session.agent.patch(`/api/v1/tables/${tableId}/configuration`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 1, status: 'OUT_OF_SERVICE', reason: 'Repair' })).status).toBe(200)
    const booking = await createBooking(actor, bookingInput)
    await expect(assignBookingTables(actor, booking.id, 1, [tableId])).rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' })
    for (const body of [advanceBody(booking.id), { guestName: 'Walk', partySize: 2, businessDate, contactChannel: 'IN_PERSON' }]) {
      const entry = await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send(body)
      expect(entry.status).toBe(201)
      expect((await session.agent.post(`/api/v1/waitlist/${(entry.body as { entry: WaitlistEntryView }).entry.id}/seat`).set('Origin', env.webOrigin)
        .set('X-CSRF-Token', session.csrfToken).send({ version: 1, tableIds: [tableId] })).status).toBe(400)
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-10-24T13:00:00Z'))
    const currentSession = await login('integration_owner')
    const walk = await currentSession.agent.post('/api/v1/bookings/walk-ins').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', currentSession.csrfToken).send({ partySize: 2, businessDate, tableIds: [tableId] })
    vi.useRealTimers()
    expect(walk.status).toBe(400)
    const [counts] = await databasePool.execute<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM visits) AS visits, (SELECT COUNT(*) FROM table_holds) AS holds')
    expect(Number(counts[0]?.visits)).toBe(0)
    expect(Number(counts[0]?.holds)).toBe(0)
  })
})

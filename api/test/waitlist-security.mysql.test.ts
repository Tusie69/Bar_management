import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createBooking, createWalkIn, getBookingById, listBookings } from '../src/modules/bookings/booking.repository.js'
import { listTables, updateTableState } from '../src/modules/tables/table.repository.js'
import { cancelWaitlistEntry, createWaitlistEntry, listWaitlist, recordWaitlistContact } from '../src/modules/waitlist/waitlist.repository.js'
import { actor, businessDate, clearFixture, foreignTableId, initializeFixture, login,
  otherOrganizationId, otherVenueId, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const waitlistInput = { guestName: 'Waiting guest', partySize: 2, businessDate, contactChannel: 'IN_PERSON' as const }
const bookingInput = { guestName: 'Masked guest', partySize: 2, businessDate,
  expectedAt: `${businessDate}T20:00:00+07:00`, sourceCode: 'HOTLINE', phoneNumber: '0987654321' }
const cancelBody = { version: 1, reasonCode: 'CUSTOMER_WITHDREW', note: 'Guest requested cancellation' }
const contactBody = { version: 1, channel: 'PHONE_BY_AUTHORIZED', outcome: 'NO_ANSWER', note: 'First attempt' }

// Every protected business route is exercised before validation/repository access.
const protectedRoutes = [
  ['get', '/tables'], ['get', '/tables/catalog'], ['patch', '/tables/1/status'], ['patch', '/tables/1/configuration'],
  ['get', '/bookings'], ['get', '/bookings/sources'], ['get', '/bookings/search'], ['get', '/bookings/export'],
  ['get', '/bookings/1'], ['post', '/bookings'], ['put', '/bookings/1'], ['post', '/bookings/1/assign'],
  ['post', '/bookings/1/merge'], ['post', '/bookings/1/cancel'], ['post', '/bookings/1/no-show'],
  ['post', '/bookings/1/check-in'], ['post', '/bookings/1/phone:reveal'], ['post', '/bookings/walk-ins'],
  ['post', '/visits/1/close'], ['post', '/visits/1/merge'], ['post', '/visits/1/move'],
  ['get', '/waitlist'], ['post', '/waitlist'], ['post', '/waitlist/1/seat'], ['post', '/waitlist/1/cancel'],
  ['post', '/waitlist/1/contact-attempts'],
] as const

mysqlDescribe('waitlist mutations and route security integration', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  it('requires authentication on every business route and session-only auth routes', async () => {
    for (const [method, path] of [...protectedRoutes, ['get', '/auth/me'], ['post', '/auth/logout']] as const) {
      const result = await request(app)[method](`/api/v1${path}`).set('Origin', env.webOrigin).send({})
      expect(result.status, `${method} ${path}`).toBe(401)
    }
  })

  it('requires permission on every business route and CSRF on every mutation', async () => {
    const session = await login()
    for (const [method, path] of protectedRoutes.filter(([method]) => method !== 'get')) {
      const result = await session.agent[method](`/api/v1${path}`).set('Origin', env.webOrigin).send({})
      expect(result.status, `CSRF ${method} ${path}`).toBe(403)
      expect((result.body as { error: { code: string } }).error.code).toBe('CSRF_TOKEN_INVALID')
    }
    // Keep an active, venue-scoped role with zero permissions, without changing seeded RBAC.
    const [role] = await databasePool.execute<ResultSetHeader>(
      "INSERT INTO roles (code, name) VALUES ('INTEGRATION_NO_PERMISSIONS', 'No permissions')",
    )
    try {
      await databasePool.execute('UPDATE membership_roles SET role_id = ? WHERE membership_id = ?', [role.insertId, actor.membershipId])
      for (const [method, path] of protectedRoutes) {
        const result = await session.agent[method](`/api/v1${path}`).set('Origin', env.webOrigin)
          .set('X-CSRF-Token', session.csrfToken).send({})
        expect(result.status, `${method} ${path}`).toBe(403)
        expect((result.body as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED')
      }
    } finally {
      await databasePool.execute('DELETE FROM membership_roles WHERE role_id = ?', [role.insertId])
      await databasePool.execute('DELETE FROM roles WHERE id = ?', [role.insertId])
    }
  })

  it('cancels through HTTP, checks versions and terminal state, and audits the authenticated actor', async () => {
    const entry = await createWaitlistEntry(actor, waitlistInput)
    const session = await login()
    const response = await session.agent.post(`/api/v1/waitlist/${entry.id}/cancel`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send(cancelBody)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ entry: { id: entry.id, version: 2, status: 'CANCELLED' } })
    const [audit] = await databasePool.execute<RowDataPacket[]>('SELECT * FROM operation_log WHERE entity_id = ?', [entry.id])
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor_user_id: String(actor.userId), actor_membership_id: String(actor.membershipId),
      organization_id: String(actor.organizationId), venue_id: String(actor.venueId), action: 'WAITLIST_CANCELLED',
      reason_code: 'CUSTOMER_WITHDREW', entity_version_before: 1, entity_version_after: 2 })
    expect(audit[0]?.auth_session_id).not.toBeNull()
    await expect(cancelWaitlistEntry(actor, { entryId: entry.id, expectedVersion: 1, reasonCode: 'OTHER' }))
      .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    await expect(cancelWaitlistEntry(actor, { entryId: entry.id, expectedVersion: 2, reasonCode: 'OTHER' }))
      .rejects.toMatchObject({ status: 409, code: 'WAITLIST_TERMINAL' })
  })

  it.each(['WAITING', 'CONTACTING', 'OFFERED', 'HOLD_ACTIVE'] as const)('cancels from %s and clears claims', async (status) => {
    const entry = await createWaitlistEntry(actor, waitlistInput)
    await databasePool.execute(
      `UPDATE waitlist_entries SET status = ?, offered_at = UTC_TIMESTAMP(3),
       claimed_by_user_id = ?, claimed_at = ?, claim_expires_at = ? WHERE id = ?`,
      [status, status === 'CONTACTING' ? actor.userId : null, status === 'CONTACTING' ? '2030-10-24 12:00:00' : null,
        status === 'CONTACTING' ? '2030-10-24 12:05:00' : null, entry.id],
    )
    expect(await cancelWaitlistEntry(actor, { entryId: entry.id, expectedVersion: 1, reasonCode: 'OTHER' }))
      .toMatchObject({ status: 'CANCELLED', version: 2 })
    const [rows] = await databasePool.execute<RowDataPacket[]>('SELECT claimed_by_user_id, close_reason_code FROM waitlist_entries WHERE id = ?', [entry.id])
    expect(rows[0]).toMatchObject({ claimed_by_user_id: null, close_reason_code: 'OTHER' })
  })

  it('releases an explicitly cancelled waitlist hold and allocations', async () => {
    const entry = await createWaitlistEntry(actor, waitlistInput)
    await databasePool.execute("UPDATE waitlist_entries SET status = 'HOLD_ACTIVE' WHERE id = ?", [entry.id])
    const [hold] = await databasePool.execute<ResultSetHeader>(
      `INSERT INTO table_holds (organization_id, venue_id, hold_kind, waitlist_entry_id, starts_at, customer_confirmed_at, deadline_at, deadline_basis, default_minutes_snapshot, created_by_user_id)
       VALUES (?, ?, 'WAITLIST_OFFER', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 15 MINUTE, 'DEFAULT', 15, ?)`,
      [actor.organizationId, actor.venueId, entry.id, actor.userId],
    )
    await databasePool.execute(
      `INSERT INTO table_allocations (organization_id, venue_id, table_id, kind, hold_id, starts_at, business_date, created_by_user_id)
       VALUES (?, ?, ?, 'HOLD', ?, UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, actor.venueId, tableId, hold.insertId, businessDate, actor.userId],
    )
    await databasePool.execute(
      `INSERT INTO operation_log (organization_id, venue_id, change_seq, actor_kind, actor_user_id, action, entity_type, entity_id)
       VALUES (?, ?, 1, 'USER', ?, 'TEST_AUDIT_FAILURE', 'waitlist_entry', ?)`,
      [actor.organizationId, actor.venueId, actor.userId, entry.id],
    )
    await expect(cancelWaitlistEntry(actor, { entryId: entry.id, expectedVersion: 1, reasonCode: 'CUSTOMER_WITHDREW' }))
      .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' })
    const [unchangedHolds] = await databasePool.execute<RowDataPacket[]>('SELECT status, version FROM table_holds WHERE id = ?', [hold.insertId])
    expect(unchangedHolds[0]).toMatchObject({ status: 'ACTIVE', version: 1 })
    const [unchangedAllocations] = await databasePool.execute<RowDataPacket[]>('SELECT released_at FROM table_allocations WHERE hold_id = ?', [hold.insertId])
    expect(unchangedAllocations[0]?.released_at).toBeNull()
    expect(await listWaitlist(actor, businessDate)).toMatchObject([{ status: 'HOLD_ACTIVE', version: 1 }])
    await databasePool.execute("DELETE FROM operation_log WHERE action = 'TEST_AUDIT_FAILURE'")
    await cancelWaitlistEntry(actor, { entryId: entry.id, expectedVersion: 1, reasonCode: 'CUSTOMER_WITHDREW' })
    const [holds] = await databasePool.execute<RowDataPacket[]>('SELECT status, version, released_by_user_id FROM table_holds WHERE id = ?', [hold.insertId])
    expect(holds[0]).toMatchObject({ status: 'RELEASED', version: 2, released_by_user_id: String(actor.userId) })
    const [allocations] = await databasePool.execute<RowDataPacket[]>('SELECT released_at, release_reason FROM table_allocations WHERE hold_id = ?', [hold.insertId])
    expect(allocations[0]?.released_at).not.toBeNull()
    expect(allocations[0]?.release_reason).toBe('HOLD_RELEASED')
  })

  it.each(['SEATED', 'DECLINED', 'CANCELLED'] as const)('rejects cancellation and contact recording for %s entries', async (status) => {
    const entry = await createWaitlistEntry(actor, waitlistInput)
    const visit = status === 'SEATED' ? await createWalkIn(actor, { partySize: 2, businessDate, tableIds: [tableId] }) : null
    await databasePool.execute(
      `UPDATE waitlist_entries SET status = ?, closed_at = UTC_TIMESTAMP(3), closed_by_user_id = ?,
       close_reason_code = ?, visit_id = ? WHERE id = ?`,
      [status, actor.userId, status === 'SEATED' ? null : 'OTHER', visit?.visitId ?? null, entry.id],
    )
    await expect(cancelWaitlistEntry(actor, { entryId: entry.id, expectedVersion: 1, reasonCode: 'OTHER' }))
      .rejects.toMatchObject({ status: 409, code: 'WAITLIST_TERMINAL' })
    await expect(recordWaitlistContact(actor, { entryId: entry.id, expectedVersion: 1, channel: 'IN_PERSON', outcome: 'NO_ANSWER' }))
      .rejects.toMatchObject({ status: 409, code: 'WAITLIST_TERMINAL' })
  })

  it('records sequential contacts through HTTP without creating offers, holds or visits', async () => {
    const entry = await createWaitlistEntry(actor, waitlistInput)
    const session = await login()
    const response = await session.agent.post(`/api/v1/waitlist/${entry.id}/contact-attempts`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send(contactBody)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ entry: { status: 'WAITING', version: 2 } })
    await expect(recordWaitlistContact(actor, { entryId: entry.id, expectedVersion: 1, channel: 'IN_PERSON', outcome: 'ACCEPTED' }))
      .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    await recordWaitlistContact(actor, { entryId: entry.id, expectedVersion: 2, channel: 'IN_PERSON', outcome: 'ACCEPTED' })
    const [attempts] = await databasePool.execute<RowDataPacket[]>('SELECT * FROM waitlist_contact_attempts WHERE entry_id = ? ORDER BY attempt_no', [entry.id])
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toMatchObject({ attempt_no: 1, attempted_by_user_id: String(actor.userId), channel: 'PHONE_BY_AUTHORIZED', outcome: 'NO_ANSWER', note: 'First attempt' })
    expect(attempts[1]).toMatchObject({ attempt_no: 2, outcome: 'ACCEPTED' })
    const [counts] = await databasePool.execute<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM table_holds) AS holds, (SELECT COUNT(*) FROM visits) AS visits')
    expect(Number(counts[0]?.holds)).toBe(0)
    expect(Number(counts[0]?.visits)).toBe(0)
    expect(await listWaitlist(actor, businessDate)).toMatchObject([{ status: 'WAITING', version: 3 }])
    const [audit] = await databasePool.execute<RowDataPacket[]>("SELECT action FROM operation_log WHERE entity_id = ?", [entry.id])
    expect(audit).toEqual([{ action: 'WAITLIST_CONTACT_RECORDED' }, { action: 'WAITLIST_CONTACT_RECORDED' }])
  })

  it('validates cancellation reasons, channels, outcomes, notes, ids and versions', async () => {
    const entry = await createWaitlistEntry(actor, waitlistInput)
    const session = await login()
    for (const [suffix, body] of [['cancel', { ...cancelBody, reasonCode: 'invented' }],
      ['cancel', { ...cancelBody, note: 'x'.repeat(301) }], ['cancel', { ...cancelBody, version: 0 }],
      ['contact-attempts', { ...contactBody, channel: 'PHONE_CALLBACK' }],
      ['contact-attempts', { ...contactBody, outcome: 'invented' }],
      ['contact-attempts', { ...contactBody, note: false }]] as const) {
      expect((await session.agent.post(`/api/v1/waitlist/${entry.id}/${suffix}`)
        .set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send(body)).status).toBe(400)
    }
    expect((await session.agent.post('/api/v1/waitlist/bad/cancel').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send(cancelBody)).status).toBe(400)
  })

  it('rolls back cancellations and contact attempts when the operation log cannot persist', async () => {
    const entry = await createWaitlistEntry(actor, waitlistInput)
    // Force a duplicate sequence only at the final audit insert, after domain writes.
    await databasePool.execute(
      `INSERT INTO operation_log (organization_id, venue_id, change_seq, actor_kind, actor_user_id, action, entity_type, entity_id)
       VALUES (?, ?, 1, 'USER', ?, 'TEST_AUDIT_FAILURE', 'waitlist_entry', ?)`,
      [actor.organizationId, actor.venueId, actor.userId, entry.id],
    )
    await expect(cancelWaitlistEntry(actor, { entryId: entry.id, expectedVersion: 1, reasonCode: 'OTHER' })).rejects.toBeTruthy()
    await expect(recordWaitlistContact(actor, { entryId: entry.id, expectedVersion: 1, channel: 'IN_PERSON', outcome: 'NO_ANSWER' })).rejects.toBeTruthy()
    expect(await listWaitlist(actor, businessDate)).toMatchObject([{ status: 'WAITING', version: 1 }])
    const [attempts] = await databasePool.execute<RowDataPacket[]>('SELECT id FROM waitlist_contact_attempts WHERE entry_id = ?', [entry.id])
    expect(attempts).toHaveLength(0)
  })

  it('rejects cross-venue table status changes before returning the derived-state rejection', async () => {
    const session = await login()
    for (const [id, version, status, code] of [[foreignTableId, 1, 404, 'TABLE_NOT_FOUND'],
      [tableId, 99, 409, 'VERSION_CONFLICT'], [tableId, 1, 409, 'TABLE_STATE_DERIVED']] as const) {
      const response = await session.agent.patch(`/api/v1/tables/${id}/status`).set('Origin', env.webOrigin)
        .set('X-CSRF-Token', session.csrfToken).send({ businessDate, state: 'AVAILABLE', expectedVersion: version })
      expect(response.status).toBe(status)
      expect(response.body).toMatchObject({ error: { code } })
    }
    await expect(updateTableState({ ...actor, organizationId: otherOrganizationId }, { tableId, businessDate, state: 'AVAILABLE' }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('scopes booking, waitlist, table, visit and configuration routes to the authenticated venue', async () => {
    const foreignActor = { ...actor, venueId: otherVenueId }
    const booking = await createBooking(foreignActor, bookingInput)
    const entry = await createWaitlistEntry(foreignActor, waitlistInput)
    const visit = await createWalkIn(foreignActor, { guestName: 'Foreign guest', partySize: 2, businessDate, tableIds: [foreignTableId] })
    const session = await login('integration_owner')
    const routes = [['get', `/bookings/${booking.id}`, {}], ['put', `/bookings/${booking.id}`, { ...bookingInput, version: 1 }],
      ...['assign', 'merge', 'cancel', 'no-show', 'check-in'].map((action) => ['post', `/bookings/${booking.id}/${action}`, { version: 1, tableIds: [tableId, foreignTableId] }] as const),
      ['post', `/bookings/${booking.id}/phone:reveal`, {}], ['post', `/waitlist/${entry.id}/cancel`, cancelBody],
      ['post', `/waitlist/${entry.id}/contact-attempts`, contactBody], ['post', `/waitlist/${entry.id}/seat`, { version: 1, tableIds: [tableId] }],
      ['patch', `/tables/${foreignTableId}/configuration`, { version: 1, isSpare: true, reason: 'Scope test' }],
      ...['close', 'move', 'merge'].map((action) => ['post', `/visits/${visit.visitId}/${action}`, { version: 1, tableIds: [tableId, foreignTableId], mode: 'MANUAL', reason: 'GUEST_LEFT' }] as const),
    ] as const
    for (const [method, path, body] of routes) {
      const response = await session.agent[method](`/api/v1${path}`).set('Origin', env.webOrigin)
        .set('X-CSRF-Token', session.csrfToken).send(body)
      expect(response.status, path).toBe(404)
    }
    for (const path of [`/bookings?date=${businessDate}`, `/bookings/search?date=${businessDate}&q=Masked`,
      `/bookings/export?date=${businessDate}`, `/waitlist?date=${businessDate}`, `/tables?date=${businessDate}`, '/tables/catalog']) {
      const response = await session.agent.get(`/api/v1${path}`)
      expect(response.status).toBe(200)
      expect(response.text).not.toContain('Foreign guest')
      expect(response.text).not.toContain('Masked guest')
      expect(response.text).not.toContain('Waiting guest')
      expect(response.text).not.toContain('B1')
    }
    const homeBooking = await createBooking(actor, bookingInput)
    await createWaitlistEntry(actor, waitlistInput)
    const wrongOrg = { ...actor, organizationId: otherOrganizationId }
    expect(await listBookings(wrongOrg, businessDate)).toEqual([])
    expect(await listTables(wrongOrg, businessDate)).toEqual([])
    expect(await listWaitlist(wrongOrg, businessDate)).toEqual([])
    await expect(getBookingById(wrongOrg, homeBooking.id)).rejects.toMatchObject({ status: 404 })
  })

  it('never exposes phone plaintext or cryptographic fields in receptionist read responses', async () => {
    const booking = await createBooking(actor, bookingInput)
    await createWaitlistEntry(actor, waitlistInput)
    const session = await login()
    for (const path of [`/bookings?date=${businessDate}`, `/bookings/search?date=${businessDate}&q=321`,
      `/bookings/export?date=${businessDate}`, `/bookings/${booking.id}`, `/tables?date=${businessDate}`,
      `/waitlist?date=${businessDate}`]) {
      const response = await session.agent.get(`/api/v1${path}`)
      expect(response.status).toBe(200)
      for (const forbidden of ['0987654321', '+84987654321', 'phoneNumber', 'phone_ciphertext', 'phone_hmac']) {
        expect(response.text, path).not.toContain(forbidden)
      }
    }
    const listed = await session.agent.get(`/api/v1/bookings?date=${businessDate}`)
    expect(listed.body).toMatchObject({ bookings: [{ phoneLast3: '321' }] })
  })
})

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Response } from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { normalizeSearchText } from '../src/lib/search-text.js'
import { createWalkIn } from '../src/modules/bookings/booking.repository.js'
import { protectPhoneNumber } from '../src/modules/bookings/phone-security.js'
import { closeVisit } from '../src/modules/visits/visit.repository.js'
import { publishFloorChange, resetFloorChangeStream, subscribeToFloorChanges } from '../src/modules/tables/floor-change-stream.js'
import {
  assignAnonymousVisit, dismissDuplicateCustomers, listAnonymousVisits, listDuplicateCustomers,
  mergeDuplicateCustomers, undoAnonymousAssignment,
} from '../src/modules/visits/customer-history.repository.js'
import { actor, businessDate, clearFixture, initializeFixture, login, otherOrganizationId, otherVenueId,
  resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && process.env.DB_NAME === 'gam21_platform_it_test' ? describe : describe.skip
const owner = { ...actor, userId: 9802, membershipId: 9802, portal: 'admin' as const }
const range = { from: businessDate, to: businessDate, page: 1, pageSize: 20 }
const phoneNumber = '0901234678'
async function customer(name: string, phone?: string, organizationId = actor.organizationId) {
  const protectedPhone = phone ? protectPhoneNumber(phone, { activeEncryptionKeyId: env.phone.activeEncryptionKeyId!,
    activeHmacKeyId: env.phone.activeHmacKeyId!, encryptionKeys: env.phone.encryptionKeys, hmacKeys: env.phone.hmacKeys }) : null
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO customers (organization_id, display_name, name_search, phone_ciphertext, phone_key_id, phone_hmac,
      phone_hmac_key_id, phone_last3) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, name, normalizeSearchText(name), protectedPhone?.ciphertext ?? null, protectedPhone?.encryptionKeyId ?? null,
      protectedPhone?.hmac ?? null, protectedPhone?.hmacKeyId ?? null, protectedPhone?.last3 ?? null])
  return result.insertId
}
async function anonymous() {
  return (await createWalkIn(actor, { tableIds: [tableId], guestName: 'Khách Walk-in', partySize: 4, businessDate })).visitId
}
async function pair() {
  const sourceCustomerId = await customer('Nguyễn An'), targetCustomerId = await customer('Nguyen An', phoneNumber)
  return { sourceCustomerId, targetCustomerId, sourceVersion: 1, targetVersion: 1 }
}
async function admin(scope: 'ORG' | 'VENUE', level: 'WRITE' | 'READ_ONLY') {
  await databasePool.execute('DELETE FROM membership_roles WHERE membership_id = 9803')
  await databasePool.execute(`INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id, access_level)
    SELECT ?, 9803, id, ?, ? FROM roles WHERE code = 'ADMIN'`, [actor.organizationId, scope === 'ORG' ? null : actor.venueId, level])
  return { ...actor, userId: 9803, membershipId: 9803, portal: 'admin' as const }
}
async function query(sql: string, values: (string | number | null)[] = []) {
  return (await databasePool.execute<RowDataPacket[]>(sql, values))[0].map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, /(^id$|_id$)/.test(key) && value !== null ? Number(value) : value])))
}
async function cursors() {
  return query('SELECT id, CAST(change_seq AS CHAR) AS seq FROM venues ORDER BY id')
}
async function watch(venueId: number) {
  const frames: string[] = []
  const response = { writeHead() {}, write: (frame: string) => frames.push(frame), on() {}, end() {} } as unknown as Response
  const venue = { organizationId: actor.organizationId, venueId }
  const [row] = await query('SELECT CAST(change_seq AS CHAR) AS seq FROM venues WHERE id = ?', [venueId])
  await publishFloorChange({ ...venue, changeSeq: String(row!.seq) }, { rebase: true })
  subscribeToFloorChanges({ ...venue, authSessionId: 1, userId: owner.userId, authorize: () => Promise.resolve(null), response })
  return () => frames.filter((frame) => frame.startsWith('event: floor-changed')).length
}
mysqlDescribe('NA-34 customer history (gam21_platform_it_test only)', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(async () => { await clearFixture(); await databasePool.end() })

  it('HTTP assigns an existing customer, masks every response, supports idempotency and audited undo', async () => {
    const visitId = await anonymous(), customerId = await customer('Nguyễn An', phoneNumber)
    await databasePool.execute('UPDATE customers SET display_name = ? WHERE id = ?', [`Nguyễn An ${phoneNumber}`, customerId])
    const session = await login('integration_owner')
    const list = await session.agent.get(`/api/v1/visits/anonymous?from=${businessDate}&to=${businessDate}`).expect(200)
    expect((list.body as { visits: unknown[] }).visits[0]).toMatchObject({ visitId, displayCode: `L-${visitId}`, tableLabel: 'A1', version: 1 })
    const send = () => session.agent.post(`/api/v1/visits/${visitId}/customer-assignment`).set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken)
      .set('Idempotency-Key', 'na34-assignment-existing').send({ version: 1, phone: phoneNumber })
    const assigned = await send().expect(200)
    const assignment = assigned.body as Awaited<ReturnType<typeof assignAnonymousVisit>>
    expect(assigned.body).toMatchObject({ version: 2, customerCreated: false, customer: { id: customerId, maskedPhone: '••• 678' } })
    expect((await send().expect(200)).body).toEqual(assigned.body)
    const reused = await session.agent.post(`/api/v1/visits/${visitId}/customer-assignment`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).set('Idempotency-Key', 'na34-assignment-existing')
      .send({ version: 1, phone: '0909999678' }).expect(422)
    expect(reused.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect(JSON.stringify(assigned.body)).not.toContain(phoneNumber)
    expect(JSON.stringify(assigned.body)).not.toContain('+84901234678')
    await session.agent.post(`/api/v1/visits/${visitId}/customer-assignment/undo`).set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken)
      .send({ operationId: assignment.undo.operationId, version: 2 }).expect(200)
    expect(await query('SELECT customer_id, version FROM visits WHERE id = ?', [visitId])).toMatchObject([{ customer_id: null, version: 3 }])
    expect(await query("SELECT action, actor_user_id FROM operation_log WHERE action LIKE '%VISIT_CUSTOMER_ASSIGNED' ORDER BY id"))
      .toMatchObject([{ action: 'VISIT_CUSTOMER_ASSIGNED', actor_user_id: 9802 }, { action: 'UNDO_VISIT_CUSTOMER_ASSIGNED', actor_user_id: 9802 }])
  })
  it('committed HTTP assignment and undo refresh other clients, while replay does not advance cursors', async () => {
    const visitId = await anonymous()
    await customer('Nguyen An', phoneNumber)
    const session = await login('integration_owner')
    const first = await watch(actor.venueId), second = await watch(otherVenueId)
    const before = await cursors()
    try {
      const send = () => session.agent.post(`/api/v1/visits/${visitId}/customer-assignment`).set('Origin', env.webOrigin)
        .set('X-CSRF-Token', session.csrfToken).set('Idempotency-Key', 'na34-stream-assignment').send({ version: 1, phone: phoneNumber })
      const assigned = await send().expect(200)
      await vi.waitFor(() => { expect(first()).toBe(1); expect(second()).toBe(1) }, { timeout: 5000 })
      expect((await listAnonymousVisits(owner, range)).visits).toHaveLength(0)
      const committed = await cursors()
      expect(committed.filter((row) => row.id === actor.venueId || row.id === otherVenueId))
        .toEqual(before.filter((row) => row.id === actor.venueId || row.id === otherVenueId).map((row) => ({ ...row, seq: String(BigInt(String(row.seq)) + 1n) })))
      expect(committed.filter((row) => row.id === otherOrganizationId)).toEqual(before.filter((row) => row.id === otherOrganizationId))
      expect((await send().expect(200)).body).toEqual(assigned.body)
      expect(await cursors()).toEqual(committed)
      await new Promise((resolve) => setTimeout(resolve, env.realtime.pollIntervalMs * 2 + 50))
      expect([first(), second()]).toEqual([1, 1])
      const assignment = assigned.body as Awaited<ReturnType<typeof assignAnonymousVisit>>
      const undo = () => session.agent.post(`/api/v1/visits/${visitId}/customer-assignment/undo`).set('Origin', env.webOrigin)
        .set('X-CSRF-Token', session.csrfToken).set('Idempotency-Key', 'na34-stream-undo').send({ operationId: assignment.undo.operationId, version: 2 })
      const undone = await undo().expect(200)
      await vi.waitFor(() => { expect(first()).toBe(2); expect(second()).toBe(2) }, { timeout: 5000 })
      expect((await listAnonymousVisits(owner, range)).visits).toMatchObject([{ visitId, version: 3 }])
      const afterUndo = await cursors()
      expect((await undo().expect(200)).body).toEqual(undone.body)
      expect(await cursors()).toEqual(afterUndo)
      await new Promise((resolve) => setTimeout(resolve, env.realtime.pollIntervalMs * 2 + 50))
      expect([first(), second()]).toEqual([2, 2])
      const audits = await query("SELECT change_seq FROM operation_log WHERE action LIKE '%VISIT_CUSTOMER_ASSIGNED' ORDER BY id")
      const assignedSeq = String(committed.find((row) => row.id === actor.venueId)!.seq)
      expect(audits.map((row) => String(row.change_seq))).toEqual([assignedSeq, String(BigInt(assignedSeq) + 1n)])
    } finally { resetFloorChangeStream() }
  })
  it('creates protected customer on missing phone; requires name with 422, keeps customer after undo', async () => {
    const visitId = await anonymous()
    const session = await login('integration_owner')
    await session.agent.post(`/api/v1/visits/${visitId}/customer-assignment`).set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send({ version: 1, phone: phoneNumber }).expect(422)
    expect(await query('SELECT id FROM customers')).toHaveLength(0)
    await expect(assignAnonymousVisit(owner, { visitId, version: 1, phone: phoneNumber, displayName: phoneNumber }))
      .rejects.toMatchObject({ status: 422, code: 'PHONE_IN_NOTE_FORBIDDEN' })
    const result = await assignAnonymousVisit(owner, { visitId, version: 1, phone: phoneNumber, displayName: '  Trần Bình  ' })
    expect(result.customerCreated).toBe(true)
    const [stored] = await query('SELECT name_search, phone_ciphertext, phone_hmac, phone_last3 FROM customers WHERE id = ?', [result.customer.id])
    expect(stored).toMatchObject({ name_search: 'tran binh', phone_last3: '678' })
    expect(Buffer.isBuffer(stored!.phone_ciphertext)).toBe(true)
    expect((stored!.phone_ciphertext as Buffer).toString()).not.toContain(phoneNumber)
    await expect(assignAnonymousVisit(owner, { visitId, version: 1, phone: phoneNumber })).rejects.toMatchObject({ status: 409 })
    await undoAnonymousAssignment(owner, result.undo)
    expect(await query('SELECT id FROM customers')).toHaveLength(1)
    await expect(undoAnonymousAssignment(owner, { ...result.undo, version: 3 })).rejects.toMatchObject({ status: 409 })
  })
  it.each(['merge', 'dismiss'] as const)('HTTP %s refreshes both venue clients and org-wide suggestions exactly once', async (action) => {
    const input = await pair()
    const [remoteVisit] = await databasePool.execute<ResultSetHeader>(
      `INSERT INTO visits (organization_id, venue_id, origin, customer_id, guest_count, started_at, business_date, created_by_user_id)
       VALUES (?, ?, 'WALK_IN', ?, 2, UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, otherVenueId, input.sourceCustomerId, businessDate, actor.userId])
    const [source] = await query('SELECT id FROM booking_sources LIMIT 1')
    const [remoteBooking] = await databasePool.execute<ResultSetHeader>(
      `INSERT INTO reservations (organization_id, venue_id, customer_id, source_id, party_size, expected_at, business_date, created_by_user_id)
       VALUES (?, ?, ?, ?, 2, UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, otherVenueId, input.sourceCustomerId, Number(source!.id), businessDate, actor.userId])
    const session = await login('integration_owner')
    const first = await watch(actor.venueId), second = await watch(otherVenueId)
    const before = await cursors()
    try {
      expect((await listDuplicateCustomers(owner)).total).toBe(1)
      const send = (body = input, path = action) => session.agent.post(`/api/v1/customers/duplicates/${path}`)
        .set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).set('Idempotency-Key', `na34-stream-${action}`).send(body)
      const result = await send().expect(200)
      await vi.waitFor(() => { expect(first()).toBe(1); expect(second()).toBe(1) }, { timeout: 5000 })
      expect((await listDuplicateCustomers(owner)).total).toBe(0)
      const committed = await cursors()
      expect(committed).toEqual(before.map((row) => row.id === actor.venueId || row.id === otherVenueId ? { ...row, seq: String(BigInt(String(row.seq)) + 1n) } : row))
      if (action === 'merge') {
        expect(await query('SELECT customer_id, version FROM visits WHERE id = ?', [remoteVisit.insertId]))
          .toMatchObject([{ customer_id: input.targetCustomerId, version: 2 }])
        expect(await query('SELECT customer_id, version FROM reservations WHERE id = ?', [remoteBooking.insertId]))
          .toMatchObject([{ customer_id: input.targetCustomerId, version: 2 }])
      }
      expect((await send().expect(200)).body).toEqual(result.body)
      expect((await send({ ...input, targetVersion: 2 }).expect(422)).body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
      expect((await send(input, action === 'merge' ? 'dismiss' : 'merge').expect(422)).body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
      expect(await cursors()).toEqual(committed)
      await new Promise((resolve) => setTimeout(resolve, env.realtime.pollIntervalMs * 2 + 50))
      expect([first(), second()]).toEqual([1, 1])
    } finally { resetFloorChangeStream() }
  })
  it('rejects changed visits on undo and cross-venue/org assignment and reads', async () => {
    await databasePool.execute('UPDATE membership_roles SET venue_id = NULL WHERE membership_id = 9802')
    const visitId = await anonymous()
    await expect(assignAnonymousVisit({ ...owner, venueId: otherVenueId }, { visitId, version: 1, phone: phoneNumber, displayName: 'An' })).rejects.toMatchObject({ status: 404 })
    await expect(assignAnonymousVisit({ ...owner, organizationId: otherOrganizationId }, { visitId, version: 1, phone: phoneNumber, displayName: 'An' })).rejects.toMatchObject({ status: 403 })
    const result = await assignAnonymousVisit(owner, { visitId, version: 1, phone: phoneNumber, displayName: 'An' })
    await databasePool.execute('UPDATE visits SET version = version + 1 WHERE id = ?', [visitId])
    await expect(undoAnonymousAssignment(owner, { ...result.undo, version: 3 })).rejects.toMatchObject({ status: 409 })
    expect((await listAnonymousVisits({ ...owner, venueId: otherVenueId }, range)).visits).toHaveLength(0)
  })
  it('lists open and served closed anonymous visits, excludes entry errors and assigned visits', async () => {
    const visitId = await anonymous()
    expect((await listAnonymousVisits(owner, range)).visits).toHaveLength(1)
    await closeVisit(actor, { visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'ENTRY_ERROR' })
    expect((await listAnonymousVisits(owner, range)).visits).toHaveLength(0)
    const servedId = await anonymous()
    await closeVisit(actor, { visitId: servedId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    expect((await listAnonymousVisits(owner, range)).visits.map((v) => v.visitId)).toEqual([servedId])
  })
  it('venue ADMIN WRITE can assign and undo at its venue, and anonymous pagination is stable', async () => {
    const scoped = await admin('VENUE', 'WRITE'), visitId = await anonymous()
    const result = await assignAnonymousVisit(scoped, { visitId, version: 1, phone: phoneNumber, displayName: 'An' })
    expect(result.customer.visitCount).toBe(1)
    await undoAnonymousAssignment(scoped, result.undo)
    await closeVisit(actor, { visitId, expectedVersion: 3, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    const secondId = await anonymous()
    const firstPage = await listAnonymousVisits(scoped, { ...range, pageSize: 1 })
    expect(firstPage).toMatchObject({ hasMore: true, visits: [{ visitId: secondId }] })
    expect((await listAnonymousVisits(scoped, { ...range, page: 2, pageSize: 1 })).visits[0]?.visitId).toBe(visitId)
    expect((await listAnonymousVisits(scoped, { ...range, page: 3, pageSize: 1 })).visits).toHaveLength(0)
  })
  it('READ_ONLY can read but assignment/undo/merge/dismiss are forbidden (HTTP 403)', async () => {
    const readOnly = await admin('ORG', 'READ_ONLY'), input = await pair(), visitId = await anonymous()
    expect((await listDuplicateCustomers(readOnly)).pairs).toHaveLength(1)
    for (const action of [() => assignAnonymousVisit(readOnly, { visitId, version: 1, phone: phoneNumber }),
      () => undoAnonymousAssignment(readOnly, { visitId, version: 1, operationId: 1 }),
      () => mergeDuplicateCustomers(readOnly, input), () => dismissDuplicateCustomers(readOnly, input)]) {
      await expect(action()).rejects.toMatchObject({ status: 403 })
    }
    // The fixture login chooses reception for this account; force admin portal explicitly.
    const session = await login('integration_owner')
    await databasePool.execute("UPDATE membership_roles SET access_level = 'READ_ONLY', role_id = (SELECT id FROM roles WHERE code = 'ADMIN') WHERE membership_id = 9802")
    await session.agent.post(`/api/v1/visits/${visitId}/customer-assignment`).set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send({ version: 1, phone: phoneNumber }).expect(403)
  })
  it('suggests ACTIVE no-phone to with-phone exact normalized names, persists permanent dismissals, excludes merged/anonymized and foreign org', async () => {
    const input = await pair()
    await customer('Nguyen An', undefined, otherOrganizationId)
    await customer('Different Name')
    const list = await listDuplicateCustomers(owner)
    expect(list).toMatchObject({ total: 1, canMerge: true, pairs: [{ source: { id: input.sourceCustomerId, maskedPhone: null }, target: { maskedPhone: '••• 678' } }] })
    expect(JSON.stringify(list)).not.toContain('phone_hmac')
    await dismissDuplicateCustomers(owner, input)
    expect((await listDuplicateCustomers(owner)).total).toBe(0)
    await expect(mergeDuplicateCustomers(owner, input)).rejects.toMatchObject({ code: 'DUPLICATE_PAIR_DISMISSED' })
    await databasePool.execute('DELETE FROM customer_duplicate_dismissals')
    await databasePool.execute("UPDATE customers SET status = 'MERGED', merged_into_customer_id = ? WHERE id = ?", [input.targetCustomerId, input.sourceCustomerId])
    expect((await listDuplicateCustomers(owner)).total).toBe(0)
    await databasePool.execute("UPDATE customers SET status = 'ANONYMIZED', display_name = NULL, name_search = NULL, anonymized_at = UTC_TIMESTAMP(3), merged_into_customer_id = NULL WHERE id = ?", [input.sourceCustomerId])
    expect((await listDuplicateCustomers(owner)).total).toBe(0)
  })
  it('venue admins see pairs only with local visit/booking/waitlist activity and local counts, cannot merge/dismiss; org-wide WRITE can', async () => {
    const input = await pair(), scoped = await admin('VENUE', 'WRITE')
    expect((await listDuplicateCustomers(scoped)).total).toBe(0)
    await databasePool.execute(`INSERT INTO waitlist_entries (organization_id, venue_id, kind, customer_id, contact_name, party_size,
      contact_channel, business_date, queued_at, created_by_user_id) VALUES (?, ?, 'WALK_IN', ?, 'An', 2, 'IN_PERSON', ?, UTC_TIMESTAMP(3), ?)`,
    [actor.organizationId, actor.venueId, input.sourceCustomerId, businessDate, actor.userId])
    expect((await listDuplicateCustomers(scoped))).toMatchObject({ total: 1, canMerge: false, canDismiss: false, pairs: [{ source: { visitCount: 0, bookingCount: 0 } }] })
    const visitId = await anonymous()
    await databasePool.execute('UPDATE visits SET customer_id = ? WHERE id = ?', [input.sourceCustomerId, visitId])
    await databasePool.execute(`INSERT INTO visits (organization_id, venue_id, origin, customer_id, guest_count, started_at, business_date, created_by_user_id)
      VALUES (?, ?, 'WALK_IN', ?, 2, UTC_TIMESTAMP(3), ?, ?)`, [actor.organizationId, otherVenueId, input.targetCustomerId, businessDate, actor.userId])
    expect((await listDuplicateCustomers(scoped)).pairs[0]).toMatchObject({ source: { visitCount: 1 }, target: { visitCount: 0 } })
    expect((await listDuplicateCustomers(owner)).pairs[0]).toMatchObject({ source: { visitCount: 1 }, target: { visitCount: 1 } })
    for (const action of [mergeDuplicateCustomers, dismissDuplicateCustomers]) await expect(action(scoped, input)).rejects.toMatchObject({ status: 403, code: 'CUSTOMER_ORG_WRITE_REQUIRED' })
    const scopedReadOnly = await admin('VENUE', 'READ_ONLY')
    expect((await listDuplicateCustomers(scopedReadOnly)).total).toBe(1)
    const global = await admin('ORG', 'WRITE')
    await expect(mergeDuplicateCustomers(global, input)).resolves.toMatchObject({ targetCustomerId: input.targetCustomerId })
  })
  it('merge repoints every business FK, including other venues and previous merge links, preserves call/contact history and target identity', async () => {
    const input = await pair(), visitId = await anonymous()
    await databasePool.execute('UPDATE visits SET customer_id = ? WHERE id = ?', [input.sourceCustomerId, visitId])
    const [source] = await query('SELECT id FROM booking_sources LIMIT 1')
    const [booking] = await databasePool.execute<ResultSetHeader>(`INSERT INTO reservations (organization_id, venue_id, customer_id, source_id,
      party_size, expected_at, business_date, created_by_user_id) VALUES (?, ?, ?, ?, 2, UTC_TIMESTAMP(3), ?, ?)`,
    [actor.organizationId, otherVenueId, input.sourceCustomerId, Number(source!.id), businessDate, actor.userId])
    const [wait] = await databasePool.execute<ResultSetHeader>(`INSERT INTO waitlist_entries (organization_id, venue_id, kind, customer_id, contact_name,
      party_size, contact_channel, business_date, queued_at, created_by_user_id) VALUES (?, ?, 'WALK_IN', ?, 'An', 2, 'PHONE_CALLBACK', ?, UTC_TIMESTAMP(3), ?)`,
    [actor.organizationId, actor.venueId, input.sourceCustomerId, businessDate, actor.userId])
    await databasePool.execute(`INSERT INTO waitlist_contact_attempts (organization_id, venue_id, entry_id, attempt_no, attempted_by_user_id,
      channel, started_at, outcome) VALUES (?, ?, ?, 1, ?, 'PHONE_BY_AUTHORIZED', UTC_TIMESTAMP(3), 'NO_ANSWER')`, [actor.organizationId, actor.venueId, wait.insertId, actor.userId])
    await databasePool.execute(`INSERT INTO booking_call_logs (organization_id, venue_id, visit_id, initiated_by_user_id, initiated_at)
      VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`, [actor.organizationId, actor.venueId, visitId, actor.userId])
    const old = await customer('Old An')
    await databasePool.execute("UPDATE customers SET status = 'MERGED', merged_into_customer_id = ? WHERE id = ?", [input.sourceCustomerId, old])
    const merged = await mergeDuplicateCustomers(owner, input)
    expect(merged.moved).toEqual({ visits: 1, reservations: 1, waitlist_entries: 1, customers: 1 })
    for (const table of ['visits', 'reservations', 'waitlist_entries']) expect(await query(`SELECT id FROM ${table} WHERE customer_id = ?`, [input.sourceCustomerId])).toHaveLength(0)
    expect(await query('SELECT customer_id, version FROM reservations WHERE id = ?', [booking.insertId])).toMatchObject([{ customer_id: input.targetCustomerId, version: 2 }])
    expect(await query('SELECT id FROM booking_call_logs')).toHaveLength(1)
    expect(await query('SELECT id FROM waitlist_contact_attempts')).toHaveLength(1)
    expect(await query('SELECT status, display_name, phone_last3, version FROM customers WHERE id = ?', [input.targetCustomerId]))
      .toMatchObject([{ status: 'ACTIVE', display_name: 'Nguyen An', phone_last3: '678', version: 2 }])
    expect((await listDuplicateCustomers(owner)).total).toBe(0)
    // Verify the explicit list against actual schema foreign keys, including immutable dismissal history.
    const references = await query(`SELECT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
      AND REFERENCED_TABLE_NAME = 'customers' AND COLUMN_NAME <> 'organization_id'`)
    expect([...new Set(references.map((row) => String(row.TABLE_NAME)))].sort()).toEqual(['customer_duplicate_dismissals', 'customers', 'reservations', 'visits', 'waitlist_entries'])
  })
  it('merge is atomic when a later write fails and stale/foreign pairs are rejected', async () => {
    const input = await pair(), visitId = await anonymous()
    await databasePool.execute('UPDATE visits SET customer_id = ? WHERE id = ?', [input.sourceCustomerId, visitId])
    const first = await watch(actor.venueId), second = await watch(otherVenueId)
    const before = await cursors()
    const connection = await databasePool.getConnection()
    const execute = connection.execute.bind(connection)
    const fault = vi.spyOn(connection, 'execute').mockImplementation(((sql: string, values: Parameters<typeof connection.execute>[1]) => {
      if (sql.includes('INSERT INTO operation_log')) return Promise.reject(new Error('NA34 atomicity fault'))
      return execute(sql, values)
    }) as typeof connection.execute)
    const pool = vi.spyOn(databasePool, 'getConnection').mockResolvedValueOnce(connection)
    try {
      await expect(mergeDuplicateCustomers(owner, input)).rejects.toThrow('NA34 atomicity fault')
    } finally { fault.mockRestore(); pool.mockRestore() }
    try {
      expect(await cursors()).toEqual(before)
      await new Promise((resolve) => setTimeout(resolve, env.realtime.pollIntervalMs * 2 + 50))
      expect([first(), second()]).toEqual([0, 0])
    } finally { resetFloorChangeStream() }
    expect(await query('SELECT customer_id, version FROM visits WHERE id = ?', [visitId])).toMatchObject([{ customer_id: input.sourceCustomerId, version: 1 }])
    expect(await query("SELECT id FROM operation_log WHERE action = 'CUSTOMERS_MERGED'")).toHaveLength(0)
    await expect(mergeDuplicateCustomers(owner, { ...input, sourceVersion: 9 })).rejects.toMatchObject({ status: 409 })
    const foreign = await customer('Nguyen An', undefined, otherOrganizationId)
    await expect(mergeDuplicateCustomers(owner, { ...input, sourceCustomerId: foreign })).rejects.toMatchObject({ status: 404 })
  })
})

import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createBooking } from '../src/modules/bookings/booking.repository.js'
import { runBusinessDayEndSweep } from '../src/modules/visits/business-day.worker.js'
import { actor, businessDate, clearFixture, initializeFixture, login, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const nextDate = '2030-10-25'
const cutoff = new Date('2030-10-24T22:00:00.000Z')

mysqlDescribe('business-day auto-close reconciles canonical floor and waitlist HTTP flow', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  async function checkedInAdvanceEntry() {
    await databasePool.execute(
      `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity)
       VALUES (?, ?, ?, ?, 'A2', 'A2', 'TABLE', 4)`,
      [tableId + 2, actor.organizationId, actor.venueId, tableId],
    )
    const booking = await createBooking(actor, { guestName: 'Auto-close advance', partySize: 6,
      businessDate, expectedAt: `${businessDate}T20:00:00+07:00`, sourceCode: 'HOTLINE' })
    const session = await login()
    const create = await session.agent.post('/api/v1/waitlist').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ kind: 'ADVANCE_RESERVATION', reservationId: booking.id,
        businessDate, contactChannel: 'IN_PERSON' })
    expect(create.status).toBe(201)
    const entryId = (create.body as { entry: { id: number } }).entry.id
    const seat = await session.agent.post(`/api/v1/waitlist/${entryId}/seat`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 1, tableIds: [tableId, tableId + 2] })
    expect(seat.status).toBe(200)
    const groupId = (seat.body as { groupId: number }).groupId
    const checkIn = await session.agent.post(`/api/v1/bookings/${booking.id}/check-in`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', session.csrfToken).send({ version: 2 })
    expect(checkIn.status).toBe(200)
    return { session, entryId, groupId }
  }

  it('shows carry-over until the sweep, then frees grouped tables without rewriting seated waitlist history', async () => {
    const { session, entryId, groupId } = await checkedInAdvanceEntry()
    const [entryBefore] = await databasePool.execute<RowDataPacket[]>('SELECT * FROM waitlist_entries WHERE id = ?', [entryId])
    expect(entryBefore[0]).toMatchObject({ status: 'SEATED', close_reason_code: 'SEATED_OTHERWISE' })
    expect(await runBusinessDayEndSweep({ organizationId: actor.organizationId, venueId: actor.venueId,
      now: new Date(cutoff.getTime() - 1) })).toEqual({ closed: 0, skipped: 0 })
    const before = await session.agent.get(`/api/v1/tables?date=${nextDate}`)
    expect(before.status).toBe(200)
    expect(before.body).toMatchObject({ tables: [
      { state: 'IN_USE', staleFromPreviousDay: true, allocationBusinessDate: businessDate, activeVisit: { guestCount: 6 } },
      { state: 'IN_USE', staleFromPreviousDay: true, allocationBusinessDate: businessDate, activeVisit: { guestCount: 6 } },
    ], groups: [{ id: groupId }] })

    expect(await runBusinessDayEndSweep({ organizationId: actor.organizationId, venueId: actor.venueId, now: cutoff }))
      .toEqual({ closed: 1, skipped: 0 })
    const after = await session.agent.get(`/api/v1/tables?date=${nextDate}`)
    expect(after.status).toBe(200)
    expect(after.body).toMatchObject({ tables: [
      { state: 'AVAILABLE', staleFromPreviousDay: false, allocationBusinessDate: null, activeVisit: null },
      { state: 'AVAILABLE', staleFromPreviousDay: false, allocationBusinessDate: null, activeVisit: null },
    ], groups: [] })
    const [groups] = await databasePool.execute<RowDataPacket[]>('SELECT dissolved_at, dissolved_by_user_id, dissolve_reason FROM table_groups WHERE id = ?', [groupId])
    expect(groups[0]?.dissolved_at).not.toBeNull()
    expect(groups[0]?.dissolved_by_user_id).toBeNull()
    expect(groups[0]?.dissolve_reason).toBe('BUSINESS_DAY_END')
    const [entryAfter] = await databasePool.execute<RowDataPacket[]>('SELECT * FROM waitlist_entries WHERE id = ?', [entryId])
    expect(entryAfter).toEqual(entryBefore)
    const [audits] = await databasePool.execute<RowDataPacket[]>('SELECT action FROM operation_log ORDER BY change_seq')
    expect(audits.map((row) => String(row.action))).toEqual([
      'WAITLIST_ADDED', 'WAITLIST_ASSIGNED_TO_RESERVATION', 'WAITLIST_SEATED', 'VISIT_AUTO_CLOSED_BUSINESS_DAY',
    ])
    expect(await runBusinessDayEndSweep({ organizationId: actor.organizationId, venueId: actor.venueId, now: cutoff }))
      .toEqual({ closed: 0, skipped: 0 })
  })

  it('rolls back visit, allocations, group and change sequence when system audit fails', async () => {
    await checkedInAdvanceEntry()
    async function snapshot() {
      const tables = ['visits', 'table_allocations', 'table_groups', 'waitlist_entries', 'venues', 'operation_log']
      return Promise.all(tables.map(async (table) => {
        const [rows] = await databasePool.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY id`)
        return rows
      }))
    }
    const before = await snapshot()
    await databasePool.query(`ALTER TABLE operation_log ADD CONSTRAINT ck_test_reject_business_day
      CHECK (action <> 'VISIT_AUTO_CLOSED_BUSINESS_DAY')`)
    try {
      await expect(runBusinessDayEndSweep({ organizationId: actor.organizationId, venueId: actor.venueId, now: cutoff }))
        .rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
    } finally {
      await databasePool.query('ALTER TABLE operation_log DROP CHECK ck_test_reject_business_day')
    }
    expect(await snapshot()).toEqual(before)
  })
})

/**
 * TU-38 — API Sổ lượt tới quán (statistics on top of the TU-25 ledger).
 *
 * AC01 per table/cluster for one operating day, including scopes with zero turns.
 * AC02 the venue total equals the turns actually recorded.
 * AC03 the average per table, with both denominators named.
 * AC04 monthly totals, a cluster counted once.
 * AC05 a booking never checked in, cancelled or no-show is not counted.
 * AC06 an operating day that crosses midnight falls on the configured shift.
 * AC07 one month of sample data under 2000ms, with EXPLAIN.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { AuthenticatedActor } from '../src/auth/authenticated-actor.js'
import { databasePool } from '../src/database/pool.js'
import {
  checkInBooking,
  closeBooking,
  createAndAssignBooking,
} from '../src/modules/bookings/booking.repository.js'
import { createLayoutGroup } from '../src/modules/tables/table-layout-group.repository.js'
import { closeVisit } from '../src/modules/visits/visit.repository.js'
import { summarizeTableTurns, type TurnSummary } from '../src/modules/visits/table-turn.repository.js'
import {
  actor,
  businessDate,
  clearFixture,
  initializeFixture,
  login,
  resetFixture,
  tableId,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const b3 = 9840
const b4 = 9841
const b5 = 9842
/** A spare table, which is not a unit that serves a party and so is not a denominator. */
const spare = 9843
const deviceActor: AuthenticatedActor = { ...actor, authSessionId: 25_101 }

async function addTables(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y, is_spare)
     VALUES
      (?, ?, ?, ?, 'B3', 'B3', 'TABLE', 4, 10, 20, 0),
      (?, ?, ?, ?, 'B4', 'B4', 'TABLE', 4, 20, 20, 0),
      (?, ?, ?, ?, 'B5', 'B5', 'TABLE', 4, 30, 20, 0),
      (?, ?, ?, ?, 'SP1', 'SP1', 'TABLE', 4, 40, 20, 1)`,
    [
      b3, actor.organizationId, actor.venueId, tableId,
      b4, actor.organizationId, actor.venueId, tableId,
      b5, actor.organizationId, actor.venueId, tableId,
      spare, actor.organizationId, actor.venueId, tableId,
    ],
  )
}

/** Books, checks in on `date` and returns the sitting visit. */
async function seat(
  name: string,
  tableIds: number[],
  partySize: number,
  date = businessDate,
  checkInAt = new Date(`${date}T21:30:00+07:00`),
): Promise<{ reservationId: number; visitId: number; version: number }> {
  const booking = await createAndAssignBooking(actor, {
    guestName: name,
    partySize,
    expectedAt: `${date}T21:00:00+07:00`,
    businessDate: date,
    sourceCode: 'HOTLINE',
    tableIds,
    capacityOverrideConfirmed: true,
  })
  await checkInBooking(actor, booking.id, booking.version, checkInAt)
  const [rows] = await databasePool.execute<(RowDataPacket & { visit_id: number })[]>(
    'SELECT visit_id FROM reservations WHERE id = ?', [booking.id],
  )
  const visitId = Number(rows[0]!.visit_id)
  const [visits] = await databasePool.execute<(RowDataPacket & { version: number })[]>(
    'SELECT version FROM visits WHERE id = ?', [visitId],
  )
  return { reservationId: booking.id, visitId, version: Number(visits[0]!.version) }
}

/** Seats and releases a party, which is the only shape that earns a counted turn. */
async function serve(name: string, tableIds: number[], partySize: number, date = businessDate): Promise<void> {
  const seated = await seat(name, tableIds, partySize, date)
  await closeVisit(actor, {
    visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
  })
}

function dayQuery(from = businessDate, to = from) {
  return { from, to, countedOnly: true }
}

mysqlDescribe('TU-38 turn statistics', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTables()
  })
  afterAll(clearFixture)

  /* ---------------- AC01, AC02, AC03 ---------------- */

  it('AC01/AC02/AC03 returns every scope for one day, totals, and both averages', async () => {
    const cluster = await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4'] })
    await serve('Cluster 1', [b3], 6)
    await serve('Cluster 2', [b3], 4)
    await serve('Single', [b5], 3)

    const summary = await summarizeTableTurns(actor, dayQuery())
    // AC02: three recorded turns, and the venue total is their count, not the sum of ordinals.
    expect(summary.completedTotal).toBe(3)
    expect(summary.guestTotal).toBe(13)
    expect(summary.byScope.reduce((sum, row) => sum + row.turns, 0)).toBe(3)

    // AC01: the cluster is one scope with two turns; B5 is its own scope with one.
    expect(summary.byScope).toEqual([
      { scope: 'GROUP', groupId: cluster.group.groupId, tableId: null, label: cluster.group.displayCode, turns: 2, guests: 10 },
      { scope: 'TABLE', groupId: null, tableId: b5, label: 'B5', turns: 1, guests: 3 },
    ])

    // AC03: A1 + B5 + the B3/B4 cluster can each serve a party; SP1 is spare, B3 and B4 are
    // owned by the cluster. The physical denominator counts A1, B3, B4 and B5.
    expect(summary.scopeTotal).toBe(3)
    expect(summary.physicalTableTotal).toBe(4)
    expect(summary.averagePerScope).toBe(1)
    expect(summary.averagePerPhysicalTable).toBe(0.75)

    // AC01: zero-turn scopes only on request, and then exactly once, with a live label.
    const withZeroes = await summarizeTableTurns(actor, { ...dayQuery(), includeZeroScopes: true })
    expect(withZeroes.byScope).toHaveLength(3)
    expect(withZeroes.byScope.at(-1)).toEqual({ scope: 'TABLE', groupId: null, tableId: tableId, label: 'A1', turns: 0, guests: 0 })
    expect(withZeroes.byScope.map((row) => row.label)).not.toContain('SP1')
    expect(withZeroes.byScope.filter((row) => row.label === cluster.group.displayCode)).toHaveLength(1)
    expect(withZeroes.completedTotal).toBe(3)
  })

  it('AC03 keeps the averages at zero rather than dividing by zero on an empty range', async () => {
    const summary = await summarizeTableTurns(actor, dayQuery('2030-01-01'))
    expect(summary).toMatchObject({
      completedTotal: 0, guestTotal: 0, averagePerScope: 0, averagePerPhysicalTable: 0,
      byBusinessDate: [], byMonth: [], byStaff: [], byScope: [],
    })
    // The denominators describe the venue, not the range, so they stay populated.
    expect(summary.scopeTotal).toBe(4)
    expect(summary.physicalTableTotal).toBe(4)
  })

  /* ---------------- AC04 ---------------- */

  it('AC04 totals each month separately and counts a cluster once per party', async () => {
    await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4'] })
    await serve('Oct cluster', [b3], 5, '2030-10-24')
    await serve('Oct single', [b5], 2, '2030-10-31')
    await serve('Nov cluster', [b3], 7, '2030-11-01')

    const summary = await summarizeTableTurns(actor, dayQuery('2030-10-01', '2030-11-30'))
    expect(summary.byMonth).toEqual([
      { month: '2030-10', turns: 2, guests: 7 },
      { month: '2030-11', turns: 1, guests: 7 },
    ])
    expect(summary.byMonth.reduce((sum, row) => sum + row.turns, 0)).toBe(summary.completedTotal)
    // The cluster earned 2 turns across the two months, never 2 per member table.
    expect(summary.byScope.find((row) => row.scope === 'GROUP')).toMatchObject({ turns: 2, guests: 12 })
  })

  /* ---------------- AC05 ---------------- */

  it('AC05 ignores bookings that were never checked in, cancelled or marked no-show', async () => {
    const waiting = await createAndAssignBooking(actor, {
      guestName: 'Chưa nhận khách', partySize: 4, expectedAt: `${businessDate}T21:00:00+07:00`,
      businessDate, sourceCode: 'HOTLINE', tableIds: [b3], capacityOverrideConfirmed: true,
    })
    const cancelled = await createAndAssignBooking(actor, {
      guestName: 'Huỷ', partySize: 2, expectedAt: `${businessDate}T21:00:00+07:00`,
      businessDate, sourceCode: 'HOTLINE', tableIds: [b4], capacityOverrideConfirmed: true,
    })
    await closeBooking(deviceActor, cancelled.id, cancelled.version, 'CANCELLED')
    const noShow = await createAndAssignBooking(actor, {
      guestName: 'Không đến', partySize: 2, expectedAt: `${businessDate}T21:00:00+07:00`,
      businessDate, sourceCode: 'HOTLINE', tableIds: [b5], capacityOverrideConfirmed: true,
    })
    await closeBooking(deviceActor, noShow.id, noShow.version, 'NO_SHOW')

    expect(waiting.id).toBeGreaterThan(0)
    const summary = await summarizeTableTurns(actor, dayQuery())
    expect(summary).toMatchObject({ completedTotal: 0, openTotal: 0, guestTotal: 0 })
    expect(summary.byScope).toEqual([])
    expect(summary.byMonth).toEqual([])
    expect(summary.averagePerScope).toBe(0)
  })

  /* ---------------- AC06 ---------------- */

  it('AC06 puts a party seated after midnight on the operating day of the configured shift', async () => {
    const [venues] = await databasePool.execute<(RowDataPacket & { start: string; cutoff: string })[]>(
      `SELECT TIME_FORMAT(business_day_start_local, '%H:%i:%s') AS start,
         TIME_FORMAT(business_day_cutoff_local, '%H:%i:%s') AS cutoff
       FROM venues WHERE organization_id = ? AND id = ?`,
      [actor.organizationId, actor.venueId],
    )
    // The shift comes from the venue row, so this test asserts the configuration it reads.
    expect(venues[0]).toMatchObject({ start: '17:00:00', cutoff: '05:00:00' })

    // 2030-10-31T00:30+07:00 is before the cutoff, so it belongs to the 2030-10-30 operating
    // day — October, although the wall clock already says 31 October.
    const afterMidnight = await createAndAssignBooking(actor, {
      guestName: 'Qua nửa đêm', partySize: 3, expectedAt: '2030-10-31T00:30:00+07:00',
      businessDate: '2030-10-30', sourceCode: 'HOTLINE', tableIds: [b3], capacityOverrideConfirmed: true,
    })
    // The same wall clock against the next operating day is refused, which is what proves the
    // cutoff — not the calendar date — decides which day a turn belongs to.
    await expect(createAndAssignBooking(actor, {
      guestName: 'Sai ngày vận hành', partySize: 3, expectedAt: '2030-10-31T00:30:00+07:00',
      businessDate: '2030-10-31', sourceCode: 'HOTLINE', tableIds: [b4], capacityOverrideConfirmed: true,
    })).rejects.toMatchObject({ status: 400 })

    // 00:30 local on 31 October: inside the shift, and still the 2030-10-30 operating day.
    await checkInBooking(actor, afterMidnight.id, afterMidnight.version, new Date('2030-10-30T17:30:00.000Z'))
    const [reservations] = await databasePool.execute<(RowDataPacket & { visit_id: number })[]>(
      'SELECT visit_id FROM reservations WHERE id = ?', [afterMidnight.id],
    )
    const visitId = Number(reservations[0]!.visit_id)
    const [visits] = await databasePool.execute<(RowDataPacket & { version: number })[]>(
      'SELECT version FROM visits WHERE id = ?', [visitId],
    )
    await closeVisit(actor, {
      visitId, expectedVersion: Number(visits[0]!.version), mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    const [rows] = await databasePool.execute<(RowDataPacket & { business_date: Date | string })[]>(
      'SELECT business_date FROM table_turns WHERE visit_id = ?', [visitId],
    )
    const stored = rows[0]!
    expect(String(stored.business_date instanceof Date
      ? stored.business_date.toISOString().slice(0, 10)
      : stored.business_date).slice(0, 10)).toBe('2030-10-30')

    const october = await summarizeTableTurns(actor, dayQuery('2030-10-01', '2030-10-31'))
    expect(october.byMonth).toEqual([{ month: '2030-10', turns: 1, guests: 3 }])
    expect(october.byBusinessDate).toEqual([{ businessDate: '2030-10-30', turns: 1, guests: 3 }])
    // Asking for 31 October alone returns nothing: the party belongs to the night before.
    expect(await summarizeTableTurns(actor, dayQuery('2030-10-31'))).toMatchObject({ completedTotal: 0 })
  })

  /* ---------------- AC09 route contract ---------------- */

  it('AC09 serves the new aggregates over the existing summary endpoint with report.read', async () => {
    await serve('Route', [b3], 4)
    const owner = await login('integration_owner')
    const url = `/api/v1/visits/turns/summary?from=${businessDate}&to=${businessDate}`
    const response = await owner.agent.get(`${url}&includeZeroScopes=true`)
    expect(response.status).toBe(200)
    const body = response.body as TurnSummary
    expect(body).toMatchObject({
      completedTotal: 1, guestTotal: 4, scopeTotal: 4, physicalTableTotal: 4,
      averagePerScope: 0.25, averagePerPhysicalTable: 0.25,
      byMonth: [{ month: businessDate.slice(0, 7), turns: 1, guests: 4 }],
    })
    expect(body.byScope).toHaveLength(4)

    const reception = await login('integration_reception')
    expect((await reception.agent.get(url)).status).toBe(403)
    expect((await owner.agent.get(`${url}&includeZeroScopes=1`)).status).toBe(400)
  })
})

/**
 * BE-01 / BF-03 — one occupancy policy for every table allocation command.
 *
 * Reproduced in the 07/11 backend review and re-verified on develop:
 *   BE-01  a HOLD on another business date blocked a walk-in today.
 *   BF-03  an unreleased carry-over USAGE did not block a direct booking today.
 *
 * The policy is the one the floor projection already applies when it reads
 * (`floor-projection.repository.ts`: "Preserve real carry-over on current/past
 * views; future planning sees only exact-date USAGE"):
 *
 *   - an unreleased HOLD blocks only the business date being allocated, so each
 *     operating day is planned independently;
 *   - an unreleased USAGE blocks a date it is relevant to — the current or a past
 *     operating day carries it over, while planning a later day sees only a USAGE
 *     of that same day.
 *
 * Nothing here infers when a table will be released. Dates are taken relative to
 * the real current business date, because the same pair of rows means
 * "carry-over into today" or "planning for tomorrow" depending on the clock.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { databasePool } from '../src/database/pool.js'
import { businessDateAt } from '../src/modules/bookings/business-date.js'
import {
  assignBookingTables,
  createAndAssignBooking,
  createBooking,
  createWalkIn,
  mergeBookingTables,
} from '../src/modules/bookings/booking.repository.js'
import { closeVisit, mergeVisitTables } from '../src/modules/visits/visit.repository.js'
import { applicationNow } from '../src/time/application-clock.js'
import { actor, clearFixture, initializeFixture, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

function shiftDate(businessDate: string, days: number): string {
  const base = new Date(`${businessDate}T12:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

// The current operating day decides whether an earlier USAGE is a carry-over or
// merely history, so every date below is anchored to it.
const today = businessDateAt(applicationNow())
const yesterday = shiftDate(today, -1)
const tomorrow = shiftDate(today, 1)
// 19:00 local on the current operating day: inside the shift and before 21:00.
const now = new Date(`${today}T19:00:00+07:00`)
const yesterdayNow = new Date(`${yesterday}T19:00:00+07:00`)

const secondTableId = 9830
const thirdTableId = 9831

async function addTables(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'O2', 'O2', 'TABLE', 4, 60, 10),
            (?, ?, ?, ?, 'O3', 'O3', 'TABLE', 4, 70, 10)`,
    [secondTableId, actor.organizationId, actor.venueId, tableId,
      thirdTableId, actor.organizationId, actor.venueId, tableId],
  )
}

function bookingInput(bd: string) {
  return {
    guestName: 'Occupancy probe',
    partySize: 2,
    expectedAt: `${bd}T21:00:00+07:00`,
    businessDate: bd,
    sourceCode: 'HOTLINE',
  }
}

/** Runs the command and reports the AppError code, or 'OK' when it succeeds. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'OK'
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
}

async function holdOn(bd: string, table: number, at: Date = now): Promise<void> {
  const booked = await createBooking(actor, bookingInput(bd), at)
  await assignBookingTables(actor, booked.id, booked.version, [table])
}

async function usageOn(bd: string, table: number): Promise<number> {
  const walkIn = await createWalkIn(actor, {
    guestName: 'Carry-over', partySize: 2, businessDate: bd, tableIds: [table],
  })
  return walkIn.visitId
}

async function liveAllocations(table: number): Promise<string[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & { kind: string; business_date: Date | string })[]>(
    `SELECT kind, business_date FROM table_allocations
     WHERE table_id = ? AND released_at IS NULL ORDER BY business_date, id`,
    [table],
  )
  return rows.map((row) => `${row.kind}@${new Date(row.business_date).toISOString().slice(0, 10)}`)
}

mysqlDescribe('BE-01/BF-03 table occupancy policy', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTables()
  })
  afterAll(clearFixture)

  // BE-01: planning for another day must not block seating a guest standing here.
  it('BE-01: a HOLD on the next business date does not block a walk-in today', async () => {
    await holdOn(tomorrow, tableId)
    expect(await outcome(() => createWalkIn(actor, {
      guestName: 'Guest at the counter', partySize: 2, businessDate: today, tableIds: [tableId],
    }))).toBe('OK')
    expect(await liveAllocations(tableId)).toEqual([`USAGE@${today}`, `HOLD@${tomorrow}`])
  })

  it('BE-01: a HOLD on an earlier business date does not block a walk-in today', async () => {
    await holdOn(yesterday, tableId, yesterdayNow)
    expect(await outcome(() => createWalkIn(actor, {
      guestName: 'Guest at the counter', partySize: 2, businessDate: today, tableIds: [tableId],
    }))).toBe('OK')
  })

  it('a HOLD on the same business date still blocks a walk-in', async () => {
    await holdOn(today, tableId)
    expect(await outcome(() => createWalkIn(actor, {
      guestName: 'Guest at the counter', partySize: 2, businessDate: today, tableIds: [tableId],
    }))).toBe('TABLE_ALREADY_OCCUPIED')
  })

  it('an unreleased USAGE carried over from yesterday still blocks a walk-in', async () => {
    await usageOn(yesterday, tableId)
    expect(await outcome(() => createWalkIn(actor, {
      guestName: 'Guest at the counter', partySize: 2, businessDate: today, tableIds: [tableId],
    }))).toBe('TABLE_ALREADY_OCCUPIED')
  })

  // BF-03: the direct create+assign path must honour the same occupancy.
  it('BF-03: an unreleased carry-over USAGE blocks a direct booking today', async () => {
    await usageOn(yesterday, tableId)
    expect(await outcome(() => createAndAssignBooking(
      actor, { ...bookingInput(today), tableIds: [tableId] }, now,
    ))).toBe('TABLE_ALREADY_OCCUPIED')
    expect(await liveAllocations(tableId)).toEqual([`USAGE@${yesterday}`])
  })

  it('BF-03: the same carry-over USAGE blocks assigning and merging for today', async () => {
    await usageOn(yesterday, secondTableId)
    const booked = await createBooking(actor, bookingInput(today), now)
    expect(await outcome(() => assignBookingTables(actor, booked.id, booked.version, [secondTableId])))
      .toBe('TABLE_ALREADY_OCCUPIED')

    const assigned = await assignBookingTables(actor, booked.id, booked.version, [tableId])
    expect(await outcome(() => mergeBookingTables(
      actor, assigned.id, assigned.version, [tableId, secondTableId],
    ))).toBe('TABLE_ALREADY_OCCUPIED')
  })

  // The same gap leaked a raw MySQL unique-key error instead of a 409.
  it('BF-03: merging a visit onto a carried-over table fails closed with 409', async () => {
    await usageOn(yesterday, secondTableId)
    const visitId = await usageOn(today, tableId)
    expect(await outcome(() => mergeVisitTables(actor, {
      visitId, expectedVersion: 1, tableIds: [tableId, secondTableId],
    }))).toBe('TABLE_ALREADY_OCCUPIED')
  })

  it('a released USAGE no longer blocks anything', async () => {
    const visitId = await usageOn(yesterday, tableId)
    await closeVisit(actor, { visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    expect(await liveAllocations(tableId)).toEqual([])

    expect(await outcome(() => createAndAssignBooking(
      actor, { ...bookingInput(today), tableIds: [tableId] }, now,
    ))).toBe('OK')
    expect(await outcome(() => createWalkIn(actor, {
      guestName: 'After release', partySize: 2, businessDate: today, tableIds: [secondTableId],
    }))).toBe('OK')
  })

  // Approved rule, also covered by future-floor-projection: planning a later day
  // on a table that is still in use today stays allowed.
  it('still allows planning the next operating day beside a current USAGE', async () => {
    await usageOn(today, tableId)
    expect(await outcome(() => createAndAssignBooking(
      actor, { ...bookingInput(tomorrow), tableIds: [tableId] }, now,
    ))).toBe('OK')
    expect(await liveAllocations(tableId)).toEqual([`USAGE@${today}`, `HOLD@${tomorrow}`])
  })

  it('keeps business dates independent for planning holds', async () => {
    await holdOn(today, tableId)
    expect(await outcome(() => createAndAssignBooking(
      actor, { ...bookingInput(today), tableIds: [tableId] }, now,
    ))).toBe('TABLE_ALREADY_OCCUPIED')
    expect(await outcome(() => createAndAssignBooking(
      actor, { ...bookingInput(tomorrow), tableIds: [tableId] }, now,
    ))).toBe('OK')
    expect(await liveAllocations(tableId)).toEqual([`HOLD@${today}`, `HOLD@${tomorrow}`])
  })

  it('records a walk-in on the operating day it is given', async () => {
    await holdOn(tomorrow, thirdTableId)
    expect(await outcome(() => createWalkIn(actor, {
      guestName: 'Late night', partySize: 2, businessDate: today, tableIds: [thirdTableId],
    }))).toBe('OK')
    const [rows] = await databasePool.execute<(RowDataPacket & { business_date: Date | string })[]>(
      `SELECT business_date FROM table_allocations
       WHERE table_id = ? AND kind = 'USAGE' AND released_at IS NULL`,
      [thirdTableId],
    )
    expect(new Date(rows[0]!.business_date).toISOString().slice(0, 10)).toBe(today)
  })

  it('still lets only one of two concurrent walk-ins win', async () => {
    const results = await Promise.allSettled([
      createWalkIn(actor, { guestName: 'Race A', partySize: 2, businessDate: today, tableIds: [tableId] }),
      createWalkIn(actor, { guestName: 'Race B', partySize: 2, businessDate: today, tableIds: [tableId] }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await liveAllocations(tableId)).toEqual([`USAGE@${today}`])
  })

  it('still lets only one of a concurrent walk-in and direct booking win', async () => {
    const results = await Promise.allSettled([
      createWalkIn(actor, { guestName: 'Race walk-in', partySize: 2, businessDate: today, tableIds: [secondTableId] }),
      createAndAssignBooking(actor, { ...bookingInput(today), tableIds: [secondTableId] }, now),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await liveAllocations(secondTableId)).toHaveLength(1)
  })
})

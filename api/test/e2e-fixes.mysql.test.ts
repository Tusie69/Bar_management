import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { databasePool } from '../src/database/pool.js'
import { assignBookingTables, checkInBooking, createBooking, mergeBookingTables } from '../src/modules/bookings/booking.repository.js'
import type { FloorGroupView, TableView } from '../src/modules/tables/table.repository.js'
import { actor, businessDate, clearFixture, initializeFixture, login, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const nextDate = '2030-10-25'

mysqlDescribe('E2E carry-over allocation projections', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  async function heldBooking(tableIds = [tableId]) {
    const booking = await createBooking(actor, { guestName: 'Carry-over guest', partySize: 2,
      businessDate, expectedAt: `${businessDate}T20:00:00+07:00`, sourceCode: 'HOTLINE' })
    return assignBookingTables(actor, booking.id, booking.version, tableIds)
  }

  async function floor(date: string) {
    const session = await login()
    const response = await session.agent.get(`/api/v1/tables?date=${date}`)
    expect(response.status).toBe(200)
    return response.body as { tables: TableView[]; groups: FloorGroupView[] }
  }

  it('keeps earlier unreleased holds reserved with their original date without mutating anything', async () => {
    await heldBooking()
    // An expired planning window still requires manual release.
    await databasePool.execute('UPDATE table_allocations SET planned_until = starts_at + INTERVAL 1 HOUR')
    const [before] = await databasePool.execute<RowDataPacket[]>('SELECT * FROM table_allocations')
    expect((await floor(nextDate)).tables).toEqual([expect.objectContaining({ id: tableId,
      state: 'RESERVED', staleFromPreviousDay: true, allocationBusinessDate: businessDate, activeVisit: null })])
    const [after] = await databasePool.execute<RowDataPacket[]>('SELECT * FROM table_allocations')
    expect(after).toEqual(before)
  })

  it('keeps earlier visits occupied with their identity even when started_at has a different date', async () => {
    const booking = await heldBooking()
    await checkInBooking(actor, booking.id, booking.version)
    await databasePool.execute('UPDATE visits SET started_at = ?', [`${nextDate} 13:00:00`])
    expect((await floor(nextDate)).tables[0]).toMatchObject({ state: 'IN_USE', staleFromPreviousDay: true,
      allocationBusinessDate: businessDate, activeVisit: { displayName: 'Carry-over guest', tableCodes: ['A1'] } })
  })

  it('includes earlier active group membership and excludes groups before their business date', async () => {
    await databasePool.execute(
      `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity)
       VALUES (?, ?, ?, ?, 'A2', 'A2', 'TABLE', 4)`,
      [tableId + 2, actor.organizationId, actor.venueId, tableId],
    )
    const booking = await heldBooking()
    await mergeBookingTables(actor, booking.id, booking.version, [tableId, tableId + 2])
    const groups = (await floor(nextDate)).groups
    expect(groups).toEqual([expect.objectContaining({ tableIds: [tableId, tableId + 2] })])
    expect((await floor('2030-10-23')).groups).toEqual([])
  })

  it('keeps same-day allocations non-stale and excludes future allocations', async () => {
    await heldBooking()
    expect((await floor(businessDate)).tables[0]).toMatchObject({ state: 'RESERVED',
      staleFromPreviousDay: false, allocationBusinessDate: businessDate })
    expect((await floor('2030-10-23')).tables[0]).toMatchObject({ state: 'AVAILABLE',
      staleFromPreviousDay: false, allocationBusinessDate: null })
  })

  it('clears carry-over occupancy only after an explicit release', async () => {
    await heldBooking()
    await databasePool.execute(
      `UPDATE table_allocations SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?,
       release_reason = 'HOLD_RELEASED'`, [actor.userId],
    )
    expect((await floor(nextDate)).tables[0]).toMatchObject({ state: 'AVAILABLE',
      staleFromPreviousDay: false, allocationBusinessDate: null })
  })
})

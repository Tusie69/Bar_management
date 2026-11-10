import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { databasePool } from '../src/database/pool.js'
import { createAndAssignBooking } from '../src/modules/bookings/booking.repository.js'
import { getFloorProjection } from '../src/modules/tables/floor-projection.repository.js'
import { runBusinessDayEndSweep } from '../src/modules/visits/business-day.worker.js'
import {
  actor,
  clearFixture,
  initializeFixture,
  resetFixture,
  tableId,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const now = new Date('2026-11-05T15:00:00.000Z') // 22:00 Asia/Ho_Chi_Minh
const currentBusinessDate = '2026-11-05'
const futureBusinessDates = ['2026-11-06', '2026-11-07', '2026-11-10'] as const
const cutoff = new Date('2026-11-05T22:00:00.000Z') // 05:00 on 2026-11-06 in Asia/Ho_Chi_Minh

mysqlDescribe('future floor projection MySQL integration', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  async function addSecondTable(): Promise<number> {
    const secondTableId = tableId + 2
    await databasePool.execute(
      `INSERT INTO dining_tables
        (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
       VALUES (?, ?, ?, ?, 'A2', 'A2', 'TABLE', 4, 20, 20)`,
      [secondTableId, actor.organizationId, actor.venueId, tableId],
    )
    return secondTableId
  }

  async function createActiveUsage(
    tableIds: number[],
    grouped = false,
    businessDate = currentBusinessDate,
  ): Promise<{ visitId: number; groupId: number | null }> {
    const [visit] = await databasePool.execute<ResultSetHeader>(
      `INSERT INTO visits
        (organization_id, venue_id, origin, contact_name, guest_count, started_at, business_date, created_by_user_id)
       VALUES (?, ?, 'WALK_IN', 'Future projection guest', ?, '2026-11-05 14:00:00', ?, ?)`,
      [actor.organizationId, actor.venueId, tableIds.length * 2, businessDate, actor.userId],
    )
    let groupId: number | null = null
    if (grouped) {
      const [group] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO table_groups
          (organization_id, venue_id, business_date, symbol_no, formed_at, formed_by_user_id)
         VALUES (?, ?, ?, 1, '2026-11-05 14:00:00', ?)`,
        [actor.organizationId, actor.venueId, businessDate, actor.userId],
      )
      groupId = group.insertId
    }
    for (const activeTableId of tableIds) {
      await databasePool.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, group_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, ?, '2026-11-05 14:00:00', ?, ?)`,
        [
          actor.organizationId,
          actor.venueId,
          activeTableId,
          visit.insertId,
          groupId,
          businessDate,
          actor.userId,
        ],
      )
    }
    return { visitId: visit.insertId, groupId }
  }

  it('keeps current USAGE but excludes it from every selected future business date', async () => {
    await createActiveUsage([tableId])

    const current = await getFloorProjection(actor, currentBusinessDate, now)
    expect(current.tables[0]).toMatchObject({
      displayState: 'IN_USE',
      state: 'IN_USE',
      staleFromPreviousDay: false,
      allocationBusinessDate: currentBusinessDate,
      claim: { kind: 'VISIT' },
    })

    for (const futureBusinessDate of futureBusinessDates) {
      const future = await getFloorProjection(actor, futureBusinessDate, now)
      expect(future.tables[0]).toMatchObject({
        displayState: 'EMPTY',
        state: 'AVAILABLE',
        staleFromPreviousDay: false,
        allocationBusinessDate: null,
        activeVisit: null,
        claim: null,
        groupId: null,
        groupDisplayCode: null,
        groupMemberTableIds: [],
      })
      expect(future.groups).toEqual([])
    }
  })

  it('preserves carry-over on the current date and the existing projection behavior for past dates', async () => {
    await createActiveUsage([tableId], false, '2026-11-03')

    const past = await getFloorProjection(actor, '2026-11-04', now)
    expect(past.tables[0]).toMatchObject({
      displayState: 'IN_USE',
      staleFromPreviousDay: true,
      allocationBusinessDate: '2026-11-03',
      claim: { kind: 'VISIT' },
    })
    const current = await getFloorProjection(actor, currentBusinessDate, now)
    expect(current.tables[0]).toMatchObject({
      displayState: 'IN_USE',
      staleFromPreviousDay: true,
      allocationBusinessDate: '2026-11-03',
      claim: { kind: 'VISIT' },
    })
    const future = await getFloorProjection(actor, '2026-11-06', now)
    expect(future.tables[0]).toMatchObject({
      displayState: 'EMPTY',
      staleFromPreviousDay: false,
      allocationBusinessDate: null,
      claim: null,
    })
  })

  it('shows a real future HOLD and allows its booking beside current-date USAGE', async () => {
    await createActiveUsage([tableId])
    const booking = await createAndAssignBooking(actor, {
      guestName: 'Future booking guest',
      partySize: 2,
      expectedAt: '2026-11-06T21:00:00+07:00',
      businessDate: '2026-11-06',
      sourceCode: 'HOTLINE',
      tableIds: [tableId],
    }, now)

    const future = await getFloorProjection(actor, '2026-11-06', now)
    expect(future.tables[0]).toMatchObject({
      displayState: 'BOOKED',
      state: 'RESERVED',
      staleFromPreviousDay: false,
      allocationBusinessDate: '2026-11-06',
      activeVisit: null,
      claim: { kind: 'RESERVATION', reservationId: booking.id },
    })
    const [activeAllocations] = await databasePool.execute<(RowDataPacket & {
      business_date: Date | string
      kind: 'HOLD' | 'USAGE'
    })[]>(
      `SELECT business_date, kind FROM table_allocations
       WHERE table_id = ? AND released_at IS NULL ORDER BY business_date, kind`,
      [tableId],
    )
    expect(activeAllocations.map((allocation) => ({
      businessDate: allocation.business_date instanceof Date
        ? allocation.business_date.toISOString().slice(0, 10)
        : String(allocation.business_date).slice(0, 10),
      kind: allocation.kind,
    }))).toEqual([
      { businessDate: '2026-11-05', kind: 'USAGE' },
      { businessDate: '2026-11-06', kind: 'HOLD' },
    ])
  })

  it('keeps current visit groups and removes every future ghost connector', async () => {
    const secondTableId = await addSecondTable()
    const { groupId } = await createActiveUsage([tableId, secondTableId], true)

    const current = await getFloorProjection(actor, currentBusinessDate, now)
    expect(current.groups).toEqual([{
      id: groupId,
      symbolNo: 1,
      displayCode: '◆A',
      tableIds: [tableId, secondTableId],
      // C1: the projection now says which lifecycle a cluster has. This one is
      // the implicit cluster of a visit, not an independent layout cluster.
      origin: 'CLAIM',
      // C2: no turn has completed on these tables today, so the badge is absent.
      seatedTurnCount: 0,
    }])
    expect(current.tables.map((table) => table.groupMemberTableIds)).toEqual([
      [tableId, secondTableId],
      [tableId, secondTableId],
    ])

    const future = await getFloorProjection(actor, '2026-11-06', now)
    expect(future.groups).toEqual([])
    expect(future.tables.every((table) => table.claim === null && table.groupId === null)).toBe(true)
    expect(future.tables.every((table) => table.groupMemberTableIds.length === 0)).toBe(true)
  })

  it('leaves worker eligibility and physical allocation release unchanged at 05:00', async () => {
    const { visitId } = await createActiveUsage([tableId])
    expect(await runBusinessDayEndSweep({
      organizationId: actor.organizationId,
      venueId: actor.venueId,
      now: new Date(cutoff.getTime() - 1),
    })).toEqual({ closed: 0, skipped: 0 })
    expect((await getFloorProjection(actor, '2026-11-06', now)).tables[0]?.displayState).toBe('EMPTY')

    expect(await runBusinessDayEndSweep({
      organizationId: actor.organizationId,
      venueId: actor.venueId,
      now: cutoff,
    })).toEqual({ closed: 1, skipped: 0 })

    const [visits] = await databasePool.execute<RowDataPacket[]>(
      'SELECT ended_at, end_reason FROM visits WHERE id = ?',
      [visitId],
    )
    expect(visits[0]).toMatchObject({ end_reason: 'BUSINESS_DAY_END' })
    expect(visits[0]?.ended_at).not.toBeNull()
    const [allocations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT released_at, release_reason FROM table_allocations WHERE visit_id = ?',
      [visitId],
    )
    expect(allocations).toEqual([
      expect.objectContaining({ release_reason: 'BUSINESS_DAY_END' }),
    ])
    expect(allocations[0]?.released_at).not.toBeNull()
  })
})

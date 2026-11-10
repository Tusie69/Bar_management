/**
 * C2 — ghi nhận lượt khách.
 *
 * AC01 one turn with all eight fields, AC02 a booking that never sat down earns
 * none, AC03/AC04 the badge and the operating day, AC05 the date-range query,
 * AC06 one turn for a cluster rather than one per member, AC07 a repeated or
 * concurrent close writes one row, AC08 history keeps the original cluster,
 * AC09 Close Visit does not dissolve a layout cluster, AC10 no regression.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { AuthenticatedActor } from '../src/auth/authenticated-actor.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  checkInBooking,
  closeBooking,
  createAndAssignBooking,
  createWalkIn,
} from '../src/modules/bookings/booking.repository.js'
import { businessDateAt } from '../src/modules/bookings/business-date.js'
import { getFloorProjection } from '../src/modules/tables/floor-projection.repository.js'
import {
  createLayoutGroup,
  dissolveLayoutGroup,
} from '../src/modules/tables/table-layout-group.repository.js'
import { closeVisit } from '../src/modules/visits/visit.repository.js'
import { listTableTurns } from '../src/modules/visits/table-turn.repository.js'
import { runBusinessDayEndSweep } from '../src/modules/visits/business-day.worker.js'
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
const deviceActor: AuthenticatedActor = { ...actor, authSessionId: 25_001 }
const checkInNow = new Date(`${businessDate}T21:30:00+07:00`)

async function addTables(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES
      (?, ?, ?, ?, 'B3', 'B3', 'TABLE', 4, 10, 20),
      (?, ?, ?, ?, 'B4', 'B4', 'TABLE', 4, 20, 20),
      (?, ?, ?, ?, 'B5', 'B5', 'TABLE', 4, 30, 20)`,
    [
      b3, actor.organizationId, actor.venueId, tableId,
      b4, actor.organizationId, actor.venueId, tableId,
      b5, actor.organizationId, actor.venueId, tableId,
    ],
  )
}

interface TurnRow extends RowDataPacket {
  id: number
  business_date: Date | string
  scope: 'TABLE' | 'GROUP'
  table_id: number | null
  group_id: number | null
  scope_key: number
  turn_no: number
  visit_id: number
  table_codes_snapshot: unknown
  member_table_ids: unknown
  group_code_snapshot: string | null
  guest_name: string
  guest_count: number
  source_code: string | null
  origin: string
  seated_at: Date
  released_at: Date
  end_reason: string
  completed_at: Date | null
  closed_by_user_id: number | null
}

async function turns(): Promise<TurnRow[]> {
  const [rows] = await databasePool.execute<TurnRow[]>('SELECT * FROM table_turns ORDER BY id')
  return rows
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function bookingInput(name: string, partySize = 4) {
  return {
    guestName: name,
    partySize,
    expectedAt: `${businessDate}T21:00:00+07:00`,
    businessDate,
    sourceCode: 'HOTLINE' as const,
  }
}

/** Books, checks in, and returns the visit the party is sitting on. */
async function seatBooking(name: string, tableIds: number[], partySize = 4): Promise<{
  reservationId: number
  visitId: number
  version: number
}> {
  const booking = await createAndAssignBooking(actor, {
    ...bookingInput(name, partySize),
    tableIds,
    capacityOverrideConfirmed: true,
  })
  await checkInBooking(actor, booking.id, booking.version, checkInNow)
  const [rows] = await databasePool.execute<(RowDataPacket & { visit_id: number })[]>(
    'SELECT visit_id FROM reservations WHERE id = ?', [booking.id],
  )
  const visitId = Number(rows[0]!.visit_id)
  const [visitRows] = await databasePool.execute<(RowDataPacket & { version: number })[]>(
    'SELECT version FROM visits WHERE id = ?', [visitId],
  )
  return { reservationId: booking.id, visitId, version: Number(visitRows[0]!.version) }
}

async function badgeFor(code: string): Promise<number> {
  const projection = await getFloorProjection(actor, businessDate, checkInNow)
  return projection.tables.find((row) => row.tableCode === code)!.seatedTurnCount
}

mysqlDescribe('C2 table turn ledger', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTables()
  })
  afterAll(clearFixture)

  /* ---------------- AC01 ---------------- */

  it('AC01 writes exactly one turn with all eight required fields', async () => {
    const seated = await seatBooking('Khách AC01', [b3], 3)
    expect(await turns()).toHaveLength(0)

    const closed = await closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })

    const rows = await turns()
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    // The eight fields the business asked for.
    expect(json(row.table_codes_snapshot)).toEqual(['B3'])            // mã bàn/cụm
    expect(dateOnly(row.business_date)).toBe(businessDate)            // ngày vận hành
    expect(row.seated_at).toBeInstanceOf(Date)                         // giờ vào
    expect(row.released_at).toBeInstanceOf(Date)                       // giờ ra
    expect(Number(row.guest_count)).toBe(3)                            // số khách
    expect(row.guest_name).toBe('Khách AC01')                          // tên khách
    expect(row.source_code).toBe('HOTLINE')                            // nguồn đặt
    expect(Number(row.turn_no)).toBe(1)                                // số thứ tự lượt

    expect(row.scope).toBe('TABLE')
    expect(Number(row.table_id)).toBe(b3)
    expect(row.completed_at).not.toBeNull()
    expect(Number(row.closed_by_user_id)).toBe(actor.userId)
    expect(row.released_at.getTime()).toBeGreaterThanOrEqual(row.seated_at.getTime())
    expect(closed.turn).toMatchObject({ scope: 'TABLE', turnNo: 1, counted: true })
  })

  it('AC01 records giờ vào from check-in, not from the close', async () => {
    const seated = await seatBooking('Khách giờ vào', [b3])
    const [visit] = await databasePool.execute<(RowDataPacket & { started_at: Date })[]>(
      'SELECT started_at FROM visits WHERE id = ?', [seated.visitId],
    )
    await closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    const row = (await turns())[0]!
    expect(row.seated_at.getTime()).toBe(visit[0]!.started_at.getTime())
  })

  /* ---------------- AC02 ---------------- */

  it('AC02 a booking cancelled before check-in earns no turn', async () => {
    const booking = await createAndAssignBooking(actor, { ...bookingInput('Hủy trước khi tới'), tableIds: [b3] })
    await closeBooking(actor, booking.id, booking.version, 'CANCELLED', 'Khách hủy')
    expect(await turns()).toHaveLength(0)
    expect(await badgeFor('B3')).toBe(0)

    const noShow = await createAndAssignBooking(actor, { ...bookingInput('Không tới'), tableIds: [b4] })
    await closeBooking(actor, noShow.id, noShow.version, 'NO_SHOW')
    expect(await turns()).toHaveLength(0)
    expect(await badgeFor('B4')).toBe(0)
  })

  /* ---------------- AC03 ---------------- */

  it('AC03 the badge goes up by one per completed turn and the table returns to empty', async () => {
    expect(await badgeFor('B3')).toBe(0)

    for (const [index, name] of ['Lượt 1', 'Lượt 2', 'Lượt 3'].entries()) {
      const seated = await seatBooking(name, [b3])
      // While the party is seated the badge still shows only completed turns.
      expect(await badgeFor('B3')).toBe(index)
      await closeVisit(actor, {
        visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
      })
      expect(await badgeFor('B3')).toBe(index + 1)
    }

    const projection = await getFloorProjection(actor, businessDate, checkInNow)
    const table = projection.tables.find((row) => row.tableCode === 'B3')!
    expect(table.displayState).toBe('EMPTY')
    expect(table.claim).toBeNull()
    expect(table.seatedTurnCount).toBe(3)
    // Ordinals are 1, 2, 3 for the same table and day.
    expect((await turns()).map((row) => Number(row.turn_no))).toEqual([1, 2, 3])
  })

  it('AC03 every device reads the same badge, and the close bumps the realtime cursor', async () => {
    const seated = await seatBooking('Khách realtime', [b3])
    const [before] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
      'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
      [actor.organizationId, actor.venueId],
    )
    await closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    const [after] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
      'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
      [actor.organizationId, actor.venueId],
    )
    // The SSE stream publishes this cursor, which is how the other device learns to
    // refetch; the badge itself travels in the projection, never in the event.
    expect(BigInt(after[0]!.change_seq)).toBeGreaterThan(BigInt(before[0]!.change_seq))

    const receptionist = await login()
    const response = await receptionist.agent.get(`/api/v1/tables?date=${businessDate}`).set('Origin', env.webOrigin)
    const body = response.body as { tables: Array<{ tableCode: string; seatedTurnCount: number }> }
    expect(body.tables.find((row) => row.tableCode === 'B3')?.seatedTurnCount).toBe(1)
  })

  /* ---------------- AC04 ---------------- */

  it('AC04 00:30 on 12/11 belongs to the operating day of 11/11', () => {
    // 17:00 → 05:00 in Asia/Ho_Chi_Minh: 00:30 local on the 12th is 17:30 UTC on the 11th.
    expect(businessDateAt(new Date('2026-11-11T17:30:00.000Z'))).toBe('2026-11-11')
    // And 18:00 local on the 11th, which is 11:00 UTC, is the same operating day.
    expect(businessDateAt(new Date('2026-11-11T11:00:00.000Z'))).toBe('2026-11-11')
    // The operating day turns over at the 05:00 cutoff, so 04:59 local on the 12th
    // is still 11/11 and 05:00 is already 12/11. The 17:00 service start is when
    // guests arrive, not when the day changes.
    expect(businessDateAt(new Date('2026-11-11T21:59:00.000Z'))).toBe('2026-11-11')
    expect(businessDateAt(new Date('2026-11-11T22:00:00.000Z'))).toBe('2026-11-12')
  })

  it('AC04 the badge resets with the operating day without deleting the old turns', async () => {
    const seated = await seatBooking('Khách hôm nay', [b3])
    await closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    expect(await badgeFor('B3')).toBe(1)

    // The next operating day starts the badge at zero.
    const nextDay = '2030-10-25'
    const tomorrow = await getFloorProjection(actor, nextDay, new Date(`${nextDay}T21:30:00+07:00`))
    expect(tomorrow.tables.find((row) => row.tableCode === 'B3')!.seatedTurnCount).toBe(0)
    // The row is still there: a reset badge is not deleted history.
    expect(await turns()).toHaveLength(1)
    const ranged = await listTableTurns(actor, {
      from: businessDate, to: nextDay, page: 1, pageSize: 50, countedOnly: true,
    })
    expect(ranged.completedTotal).toBe(1)
  })

  /* ---------------- AC05 ---------------- */

  it('AC05 the date-range query totals turns correctly, with pagination and permission', async () => {
    for (const name of ['Khách A', 'Khách B']) {
      const seated = await seatBooking(name, [b3], 2)
      await closeVisit(actor, {
        visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
      })
    }
    const seatedThird = await seatBooking('Khách C', [b4], 5)
    await closeVisit(actor, {
      visitId: seatedThird.visitId, expectedVersion: seatedThird.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })

    const all = await listTableTurns(actor, {
      from: businessDate, to: businessDate, page: 1, pageSize: 50, countedOnly: true,
    })
    expect(all.total).toBe(3)
    expect(all.completedTotal).toBe(3)
    expect(all.guestTotal).toBe(9)
    expect(all.turns).toHaveLength(3)
    expect(all.turns[0]).toMatchObject({ turnNo: 1, tableCodes: ['B4'], guestCount: 5, sourceCode: 'HOTLINE' })

    const paged = await listTableTurns(actor, {
      from: businessDate, to: businessDate, page: 2, pageSize: 2, countedOnly: true,
    })
    expect(paged.total).toBe(3)
    expect(paged.turns).toHaveLength(1)

    // A day with nothing returns zero rather than failing.
    const empty = await listTableTurns(actor, {
      from: '2030-01-01', to: '2030-01-02', page: 1, pageSize: 50, countedOnly: true,
    })
    expect(empty).toMatchObject({ total: 0, completedTotal: 0, guestTotal: 0, turns: [] })
  })

  it('AC05 the route validates its range and is gated on report.read', async () => {
    const receptionist = await login()
    // A receptionist reads the badge from the floor, not the statistics ledger.
    const refused = await receptionist.agent
      .get(`/api/v1/visits/turns?from=${businessDate}&to=${businessDate}`)
      .set('Origin', env.webOrigin)
    expect(refused.status).toBe(403)

    const owner = await login('integration_owner')
    const allowed = await owner.agent
      .get(`/api/v1/visits/turns?from=${businessDate}&to=${businessDate}`)
      .set('Origin', env.webOrigin)
    expect(allowed.status).toBe(200)
    expect(allowed.body).toMatchObject({ from: businessDate, to: businessDate, page: 1, pageSize: 50 })

    for (const query of [
      'from=2030-13-01&to=2030-10-24',
      `from=${businessDate}`,
      `from=2030-10-25&to=${businessDate}`,
      `from=${businessDate}&to=${businessDate}&page=0`,
      `from=${businessDate}&to=${businessDate}&pageSize=500`,
      `from=${businessDate}&to=${businessDate}&includeUncounted=maybe`,
      'from=2020-01-01&to=2030-01-01',
    ]) {
      const response = await owner.agent.get(`/api/v1/visits/turns?${query}`).set('Origin', env.webOrigin)
      expect(response.status, query).toBe(400)
    }
  })

  /* ---------------- AC06, AC08, AC09 ---------------- */

  it('AC06 a cluster of B3+B4+B5 earns one turn, not three', async () => {
    const cluster = await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4', 'B5'] })
    const seated = await seatBooking('Đoàn 12 khách', [b3], 12)
    await closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })

    const rows = await turns()
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.scope).toBe('GROUP')
    expect(Number(row.group_id)).toBe(cluster.group.groupId)
    expect(row.group_code_snapshot).toBe(cluster.group.displayCode)
    expect(json(row.member_table_ids)).toEqual([b3, b4, b5])
    expect(json(row.table_codes_snapshot)).toEqual(['B3', 'B4', 'B5'])

    // One badge for the cluster, and the same number on each member cell, so the
    // client draws it once on the anchor instead of three times.
    const projection = await getFloorProjection(actor, businessDate, checkInNow)
    expect(projection.groups.find((group) => group.id === cluster.group.groupId)?.seatedTurnCount).toBe(1)
    for (const code of ['B3', 'B4', 'B5']) expect(await badgeFor(code)).toBe(1)
  })

  it('AC09 Close Visit leaves the layout cluster standing, and the next party is turn 2', async () => {
    const cluster = await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4'] })
    const first = await seatBooking('Đoàn 1', [b3], 8)
    await closeVisit(actor, {
      visitId: first.visitId, expectedVersion: first.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    const [afterClose] = await databasePool.execute<(RowDataPacket & { dissolved_at: Date | null })[]>(
      'SELECT dissolved_at FROM table_groups WHERE id = ?', [cluster.group.groupId],
    )
    expect(afterClose[0]!.dissolved_at).toBeNull()

    const second = await seatBooking('Đoàn 2', [b4], 8)
    await closeVisit(actor, {
      visitId: second.visitId, expectedVersion: second.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    const rows = await turns()
    expect(rows.map((row) => Number(row.turn_no))).toEqual([1, 2])
    expect(rows.every((row) => Number(row.group_id) === cluster.group.groupId)).toBe(true)
    expect(await badgeFor('B3')).toBe(2)
  })

  it('AC08 a split leaves the old turns on the original cluster', async () => {
    const cluster = await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4'] })
    const seated = await seatBooking('Đoàn lịch sử', [b3], 8)
    await closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    await dissolveLayoutGroup(deviceActor, { groupId: cluster.group.groupId })

    const rows = await turns()
    expect(rows).toHaveLength(1)
    // The turn still names the cluster it happened on, by id and by code.
    expect(Number(rows[0]!.group_id)).toBe(cluster.group.groupId)
    expect(rows[0]!.group_code_snapshot).toBe(cluster.group.displayCode)
    expect(json(rows[0]!.member_table_ids)).toEqual([b3, b4])

    // The history does not migrate to the now-single tables, so their badge is 0.
    expect(await badgeFor('B3')).toBe(0)
    expect(await badgeFor('B4')).toBe(0)
    const ranged = await listTableTurns(actor, {
      from: businessDate, to: businessDate, page: 1, pageSize: 50, countedOnly: true,
    })
    expect(ranged.turns[0]).toMatchObject({ scope: 'GROUP', groupCode: cluster.group.displayCode })
  })

  /* ---------------- AC07 ---------------- */

  it('AC07 a repeated Close Visit writes no second turn', async () => {
    const seated = await seatBooking('Khách bấm hai lần', [b3])
    await closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    // The second close is refused by the visit's own state, long before the ledger.
    await expect(closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version + 1, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })).rejects.toMatchObject({ code: 'VISIT_ALREADY_CLOSED' })
    expect(await turns()).toHaveLength(1)
    expect(await badgeFor('B3')).toBe(1)
  })

  it('AC07 two devices closing the same visit at once write one turn', async () => {
    const seated = await seatBooking('Khách đồng thời', [b3])
    const close = () => closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    const outcomes = await Promise.allSettled([close(), close()])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(await turns()).toHaveLength(1)
    expect(await badgeFor('B3')).toBe(1)
  })

  it('AC07 two devices closing two visits on one table hand out distinct ordinals', async () => {
    const first = await seatBooking('Bàn B3 lượt 1', [b3])
    await closeVisit(actor, {
      visitId: first.visitId, expectedVersion: first.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })
    const second = await seatBooking('Bàn B3 lượt 2', [b3])
    const third = await seatBooking('Bàn B4 lượt 1', [b4])

    await Promise.all([
      closeVisit(actor, {
        visitId: second.visitId, expectedVersion: second.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
      }),
      closeVisit({ ...actor, authSessionId: 25_002 }, {
        visitId: third.visitId, expectedVersion: third.version, mode: 'MANUAL', reason: 'GUEST_LEFT',
      }),
    ])

    const rows = await turns()
    expect(rows).toHaveLength(3)
    // B3 got 1 and 2; B4 started its own sequence at 1.
    expect(rows.filter((row) => Number(row.table_id) === b3).map((row) => Number(row.turn_no)).sort())
      .toEqual([1, 2])
    expect(rows.filter((row) => Number(row.table_id) === b4).map((row) => Number(row.turn_no)))
      .toEqual([1])
    expect(await badgeFor('B3')).toBe(2)
    expect(await badgeFor('B4')).toBe(1)
  })

  /* ---------------- uncounted closes ---------------- */

  it('records an entry correction for history without counting it as a served turn', async () => {
    const seated = await seatBooking('Nhập sai', [b3])
    await closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version, mode: 'MANUAL', reason: 'ENTRY_ERROR',
    })
    const rows = await turns()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.end_reason).toBe('ENTRY_ERROR')
    expect(rows[0]!.completed_at).toBeNull()
    // Recorded, but it never served a party, so the badge stays at zero.
    expect(await badgeFor('B3')).toBe(0)
  })

  it('records the end-of-shift auto close without counting it', async () => {
    const seated = await seatBooking('Khách quên trả bàn', [b3])
    void seated
    await runBusinessDayEndSweep({
      organizationId: actor.organizationId,
      venueId: actor.venueId,
      now: new Date('2030-10-26T00:00:00.000Z'),
    })
    const rows = await turns()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.end_reason).toBe('BUSINESS_DAY_END')
    expect(rows[0]!.closed_by_user_id).toBeNull()
    // [?] Whether the end-of-shift close should count is unconfirmed; today it does not.
    expect(rows[0]!.completed_at).toBeNull()
    expect(await badgeFor('B3')).toBe(0)
    const ranged = await listTableTurns(actor, {
      from: businessDate, to: businessDate, page: 1, pageSize: 50, countedOnly: false,
    })
    expect(ranged.total).toBe(1)
    expect(ranged.completedTotal).toBe(0)
  })

  /* ---------------- AC10 ---------------- */

  it('AC10 a walk-in on an ad-hoc multi-table grouping still earns one turn', async () => {
    const walkIn = await createWalkIn(actor, {
      guestName: 'Walk-in ghép tay', partySize: 8, businessDate, tableIds: [b3, b4],
    })
    const [visitRows] = await databasePool.execute<(RowDataPacket & { version: number })[]>(
      'SELECT version FROM visits WHERE id = ?', [walkIn.visitId],
    )
    await closeVisit(actor, {
      visitId: walkIn.visitId,
      expectedVersion: Number(visitRows[0]!.version),
      mode: 'MANUAL',
      reason: 'GUEST_LEFT',
    })

    const rows = await turns()
    expect(rows).toHaveLength(1)
    // No layout cluster, so the turn is anchored on the lowest member id — the same
    // cell the client draws the cluster badge on.
    expect(rows[0]!.scope).toBe('TABLE')
    expect(Number(rows[0]!.table_id)).toBe(Math.min(b3, b4))
    expect(json(rows[0]!.member_table_ids)).toEqual([b3, b4])
    expect(rows[0]!.origin).toBe('WALK_IN')
    expect(rows[0]!.source_code).toBeNull()

    const projection = await getFloorProjection(actor, businessDate, checkInNow)
    expect(projection.tables.find((row) => row.tableCode === 'B3')!.seatedTurnCount).toBe(1)
  })

  it('AC10 a rolled-back close leaves no turn behind', async () => {
    const seated = await seatBooking('Khách xung đột', [b3])
    await expect(closeVisit(actor, {
      visitId: seated.visitId, expectedVersion: seated.version + 99, mode: 'MANUAL', reason: 'GUEST_LEFT',
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(await turns()).toHaveLength(0)
    expect(await badgeFor('B3')).toBe(0)
  })
})

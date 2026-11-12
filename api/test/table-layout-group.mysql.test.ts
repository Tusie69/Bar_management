/**
 * C1 — cụm bàn (layout cluster) independent of booking and visit.
 *
 * AC01 merge, AC02 split, AC03 lifecycle, AC04 capacity, AC05 permission and
 * spare tables, AC06 data safety and concurrency, AC07 the cross-zone flag,
 * AC10 regression of the older CLAIM grouping.
 *
 * AC08 (layout UI) and AC09 (the browser's SSE client) are covered on the web
 * side; what the server owes them is asserted here: the floor projection carries
 * an empty cluster with its code, members, seats and version, and the stream
 * cursor moves exactly once per committed mutation.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { AuthenticatedActor } from '../src/auth/authenticated-actor.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  assignBookingTables,
  checkInBooking,
  closeBooking,
  createAndAssignBooking,
  createBooking,
  createWalkIn,
} from '../src/modules/bookings/booking.repository.js'
import { getFloorProjection } from '../src/modules/tables/floor-projection.repository.js'
import {
  addLayoutGroupMembers,
  createLayoutGroup,
  dissolveLayoutGroup,
  getLayoutGroup,
  listLayoutGroups,
} from '../src/modules/tables/table-layout-group.repository.js'
import { closeVisit } from '../src/modules/visits/visit.repository.js'
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

/** A1 comes from the fixture; these are B3/B4/B5 plus a spare and a second zone. */
const b3 = 9830
const b4 = 9831
const b5 = 9832
const spare = 9833
const otherZoneTable = 9834
const otherZoneId = 9835
/** Inside the fixture business date, which check-in requires. */
const checkInNow = new Date(`${businessDate}T21:30:00+07:00`)
const deviceActor: AuthenticatedActor = { ...actor, authSessionId: 24_001 }

async function addTables(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, is_spare, pos_x, pos_y)
     VALUES
      (?, ?, ?, ?, 'B3', 'B3', 'TABLE', 4, 0, 10, 20),
      (?, ?, ?, ?, 'B4', 'B4', 'TABLE', 4, 0, 20, 20),
      (?, ?, ?, ?, 'B5', 'B5', 'TABLE', 4, 0, 30, 20),
      (?, ?, ?, ?, 'SP1', 'SP1', 'TABLE', 2, 1, 40, 20)`,
    [
      b3, actor.organizationId, actor.venueId, tableId,
      b4, actor.organizationId, actor.venueId, tableId,
      b5, actor.organizationId, actor.venueId, tableId,
      spare, actor.organizationId, actor.venueId, tableId,
    ],
  )
  await databasePool.execute(
    "INSERT INTO zones (id, organization_id, venue_id, code, name) VALUES (?, ?, ?, 'C', 'C')",
    [otherZoneId, actor.organizationId, actor.venueId],
  )
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'C1', 'C1', 'TABLE', 6, 50, 20)`,
    [otherZoneTable, actor.organizationId, actor.venueId, otherZoneId],
  )
}

async function groupRow(groupId: number): Promise<{
  origin: string
  dissolvedAt: Date | null
  version: number
  symbolNo: number
} | null> {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    origin: string; dissolved_at: Date | null; version: number; symbol_no: number
  })[]>('SELECT origin, dissolved_at, version, symbol_no FROM table_groups WHERE id = ?', [groupId])
  const row = rows[0]
  return row
    ? { origin: row.origin, dissolvedAt: row.dissolved_at, version: Number(row.version), symbolNo: Number(row.symbol_no) }
    : null
}

async function activeMemberTableIds(groupId: number): Promise<number[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & { table_id: number })[]>(
    'SELECT table_id FROM table_group_members WHERE group_id = ? AND left_at IS NULL ORDER BY table_id',
    [groupId],
  )
  return rows.map((row) => Number(row.table_id))
}

async function memberHistoryCount(groupId: number): Promise<number> {
  const [rows] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM table_group_members WHERE group_id = ?',
    [groupId],
  )
  return Number(rows[0]?.total ?? 0)
}

async function venueChangeSeq(): Promise<bigint> {
  const [rows] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
    [actor.organizationId, actor.venueId],
  )
  return BigInt(rows[0]!.change_seq)
}

async function auditChanges(action: string): Promise<Record<string, unknown>> {
  const [rows] = await databasePool.execute<(RowDataPacket & { changes: unknown })[]>(
    'SELECT changes FROM operation_log WHERE action = ? ORDER BY id DESC LIMIT 1',
    [action],
  )
  const raw = rows[0]?.changes
  const decoded: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  return (Array.isArray(decoded) ? decoded[0] : decoded) as Record<string, unknown>
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

mysqlDescribe('C1 layout table groups', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTables()
  })
  afterAll(clearFixture)

  /* ---------------- AC01: merge ---------------- */

  it('AC01 merges B3+B4+B5 with no guest details and reports the real total capacity', async () => {
    const before = await venueChangeSeq()
    const outcome = await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4', 'B5'] })

    expect(outcome.group.groupId).toBeGreaterThan(0)
    expect(outcome.group.groupCode).toBe(`TG-${outcome.group.groupId}`)
    expect(outcome.group.status).toBe('ACTIVE')
    expect(outcome.group.tableCodes).toEqual(['B3', 'B4', 'B5'])
    expect(outcome.group.tableIds).toEqual([b3, b4, b5])
    // 4 + 4 + 4, summed from dining_tables, never a constant.
    expect(outcome.group.totalCapacity).toBe(12)
    expect(outcome.group.inUseBy).toBeNull()
    expect(await activeMemberTableIds(outcome.group.groupId)).toEqual([b3, b4, b5])
    expect((await groupRow(outcome.group.groupId))?.origin).toBe('LAYOUT')
    // One committed mutation, one cursor step: what the SSE stream publishes.
    expect(await venueChangeSeq()).toBe(before + 1n)
  })

  it('AC01 accepts table ids as well as codes and needs no name, phone or party size', async () => {
    const outcome = await createLayoutGroup(deviceActor, { tableIds: [b4, b3] })
    expect(outcome.group.tableIds).toEqual([b3, b4])
    expect(outcome.group.totalCapacity).toBe(8)
    const [reservations] = await databasePool.execute<RowDataPacket[]>('SELECT id FROM reservations')
    const [visits] = await databasePool.execute<RowDataPacket[]>('SELECT id FROM visits')
    expect(reservations).toHaveLength(0)
    expect(visits).toHaveLength(0)
  })

  it('AC01 refuses one table, a repeated code and an unknown code', async () => {
    await expect(createLayoutGroup(deviceActor, { tableCodes: ['B3'] }))
      .rejects.toMatchObject({ code: 'MERGE_REQUIRES_MULTIPLE_TABLES', status: 400 })
    await expect(createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B3'] }))
      .rejects.toMatchObject({ code: 'DUPLICATE_TABLE_CODE', status: 400 })
    await expect(createLayoutGroup(deviceActor, { tableIds: [b3, b3, b4] }))
      .rejects.toMatchObject({ code: 'DUPLICATE_TABLE_CODE', status: 400 })
    await expect(createLayoutGroup(deviceActor, { tableCodes: ['B3', 'NOPE'] }))
      .rejects.toMatchObject({ code: 'TABLE_NOT_FOUND', status: 400 })
    const [groups] = await databasePool.execute<RowDataPacket[]>('SELECT id FROM table_groups')
    expect(groups).toHaveLength(0)
  })

  it('AC01/AC06 refuses a table that already belongs to another active cluster', async () => {
    const first = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    await expect(createLayoutGroup(deviceActor, { tableIds: [b4, b5] }))
      .rejects.toMatchObject({ code: 'TABLE_ALREADY_GROUPED', status: 409 })
    // The refusal changed nothing: the first cluster is intact and B5 is free.
    expect(await activeMemberTableIds(first.group.groupId)).toEqual([b3, b4])
    const [members] = await databasePool.execute<RowDataPacket[]>(
      'SELECT id FROM table_group_members WHERE table_id = ? AND left_at IS NULL', [b5],
    )
    expect(members).toHaveLength(0)
  })

  it('AC01 adds a table to a live cluster without dissolving it', async () => {
    const created = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    const added = await addLayoutGroupMembers(deviceActor, {
      groupId: created.group.groupId,
      version: created.group.version,
      tableCodes: ['B5'],
    })
    expect(added.group.groupId).toBe(created.group.groupId)
    expect(added.group.tableIds).toEqual([b3, b4, b5])
    expect(added.group.totalCapacity).toBe(12)
    expect(added.group.version).toBe(created.group.version + 1)
    expect((await groupRow(created.group.groupId))?.dissolvedAt).toBeNull()
  })

  it('AC06 refuses an add at a stale version and leaves the cluster untouched', async () => {
    const created = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    await expect(addLayoutGroupMembers(deviceActor, {
      groupId: created.group.groupId,
      version: created.group.version + 7,
      tableIds: [b5],
    })).rejects.toMatchObject({ code: 'TABLE_GROUP_VERSION_CONFLICT', status: 409 })
    expect(await activeMemberTableIds(created.group.groupId)).toEqual([b3, b4])
  })

  /* ---------------- AC05: permission and spare tables ---------------- */

  it('AC05 lets a receptionist with table.group.manage merge, and refuses CSKH with 403', async () => {
    const receptionist = await login()
    const allowed = await receptionist.agent.post('/api/v1/tables/groups')
      .set('Origin', env.webOrigin).set('X-CSRF-Token', receptionist.csrfToken)
      .send({ tableCodes: ['B3', 'B4'] })
    expect(allowed.status).toBe(201)

    const care = await login('integration_care')
    const refused = await care.agent.post('/api/v1/tables/groups')
      .set('Origin', env.webOrigin).set('X-CSRF-Token', care.csrfToken)
      .send({ tableCodes: ['B5', spare] })
    expect(refused.status).toBe(403)
    const [groups] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM table_groups',
    )
    expect(Number(groups[0]!.total)).toBe(1)
  })

  it('AC05 merges a spare table only once the warning is confirmed, and audits that', async () => {
    await expect(createLayoutGroup(deviceActor, { tableIds: [b3, spare] }))
      .rejects.toMatchObject({ code: 'SPARE_TABLE_OVERRIDE_REQUIRED', status: 409 })
    const [none] = await databasePool.execute<RowDataPacket[]>('SELECT id FROM table_groups')
    expect(none).toHaveLength(0)

    const outcome = await createLayoutGroup(deviceActor, {
      tableIds: [b3, spare],
      spareOverrideConfirmed: true,
    })
    expect(outcome.group.tableIds).toEqual([b3, spare])
    // 4 + 2, still from the tables' own data.
    expect(outcome.group.totalCapacity).toBe(6)
    const audit = await auditChanges('TABLE_GROUP_FORMED')
    expect(audit.spareOverrideConfirmed).toBe(true)
    expect(audit.spareTableCodes).toEqual(['SP1'])
  })

  it('AC05 never merges an empty table with one that already has a guest', async () => {
    await createWalkIn(actor, { guestName: 'Khách B3', partySize: 2, businessDate, tableIds: [b3] })
    await expect(createLayoutGroup(deviceActor, { tableIds: [b3, b4] }))
      .rejects.toMatchObject({ code: 'TABLE_GROUP_MIXED_STATE', status: 409 })
    const [groups] = await databasePool.execute<RowDataPacket[]>(
      "SELECT id FROM table_groups WHERE origin = 'LAYOUT'",
    )
    expect(groups).toHaveLength(0)
  })

  it('AC05 never merges two tables carrying two different bookings', async () => {
    await createAndAssignBooking(actor, { ...bookingInput('Khách B3'), tableIds: [b3] })
    await createAndAssignBooking(actor, { ...bookingInput('Khách B4'), tableIds: [b4] })
    await expect(createLayoutGroup(deviceActor, { tableIds: [b3, b4] }))
      .rejects.toMatchObject({ code: 'TABLE_GROUP_MULTIPLE_CLAIMS', status: 409 })
  })

  /* ---------------- AC07: cross-zone flag ---------------- */

  it('AC07 refuses a cross-zone merge while ALLOW_CROSS_ZONE_TABLE_MERGE is off', async () => {
    expect(env.tableGroups.allowCrossZoneMerge).toBe(false)
    await expect(createLayoutGroup(deviceActor, { tableIds: [b3, otherZoneTable] }))
      .rejects.toMatchObject({ code: 'CROSS_ZONE_MERGE_DISABLED', status: 409 })
    // Same-zone merging is unaffected by the flag being off.
    const same = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    expect(same.group.tableIds).toEqual([b3, b4])
  })

  /* ---------------- AC02 and AC03: split and lifecycle ---------------- */

  it('AC02 splits a cluster back to single tables and keeps the membership history', async () => {
    const created = await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4', 'B5'] })
    const groupId = created.group.groupId
    const before = await venueChangeSeq()

    const outcome = await dissolveLayoutGroup(deviceActor, { groupId, version: created.group.version })

    expect(outcome.status).toBe('DISSOLVED')
    expect(outcome.groupCode).toBe(`TG-${groupId}`)
    expect(outcome.releasedTableIds).toEqual([b3, b4, b5])
    expect(outcome.releasedTables).toEqual(['B3', 'B4', 'B5'])
    expect((await groupRow(groupId))?.dissolvedAt).not.toBeNull()
    expect(await activeMemberTableIds(groupId)).toEqual([])
    // Append-only: the member rows stay, they only gain left_at.
    expect(await memberHistoryCount(groupId)).toBe(3)
    expect(await venueChangeSeq()).toBe(before + 1n)

    // Dissolved means not ACTIVE, and the tables are free to merge again.
    expect((await listLayoutGroups(actor)).groups).toHaveLength(0)
    expect((await getLayoutGroup(actor, groupId)).group.status).toBe('DISSOLVED')
    const second = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    expect(second.group.groupId).not.toBe(groupId)
  })

  it('AC02/AC06 refuses a second split of the same cluster', async () => {
    const created = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    await dissolveLayoutGroup(deviceActor, { groupId: created.group.groupId })
    await expect(dissolveLayoutGroup(deviceActor, { groupId: created.group.groupId }))
      .rejects.toMatchObject({ code: 'TABLE_GROUP_ALREADY_DISSOLVED', status: 409 })
  })

  it('AC06 refuses a split while the cluster is serving a party', async () => {
    const created = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    const walkIn = await createWalkIn(actor, {
      guestName: 'Đang ngồi', partySize: 6, businessDate, tableIds: [b3],
    })
    await expect(dissolveLayoutGroup(deviceActor, { groupId: created.group.groupId }))
      .rejects.toMatchObject({ code: 'TABLE_GROUP_IN_USE', status: 409 })
    expect(await activeMemberTableIds(created.group.groupId)).toEqual([b3, b4])

    // Closing the visit frees the cluster to be split, but does not split it.
    await closeVisit(actor, { visitId: walkIn.visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    expect((await groupRow(created.group.groupId))?.dissolvedAt).toBeNull()
    const outcome = await dissolveLayoutGroup(deviceActor, { groupId: created.group.groupId })
    expect(outcome.releasedTableIds).toEqual([b3, b4])
  })

  it('AC03 keeps the cluster through Close Visit, Cancel, No-show and the business-day sweep', async () => {
    const created = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    const groupId = created.group.groupId

    // Guest A: booked on the cluster, checked in, then closed and paid up.
    const bookingA = await createAndAssignBooking(actor, { ...bookingInput('Khách A', 8), tableIds: [b3] })
    await checkInBooking(actor, bookingA.id, bookingA.version, checkInNow)
    const visitA = await databasePool.execute<(RowDataPacket & { visit_id: number })[]>(
      'SELECT visit_id FROM reservations WHERE id = ?', [bookingA.id],
    )
    const visitAId = Number(visitA[0][0]!.visit_id)
    await closeVisit(actor, { visitId: visitAId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    expect((await groupRow(groupId))?.dissolvedAt).toBeNull()

    // Guest B: a cancelled booking on the same cluster.
    const bookingB = await createAndAssignBooking(actor, { ...bookingInput('Khách B'), tableIds: [b4] })
    await closeBooking(actor, bookingB.id, bookingB.version, 'CANCELLED', 'Khách hủy')
    expect((await groupRow(groupId))?.dissolvedAt).toBeNull()

    // Guest C: a No-show on the same cluster.
    const bookingC = await createAndAssignBooking(actor, { ...bookingInput('Khách C'), tableIds: [b3] })
    await closeBooking(actor, bookingC.id, bookingC.version, 'NO_SHOW')
    expect((await groupRow(groupId))?.dissolvedAt).toBeNull()

    // End of the business day: the worker closes visits, never the layout.
    const bookingD = await createAndAssignBooking(actor, { ...bookingInput('Khách D'), tableIds: [b4] })
    await checkInBooking(actor, bookingD.id, bookingD.version, checkInNow)
    await runBusinessDayEndSweep({
      organizationId: actor.organizationId,
      venueId: actor.venueId,
      now: new Date('2030-10-26T00:00:00.000Z'),
    })
    expect((await groupRow(groupId))?.dissolvedAt).toBeNull()
    expect(await activeMemberTableIds(groupId)).toEqual([b3, b4])
  })

  it('AC03 keeps the cluster across a restart, because it is a row and not memory', async () => {
    const created = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    // Nothing in this process holds the cluster: a fresh read is what a restarted
    // server does, and it finds the same ACTIVE cluster with the same members.
    const listed = await listLayoutGroups(actor)
    expect(listed.groups).toHaveLength(1)
    expect(listed.groups[0]!.groupId).toBe(created.group.groupId)
    expect(listed.groups[0]!.status).toBe('ACTIVE')
    expect(listed.groups[0]!.tableIds).toEqual([b3, b4])
  })

  it('AC03 serves several parties one after another on one cluster', async () => {
    const created = await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4'] })
    const groupId = created.group.groupId

    for (const name of ['Lượt 1', 'Lượt 2', 'Lượt 3']) {
      const walkIn = await createWalkIn(actor, { guestName: name, partySize: 4, businessDate, tableIds: [b3] })
      // Booking one member books the whole cluster.
      const [allocations] = await databasePool.execute<(RowDataPacket & { table_id: number; group_id: number })[]>(
        `SELECT table_id, group_id FROM table_allocations
         WHERE visit_id = ? AND kind = 'USAGE' AND released_at IS NULL ORDER BY table_id`,
        [walkIn.visitId],
      )
      expect(allocations.map((row) => Number(row.table_id))).toEqual([b3, b4])
      expect(allocations.every((row) => Number(row.group_id) === groupId)).toBe(true)
      await closeVisit(actor, { visitId: walkIn.visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
      expect((await groupRow(groupId))?.dissolvedAt).toBeNull()
    }

    // Three visits of history survive, and the cluster is still the same one.
    const [visits] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM visits',
    )
    expect(Number(visits[0]!.total)).toBe(3)
    expect(await activeMemberTableIds(groupId)).toEqual([b3, b4])
  })

  it('AC02 leaves every past booking and visit intact after the split', async () => {
    const created = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    const booking = await createAndAssignBooking(actor, { ...bookingInput('Lịch sử'), tableIds: [b3] })
    await checkInBooking(actor, booking.id, booking.version, checkInNow)
    const [reservation] = await databasePool.execute<(RowDataPacket & { visit_id: number })[]>(
      'SELECT visit_id FROM reservations WHERE id = ?', [booking.id],
    )
    const visitId = Number(reservation[0]!.visit_id)
    await closeVisit(actor, { visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })

    const allocationsBefore = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM table_allocations',
    )
    await dissolveLayoutGroup(deviceActor, { groupId: created.group.groupId })

    const [reservationsAfter] = await databasePool.execute<(RowDataPacket & { id: number; status: string })[]>(
      'SELECT id, status FROM reservations',
    )
    expect(reservationsAfter).toHaveLength(1)
    expect(reservationsAfter[0]!.status).toBe('CHECKED_IN')
    const [visitsAfter] = await databasePool.execute<(RowDataPacket & { id: number; ended_at: Date | null })[]>(
      'SELECT id, ended_at FROM visits',
    )
    expect(visitsAfter).toHaveLength(1)
    expect(visitsAfter[0]!.ended_at).not.toBeNull()
    const allocationsAfter = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM table_allocations',
    )
    // The split writes no allocation row at all: it is a layout change.
    expect(Number(allocationsAfter[0][0]!.total)).toBe(Number(allocationsBefore[0][0]!.total))
  })

  /* ---------------- AC04: capacity ---------------- */

  it('AC04 refuses an over-capacity booking until it is confirmed, then saves it and audits it', async () => {
    // B3 seats 4; this is 6 guests on it.
    await expect(createAndAssignBooking(actor, { ...bookingInput('Vượt sức chứa', 6), tableIds: [b3] }))
      .rejects.toMatchObject({
        code: 'CAPACITY_OVERRIDE_REQUIRED',
        status: 409,
        details: { requestedGuests: 6, totalCapacity: 4, tableCodes: ['B3'] },
      })
    const [refused] = await databasePool.execute<RowDataPacket[]>(
      'SELECT id FROM reservations WHERE contact_name = ?', ['Vượt sức chứa'],
    )
    expect(refused).toHaveLength(0)

    const saved = await createAndAssignBooking(actor, {
      ...bookingInput('Vượt sức chứa', 6),
      tableIds: [b3],
      capacityOverrideConfirmed: true,
    })
    expect(saved.partySize).toBe(6)
    const audit = await auditChanges('RESERVATION_CREATED_AND_ASSIGNED')
    expect(audit.capacityOverride).toMatchObject({
      requestedGuests: 6,
      totalCapacity: 4,
      acknowledged: true,
    })
  })

  it('AC04 keeps every other rule: a positive party size, and no double booking', async () => {
    await expect(createWalkIn(actor, {
      guestName: 'Số khách sai', partySize: 0, businessDate, tableIds: [b3],
    })).rejects.toBeTruthy()

    await createWalkIn(actor, { guestName: 'Đã ngồi', partySize: 9, businessDate, tableIds: [b3], capacityOverrideConfirmed: true })
    // Over capacity is allowed with a confirmation; a second party on the same
    // table is still not, confirmation or no confirmation.
    await expect(createWalkIn(actor, {
      guestName: 'Chồng chéo', partySize: 2, businessDate, tableIds: [b3], capacityOverrideConfirmed: true,
    })).rejects.toMatchObject({ code: 'TABLE_ALREADY_OCCUPIED' })
  })

  it('AC04 gates an over-capacity assign on the same confirmation', async () => {
    const booking = await createBooking(actor, bookingInput('Gán vượt', 9))
    await expect(assignBookingTables(actor, booking.id, booking.version, [b3]))
      .rejects.toMatchObject({ code: 'CAPACITY_OVERRIDE_REQUIRED' })
    const assigned = await assignBookingTables(actor, booking.id, booking.version, [b3], true)
    expect(assigned.tableCodes).toEqual(['B3'])
  })

  /* ---------------- AC08/AC09: what the server owes the floor ---------------- */

  it('AC08 shows an empty cluster on the floor with its code, members, seats and version', async () => {
    const created = await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4', 'B5'] })
    const projection = await getFloorProjection(actor, businessDate, new Date(`${businessDate}T13:00:00.000Z`))

    const group = projection.groups.find((row) => row.id === created.group.groupId)
    expect(group).toMatchObject({
      origin: 'LAYOUT',
      version: created.group.version,
      tableIds: [b3, b4, b5],
      totalSeats: 12,
      isOutOfService: false,
      displayState: 'EMPTY',
      claim: null,
    })
    expect(group?.displayCode).toBe(created.group.displayCode)

    // Touching one member identifies the whole cluster.
    for (const id of [b3, b4, b5]) {
      const table = projection.tables.find((row) => row.tableId === id)
      expect(table?.groupId).toBe(created.group.groupId)
      expect(table?.groupMemberTableIds).toEqual([b3, b4, b5])
      expect(table?.groupDisplayCode).toBe(created.group.displayCode)
      // An empty cluster has no claim, so no tile claims to own one.
      expect(table?.claimOwner).toBeNull()
    }
  })

  it('AC08 keeps each member table its own operational state while the cluster has a guest', async () => {
    const created = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    const walkIn = await createWalkIn(actor, {
      guestName: 'Đoàn khách', partySize: 7, businessDate, tableIds: [b3], capacityOverrideConfirmed: true,
    })
    const projection = await getFloorProjection(actor, businessDate, new Date(`${businessDate}T13:00:00.000Z`))

    const group = projection.groups.find((row) => row.id === created.group.groupId)
    expect(group?.displayState).toBe('IN_USE')
    expect(group?.claim?.visitId).toBe(walkIn.visitId)
    // The cluster colour does not replace the member's own operational state.
    for (const id of [b3, b4]) {
      const table = projection.tables.find((row) => row.tableId === id)
      expect(table?.displayState).toBe('IN_USE')
      expect(table?.claim?.visitId).toBe(walkIn.visitId)
      expect(table?.claimOwner).toBe('GROUP')
    }
  })

  /* ---------------- AC06: concurrency ---------------- */

  it('AC06 lets only one of two devices claim the same table, with no half-written cluster', async () => {
    const [first, second] = await Promise.allSettled([
      createLayoutGroup(deviceActor, { tableIds: [b3, b4] }),
      createLayoutGroup({ ...actor, authSessionId: 24_002 }, { tableIds: [b4, b5] }),
    ])
    const fulfilled = [first, second].filter((outcome) => outcome.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)

    const [activeGroups] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM table_groups WHERE origin = 'LAYOUT' AND dissolved_at IS NULL",
    )
    expect(Number(activeGroups[0]!.total)).toBe(1)
    // B4 is in exactly one active cluster, which is the database's guarantee.
    const [b4Members] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM table_group_members WHERE table_id = ? AND left_at IS NULL', [b4],
    )
    expect(Number(b4Members[0]!.total)).toBe(1)
  })

  it('AC06 lets only one of two devices split the same cluster', async () => {
    const created = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    const outcomes = await Promise.allSettled([
      dissolveLayoutGroup(deviceActor, { groupId: created.group.groupId }),
      dissolveLayoutGroup({ ...actor, authSessionId: 24_002 }, { groupId: created.group.groupId }),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(await memberHistoryCount(created.group.groupId)).toBe(2)
    expect(await activeMemberTableIds(created.group.groupId)).toEqual([])
  })

  it('AC06 replays a double-clicked merge instead of forming two clusters', async () => {
    const receptionist = await login()
    const send = () => receptionist.agent.post('/api/v1/tables/groups')
      .set('Origin', env.webOrigin)
      .set('X-CSRF-Token', receptionist.csrfToken)
      .set('Idempotency-Key', 'double-click-0001')
      .send({ tableCodes: ['B3', 'B4'] })

    const first = await send()
    expect(first.status).toBe(201)
    const second = await send()
    expect(second.status).toBe(201)
    expect((second.body as { group: { groupId: number } }).group.groupId)
      .toBe((first.body as { group: { groupId: number } }).group.groupId)
    const [groups] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM table_groups WHERE origin = 'LAYOUT'",
    )
    expect(Number(groups[0]!.total)).toBe(1)
  })

  it('AC06 rolls the whole merge back when one member is invalid', async () => {
    const before = await venueChangeSeq()
    await expect(createLayoutGroup(deviceActor, { tableIds: [b3, b4, 999_999] }))
      .rejects.toMatchObject({ code: 'TABLE_NOT_FOUND' })
    const [groups] = await databasePool.execute<RowDataPacket[]>('SELECT id FROM table_groups')
    const [members] = await databasePool.execute<RowDataPacket[]>('SELECT id FROM table_group_members')
    expect(groups).toHaveLength(0)
    expect(members).toHaveLength(0)
    // No cursor step, so the SSE stream publishes nothing for a rolled-back write.
    expect(await venueChangeSeq()).toBe(before)
  })

  /* ---------------- AC10: regression ---------------- */

  it('AC10 leaves the older CLAIM grouping and its auto-dissolve alone', async () => {
    const walkIn = await createWalkIn(actor, {
      guestName: 'Nhóm cũ', partySize: 8, businessDate, tableIds: [b3, b4],
    })
    const [allocations] = await databasePool.execute<(RowDataPacket & { group_id: number })[]>(
      `SELECT group_id FROM table_allocations
       WHERE visit_id = ? AND kind = 'USAGE' AND released_at IS NULL AND group_id IS NOT NULL LIMIT 1`,
      [walkIn.visitId],
    )
    const claimGroupId = Number(allocations[0]!.group_id)
    expect((await groupRow(claimGroupId))?.origin).toBe('CLAIM')
    expect(await activeMemberTableIds(claimGroupId)).toEqual([])

    // A CLAIM cluster still dissolves by itself once nothing uses it.
    await closeVisit(actor, { visitId: walkIn.visitId, expectedVersion: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    expect((await groupRow(claimGroupId))?.dissolvedAt).not.toBeNull()
  })

  it('AC10 keeps a LAYOUT symbol reserved venue-wide so two clusters never share a mark', async () => {
    const layout = await createLayoutGroup(deviceActor, { tableIds: [b3, b4] })
    // A booking on other tables forms a CLAIM cluster, which must take the next
    // symbol rather than reuse the layout cluster's.
    await createAndAssignBooking(actor, {
      ...bookingInput('Nhóm booking', 8),
      // A1 from the fixture sits in the same zone as B3-B5, so this is a plain
      // same-zone booking: the point here is the symbol, not the zone rule.
      tableIds: [b5, tableId],
    })
    const [symbols] = await databasePool.execute<(RowDataPacket & { symbol_no: number })[]>(
      'SELECT symbol_no FROM table_groups WHERE dissolved_at IS NULL ORDER BY symbol_no',
    )
    expect(symbols.map((row) => Number(row.symbol_no))).toEqual([1, 2])
    expect((await groupRow(layout.group.groupId))?.symbolNo).toBe(1)
  })
})

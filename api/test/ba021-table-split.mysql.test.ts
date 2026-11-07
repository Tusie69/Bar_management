import type { RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { AuthenticatedActor } from '../src/auth/authenticated-actor.js'
import { app } from '../src/app.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  assignBookingTables,
  closeBooking,
  createBooking,
  createWalkIn,
  mergeBookingTables,
} from '../src/modules/bookings/booking.repository.js'
import { getUndoState } from '../src/modules/operations/operation.repository.js'
import { splitTableGroup } from '../src/modules/tables/table-split.repository.js'
import { closeVisit, mergeVisitTables } from '../src/modules/visits/visit.repository.js'
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

const tableTwoId = 9820
const tableThreeId = 9821
const deviceSessionId = 21_001
const deviceActor: AuthenticatedActor = { ...actor, authSessionId: deviceSessionId }

async function addTables(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES
      (?, ?, ?, ?, 'S2', 'S2', 'TABLE', 4, 20, 60),
      (?, ?, ?, ?, 'S3', 'S3', 'TABLE', 4, 30, 60)`,
    [
      tableTwoId, actor.organizationId, actor.venueId, tableId,
      tableThreeId, actor.organizationId, actor.venueId, tableId,
    ],
  )
}

/** Active USAGE tables of a visit, ordered. */
async function activeVisitTables(visitId: number): Promise<number[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & { table_id: number })[]>(
    `SELECT table_id FROM table_allocations
     WHERE visit_id = ? AND kind = 'USAGE' AND released_at IS NULL ORDER BY table_id`,
    [visitId],
  )
  return rows.map((row) => Number(row.table_id))
}

async function activeReservationTables(reservationId: number): Promise<number[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & { table_id: number })[]>(
    `SELECT a.table_id FROM table_allocations AS a
     JOIN table_holds AS h ON h.venue_id = a.venue_id AND h.id = a.hold_id
     WHERE h.reservation_id = ? AND h.status = 'ACTIVE' AND a.released_at IS NULL
     ORDER BY a.table_id`,
    [reservationId],
  )
  return rows.map((row) => Number(row.table_id))
}

async function groupRow(groupId: number): Promise<{ dissolved: boolean; symbolNo: number } | null> {
  const [rows] = await databasePool.execute<(RowDataPacket & { dissolved_at: Date | null; symbol_no: number })[]>(
    'SELECT dissolved_at, symbol_no FROM table_groups WHERE id = ?',
    [groupId],
  )
  const row = rows[0]
  return row ? { dissolved: row.dissolved_at !== null, symbolNo: Number(row.symbol_no) } : null
}

async function venueChangeSeq(): Promise<bigint> {
  const [rows] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
    [actor.organizationId, actor.venueId],
  )
  return BigInt(rows[0]!.change_seq)
}

async function mergedVisit(tables: number[]): Promise<{ visitId: number; groupId: number }> {
  const walkIn = await createWalkIn(actor, {
    guestName: 'BA021 split', partySize: 4, businessDate, tableIds: [tables[0]!],
  })
  const merged = await mergeVisitTables(deviceActor, {
    visitId: walkIn.visitId, expectedVersion: 1, tableIds: tables,
  })
  return { visitId: walkIn.visitId, groupId: merged.group.id }
}

mysqlDescribe('BA-021 table group Split', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTables()
  })
  afterAll(clearFixture)

  // SPLIT-01: the approved core case — keep one table, release the rest.
  it('keeps one table, releases the rest with reason SPLIT and dissolves the group', async () => {
    const { visitId, groupId } = await mergedVisit([tableId, tableTwoId])
    expect(await activeVisitTables(visitId)).toEqual([tableId, tableTwoId])
    const before = await venueChangeSeq()

    const outcome = await splitTableGroup(deviceActor, { groupId, keepTableIds: [tableId] })

    expect(outcome.keptTableIds).toEqual([tableId])
    expect(outcome.releasedTableIds).toEqual([tableTwoId])
    expect(outcome.group).toBeNull()
    expect(outcome.undoable).toBe(false)
    expect(await activeVisitTables(visitId)).toEqual([tableId])
    expect((await groupRow(groupId))?.dissolved).toBe(true)
    expect(await venueChangeSeq()).toBe(before + 1n)

    // Released rows stay, so usage history survives the split.
    const [released] = await databasePool.execute<(RowDataPacket & { table_id: number; release_reason: string })[]>(
      `SELECT table_id, release_reason FROM table_allocations
       WHERE visit_id = ? AND released_at IS NOT NULL ORDER BY table_id`,
      [visitId],
    )
    expect(released.map((row) => [Number(row.table_id), row.release_reason]))
      .toEqual([[tableId, 'SPLIT'], [tableTwoId, 'SPLIT']])

    const [audit] = await databasePool.execute<(RowDataPacket & {
      action: string; entity_type: string; entity_id: number; is_undoable: number
    })[]>(
      `SELECT action, entity_type, entity_id, is_undoable FROM operation_log
       WHERE action = 'TABLES_SPLIT' AND auth_session_id = ?`,
      [deviceSessionId],
    )
    expect(audit).toHaveLength(1)
    expect(audit[0]?.entity_type).toBe('table_group')
    expect(Number(audit[0]?.entity_id)).toBe(groupId)
    expect(Number(audit[0]?.is_undoable)).toBe(0)
  })

  // Keeping two or more tables leaves them merged under a fresh group symbol.
  it('re-groups the kept tables when more than one stays with the party', async () => {
    const { visitId, groupId } = await mergedVisit([tableId, tableTwoId, tableThreeId])

    const outcome = await splitTableGroup(deviceActor, { groupId, keepTableIds: [tableId, tableTwoId] })

    expect(outcome.group).not.toBeNull()
    expect(outcome.group?.id).not.toBe(groupId)
    expect(outcome.group?.tableIds).toEqual([tableId, tableTwoId])
    expect(await activeVisitTables(visitId)).toEqual([tableId, tableTwoId])
    expect((await groupRow(groupId))?.dissolved).toBe(true)
    expect((await groupRow(outcome.group!.id))?.dissolved).toBe(false)
  })

  // SPLIT-03/04: input the contract forbids is refused without any mutation.
  it('refuses an empty keep list and a table outside the group', async () => {
    const { visitId, groupId } = await mergedVisit([tableId, tableTwoId])

    await expect(splitTableGroup(deviceActor, { groupId, keepTableIds: [] }))
      .rejects.toMatchObject({ code: 'SPLIT_REQUIRES_KEPT_TABLE' })
    await expect(splitTableGroup(deviceActor, { groupId, keepTableIds: [tableThreeId] }))
      .rejects.toMatchObject({ code: 'SPLIT_TABLE_NOT_IN_GROUP' })

    expect(await activeVisitTables(visitId)).toEqual([tableId, tableTwoId])
    expect((await groupRow(groupId))?.dissolved).toBe(false)
  })

  // SPLIT-05: an unknown or already dissolved group is not resurrected.
  it('refuses an unknown group and a group already split', async () => {
    const { groupId } = await mergedVisit([tableId, tableTwoId])
    await expect(splitTableGroup(deviceActor, { groupId: 9_999_999, keepTableIds: [tableId] }))
      .rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' })

    await splitTableGroup(deviceActor, { groupId, keepTableIds: [tableId] })
    await expect(splitTableGroup(deviceActor, { groupId, keepTableIds: [tableId] }))
      .rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' })
  })

  // SPLIT-06: concurrency — one winner, one audit row, no orphan allocation.
  it('lets only one of two concurrent splits win', async () => {
    const { visitId, groupId } = await mergedVisit([tableId, tableTwoId])

    const results = await Promise.allSettled([
      splitTableGroup(deviceActor, { groupId, keepTableIds: [tableId] }),
      splitTableGroup(deviceActor, { groupId, keepTableIds: [tableTwoId] }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const [audit] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM operation_log WHERE action = 'TABLES_SPLIT' AND entity_id = ?",
      [groupId],
    )
    expect(Number(audit[0]?.total)).toBe(1)
    // Exactly one table remains, and it has no dangling group identity.
    const remaining = await activeVisitTables(visitId)
    expect(remaining).toHaveLength(1)
    const [orphans] = await databasePool.execute<RowDataPacket[]>(
      `SELECT a.id FROM table_allocations AS a
       JOIN table_groups AS g ON g.venue_id = a.venue_id AND g.id = a.group_id
       WHERE a.visit_id = ? AND a.released_at IS NULL AND g.dissolved_at IS NOT NULL`,
      [visitId],
    )
    expect(orphans).toEqual([])
  })

  // SPLIT-07: a booking HOLD group splits too, keeping the same hold active.
  it('splits a booking hold group and keeps the hold active', async () => {
    const created = await createBooking(actor, {
      guestName: 'BA021 booking split',
      partySize: 4,
      expectedAt: `${businessDate}T21:00:00+07:00`,
      businessDate,
      sourceCode: 'HOTLINE',
    })
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    const merged = await mergeBookingTables(deviceActor, assigned.id, assigned.version, [tableId, tableTwoId])

    const outcome = await splitTableGroup(deviceActor, {
      groupId: merged.group.id, keepTableIds: [tableId],
    })

    expect(outcome.owner.kind).toBe('HOLD')
    expect(await activeReservationTables(created.id)).toEqual([tableId])
    const [holds] = await databasePool.execute<(RowDataPacket & { status: string; version: number })[]>(
      "SELECT status, version FROM table_holds WHERE reservation_id = ? AND status = 'ACTIVE'",
      [created.id],
    )
    expect(holds).toHaveLength(1)
    expect(Number(holds[0]?.version)).toBe(outcome.owner.version)
  })

  // A closed owner must not be reopened by a split.
  it('refuses to split once the visit is closed or the booking cancelled', async () => {
    const { visitId, groupId } = await mergedVisit([tableId, tableTwoId])
    await closeVisit(actor, { visitId, expectedVersion: 2, mode: 'MANUAL', reason: 'GUEST_LEFT' })
    await expect(splitTableGroup(deviceActor, { groupId, keepTableIds: [tableId] }))
      .rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' })

    const created = await createBooking(actor, {
      guestName: 'BA021 cancelled split',
      partySize: 4,
      expectedAt: `${businessDate}T21:30:00+07:00`,
      businessDate,
      sourceCode: 'HOTLINE',
    })
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableTwoId])
    const merged = await mergeBookingTables(deviceActor, assigned.id, assigned.version, [tableTwoId, tableThreeId])
    await closeBooking(actor, created.id, merged.booking.version, 'CANCELLED', 'BA021 test cancel')
    await expect(splitTableGroup(deviceActor, { groupId: merged.group.id, keepTableIds: [tableTwoId] }))
      .rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' })
  })

  // BA-020 must stay closed: a Split is not undoable, and it is not offered as one.
  it('does not offer a split as an undoable operation', async () => {
    const { groupId } = await mergedVisit([tableId, tableTwoId])
    expect((await getUndoState(deviceActor)).undo?.action).toBe('VISIT_TABLES_MERGED')

    await splitTableGroup(deviceActor, { groupId, keepTableIds: [tableId] })

    expect(await getUndoState(deviceActor)).toEqual({ undo: null, redo: null })
  })

  // SPLIT-09: transport security on the HTTP route.
  it('enforces authentication, RBAC and CSRF on the split route', async () => {
    const { groupId } = await mergedVisit([tableId, tableTwoId])
    const path = `/api/v1/tables/groups/${groupId}/split`

    expect((await request(app).post(path).set('Origin', env.webOrigin).send({ keepTableIds: [tableId] })).status)
      .toBe(401)

    const care = await login('integration_care')
    expect((await care.agent.post(path).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', care.csrfToken).send({ keepTableIds: [tableId] })).status).toBe(403)

    const receptionist = await login()
    // Missing CSRF token is refused before any mutation.
    expect((await receptionist.agent.post(path).set('Origin', env.webOrigin)
      .send({ keepTableIds: [tableId] })).status).toBe(403)
    expect((await groupRow(groupId))?.dissolved).toBe(false)

    const accepted = await receptionist.agent.post(path).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', receptionist.csrfToken).send({ keepTableIds: [tableId] })
    expect(accepted.status).toBe(200)
    expect((accepted.body as { keptTableIds: number[] }).keptTableIds).toEqual([tableId])
    expect((await groupRow(groupId))?.dissolved).toBe(true)
  })

  // A malformed body is rejected with 400, not a 500.
  it('rejects a malformed split body', async () => {
    const { groupId } = await mergedVisit([tableId, tableTwoId])
    const receptionist = await login()
    const response = await receptionist.agent.post(`/api/v1/tables/groups/${groupId}/split`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', receptionist.csrfToken).send({})
    expect(response.status).toBe(400)
    expect((response.body as { error: { code: string } }).error.code).toBe('TABLES_REQUIRED')
  })
})

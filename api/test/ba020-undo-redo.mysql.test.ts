import type { RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { AuthenticatedActor } from '../src/auth/authenticated-actor.js'
import { databasePool } from '../src/database/pool.js'
import { env } from '../src/config/env.js'
import { app } from '../src/app.js'
import {
  assignBookingTables,
  createBooking,
  closeBooking,
  createWalkIn,
  getBookingById,
  mergeBookingTables,
} from '../src/modules/bookings/booking.repository.js'
import { compensateOperation, getUndoState } from '../src/modules/operations/operation.repository.js'
import { mergeVisitTables, moveVisit } from '../src/modules/visits/visit.repository.js'
import {
  actor,
  businessDate,
  clearFixture,
  initializeFixture,
  login,
  otherOrganizationId,
  otherVenueId,
  resetFixture,
  tableId,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip
const tableTwoId = 9810
const tableThreeId = 9811
const tableFourId = 9812
const tableFiveId = 9813
const deviceSessionId = 20_001
const deviceActor: AuthenticatedActor = { ...actor, authSessionId: deviceSessionId }

function bookingInput(name: string) {
  return {
    guestName: name,
    partySize: 4,
    expectedAt: `${businessDate}T21:00:00+07:00`,
    businessDate,
    sourceCode: 'HOTLINE',
  }
}

async function addTables(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES
      (?, ?, ?, ?, 'A2', 'A2', 'TABLE', 4, 20, 10),
      (?, ?, ?, ?, 'A3', 'A3', 'TABLE', 4, 30, 10),
      (?, ?, ?, ?, 'A4', 'A4', 'TABLE', 4, 40, 10),
      (?, ?, ?, ?, 'A5', 'A5', 'TABLE', 4, 50, 10)`,
    [
      tableTwoId, actor.organizationId, actor.venueId, tableId,
      tableThreeId, actor.organizationId, actor.venueId, tableId,
      tableFourId, actor.organizationId, actor.venueId, tableId,
      tableFiveId, actor.organizationId, actor.venueId, tableId,
    ],
  )
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

async function activeVisitTables(visitId: number): Promise<number[]> {
  const [rows] = await databasePool.execute<(RowDataPacket & { table_id: number })[]>(
    `SELECT table_id FROM table_allocations
     WHERE visit_id = ? AND kind = 'USAGE' AND released_at IS NULL ORDER BY table_id`,
    [visitId],
  )
  return rows.map((row) => Number(row.table_id))
}

mysqlDescribe('BA-020 server-authoritative Undo/Redo', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTables()
  })
  afterAll(clearFixture)

  it('undoes and redoes a booking reassignment and records an append-only compensation chain', async () => {
    const created = await createBooking(actor, bookingInput('BA020 booking move'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    await assignBookingTables(deviceActor, assigned.id, assigned.version, [tableTwoId])
    const state = await getUndoState(deviceActor)
    expect(state.undo?.action).toBe('RESERVATION_TABLES_REASSIGNED')
    expect(state.redo).toBeNull()

    const undo = await compensateOperation(deviceActor, state.undo!.operationId, 'undo')
    expect(await activeReservationTables(created.id)).toEqual([tableId])
    expect((await getUndoState(deviceActor)).redo?.operationId).toBe(undo.operationId)
    const redo = await compensateOperation(deviceActor, undo.operationId, 'redo')
    expect(await activeReservationTables(created.id)).toEqual([tableTwoId])
    expect((await getUndoState(deviceActor)).undo?.operationId).toBe(redo.operationId)

    const [audit] = await databasePool.execute<(RowDataPacket & {
      id: number
      action: string
      compensates_operation_id: number | null
    })[]>(
      `SELECT id, action, compensates_operation_id FROM operation_log
       WHERE auth_session_id = ? ORDER BY id`,
      [deviceSessionId],
    )
    expect(audit.map((row) => row.action)).toEqual([
      'RESERVATION_TABLES_REASSIGNED',
      'UNDO_RESERVATION_TABLES_REASSIGNED',
      'REDO_RESERVATION_TABLES_REASSIGNED',
    ])
    expect(Number(audit[1]?.compensates_operation_id)).toBe(Number(audit[0]?.id))
    expect(Number(audit[2]?.compensates_operation_id)).toBe(Number(audit[1]?.id))
  })

  it('undoes and redoes booking merge, visit move, and visit merge operations', async () => {
    const created = await createBooking(actor, bookingInput('BA020 booking merge'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    await mergeBookingTables(deviceActor, assigned.id, assigned.version, [tableId, tableTwoId])
    const bookingUndo = await compensateOperation(deviceActor, (await getUndoState(deviceActor)).undo!.operationId, 'undo')
    expect(await activeReservationTables(created.id)).toEqual([tableId])
    await compensateOperation(deviceActor, bookingUndo.operationId, 'redo')
    expect(await activeReservationTables(created.id)).toEqual([tableId, tableTwoId])

    const movingVisit = await createWalkIn(actor, {
      guestName: 'BA020 visit move', partySize: 4, businessDate, tableIds: [tableThreeId],
    })
    await moveVisit(deviceActor, { visitId: movingVisit.visitId, expectedVersion: 1, tableIds: [tableFourId] })
    const moveUndo = await compensateOperation(deviceActor, (await getUndoState(deviceActor)).undo!.operationId, 'undo')
    expect(await activeVisitTables(movingVisit.visitId)).toEqual([tableThreeId])
    await compensateOperation(deviceActor, moveUndo.operationId, 'redo')
    expect(await activeVisitTables(movingVisit.visitId)).toEqual([tableFourId])

    const mergingVisit = await createWalkIn(actor, {
      guestName: 'BA020 visit merge', partySize: 4, businessDate, tableIds: [tableThreeId],
    })
    await mergeVisitTables(deviceActor, {
      visitId: mergingVisit.visitId, expectedVersion: 1, tableIds: [tableThreeId, tableFiveId],
    })
    const mergeUndo = await compensateOperation(deviceActor, (await getUndoState(deviceActor)).undo!.operationId, 'undo')
    expect(await activeVisitTables(mergingVisit.visitId)).toEqual([tableThreeId])
    await compensateOperation(deviceActor, mergeUndo.operationId, 'redo')
    expect(await activeVisitTables(mergingVisit.visitId)).toEqual([tableThreeId, tableFiveId])
  })

  it('rejects another device and an actor conflict without partial mutation', async () => {
    const created = await createBooking(actor, bookingInput('BA020 conflict source'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    await assignBookingTables(deviceActor, assigned.id, assigned.version, [tableTwoId])
    const operationId = (await getUndoState(deviceActor)).undo!.operationId
    await expect(compensateOperation({ ...actor, authSessionId: 20_002 }, operationId, 'undo'))
      .rejects.toMatchObject({ code: 'NOT_LATEST_DEVICE_OPERATION' })

    const other = await createBooking(actor, bookingInput('BA020 conflict owner'))
    await assignBookingTables(actor, other.id, other.version, [tableId])
    await expect(compensateOperation(deviceActor, operationId, 'undo'))
      .rejects.toMatchObject({ code: 'UNDO_CONFLICT_MODIFIED' })
    expect(await activeReservationTables(created.id)).toEqual([tableTwoId])
    expect(await activeReservationTables(other.id)).toEqual([tableId])
  })

  it('invalidates redo after a new same-device operation', async () => {
    const created = await createBooking(actor, bookingInput('BA020 redo invalidation'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    await assignBookingTables(deviceActor, assigned.id, assigned.version, [tableTwoId])
    const undo = await compensateOperation(deviceActor, (await getUndoState(deviceActor)).undo!.operationId, 'undo')
    expect((await getUndoState(deviceActor)).redo?.operationId).toBe(undo.operationId)
    const current = await getBookingById(deviceActor, created.id)
    await mergeBookingTables(deviceActor, current.id, current.version, [tableId, tableThreeId])
    const afterNewOperation = await getUndoState(deviceActor)
    expect(afterNewOperation.redo).toBeNull()
    expect(afterNewOperation.undo?.action).toBe('RESERVATION_TABLES_MERGED')
  })

  // UNDO-03: an untouched session has nothing to compensate and must not guess one.
  it('reports no undo candidate and refuses compensation without a prior operation', async () => {
    const fresh: AuthenticatedActor = { ...actor, authSessionId: 20_010 }
    expect(await getUndoState(fresh)).toEqual({ undo: null, redo: null })
    await expect(compensateOperation(fresh, 1, 'undo'))
      .rejects.toMatchObject({ code: 'NOT_LATEST_DEVICE_OPERATION' })
  })

  // UNDO-05/17: an operation is owned by one session inside one organization and venue.
  it('isolates undo state across sessions, venues and organizations', async () => {
    const created = await createBooking(actor, bookingInput('BA020 isolation'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    await assignBookingTables(deviceActor, assigned.id, assigned.version, [tableTwoId])
    const operationId = (await getUndoState(deviceActor)).undo!.operationId

    // Same session id, different venue and different organization: not visible, not compensable.
    for (const stranger of [
      { ...deviceActor, venueId: otherVenueId },
      { ...deviceActor, organizationId: otherOrganizationId },
    ] as AuthenticatedActor[]) {
      expect(await getUndoState(stranger)).toEqual({ undo: null, redo: null })
      await expect(compensateOperation(stranger, operationId, 'undo'))
        .rejects.toMatchObject({ code: 'NOT_LATEST_DEVICE_OPERATION' })
    }
    // A request with no resolvable device session is refused rather than defaulted.
    const sessionless: AuthenticatedActor = { ...deviceActor }
    delete (sessionless as { authSessionId?: number }).authSessionId
    await expect(compensateOperation(sessionless, operationId, 'undo'))
      .rejects.toMatchObject({ code: 'UNDO_SESSION_REQUIRED' })
    expect(await activeReservationTables(created.id)).toEqual([tableTwoId])
  })

  // UNDO-07/08: concurrent compensation of one operation commits exactly once.
  it('lets only one of two concurrent undos win and compensates once', async () => {
    const created = await createBooking(actor, bookingInput('BA020 concurrent undo'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    await assignBookingTables(deviceActor, assigned.id, assigned.version, [tableTwoId])
    const operationId = (await getUndoState(deviceActor)).undo!.operationId

    const results = await Promise.allSettled([
      compensateOperation(deviceActor, operationId, 'undo'),
      compensateOperation(deviceActor, operationId, 'undo'),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await activeReservationTables(created.id)).toEqual([tableId])
    const [compensations] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM operation_log WHERE compensates_operation_id = ?',
      [operationId],
    )
    expect(Number(compensations[0]?.total)).toBe(1)
  })

  // UNDO-15: a booking cancelled after the operation must not be silently resurrected.
  it('refuses to undo a table move once the booking has been cancelled', async () => {
    const created = await createBooking(actor, bookingInput('BA020 cancelled booking'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    const moved = await assignBookingTables(deviceActor, assigned.id, assigned.version, [tableTwoId])
    const operationId = (await getUndoState(deviceActor)).undo!.operationId
    await closeBooking(actor, created.id, moved.version, 'CANCELLED', 'BA020 test cancel')

    await expect(compensateOperation(deviceActor, operationId, 'undo'))
      .rejects.toMatchObject({ code: 'UNDO_CONFLICT_MODIFIED' })
    expect(await activeReservationTables(created.id)).toEqual([])
  })

  // UNDO-24: compensation restores allocations on the operation's own business date.
  it('keeps compensation on the original business date across midnight', async () => {
    const lateInput = {
      ...bookingInput('BA020 cross midnight'),
      expectedAt: `${businessDate}T23:45:00+07:00`,
    }
    const created = await createBooking(actor, lateInput)
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    await assignBookingTables(deviceActor, assigned.id, assigned.version, [tableTwoId])
    await compensateOperation(deviceActor, (await getUndoState(deviceActor)).undo!.operationId, 'undo')

    const [rows] = await databasePool.execute<(RowDataPacket & { business_date: Date | string; table_id: number })[]>(
      `SELECT a.business_date, a.table_id FROM table_allocations AS a
       JOIN table_holds AS h ON h.venue_id = a.venue_id AND h.id = a.hold_id
       WHERE h.reservation_id = ? AND a.released_at IS NULL`,
      [created.id],
    )
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]?.table_id)).toBe(tableId)
    const restored = rows[0]!.business_date
    const asText = restored instanceof Date ? restored.toISOString().slice(0, 10) : String(restored).slice(0, 10)
    expect(asText).toBe(businessDate)
  })

  it('enforces auth, CSRF, RBAC and idempotently replays one committed HTTP undo', async () => {
    expect((await request(app).get('/api/v1/operations/undo-state').set('Origin', env.webOrigin)).status).toBe(401)
    const care = await login('integration_care')
    expect((await care.agent.get('/api/v1/operations/undo-state').set('Origin', env.webOrigin)).status).toBe(403)

    const created = await createBooking(actor, bookingInput('BA020 HTTP'))
    const assigned = await assignBookingTables(actor, created.id, created.version, [tableId])
    const receptionist = await login()
    const move = await receptionist.agent.post(`/api/v1/bookings/${created.id}/assign`)
      .set('Origin', env.webOrigin).set('X-CSRF-Token', receptionist.csrfToken)
      .send({ version: assigned.version, tableIds: [tableTwoId] })
    expect(move.status).toBe(200)
    const state = await receptionist.agent.get('/api/v1/operations/undo-state').set('Origin', env.webOrigin)
    const operationId = Number((state.body as { undo: { operationId: number } }).undo.operationId)
    expect((await receptionist.agent.post('/api/v1/operations/undo').set('Origin', env.webOrigin)
      .send({ operationId })).status).toBe(403)

    const key = 'ba020_http_replay_0001'
    const first = await receptionist.agent.post('/api/v1/operations/undo').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', receptionist.csrfToken).set('Idempotency-Key', key).send({ operationId })
    expect(first.status).toBe(200)
    const replay = await receptionist.agent.post('/api/v1/operations/undo').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', receptionist.csrfToken).set('Idempotency-Key', key).send({ operationId })
    expect(replay.status).toBe(200)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(replay.body).toEqual(first.body)
    expect(await activeReservationTables(created.id)).toEqual([tableId])
  })
})

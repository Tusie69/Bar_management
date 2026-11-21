import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { Response } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createWalkIn } from '../src/modules/bookings/booking.repository.js'
import { resetFloorChangeStream, subscribeToFloorChanges } from '../src/modules/tables/floor-change-stream.js'
import {
  actor, businessDate, clearFixture, initializeFixture, loginAtPortal, resetFixture,
  seedFixtureAccount, tableId, foreignTableId, otherVenueId,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

interface Session { cookie: string; csrfToken: string }

async function signIn(username: string): Promise<Session> {
  const signed = await loginAtPortal(username, 'preparation')
  const cookies = signed.headers['set-cookie'] as unknown as string[]
  expect(signed.status).toBe(200)
  return { cookie: cookies[0]!, csrfToken: (signed.body as { csrfToken: string }).csrfToken }
}

let key = 0
const idem = () => `prep-module4-${String(++key).padStart(8, '0')}`

async function seedTickets(): Promise<{ visitId: number; barId: number; kitchenId: number }> {
  const visit = await createWalkIn(actor, { tableIds: [tableId], partySize: 2, businessDate })
  const [order] = await databasePool.execute<import('mysql2/promise').ResultSetHeader>(
    `INSERT INTO sales_orders
      (organization_id, venue_id, visit_id, visit_sequence, business_date, ordered_by_user_id,
       ordered_by_membership_id, line_count, item_count, total_amount_vnd)
     VALUES (?, ?, ?, 1, ?, ?, ?, 2, 3, 1000)`,
    [actor.organizationId, actor.venueId, visit.visitId, businessDate, actor.userId, actor.membershipId],
  )
  const ids: number[] = []
  for (const [station, count] of [['BAR', 1], ['KITCHEN', 2]] as const) {
    const [ticket] = await databasePool.execute<import('mysql2/promise').ResultSetHeader>(
      `INSERT INTO preparation_tickets
       (organization_id, venue_id, order_id, visit_id, station, status, line_count, item_count)
       VALUES (?, ?, ?, ?, ?, 'SUBMITTED', 1, ?)`,
      [actor.organizationId, actor.venueId, order.insertId, visit.visitId, station, count],
    )
    ids.push(Number(ticket.insertId))
    await databasePool.execute(
      `INSERT INTO preparation_print_outbox (organization_id, venue_id, ticket_id, station) VALUES (?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, ticket.insertId, station],
    )
  }
  return { visitId: visit.visitId, barId: ids[0]!, kitchenId: ids[1]! }
}

async function enablePrinting(station: 'BAR' | 'KITCHEN'): Promise<void> {
  await databasePool.execute(
    `INSERT INTO preparation_print_capabilities
      (organization_id, venue_id, station, adapter_name, is_enabled, worker_heartbeat_at)
     VALUES (?, ?, ?, 'integration-adapter', 1, UTC_TIMESTAMP(3))`,
    [actor.organizationId, actor.venueId, station],
  )
}

function post(session: Session, path: string, payload: Record<string, unknown>) {
  return request(app).post(path).set('Cookie', session.cookie).set('Origin', env.webOrigin)
    .set('X-CSRF-Token', session.csrfToken).send(payload)
}

function get(session: Session, path: string) {
  return request(app).get(path).set('Cookie', session.cookie).set('Origin', env.webOrigin)
}

function json<T>(response: { body: unknown }): T {
  return response.body as T
}

mysqlDescribe('Module 4 preparation queue', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await seedFixtureAccount(9891, 'module4_bar', 'BAR')
    await seedFixtureAccount(9892, 'module4_kitchen', 'KITCHEN')
  })
  afterAll(async () => { await clearFixture(); await databasePool.end() })

  it('isolates stations at the server and returns only tickets from the selected station', async () => {
    const seeded = await seedTickets()
    const foreignVisit = await createWalkIn({ ...actor, venueId: otherVenueId },
      { tableIds: [foreignTableId], partySize: 2, businessDate })
    const [foreignOrder] = await databasePool.execute<import('mysql2/promise').ResultSetHeader>(
      `INSERT INTO sales_orders
        (organization_id, venue_id, visit_id, visit_sequence, business_date, ordered_by_user_id,
         ordered_by_membership_id, line_count, item_count, total_amount_vnd)
       VALUES (?, ?, ?, 1, ?, ?, ?, 1, 1, 1000)`,
      [actor.organizationId, otherVenueId, foreignVisit.visitId, businessDate, actor.userId, actor.membershipId],
    )
    await databasePool.execute(
      `INSERT INTO preparation_tickets
        (organization_id, venue_id, order_id, visit_id, station, status, line_count, item_count)
       VALUES (?, ?, ?, ?, 'BAR', 'SUBMITTED', 1, 1)`,
      [actor.organizationId, otherVenueId, foreignOrder.insertId, foreignVisit.visitId],
    )
    const bar = await signIn('module4_bar')
    const own = await get(bar, '/api/v1/preparation/BAR/tickets')
    expect(own.status).toBe(200)
    expect((own.body as { tickets: Array<{ ticketId: number }> }).tickets.map((ticket) => ticket.ticketId)).toEqual([seeded.barId])
    expect((await get(bar, '/api/v1/preparation/KITCHEN/tickets')).status).toBe(403)
    expect((await post(bar, `/api/v1/preparation/KITCHEN/tickets/${seeded.kitchenId}/transition`,
      { toStatus: 'ACCEPTED', expectedVersion: 1, idempotencyKey: idem() })).status).toBe(403)
  })

  it('enforces sequential transitions, terminal state and optimistic concurrency with audit history', async () => {
    const seeded = await seedTickets()
    const bar = await signIn('module4_bar')
    const kitchen = await signIn('module4_kitchen')
    const invalidKey = idem()
    const skipped = await post(bar, `/api/v1/preparation/BAR/tickets/${seeded.barId}/transition`,
      { toStatus: 'PREPARING', expectedVersion: 1, idempotencyKey: invalidKey })
    expect(skipped.status).toBe(409)
    let version = 1
    for (const toStatus of ['ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'] as const) {
      const idempotencyKey = idem()
      const response = await post(bar, `/api/v1/preparation/BAR/tickets/${seeded.barId}/transition`,
        { toStatus, expectedVersion: version, idempotencyKey })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
      version += 1
      expect((response.body as { ticket: { status: string; version: number } }).ticket).toMatchObject({ status: toStatus, version })
    }
    const terminal = await post(bar, `/api/v1/preparation/BAR/tickets/${seeded.barId}/transition`,
      { toStatus: 'COLLECTED', expectedVersion: version, idempotencyKey: idem() })
    expect(terminal.status).toBe(409)
    const conflict = await post(kitchen, `/api/v1/preparation/KITCHEN/tickets/${seeded.kitchenId}/transition`,
      { toStatus: 'ACCEPTED', expectedVersion: 999, idempotencyKey: idem() })
    expect(conflict.status).toBe(409)
    const [events] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) total FROM preparation_ticket_events WHERE ticket_id = ?', [seeded.barId])
    expect(Number(events[0]!.total)).toBe(4)
    const [ready] = await databasePool.execute<(RowDataPacket & { visit_id: number; recipient_user_id: number })[]>(
      'SELECT visit_id, recipient_user_id FROM preparation_ready_notifications WHERE ticket_id = ?', [seeded.barId])
    expect(Number(ready[0]!.visit_id)).toBe(seeded.visitId)
    expect(Number(ready[0]!.recipient_user_id)).toBe(actor.userId)
  })

  it('retries the same print outbox row idempotently without creating another ticket or order', async () => {
    const seeded = await seedTickets()
    const bar = await signIn('module4_bar')
    await enablePrinting('BAR')
    const idempotencyKey = idem()
    const path = `/api/v1/preparation/BAR/tickets/${seeded.barId}/print-retry`
    const first = await post(bar, path, { idempotencyKey })
    const replay = await post(bar, path, { idempotencyKey })
    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    const [counts] = await databasePool.execute<(RowDataPacket & { tickets: number; orders: number; outbox: number; retries: number })[]>(
      `SELECT (SELECT COUNT(*) FROM preparation_tickets) tickets,
       (SELECT COUNT(*) FROM sales_orders) orders,
       (SELECT COUNT(*) FROM preparation_print_outbox) outbox,
       (SELECT retry_request_count FROM preparation_print_outbox WHERE ticket_id = ?) retries`, [seeded.barId])
    expect(Number(counts[0]!.tickets)).toBe(2)
    expect(Number(counts[0]!.orders)).toBe(1)
    expect(Number(counts[0]!.outbox)).toBe(2)
    expect(Number(counts[0]!.retries)).toBe(1)
    const [audits] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) total FROM preparation_print_retry_events WHERE outbox_id = ?',
      [json<{ outboxId: number }>(first).outboxId])
    expect(Number(audits[0]!.total)).toBe(1)
  })

  it('returns PRINT_NOT_CONFIGURED and exposes printing.enabled=false without an active worker', async () => {
    const seeded = await seedTickets()
    const bar = await signIn('module4_bar')
    const snapshot = await get(bar, '/api/v1/preparation/BAR/tickets')
    expect(snapshot.status).toBe(200)
    expect(json<{ printing: { enabled: boolean } }>(snapshot).printing).toEqual({ enabled: false })
    const response = await post(bar, `/api/v1/preparation/BAR/tickets/${seeded.barId}/print-retry`, { idempotencyKey: idem() })
    expect(response.status).toBe(503)
    expect(json<{ error: { code: string } }>(response).error.code).toBe('PRINT_NOT_CONFIGURED')
  })

  it('enforces CSRF and rejects reuse of one idempotency key with another payload', async () => {
    const seeded = await seedTickets()
    const bar = await signIn('module4_bar')
    const path = `/api/v1/preparation/BAR/tickets/${seeded.barId}/transition`
    const missing = await request(app).post(path).set('Cookie', bar.cookie).set('Origin', env.webOrigin)
      .send({ toStatus: 'ACCEPTED', expectedVersion: 1, idempotencyKey: idem() })
    expect(missing.status).toBe(403)
    const idempotencyKey = idem()
    expect((await post(bar, path, { toStatus: 'ACCEPTED', expectedVersion: 1, idempotencyKey })).status).toBe(200)
    const reused = await post(bar, path, { toStatus: 'PREPARING', expectedVersion: 2, idempotencyKey })
    expect(reused.status).toBe(422)
    expect(json<{ error: { code: string } }>(reused).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('serializes concurrent transitions and records milestone actor/timestamp', async () => {
    const seeded = await seedTickets()
    const bar = await signIn('module4_bar')
    const path = `/api/v1/preparation/BAR/tickets/${seeded.barId}/transition`
    const responses = await Promise.all([
      post(bar, path, { toStatus: 'ACCEPTED', expectedVersion: 1, idempotencyKey: idem() }),
      post(bar, path, { toStatus: 'ACCEPTED', expectedVersion: 1, idempotencyKey: idem() }),
    ])
    expect(responses.map((item) => item.status).sort()).toEqual([200, 409])
    const [rows] = await databasePool.execute<(RowDataPacket & { accepted_by_user_id: number; accepted_at: Date; version: number })[]>(
      'SELECT accepted_by_user_id, accepted_at, version FROM preparation_tickets WHERE id = ?', [seeded.barId])
    expect(Number(rows[0]!.accepted_by_user_id)).toBe(9891)
    expect(rows[0]!.accepted_at).toBeTruthy()
    expect(Number(rows[0]!.version)).toBe(2)
  })

  it('publishes SSE only after commit and emits nothing for a rolled-back transition', async () => {
    resetFloorChangeStream()
    const seeded = await seedTickets()
    const bar = await signIn('module4_bar')
    const independent: PoolConnection = await databasePool.getConnection()
    const observed: Array<Promise<string>> = []
    const response = {
      writeHead() { return this },
      write(chunk: string) {
        if (chunk.includes('event: floor-changed')) {
          observed.push(independent.execute<(RowDataPacket & { status: string })[]>(
            'SELECT status FROM preparation_tickets WHERE id = ?', [seeded.barId]).then(([rows]) => rows[0]!.status))
        }
        return true
      },
      on() { return this },
      end() { return this },
    } as unknown as Response
    const unsubscribe = subscribeToFloorChanges({ organizationId: actor.organizationId, venueId: actor.venueId,
      authSessionId: 1, userId: 1, authorize: () => Promise.resolve(null), response })
    try {
      const path = `/api/v1/preparation/BAR/tickets/${seeded.barId}/transition`
      expect((await post(bar, path, { toStatus: 'ACCEPTED', expectedVersion: 1, idempotencyKey: idem() })).status).toBe(200)
      expect(await Promise.all(observed)).toEqual(['ACCEPTED'])
      const emitted = observed.length
      expect((await post(bar, path, { toStatus: 'READY', expectedVersion: 2, idempotencyKey: idem() })).status).toBe(409)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(observed).toHaveLength(emitted)
    } finally {
      unsubscribe()
      resetFloorChangeStream()
      independent.release()
    }
  })

  it('projects the current table from visit allocation after a table move', async () => {
    const seeded = await seedTickets()
    const bar = await signIn('module4_bar')
    await databasePool.execute(
      `INSERT INTO dining_tables
       (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
       VALUES (9899, ?, ?, ?, 'A2', 'A2', 'TABLE', 4, 20, 20)`,
      [actor.organizationId, actor.venueId, tableId],
    )
    await databasePool.execute(
      `UPDATE table_allocations SET table_id = 9899
       WHERE organization_id = ? AND venue_id = ? AND visit_id = ? AND kind = 'USAGE' AND released_at IS NULL`,
      [actor.organizationId, actor.venueId, seeded.visitId],
    )
    const response = await get(bar, '/api/v1/preparation/BAR/tickets')
    expect(response.status).toBe(200)
    expect((response.body as { tickets: Array<{ ticketId: number; visitId: number; tableCodes: string[] }> }).tickets[0])
      .toMatchObject({ ticketId: seeded.barId, visitId: seeded.visitId, tableCodes: ['A2'] })
  })

  it('delivers READY independently to the ordering waiter and cashier audience with idempotent acknowledgement', async () => {
    const seeded = await seedTickets()
    await databasePool.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
       SELECT ?, ?, id, ? FROM roles WHERE code = 'WAITER'`,
      [actor.organizationId, actor.membershipId, actor.venueId],
    )
    await seedFixtureAccount(9893, 'module4_cashier', 'CASHIER')
    const waiter = await loginAtPortal('integration_reception', 'waiter')
    const cashier = await loginAtPortal('module4_cashier', 'cashier')
    const waiterSession = { cookie: (waiter.headers['set-cookie'] as unknown as string[])[0]!,
      csrfToken: json<{ csrfToken: string }>(waiter).csrfToken }
    const cashierSession = { cookie: (cashier.headers['set-cookie'] as unknown as string[])[0]!,
      csrfToken: json<{ csrfToken: string }>(cashier).csrfToken }
    const bar = await signIn('module4_bar')
    let version = 1
    for (const toStatus of ['ACCEPTED', 'PREPARING', 'READY'] as const) {
      expect((await post(bar, `/api/v1/preparation/BAR/tickets/${seeded.barId}/transition`,
        { toStatus, expectedVersion: version++, idempotencyKey: idem() })).status).toBe(200)
    }
    const waiterReady = await get(waiterSession, '/api/v1/preparation/ready-notifications')
    const cashierReady = await get(cashierSession, '/api/v1/preparation/ready-notifications')
    const waiterNotifications = json<{ notifications: Array<{ eventId: number; visitId: number; audience: string; orderedByUserId: number }> }>(waiterReady).notifications
    const cashierNotifications = json<{ notifications: Array<{ visitId: number; audience: string; orderedByUserId: number }> }>(cashierReady).notifications
    expect(waiterNotifications[0]).toMatchObject({ visitId: seeded.visitId, audience: 'ORDERED_BY_USER', orderedByUserId: actor.userId })
    expect(cashierNotifications[0]).toMatchObject({ visitId: seeded.visitId, audience: 'CASHIER_ROLE', orderedByUserId: actor.userId })
    const eventId = Number(waiterNotifications[0]!.eventId)
    const waiterKey = idem()
    const ackPath = `/api/v1/preparation/ready-notifications/${eventId}/acknowledge`
    expect((await post(waiterSession, ackPath, { audience: 'ORDERED_BY_USER', idempotencyKey: waiterKey })).status).toBe(200)
    const replay = await post(waiterSession, ackPath, { audience: 'ORDERED_BY_USER', idempotencyKey: waiterKey })
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect((await post(cashierSession, ackPath, { audience: 'CASHIER_ROLE', idempotencyKey: idem() })).status).toBe(200)
    const [acks] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) total FROM preparation_ready_acknowledgements WHERE event_id = ?', [eventId])
    expect(Number(acks[0]!.total)).toBe(2)
  })

  it('bounds the active queue and exposes collected tickets only through paginated history', async () => {
    const seeded = await seedTickets()
    const bar = await signIn('module4_bar')
    let version = 1
    for (const toStatus of ['ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'] as const) {
      expect((await post(bar, `/api/v1/preparation/BAR/tickets/${seeded.barId}/transition`,
        { toStatus, expectedVersion: version++, idempotencyKey: idem() })).status).toBe(200)
    }
    const active = await get(bar, '/api/v1/preparation/BAR/tickets')
    const activeBody = json<{ limit: number; tickets: Array<{ ticketId: number }> }>(active)
    expect(activeBody.limit).toBe(200)
    expect(activeBody.tickets.some((ticket) => ticket.ticketId === seeded.barId)).toBe(false)
    const history = await get(bar, '/api/v1/preparation/BAR/history?limit=1')
    expect(history.status).toBe(200)
    const historyBody = json<{ limit: number; tickets: Array<{ ticketId: number; status: string }> }>(history)
    expect(historyBody.limit).toBe(1)
    expect(historyBody.tickets).toHaveLength(1)
    expect(historyBody.tickets[0]).toMatchObject({ ticketId: seeded.barId, status: 'COLLECTED' })
  })

  it('keeps the 0039 READY audience backfill idempotent', async () => {
    const seeded = await seedTickets()
    const bar = await signIn('module4_bar')
    let version = 1
    for (const toStatus of ['ACCEPTED', 'PREPARING', 'READY'] as const) {
      expect((await post(bar, `/api/v1/preparation/BAR/tickets/${seeded.barId}/transition`,
        { toStatus, expectedVersion: version++, idempotencyKey: idem() })).status).toBe(200)
    }
    await databasePool.execute('DELETE FROM preparation_ready_audiences')
    await databasePool.execute('DELETE FROM preparation_ready_events')
    const backfill = async () => {
      await databasePool.execute(
        `INSERT IGNORE INTO preparation_ready_events
          (organization_id, venue_id, ticket_id, visit_id, ordered_by_user_id, created_at)
         SELECT organization_id, venue_id, ticket_id, visit_id, recipient_user_id, created_at
           FROM preparation_ready_notifications`,
      )
      await databasePool.execute(
        `INSERT IGNORE INTO preparation_ready_audiences (event_id, audience, target_user_id, created_at)
         SELECT id, 'ORDERED_BY_USER', ordered_by_user_id, created_at FROM preparation_ready_events`,
      )
      await databasePool.execute(
        `INSERT IGNORE INTO preparation_ready_audiences (event_id, audience, target_user_id, created_at)
         SELECT id, 'CASHIER_ROLE', NULL, created_at FROM preparation_ready_events`,
      )
    }
    await backfill()
    await backfill()
    const [counts] = await databasePool.execute<(RowDataPacket & { events: number; audiences: number })[]>(
      `SELECT (SELECT COUNT(*) FROM preparation_ready_events) events,
        (SELECT COUNT(*) FROM preparation_ready_audiences) audiences`,
    )
    expect(Number(counts[0]!.events)).toBe(1)
    expect(Number(counts[0]!.audiences)).toBe(2)
  })
})

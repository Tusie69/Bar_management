import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createBooking } from '../src/modules/bookings/booking.repository.js'
import { actor, businessDate, clearFixture, initializeFixture, login, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const bookingInput = { guestName: 'Concurrent guest', partySize: 2, businessDate,
  expectedAt: `${businessDate}T20:00:00+07:00`, sourceCode: 'HOTLINE' }

mysqlDescribe('HTTP allocation concurrency on MySQL', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterEach(() => vi.useRealTimers())
  afterAll(clearFixture)

  it.each([1, 2, 3])('permits exactly one concurrent booking assign (run %s)', async () => {
    const bookings = await Promise.all([createBooking(actor, bookingInput), createBooking(actor, bookingInput)])
    const sessions = await Promise.all([login(), login()])
    const results = await Promise.all(bookings.map((booking, index) => {
      const session = sessions[index]!
      return session.agent.post(`/api/v1/bookings/${booking.id}/assign`).set('Origin', env.webOrigin)
        .set('X-CSRF-Token', session.csrfToken).send({ version: booking.version, tableIds: [tableId] })
    }))
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    const [allocations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT id FROM table_allocations WHERE table_id = ? AND business_date = ? AND released_at IS NULL', [tableId, businessDate],
    )
    expect(allocations).toHaveLength(1)
    const [holds] = await databasePool.execute<RowDataPacket[]>("SELECT id FROM table_holds WHERE status = 'ACTIVE'")
    expect(holds).toHaveLength(1)
  })

  it.each([1, 2, 3])('permits exactly one booking assign versus walk-in (run %s)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${businessDate}T14:00:00Z`))
    const booking = await createBooking(actor, bookingInput)
    const [assigner, walker] = await Promise.all([login(), login()])
    const results = await Promise.all([
      assigner.agent.post(`/api/v1/bookings/${booking.id}/assign`).set('Origin', env.webOrigin)
        .set('X-CSRF-Token', assigner.csrfToken).send({ version: booking.version, tableIds: [tableId] }),
      walker.agent.post('/api/v1/bookings/walk-ins').set('Origin', env.webOrigin)
        .set('X-CSRF-Token', walker.csrfToken).send({ guestName: 'Concurrent walk-in', partySize: 2, businessDate, tableIds: [tableId] }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(results[0]?.status === 200 ? [200, 409] : [201, 409])
    const [allocations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT id FROM table_allocations WHERE table_id = ? AND business_date = ? AND released_at IS NULL', [tableId, businessDate],
    )
    expect(allocations).toHaveLength(1)
    const [rows] = await databasePool.execute<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM visits) + (SELECT COUNT(*) FROM table_holds WHERE status = 'ACTIVE') AS winners",
    )
    expect(Number(rows[0]?.winners)).toBe(1)
  })
})

import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { databasePool } from '../src/database/pool.js'
import type { BookingView } from '../src/modules/bookings/booking.repository.js'
import { actor, clearFixture, initializeFixture, login, otherVenueId, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const bookingInput = {
  guestName: 'Selective NA-14 guest',
  partySize: 2,
  businessDate: '2030-10-24',
  expectedAt: '2030-10-24T21:00:00+07:00',
  sourceCode: 'HOTLINE',
}

mysqlDescribe('selective NA-14 integration', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  it('preserves the unclassified default and persists explicit metadata through atomic direct booking', async () => {
    const { agent, csrfToken } = await login()
    const create = (body: object) => agent.post('/api/v1/bookings')
      .set('Origin', 'http://localhost:5173').set('X-CSRF-Token', csrfToken).send(body)

    const legacy = await create(bookingInput)
    expect(legacy.status).toBe(201)
    expect((legacy.body as { booking: BookingView }).booking).toMatchObject({
      classification: 'UNCLASSIFIED', guestType: null, isBirthday: false,
    })

    const direct = await agent.post('/api/v1/bookings/direct')
      .set('Origin', 'http://localhost:5173').set('X-CSRF-Token', csrfToken)
      .send({ ...bookingInput, guestType: 'REGULAR', isBirthday: true, tableIds: [tableId] })
    expect(direct.status).toBe(201)
    expect((direct.body as { booking: BookingView }).booking).toMatchObject({
      classification: 'RETURNING', guestType: 'REGULAR', isBirthday: true,
    })

    const [rows] = await databasePool.execute<RowDataPacket[]>(
      'SELECT customer_classification, guest_type, is_birthday FROM reservations ORDER BY id',
    )
    expect(rows).toEqual([
      expect.objectContaining({ customer_classification: 'UNCLASSIFIED', guest_type: null, is_birthday: 0 }),
      expect.objectContaining({ customer_classification: 'RETURNING', guest_type: 'REGULAR', is_birthday: 1 }),
    ])
  })

  it('uses venue thresholds as the single timing source and keeps settings tenant-scoped', async () => {
    const { agent } = await login()
    await databasePool.execute(
      'UPDATE venues SET upcoming_warning_minutes = 12, no_show_warning_minutes = 45 WHERE id = ?',
      [actor.venueId],
    )
    const response = await agent.get(`/api/v1/venues/${actor.venueId}/settings`)
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      venueId: actor.venueId,
      settings: {
        quick_times: ['21:00', '21:30', '22:00', '22:30'],
        upcoming_minutes: 12,
        no_show_minutes: 45,
      },
    })
    expect((await agent.get(`/api/v1/venues/${otherVenueId}/settings`)).status).toBe(404)
  })

  it('rejects conflicting metadata instead of silently changing existing business semantics', async () => {
    const { agent, csrfToken } = await login()
    const response = await agent.post('/api/v1/bookings')
      .set('Origin', 'http://localhost:5173').set('X-CSRF-Token', csrfToken)
      .send({ ...bookingInput, classification: 'RETURNING', guestType: 'NEW' })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: { code: 'CONFLICTING_GUEST_TYPE' } })
  })
})

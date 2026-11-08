/**
 * BF-01 — turning a named booking that has a phone into a phone-only booking.
 *
 * Reproduced in the 07/11 backend review and re-verified on develop: a named
 * booking with a phone stores `customer_id = NULL` and the name in
 * `contact_name`. Clearing the name while omitting `phoneNumber` left both NULL
 * and violated `ck_reservations_contact`, so the request died as a raw MySQL
 * check-constraint failure and HTTP 500.
 *
 * S1 and docs/api.md treat this as a legitimate transition, so it must succeed:
 * the contact becomes the Customer identity resolved from the phone already
 * stored. The client is never asked to resend the full number, and nothing here
 * decrypts it.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createBooking, getBookingById, updateBooking } from '../src/modules/bookings/booking.repository.js'
import { actor, businessDate, clearFixture, initializeFixture, login, resetFixture } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const phoneNumber = '0901234567'
const now = new Date(`${businessDate}T19:00:00+07:00`)

function input(extra: Record<string, unknown> = {}) {
  return {
    partySize: 2,
    expectedAt: `${businessDate}T21:00:00+07:00`,
    businessDate,
    sourceCode: 'HOTLINE',
    ...extra,
  }
}

function updateInput(version: number, extra: Record<string, unknown> = {}) {
  return {
    expectedVersion: version,
    partySize: 2,
    expectedAt: `${businessDate}T21:00:00+07:00`,
    businessDate,
    sourceCode: 'HOTLINE',
    ...extra,
  }
}

async function contactRow(id: number) {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    customer_id: number | null
    contact_name: string | null
    phone_last3: string | null
    phone_hmac: Buffer | null
  })[]>(
    'SELECT customer_id, contact_name, phone_last3, phone_hmac FROM reservations WHERE id = ?',
    [id],
  )
  return rows[0]!
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'OK'
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
}

mysqlDescribe('BF-01 named booking to phone-only update', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  it('stores a named booking with a phone as contact_name without a Customer', async () => {
    const booked = await createBooking(actor, input({ guestName: 'Named guest', phoneNumber }), now)
    const row = await contactRow(booked.id)
    expect(row.contact_name).toBe('Named guest')
    expect(row.customer_id).toBeNull()
    expect(row.phone_hmac).not.toBeNull()
  })

  it('clears the name while retaining the phone and keeps the masked suffix', async () => {
    const booked = await createBooking(actor, input({ guestName: 'Named guest', phoneNumber }), now)

    expect(await outcome(() => updateBooking(actor, booked.id, updateInput(booked.version, {
      guestName: '',
    }), now))).toBe('OK')

    const row = await contactRow(booked.id)
    // The contact is now the Customer identity behind the stored phone.
    expect(row.contact_name).toBeNull()
    expect(row.customer_id).not.toBeNull()
    expect(row.phone_hmac).not.toBeNull()

    const view = await getBookingById(actor, booked.id)
    // No name anywhere, so the API reports the booking as having no guest name.
    expect(view.hasGuestName).toBe(false)
    expect(view.phoneLast3).toBe(phoneNumber.slice(-3))
    // Nothing decrypted or leaked into the response.
    expect(JSON.stringify(view)).not.toContain(phoneNumber)
  })

  it('reuses the existing Customer for that phone instead of creating another', async () => {
    const first = await createBooking(actor, input({ phoneNumber }), now)
    const firstRow = await contactRow(first.id)
    const named = await createBooking(actor, input({ guestName: 'Named guest', phoneNumber }), now)

    await updateBooking(actor, named.id, updateInput(named.version, { guestName: '' }), now)

    const namedRow = await contactRow(named.id)
    expect(namedRow.customer_id).toBe(firstRow.customer_id)
    const [customers] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      'SELECT COUNT(*) AS total FROM customers WHERE organization_id = ?',
      [actor.organizationId],
    )
    expect(Number(customers[0]?.total)).toBe(1)
  })

  it('refuses to clear both the name and the phone', async () => {
    const booked = await createBooking(actor, input({ guestName: 'Named guest', phoneNumber }), now)
    expect(await outcome(() => updateBooking(actor, booked.id, updateInput(booked.version, {
      guestName: '', phoneNumber: null,
    }), now))).toBe('BOOKING_CONTACT_REQUIRED')
    const row = await contactRow(booked.id)
    expect(row.contact_name).toBe('Named guest')
  })

  it('refuses to clear the name on a booking that never had a phone', async () => {
    const booked = await createBooking(actor, input({ guestName: 'No phone guest' }), now)
    expect(await outcome(() => updateBooking(actor, booked.id, updateInput(booked.version, {
      guestName: '',
    }), now))).toBe('BOOKING_CONTACT_REQUIRED')
    const row = await contactRow(booked.id)
    expect(row.contact_name).toBe('No phone guest')
  })

  it('still rejects a stale version and leaves the identity untouched', async () => {
    const booked = await createBooking(actor, input({ guestName: 'Named guest', phoneNumber }), now)
    expect(await outcome(() => updateBooking(actor, booked.id, updateInput(booked.version + 5, {
      guestName: '',
    }), now))).toBe('VERSION_CONFLICT')
    const row = await contactRow(booked.id)
    expect(row.contact_name).toBe('Named guest')
    expect(row.customer_id).toBeNull()
  })

  it('returns 200 over HTTP where it used to return 500', async () => {
    const receptionist = await login()
    const created = await receptionist.agent.post('/api/v1/bookings').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', receptionist.csrfToken)
      .send({ guestName: 'Named guest', phoneNumber, ...input() })
    expect(created.status).toBe(201)
    const booking = (created.body as { booking: { id: number; version: number } }).booking

    const cleared = await receptionist.agent.put(`/api/v1/bookings/${booking.id}`).set('Origin', env.webOrigin)
      .set('X-CSRF-Token', receptionist.csrfToken)
      .send({ version: booking.version, guestName: '', ...input() })
    expect(cleared.status).toBe(200)
    const view = (cleared.body as { booking: { hasGuestName: boolean; phoneLast3: string } }).booking
    expect(view.hasGuestName).toBe(false)
    expect(view.phoneLast3).toBe(phoneNumber.slice(-3))
    expect(JSON.stringify(cleared.body)).not.toContain(phoneNumber)
  })
})

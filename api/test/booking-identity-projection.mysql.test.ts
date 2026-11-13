/**
 * BF-02 and B02 — what the projections report about a booking's identity.
 *
 * Both were reproduced in the 07/11 backend review and re-verified on develop.
 *
 * BF-02: every projection read `COALESCE(c.display_name, r.contact_name, ...)`,
 * so a Customer display name masked the per-booking contact name. An edit
 * returned 200 with the new name written to `contact_name`, while detail, list,
 * search, floor and export all kept showing the old Customer name. The chosen
 * fix is the second option the review allowed: prefer the per-booking contact
 * name consistently in every projection, and leave `Customer.display_name`
 * global and untouched.
 *
 * B02: the floor's VISIT branch returned `reservationId: null`, `flags: []`,
 * `sourceCode: null` and only a Customer-linked suffix, so checking a booking in
 * dropped its identity from the floor. The reservation is reachable through
 * `reservations.visit_id`, which check-in already sets.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { databasePool } from '../src/database/pool.js'
import {
  assignBookingTables,
  checkInBooking,
  createBooking,
  createWalkIn,
  getBookingById,
  listBookings,
  searchBookings,
  updateBooking,
} from '../src/modules/bookings/booking.repository.js'
import { formatDailyBookingText, getDailyBookingTextInput } from '../src/modules/bookings/booking-export.js'
import { getFloorProjection } from '../src/modules/tables/floor-projection.repository.js'
import { actor, businessDate, clearFixture, initializeFixture, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const phoneNumber = '0901234567'
const customerName = 'Existing customer'
const editedName = 'Edited booking name'
// Inside the 17:00-05:00 shift so check-in is allowed, and before 21:00.
const now = new Date(`${businessDate}T19:00:00+07:00`)
const secondTableId = 9840

async function addTable(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'P2', 'P2', 'TABLE', 4, 80, 10)`,
    [secondTableId, actor.organizationId, actor.venueId, tableId],
  )
}

function input(extra: Record<string, unknown> = {}) {
  return {
    partySize: 2,
    expectedAt: `${businessDate}T21:00:00+07:00`,
    businessDate,
    sourceCode: 'HOTLINE',
    ...extra,
  }
}

/** A phone-only booking whose Customer already carries a display name. */
async function bookingOnNamedCustomer() {
  const booked = await createBooking(actor, input({ phoneNumber }), now)
  const [rows] = await databasePool.execute<(RowDataPacket & { customer_id: number })[]>(
    'SELECT customer_id FROM reservations WHERE id = ?', [booked.id],
  )
  const customerId = Number(rows[0]!.customer_id)
  await databasePool.execute(
    'UPDATE customers SET display_name = ?, name_search = ? WHERE id = ?',
    [customerName, customerName.toLowerCase(), customerId],
  )
  return { booked, customerId }
}

async function claimOn(table: number) {
  const projection = await getFloorProjection(actor, businessDate, now)
  return projection.tables.find((entry) => Number(entry.tableId) === table)?.claim ?? null
}

mysqlDescribe('BF-02/B02 booking identity in projections', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTable()
  })
  afterAll(clearFixture)

  // BF-02: the name the user just saved must be the name every view shows.
  it('BF-02: an edited booking name wins over the Customer display name everywhere', async () => {
    const { booked, customerId } = await bookingOnNamedCustomer()
    expect((await getBookingById(actor, booked.id)).guestName).toBe(customerName)

    const updated = await updateBooking(actor, booked.id, {
      expectedVersion: booked.version,
      guestName: editedName,
      partySize: 2,
      expectedAt: `${businessDate}T21:00:00+07:00`,
      businessDate,
      sourceCode: 'HOTLINE',
    }, now)
    expect(updated.guestName).toBe(editedName)

    // Detail, list and search agree with the response.
    expect((await getBookingById(actor, booked.id)).guestName).toBe(editedName)
    expect((await listBookings(actor, businessDate)).find((b) => b.id === booked.id)?.guestName)
      .toBe(editedName)
    expect((await searchBookings(actor, businessDate, 'Edited')).map((b) => b.id)).toContain(booked.id)

    // The export text carries the new name and not the old one.
    const text = formatDailyBookingText(await getDailyBookingTextInput(actor, businessDate))
    expect(text).toContain(editedName)
    expect(text).not.toContain(customerName)

    // The floor shows it too, once the booking holds a table.
    await assignBookingTables(actor, booked.id, updated.version, [tableId])
    expect((await claimOn(tableId))?.guestName).toBe(editedName)

    // The global Customer record is untouched.
    const [customers] = await databasePool.execute<(RowDataPacket & { display_name: string })[]>(
      'SELECT display_name FROM customers WHERE id = ?', [customerId],
    )
    expect(customers[0]?.display_name).toBe(customerName)
  })

  it('BF-02: a booking with no name of its own still shows the Customer name', async () => {
    const { booked } = await bookingOnNamedCustomer()
    const view = await getBookingById(actor, booked.id)
    expect(view.guestName).toBe(customerName)
    expect(view.hasGuestName).toBe(true)

    await assignBookingTables(actor, booked.id, booked.version, [tableId])
    expect((await claimOn(tableId))?.guestName).toBe(customerName)
  })

  // B02: checking in must not drop the booking's identity from the floor.
  it('B02: the floor keeps the booking identity after check-in', async () => {
    const booked = await createBooking(actor, input({
      guestName: 'Checked in guest',
      phoneNumber,
      classification: 'RETURNING',
      isBirthday: true,
    }), now)
    const assigned = await assignBookingTables(actor, booked.id, booked.version, [tableId])

    const before = await claimOn(tableId)
    expect(before).toMatchObject({
      kind: 'RESERVATION',
      reservationId: booked.id,
      phoneLast3: phoneNumber.slice(-3),
      sourceCode: 'HOTLINE',
    })
    expect(before?.flags).toEqual(['BIRTHDAY', 'RETURNING'])

    await checkInBooking(actor, booked.id, assigned.version, now)

    const after = await claimOn(tableId)
    expect(after?.kind).toBe('VISIT')
    expect(after?.visitId).not.toBeNull()
    // Everything the review found missing is kept.
    expect(after?.reservationId).toBe(booked.id)
    expect(after?.flags).toEqual(['BIRTHDAY', 'RETURNING'])
    expect(after?.phoneLast3).toBe(phoneNumber.slice(-3))
    expect(after?.sourceCode).toBe('HOTLINE')
    expect(after?.partySize).toBe(2)
    // Vẫn không lộ số đầy đủ, nhưng khách đã ngồi thì lễ tân vẫn gọi được:
    // lượt ghé còn giữ booking nên cuộc gọi vẫn ghi được log.
    expect(after?.canCall).toBe(true)
    expect(JSON.stringify(after)).not.toContain(phoneNumber)
  })

  it('B02: an independent walk-in visit stays without a reservation identity', async () => {
    await createWalkIn(actor, {
      guestName: 'Walk-in guest', partySize: 2, businessDate, tableIds: [secondTableId],
    })
    const claim = await claimOn(secondTableId)
    expect(claim?.kind).toBe('VISIT')
    expect(claim?.reservationId).toBeNull()
    expect(claim?.flags).toEqual([])
    expect(claim?.sourceCode).toBeNull()
    expect(claim?.guestName).toBe('Walk-in guest')
    expect(claim?.origin).toBe('WALK_IN')
  })

  it('B02: one checked-in booking does not duplicate its table row', async () => {
    const booked = await createBooking(actor, input({ guestName: 'Single row', phoneNumber }), now)
    const assigned = await assignBookingTables(actor, booked.id, booked.version, [tableId])
    await checkInBooking(actor, booked.id, assigned.version, now)

    const projection = await getFloorProjection(actor, businessDate, now)
    expect(projection.tables.filter((entry) => Number(entry.tableId) === tableId)).toHaveLength(1)
  })
})

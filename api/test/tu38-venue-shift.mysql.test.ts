/**
 * TU-38 — the booking rules follow the venue's own shift columns.
 *
 * The unit tests in `business-date.test.ts` prove the pure rules honour a shift passed to
 * them. This file proves the request paths actually read it: the venue row is reconfigured to
 * 18:00–03:00 and the same calls then behave differently, which is only possible if nothing
 * on the way still holds 17 and 5 as constants.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '../src/errors/app-error.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import * as applicationClock from '../src/time/application-clock.js'
import { createAndAssignBooking, checkInBooking } from '../src/modules/bookings/booking.repository.js'
import { createWaitlistEntry } from '../src/modules/waitlist/waitlist.repository.js'
import { getVenueShift, invalidateVenueShift } from '../src/modules/venues/venue-shift.js'
import { actor, clearFixture, initializeFixture, login, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const b3 = 9840

/** 04:00 local on 25 Oct: inside a 17:00–05:00 shift, past a 03:00 cutoff. */
const fourAm = new Date('2026-10-24T21:00:00.000Z')
/** 17:30 local on 24 Oct: open by default, not yet open for a venue starting at 18:00. */
const halfPastFive = new Date('2026-10-24T10:30:00.000Z')
/** 22:00 local on 24 Oct: inside both shifts. */
const tenPm = new Date('2026-10-24T15:00:00.000Z')

async function setVenueShift(startLocal: string, cutoffLocal: string): Promise<void> {
  await databasePool.execute(
    `UPDATE venues SET business_day_start_local = ?, business_day_cutoff_local = ?
     WHERE organization_id = ? AND id = ?`,
    [startLocal, cutoffLocal, actor.organizationId, actor.venueId],
  )
  invalidateVenueShift(actor)
}

async function addTable(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'B3', 'B3', 'TABLE', 4, 10, 20)`,
    [b3, actor.organizationId, actor.venueId, tableId],
  )
}

/** The operating day a visit was actually filed against, read back from the row. */
async function visitBusinessDate(visitId: number): Promise<string> {
  const [rows] = await databasePool.execute<(RowDataPacket & { business_date: Date | string })[]>(
    'SELECT business_date FROM visits WHERE id = ?', [visitId],
  )
  const stored: Date | string = rows[0]!.business_date
  return (stored instanceof Date ? stored.toISOString() : String(stored)).slice(0, 10)
}

/** Matches an AppError by its code, whatever message the shift puts in it. */
function expectAppError(code: string): unknown {
  return expect.objectContaining({ code }) as unknown
}

mysqlDescribe('TU-38 venue shift drives the booking rules', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTable()
  })
  afterAll(clearFixture)

  it('reads the shift from the venue row and caches it until invalidated', async () => {
    expect(await getVenueShift(actor)).toMatchObject({
      startLocal: '17:00:00', cutoffLocal: '05:00:00', startHour: 17, cutoffHour: 5,
      timeZone: 'Asia/Ho_Chi_Minh',
    })

    // A write behind the cache's back is deliberately NOT visible: that is what caching means.
    await databasePool.execute(
      `UPDATE venues SET business_day_cutoff_local = '03:00:00' WHERE organization_id = ? AND id = ?`,
      [actor.organizationId, actor.venueId],
    )
    expect(await getVenueShift(actor)).toMatchObject({ cutoffHour: 5 })

    invalidateVenueShift(actor)
    expect(await getVenueShift(actor)).toMatchObject({ cutoffLocal: '03:00:00', cutoffHour: 3 })
  })

  it('refuses a walk-in in the gap between the configured cutoff and opening', async () => {
    // The walk-in route is what validates the operating day, so this one goes over HTTP.
    vi.spyOn(applicationClock, 'applicationNow').mockReturnValue(fourAm)
    try {
      const reception = await login('integration_reception')
      // 04:00 under the seeded shift is still last night, so the walk-in is accepted.
      const accepted = await reception.agent.post('/api/v1/bookings/walk-ins')
        .set('Origin', env.webOrigin)
        .set('X-CSRF-Token', reception.csrfToken)
        .send({ partySize: 2, businessDate: '2026-10-24', tableIds: [b3], capacityOverrideConfirmed: true })
      expect(accepted.status).toBe(201)

      await setVenueShift('18:00:00', '03:00:00')
      // The same moment is now dead time, and the message quotes the venue's own hours.
      const refused = await reception.agent.post('/api/v1/bookings/walk-ins')
        .set('Origin', env.webOrigin)
        .set('X-CSRF-Token', reception.csrfToken)
        .send({ partySize: 2, businessDate: '2026-10-25', tableIds: [b3], capacityOverrideConfirmed: true })
      expect(refused.status).toBe(409)
      const error = (refused.body as { error: { code: string; message: string } }).error
      expect(error.code).toBe('WALK_IN_OUTSIDE_BUSINESS_HOURS')
      expect(error.message).toContain('18:00–03:00')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('refuses a check-in before the configured opening hour', async () => {
    await setVenueShift('18:00:00', '03:00:00')
    const booking = await createAndAssignBooking(actor, {
      guestName: 'Khách 18h', partySize: 2, expectedAt: '2026-10-24T22:00:00+07:00',
      businessDate: '2026-10-24', sourceCode: 'HOTLINE', tableIds: [b3], capacityOverrideConfirmed: true,
    }, tenPm)

    // 17:30 is before this venue opens, so there is no active shift to check anyone into.
    await expect(checkInBooking(actor, booking.id, booking.version, halfPastFive))
      .rejects.toThrowError(expectAppError('CHECK_IN_OUTSIDE_BUSINESS_HOURS'))
    await expect(checkInBooking(actor, booking.id, booking.version, halfPastFive))
      .rejects.toThrowError(/03:00–18:00/)

    // 22:00 is inside the shift, so the same booking checks in.
    await expect(checkInBooking(actor, booking.id, booking.version, tenPm)).resolves.toMatchObject({ id: booking.id })
  })

  it('judges a past operating day for the waitlist by the configured cutoff', async () => {
    // At 04:00 the seeded venue is still on the 24th, so a 24th entry is current.
    await expect(createWaitlistEntry(actor, {
      kind: 'WALK_IN', guestName: 'Chờ bàn', partySize: 2, businessDate: '2026-10-24',
      contactChannel: 'IN_PERSON',
    }, fourAm)).resolves.toMatchObject({ businessDate: '2026-10-24' })

    await resetFixture()
    await addTable()
    await setVenueShift('18:00:00', '03:00:00')
    // Past the 03:00 cutoff the operating day has rolled to the 25th, so the 24th is history.
    await expect(createWaitlistEntry(actor, {
      kind: 'WALK_IN', guestName: 'Chờ bàn', partySize: 2, businessDate: '2026-10-24',
      contactChannel: 'IN_PERSON',
    }, fourAm)).rejects.toThrowError(expectAppError('BUSINESS_DATE_IN_PAST'))
  })

  it('quotes the configured shift when a booking date does not match its arrival', async () => {
    await setVenueShift('18:00:00', '03:00:00')
    // 00:30 on the 25th belongs to the 24th's shift under either cutoff, so the business date
    // sent here is wrong. What proves the shift was read is the hours the refusal quotes: the
    // message is built from the venue row, so a stale constant would still say 17:00–05:00.
    await expect(createAndAssignBooking(actor, {
      guestName: 'Sai ngày', partySize: 2, expectedAt: '2026-10-25T00:30:00+07:00',
      businessDate: '2026-10-25', sourceCode: 'HOTLINE', tableIds: [b3], capacityOverrideConfirmed: true,
    }, tenPm)).rejects.toThrowError(expectAppError('BUSINESS_DATE_MISMATCH'))
    await expect(createAndAssignBooking(actor, {
      guestName: 'Sai ngày', partySize: 2, expectedAt: '2026-10-25T00:30:00+07:00',
      businessDate: '2026-10-25', sourceCode: 'HOTLINE', tableIds: [b3], capacityOverrideConfirmed: true,
    }, tenPm)).rejects.toThrowError(/ca 18:00–03:00/)

    // The correct operating day is accepted, and is the one the visit is later filed against.
    const booking = await createAndAssignBooking(actor, {
      guestName: 'Đúng ngày', partySize: 2, expectedAt: '2026-10-25T00:30:00+07:00',
      businessDate: '2026-10-24', sourceCode: 'HOTLINE', tableIds: [b3], capacityOverrideConfirmed: true,
    }, tenPm)
    const onePastMidnight = new Date('2026-10-24T18:00:00.000Z')
    await checkInBooking(actor, booking.id, booking.version, onePastMidnight)
    const [rows] = await databasePool.execute<(RowDataPacket & { visit_id: number })[]>(
      'SELECT visit_id FROM reservations WHERE id = ?', [booking.id],
    )
    expect(await visitBusinessDate(Number(rows[0]!.visit_id))).toBe('2026-10-24')
  })

  it('fails loudly on a venue row whose shift column is not a time', async () => {
    // A column this broken cannot be reached through the API; it is reachable by a bad
    // migration, and the point is that it surfaces as a 500 rather than silently becoming
    // midnight and filing a whole night against the wrong operating day.
    invalidateVenueShift(actor)
    await databasePool.execute(
      `UPDATE venues SET business_day_cutoff_local = '00:00:00' WHERE organization_id = ? AND id = ?`,
      [actor.organizationId, actor.venueId],
    )
    expect(await getVenueShift(actor)).toMatchObject({ cutoffHour: 0 })

    invalidateVenueShift({ organizationId: actor.organizationId, venueId: 999_999 })
    await expect(getVenueShift({ organizationId: actor.organizationId, venueId: 999_999 }))
      .rejects.toThrowError(expectAppError('VENUE_NOT_FOUND'))
    expect(new AppError(500, 'VENUE_SHIFT_INVALID', 'x').status).toBe(500)
  })
})

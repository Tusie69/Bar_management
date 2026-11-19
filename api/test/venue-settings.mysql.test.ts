import type { RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { databasePool } from '../src/database/pool.js'
import { checkInBooking, confirmBookingLate, createAndAssignBooking } from '../src/modules/bookings/booking.repository.js'
import { getFloorProjection } from '../src/modules/tables/floor-projection.repository.js'
import { updateVenueSettings } from '../src/modules/venues/venue-settings.repository.js'
import { getVenueShift } from '../src/modules/venues/venue-shift.js'
import {
  actor,
  clearFixture,
  initializeFixture,
  login,
  otherVenueId,
  resetFixture,
  tableId,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const origin = 'http://localhost:5173'
const defaults = {
  quickTimes: ['21:00', '21:30', '22:00', '22:30'],
  upcomingMinutes: 10,
  noShowMinutes: 30,
  // TU-38: the shift travels with the rest of the configuration.
  businessDayStartLocal: '17:00:00',
  businessDayCutoffLocal: '05:00:00',
}

mysqlDescribe('venue settings API and dynamic configuration', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(async () => {
    await clearFixture()
    await databasePool.execute(
      `DELETE rp FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
       WHERE r.code = 'CUSTOMER_CARE' AND p.code = 'venue.configure'`,
    )
    await databasePool.execute(
      `DELETE rp FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.code IN ('TEST_SUPER_ADMIN', 'TEST_READ_ONLY_ADMIN')`,
    )
    await databasePool.execute("DELETE FROM roles WHERE code IN ('TEST_SUPER_ADMIN', 'TEST_READ_ONLY_ADMIN')")
  })

  /** `operation_log.changes` is a JSON column, so mysql2 hands it back already parsed. */
  function auditedTypes(changes: unknown): string[] {
    const rows = (typeof changes === 'string' ? JSON.parse(changes) : changes) as { type: string }[]
    return rows.map((row) => row.type)
  }

  async function putSettings(
    username: string,
    body: Record<string, unknown> = defaults,
  ) {
    const session = await login(username)
    return session.agent.put('/api/v1/settings')
      .set('Origin', origin)
      .set('X-CSRF-Token', session.csrfToken)
      .send(body)
  }

  async function setRole(username: string, roleCode: string, canConfigure: boolean) {
    await databasePool.execute(
      `INSERT INTO roles (code, name, is_system) VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [roleCode, roleCode],
    )
    await databasePool.execute(
      `DELETE mr FROM membership_roles mr
       JOIN memberships m ON m.id = mr.membership_id
       JOIN users u ON u.id = m.user_id
       WHERE u.username = ?`,
      [username],
    )
    await databasePool.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
       SELECT m.organization_id, m.id, r.id, ?
       FROM memberships m JOIN users u ON u.id = m.user_id
       JOIN roles r ON r.code = ? WHERE u.username = ?`,
      [actor.venueId, roleCode, username],
    )
    if (canConfigure) {
      await databasePool.execute(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'venue.configure'
         WHERE r.code = ?`,
        [roleCode],
      )
    } else {
      await databasePool.execute(
        `DELETE rp FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
         WHERE r.code = ? AND p.code = 'venue.configure'`,
        [roleCode],
      )
    }
  }

  it('requires authentication and GET is a read-only camelCase venue-scoped fallback', async () => {
    expect((await request(app).get('/api/v1/settings')).status).toBe(401)
    await databasePool.execute(
      "DELETE FROM venue_settings WHERE organization_id = ? AND venue_id = ? AND `key` = 'quick_times'",
      [actor.organizationId, actor.venueId],
    )
    const [beforeVenue] = await databasePool.execute<RowDataPacket[]>(
      'SELECT version, change_seq, updated_at FROM venues WHERE id = ?',
      [actor.venueId],
    )
    const [beforeOperations] = await databasePool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM operation_log WHERE entity_type <> 'auth_session'",
    )

    const { agent } = await login()
    const response = await agent.get('/api/v1/settings')
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual(defaults)

    const [afterVenue] = await databasePool.execute<RowDataPacket[]>(
      'SELECT version, change_seq, updated_at FROM venues WHERE id = ?',
      [actor.venueId],
    )
    const [settings] = await databasePool.execute<RowDataPacket[]>(
      'SELECT * FROM venue_settings WHERE organization_id = ? AND venue_id = ?',
      [actor.organizationId, actor.venueId],
    )
    const [afterOperations] = await databasePool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM operation_log WHERE entity_type <> 'auth_session'",
    )
    expect(afterVenue).toEqual(beforeVenue)
    expect(settings).toEqual([])
    expect(afterOperations).toEqual(beforeOperations)
  })

  it('enforces venue.configure for owner, permission-equivalent super admin and read-only staff', async () => {
    expect((await putSettings('integration_reception')).status).toBe(403)
    expect((await putSettings('integration_owner', {
      quickTimes: ['20:45', '22:15', '00:30'], upcomingMinutes: 15, noShowMinutes: 45,
    })).status).toBe(200)

    await setRole('integration_care', 'CUSTOMER_CARE', true)
    const superAdmin = await putSettings('integration_care', {
      quickTimes: ['19:00', '23:45', '01:00'], upcomingMinutes: 20, noShowMinutes: 50,
    })
    expect(superAdmin.status).toBe(200)
    expect(superAdmin.body).toEqual({
      quickTimes: ['19:00', '23:45', '01:00'], upcomingMinutes: 20, noShowMinutes: 50,
      businessDayStartLocal: '17:00:00', businessDayCutoffLocal: '05:00:00',
    })

    await resetFixture()
    await setRole('integration_care', 'CUSTOMER_CARE', false)
    expect((await putSettings('integration_care')).status).toBe(403)
  })

  it('strictly validates the complete payload and cannot select another venue', async () => {
    const invalid = [
      { quickTimes: ['21:00', '21:00'], upcomingMinutes: 10, noShowMinutes: 30 },
      { quickTimes: ['18:59'], upcomingMinutes: 10, noShowMinutes: 30 },
      { quickTimes: ['01:01'], upcomingMinutes: 10, noShowMinutes: 30 },
      { quickTimes: ['21:00'], upcomingMinutes: 0, noShowMinutes: 30 },
      { quickTimes: ['21:00'], upcomingMinutes: 10.5, noShowMinutes: 30 },
      { quickTimes: ['21:00'], upcomingMinutes: 10, noShowMinutes: 15 },
      { ...defaults, venueId: otherVenueId },
    ]
    for (const body of invalid) {
      const response = await putSettings('integration_owner', body)
      expect(response.status).toBe(400)
    }
    expect((await putSettings('integration_owner', {
      quickTimes: ['19:00', '01:00'], upcomingMinutes: 240, noShowMinutes: 65_535,
    })).status).toBe(200)
  })

  it('updates quick times and thresholds atomically without touching late warning or another venue', async () => {
    const [beforeOther] = await databasePool.execute<RowDataPacket[]>(
      'SELECT version, change_seq, upcoming_warning_minutes, late_warning_minutes, no_show_warning_minutes FROM venues WHERE id = ?',
      [otherVenueId],
    )
    const response = await putSettings('integration_owner', {
      quickTimes: ['20:15', '21:45', '00:15'], upcomingMinutes: 18, noShowMinutes: 42,
    })
    expect(response.status).toBe(200)
    const { agent } = await login()
    expect((await agent.get('/api/v1/settings')).body).toEqual({
      quickTimes: ['20:15', '21:45', '00:15'], upcomingMinutes: 18, noShowMinutes: 42,
      // TU-38: a save that omits the shift keeps the stored pair rather than blanking it.
      businessDayStartLocal: '17:00:00', businessDayCutoffLocal: '05:00:00',
    })
    const [home] = await databasePool.execute<RowDataPacket[]>(
      `SELECT version, change_seq, upcoming_warning_minutes, late_warning_minutes, no_show_warning_minutes
       FROM venues WHERE id = ?`,
      [actor.venueId],
    )
    expect(home[0]).toMatchObject({
      version: 2,
      change_seq: '1',
      upcoming_warning_minutes: 18,
      late_warning_minutes: 15,
      no_show_warning_minutes: 42,
    })
    const [other] = await databasePool.execute<RowDataPacket[]>(
      'SELECT version, change_seq, upcoming_warning_minutes, late_warning_minutes, no_show_warning_minutes FROM venues WHERE id = ?',
      [otherVenueId],
    )
    expect(other).toEqual(beforeOther)
    const [audits] = await databasePool.execute<RowDataPacket[]>(
      "SELECT action, change_seq FROM operation_log WHERE action = 'VENUE_SETTINGS_UPDATED'",
    )
    expect(audits).toEqual([expect.objectContaining({ action: 'VENUE_SETTINGS_UPDATED', change_seq: '1' })])
  })

  it('rolls back quick times when a later venue update fails', async () => {
    await expect(updateVenueSettings(
      { ...actor, userId: 9_999_999, membershipId: 9_999_999 },
      {
        quickTimes: ['20:15'], upcomingMinutes: 17, noShowMinutes: 40,
      },
    )).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' })
    const { agent } = await login()
    expect((await agent.get('/api/v1/settings')).body).toEqual(defaults)
    const [audits] = await databasePool.execute<RowDataPacket[]>(
      "SELECT * FROM operation_log WHERE action = 'VENUE_SETTINGS_UPDATED'",
    )
    expect(audits).toEqual([])
  })

  it('applies updated thresholds to Floor Projection and TU-Call while keeping NO_SHOW manual', async () => {
    const createNow = new Date('2026-11-05T13:00:00.000Z')
    const booking = await createAndAssignBooking(actor, {
      guestName: 'Dynamic threshold guest',
      phoneNumber: '0901234567',
      partySize: 2,
      expectedAt: '2026-11-05T21:30:00+07:00',
      businessDate: '2026-11-05',
      sourceCode: 'HOTLINE',
      tableIds: [tableId],
    }, createNow)

    // canCall không còn đi theo displayState: có số điện thoại là gọi được,
    // kể cả trước cửa sổ UPCOMING và sau ngưỡng no-show.
    const before = await getFloorProjection(actor, '2026-11-05', new Date('2026-11-05T14:19:00.000Z'))
    expect(before.tables[0]).toMatchObject({ displayState: 'BOOKED', claim: { canCall: true } })
    const boundary = await getFloorProjection(actor, '2026-11-05', new Date('2026-11-05T14:20:00.000Z'))
    expect(boundary.tables[0]).toMatchObject({ displayState: 'UPCOMING', claim: { canCall: true } })

    expect((await putSettings('integration_owner', {
      quickTimes: ['21:15', '21:30'], upcomingMinutes: 15, noShowMinutes: 30,
    })).status).toBe(200)
    const expanded = await getFloorProjection(actor, '2026-11-05', new Date('2026-11-05T14:15:00.000Z'))
    expect(expanded.tables[0]).toMatchObject({ displayState: 'UPCOMING', claim: { canCall: true } })
    await confirmBookingLate(actor, booking.id, booking.version, new Date('2026-11-05T14:46:00.000Z'))
    const lateConfirmed = await getFloorProjection(actor, '2026-11-05', new Date('2026-11-05T14:46:00.000Z'))
    expect(lateConfirmed.tables[0]).toMatchObject({ displayState: 'LATE_CONFIRMED', claim: { canCall: true } })
    const noShow = await getFloorProjection(actor, '2026-11-05', new Date('2026-11-05T15:00:00.000Z'))
    expect(noShow.tables[0]).toMatchObject({ displayState: 'NO_SHOW', claim: { canCall: true } })

    const [reservations] = await databasePool.execute<RowDataPacket[]>(
      'SELECT status FROM reservations WHERE id = ?', [booking.id],
    )
    const [allocations] = await databasePool.execute<RowDataPacket[]>(
      `SELECT a.released_at FROM table_allocations a
       JOIN table_holds h ON h.organization_id = a.organization_id AND h.venue_id = a.venue_id AND h.id = a.hold_id
       WHERE h.reservation_id = ?`,
      [booking.id],
    )
    expect(reservations[0]).toMatchObject({ status: 'BOOKED' })
    expect(allocations[0]?.released_at).toBeNull()
  })

  /* ---------------- TU-38: the operating shift is configuration, not a constant ---------------- */

  it('TU-38 saves the shift, invalidates the cache and audits only a real change', async () => {
    const shift = { businessDayStartLocal: '18:00', businessDayCutoffLocal: '03:00' }
    const saved = await putSettings('integration_owner', { ...defaults, ...shift })
    expect(saved.status).toBe(200)
    // "HH:mm" in, "HH:mm:ss" out: the column's own shape, so a client round-trips cleanly.
    expect(saved.body).toMatchObject({
      businessDayStartLocal: '18:00:00', businessDayCutoffLocal: '03:00:00',
    })

    // The booking rules see the new shift immediately, without waiting out the cache TTL.
    expect(await getVenueShift(actor)).toMatchObject({
      startLocal: '18:00:00', cutoffLocal: '03:00:00', startHour: 18, cutoffHour: 3,
    })

    const [changed] = await databasePool.execute<(RowDataPacket & { changes: unknown })[]>(
      `SELECT changes FROM operation_log WHERE action = 'VENUE_SETTINGS_UPDATED'
       AND venue_id = ? ORDER BY id DESC LIMIT 1`,
      [actor.venueId],
    )
    const types = auditedTypes(changed[0]!.changes)
    expect(types).toContain('business_day_start_local')
    expect(types).toContain('business_day_cutoff_local')

    // Saving the same configuration again records the thresholds but not the shift: an entry
    // on every save would bury the one change that moves the operating day.
    expect((await putSettings('integration_owner', { ...defaults, ...shift })).status).toBe(200)
    const [unchanged] = await databasePool.execute<(RowDataPacket & { changes: unknown })[]>(
      `SELECT changes FROM operation_log WHERE action = 'VENUE_SETTINGS_UPDATED'
       AND venue_id = ? ORDER BY id DESC LIMIT 1`,
      [actor.venueId],
    )
    const sameTypes = auditedTypes(unchanged[0]!.changes)
    expect(sameTypes).not.toContain('business_day_start_local')
  })

  it('TU-38 refuses a shift that cannot serve the 19:00-01:00 booking window', async () => {
    for (const shift of [
      // Opens after 19:00, so a 19:00 booking could never be seated.
      { businessDayStartLocal: '20:00', businessDayCutoffLocal: '02:00' },
      // Closes before 01:00, so a 00:30 booking could never be seated.
      { businessDayStartLocal: '11:00', businessDayCutoffLocal: '23:00' },
      // A zero-length shift serves nothing at all.
      { businessDayStartLocal: '17:00', businessDayCutoffLocal: '17:00' },
    ]) {
      const response = await putSettings('integration_owner', { ...defaults, ...shift })
      expect(response.status, JSON.stringify(shift)).toBe(400)
      expect((response.body as { error: { code: string } }).error.code)
        .toBe('SHIFT_CANNOT_SERVE_BOOKING_WINDOW')
    }
    // Nothing was written, so the stored shift still answers.
    expect(await getVenueShift(actor)).toMatchObject({ startLocal: '17:00:00', cutoffLocal: '05:00:00' })
  })

  it('TU-38 rejects a malformed boundary and half a shift', async () => {
    // `thresholds` deliberately drops both shift keys, so each case controls the pair itself.
    const thresholds = {
      quickTimes: defaults.quickTimes,
      upcomingMinutes: defaults.upcomingMinutes,
      noShowMinutes: defaults.noShowMinutes,
    }
    for (const [shift, code] of [
      [{ businessDayStartLocal: '18:00' }, 'INCOMPLETE_BUSINESS_DAY_SHIFT'],
      [{ businessDayCutoffLocal: '03:00' }, 'INCOMPLETE_BUSINESS_DAY_SHIFT'],
      [{ businessDayStartLocal: '18', businessDayCutoffLocal: '03:00' }, 'INVALID_BUSINESS_DAY_SHIFT'],
      [{ businessDayStartLocal: '24:00', businessDayCutoffLocal: '03:00' }, 'INVALID_BUSINESS_DAY_SHIFT'],
      [{ businessDayStartLocal: '18:60', businessDayCutoffLocal: '03:00' }, 'INVALID_BUSINESS_DAY_SHIFT'],
      [{ businessDayStartLocal: 18, businessDayCutoffLocal: '03:00' }, 'INVALID_BUSINESS_DAY_SHIFT'],
    ] as const) {
      const response = await putSettings('integration_owner', { ...thresholds, ...shift })
      expect(response.status, JSON.stringify(shift)).toBe(400)
      expect((response.body as { error: { code: string } }).error.code, JSON.stringify(shift)).toBe(code)
    }
    // An unknown key is still refused, so the payload cannot grow silently.
    expect((await putSettings('integration_owner', { ...defaults, extra: 1 })).status).toBe(400)
    // Omitting the pair entirely is the existing contract and stays valid.
    expect((await putSettings('integration_owner', thresholds)).status).toBe(200)
  })

  it('TU-38 refuses to move the shift while a party is still seated', async () => {
    const booking = await createAndAssignBooking(actor, {
      guestName: 'Đang ngồi', partySize: 2, expectedAt: '2030-10-24T21:00:00+07:00',
      businessDate: '2030-10-24', sourceCode: 'HOTLINE', tableIds: [tableId],
      capacityOverrideConfirmed: true,
    }, new Date('2030-10-24T13:00:00.000Z'))
    await checkInBooking(actor, booking.id, booking.version, new Date('2030-10-24T14:30:00.000Z'))

    const refused = await putSettings('integration_owner', {
      ...defaults, businessDayStartLocal: '18:00', businessDayCutoffLocal: '03:00',
    })
    expect(refused.status).toBe(409)
    expect((refused.body as { error: { code: string } }).error.code).toBe('SHIFT_CHANGE_WITH_OPEN_VISITS')
    // The rest of the configuration is not half-applied: the whole save was refused.
    expect(await getVenueShift(actor)).toMatchObject({ startLocal: '17:00:00' })
    expect((await login('integration_owner')).agent).toBeDefined()

    // The same save with the shift left out is accepted, because nothing moves.
    expect((await putSettings('integration_owner', { ...defaults, upcomingMinutes: 18 })).status).toBe(200)
  })
})

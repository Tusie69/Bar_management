import { readFile, readdir } from 'node:fs/promises'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { getBookingById, type BookingView } from '../src/modules/bookings/booking.repository.js'
import { listNoShowCandidates } from '../src/modules/bookings/no-show.worker.js'
import { getTableCatalog } from '../src/modules/tables/table.repository.js'
import { getVenueSettings, type VenueSettings } from '../src/modules/venues/venue-settings.repository.js'
import { actor, clearFixture, initializeFixture, login, otherOrganizationId, otherVenueId, resetFixture, tableId } from './support/integration-fixture.js'

const bookingResponse = (response: { body: unknown }): BookingView => (response.body as { booking: BookingView }).booking

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip
const body = { guestName: 'NA-14 guest', partySize: 2, businessDate: '2030-10-24',
  expectedAt: '2030-10-24T21:00:00+07:00', sourceCode: 'HOTLINE' }

mysqlDescribe('NA-14 API and tenant isolation', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterEach(() => vi.useRealTimers())
  afterAll(clearFixture)

  it('persists defaults, direct assignments, metadata-only edits and legacy writes', async () => {
    const { agent, csrfToken } = await login()
    const post = (path: string, value: object) => agent.post(path).set('Origin', env.webOrigin).set('x-csrf-token', csrfToken).send(value)
    const oldClient = await post('/api/v1/bookings', body)
    expect(oldClient.status).toBe(201)
    expect(bookingResponse(oldClient)).toMatchObject({ guestType: 'NEW', isBirthday: false, lateConfirmedAt: null })
    const created = await post('/api/v1/bookings/direct', { ...body, guestType: 'REGULAR', isBirthday: true, tableIds: [tableId] })
    expect(created.status).toBe(201)
    expect(bookingResponse(created)).toMatchObject({ guestType: 'REGULAR', classification: 'RETURNING', isBirthday: true, lateConfirmedAt: null })
    const id = Number(bookingResponse(created).id)
    await databasePool.execute("UPDATE reservations SET late_confirmed_at = '2030-10-24 14:05:00.123' WHERE id = ?", [id])
    const update = (value: object) => agent.put(`/api/v1/bookings/${id}`).set('Origin', env.webOrigin).set('x-csrf-token', csrfToken).send({ ...body, ...value })
    const legacyEdit = await update({ version: bookingResponse(created).version, guestName: 'Legacy rename' })
    expect(legacyEdit.status).toBe(200)
    expect(bookingResponse(legacyEdit)).toMatchObject({ guestType: 'REGULAR', isBirthday: true, lateConfirmedAt: '2030-10-24T14:05:00.123Z' })
    const changed = await update({ version: bookingResponse(legacyEdit).version, guestName: 'Legacy rename', guestType: 'NEW', isBirthday: false })
    expect(changed.status).toBe(200)
    expect(bookingResponse(changed)).toMatchObject({ guestType: 'NEW', classification: 'NEW', isBirthday: false, lateConfirmedAt: '2030-10-24T14:05:00.123Z' })
    expect(bookingResponse(await agent.get(`/api/v1/bookings/${id}`))).toMatchObject(bookingResponse(changed))
    const [audit] = await databasePool.execute<RowDataPacket[]>("SELECT changes FROM operation_log WHERE entity_id = ? AND action = 'RESERVATION_UPDATED' ORDER BY id DESC LIMIT 1", [id])
    expect(JSON.stringify(audit)).toContain('isBirthday')
    expect(((await agent.get('/api/v1/bookings?date=2030-10-24')).body as { bookings: BookingView[] }).bookings).toHaveLength(2)
    for (const invalid of [{ guestType: 'VIP' }, { guestType: null }, { isBirthday: 1 }, { lateConfirmedAt: null }, { guestType: 'NEW', classification: 'RETURNING' }]) {
      expect((await post('/api/v1/bookings', { ...body, ...invalid })).status).toBe(400)
      expect((await update({ ...invalid, version: bookingResponse(changed).version })).status).toBe(400)
    }
    expect(bookingResponse(await post('/api/v1/bookings', { ...body, classification: 'RETURNING' })).guestType).toBe('REGULAR')
    expect((await agent.get('/api/v1/bookings/export?date=2030-10-24')).status).toBe(200)
  })

  it('initializes each venue without overwriting settings and refuses cross-tenant access', async () => {
    const { agent } = await login()
    const home = await agent.get(`/api/v1/venues/${actor.venueId}/settings`)
    expect(home.status).toBe(200)
    expect((home.body as { settings: VenueSettings }).settings).toEqual({ quick_times: ['21:00', '21:30', '22:00', '22:30'], upcoming_minutes: 10, no_show_minutes: 30 })
    expect((await agent.get(`/api/v1/venues/${otherVenueId}/settings`)).status).toBe(404)
    expect((await agent.get(`/api/v1/venues/${otherOrganizationId}/settings`)).status).toBe(404)
    expect((await agent.put(`/api/v1/venues/${otherVenueId}/settings`).set('Origin', env.webOrigin).send({ no_show_minutes: 1 })).status).toBe(404)
    await expect(getVenueSettings({ organizationId: otherOrganizationId, venueId: actor.venueId })).rejects.toMatchObject({ status: 404 })
    await databasePool.execute('UPDATE venue_settings SET `value` = ? WHERE venue_id = ? AND `key` = ?', ['45', actor.venueId, 'no_show_minutes'])
    await databasePool.execute('DELETE FROM venue_settings WHERE venue_id = ? AND `key` = ?', [actor.venueId, 'upcoming_minutes'])
    expect((await getVenueSettings(actor)).no_show_minutes).toBe(45)
    expect((await getVenueSettings(actor)).upcoming_minutes).toBe(10)
    expect((await getTableCatalog(actor)).venue.noShowWarningMinutes).toBe(45)
    await expect(databasePool.execute('INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`) VALUES (?, ?, ?, ?)', [actor.organizationId, actor.venueId, 'no_show_minutes', '30'])).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' })
    await expect(databasePool.execute('INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`) VALUES (?, ?, ?, ?)', [otherOrganizationId, actor.venueId, 'foreign', '30'])).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' })
    await databasePool.execute('UPDATE venue_settings SET `value` = ? WHERE venue_id = ? AND `key` = ?', ['"30"', actor.venueId, 'no_show_minutes'])
    expect((await getVenueSettings(actor)).no_show_minutes).toBe(30)
    await databasePool.execute('UPDATE venue_settings SET `value` = ? WHERE venue_id = ? AND `key` = ?', ['["99:00"]', actor.venueId, 'quick_times'])
    expect((await getVenueSettings(actor)).quick_times).toEqual((home.body as { settings: VenueSettings }).settings.quick_times)
  })

  it('uses one no-show threshold for booking, catalog and the existing opt-in worker', async () => {
    const { agent, csrfToken } = await login()
    const created = await agent.post('/api/v1/bookings').set('Origin', env.webOrigin).set('x-csrf-token', csrfToken).send(body)
    const now = new Date('2030-10-24T14:35:00Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const cutoff = new Date('2000-01-01T00:00:00Z')
    await databasePool.execute('UPDATE venue_settings SET `value` = ? WHERE venue_id = ? AND `key` = ?', ['45', actor.venueId, 'no_show_minutes'])
    expect(await listNoShowCandidates(actor.organizationId, actor.venueId, now, cutoff)).toEqual([])
    expect(await getBookingById(actor, Number(bookingResponse(created).id))).toMatchObject({ displayStatus: 'LATE', autoNoShowDue: false })
    expect((await getBookingById(actor, Number(bookingResponse(created).id))).status).toBe('BOOKED')
    expect(env.noShowWorker.enabled).toBe(false)
    await databasePool.execute('UPDATE venue_settings SET `value` = ? WHERE venue_id = ? AND `key` = ?', ['30', actor.venueId, 'no_show_minutes'])
    expect(await listNoShowCandidates(actor.organizationId, actor.venueId, now, cutoff)).toHaveLength(1)
    expect(await getBookingById(actor, Number(bookingResponse(created).id))).toMatchObject({ displayStatus: 'LATE', autoNoShowDue: true })
    expect((await getBookingById(actor, Number(bookingResponse(created).id))).status).toBe('BOOKED')
  })
})

mysqlDescribe('NA-14 migration and guarded demo seed', () => {
  it('preserves legacy rows, validates DB constraints, seeds a fresh schema and preserves RBAC', async () => {
    const databaseName = `gam21_na14_${process.pid}_${Date.now()}_test`
    if (env.database.name !== 'gam21_platform_it_test') throw new Error('Isolated integration database required')
    await databasePool.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
    const config = { host: env.database.host, port: env.database.port, user: env.database.user, password: env.database.password, multipleStatements: true, timezone: 'Z' }
    const connection = await mysql.createConnection({ ...config, database: databaseName })
    try {
      const files = (await readdir('database/migrations')).filter((file) => file.endsWith('.sql')).sort()
      for (const file of files.filter((file) => !file.startsWith('0008_'))) await connection.query(await readFile(`database/migrations/${file}`, 'utf8'))
      await connection.query(`INSERT INTO organizations (id,code,name) VALUES (1,'OLD','Old org');
        INSERT INTO venues (id,organization_id,code,name,no_show_warning_minutes) VALUES (1,1,'OLD','Old venue',45);
        INSERT INTO booking_sources (id,organization_id,code,name) VALUES (1,1,'HOTLINE','Hotline');
        INSERT INTO users (id,username,display_name,password_hash,status) VALUES (1,'legacy','Legacy','!NO_LOGIN','DISABLED');
        INSERT INTO reservations (id,organization_id,venue_id,source_id,contact_name,party_size,expected_at,business_date,customer_classification,created_by_user_id)
        VALUES (1,1,1,1,'Returning',2,'2030-10-24 14:00:00','2030-10-24','RETURNING',1),
          (2,1,1,1,'New',3,'2030-10-24 14:00:00','2030-10-24','NEW',1),
          (3,1,1,1,'Unclassified',4,'2030-10-24 14:00:00','2030-10-24','UNCLASSIFIED',1),
          (4,1,1,1,'Null',5,'2030-10-24 14:00:00','2030-10-24',NULL,1);`)
      const [before] = await connection.query<RowDataPacket[]>('SELECT id,contact_name,party_size,expected_at,business_date,customer_classification FROM reservations ORDER BY id')
      await connection.query(await readFile('database/migrations/0008_booking_metadata_venue_settings.sql', 'utf8'))
      const [after] = await connection.query<RowDataPacket[]>('SELECT id,contact_name,party_size,expected_at,business_date,customer_classification FROM reservations ORDER BY id')
      expect(after).toEqual(before)
      const [metadata] = await connection.query<RowDataPacket[]>('SELECT guest_type,is_birthday,late_confirmed_at FROM reservations ORDER BY id')
      expect(metadata.map((row) => String(row.guest_type))).toEqual(['REGULAR','NEW','NEW','NEW'])
      expect(metadata.every((row) => row.is_birthday === 0 && row.late_confirmed_at === null)).toBe(true)
      expect((await getVenueSettings({ organizationId: 1, venueId: 1 }, connection)).no_show_minutes).toBe(45)
      await expect(connection.query("UPDATE reservations SET guest_type='VIP' WHERE id=2")).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
      await expect(connection.query('UPDATE reservations SET is_birthday=2 WHERE id=2')).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
      await expect(connection.query("UPDATE reservations SET guest_type='NEW' WHERE id=1")).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
      await connection.query("INSERT INTO reservations (organization_id,venue_id,source_id,contact_name,party_size,expected_at,business_date,created_by_user_id) VALUES (1,1,1,'Default guest',2,'2030-10-24 14:00:00','2030-10-24',1)")
      const [defaults] = await connection.query<RowDataPacket[]>('SELECT guest_type,is_birthday,late_confirmed_at FROM reservations ORDER BY id DESC LIMIT 1')
      expect(defaults[0]).toMatchObject({ guest_type: 'NEW', is_birthday: 0, late_confirmed_at: null })
    } finally {
      await connection.end()
      await databasePool.query(`DROP DATABASE \`${databaseName}\``)
    }

    const seedDatabase = `${databaseName.slice(0, -5)}_seed_test`
    await databasePool.query(`CREATE DATABASE \`${seedDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
    const seed = await mysql.createConnection({ ...config, database: seedDatabase })
    try {
      for (const file of (await readdir('database/migrations')).filter((file) => file.endsWith('.sql')).sort()) await seed.query(await readFile(`database/migrations/${file}`, 'utf8'))
      const [grants] = await seed.query<RowDataPacket[]>('SELECT * FROM role_permissions ORDER BY role_id,permission_id')
      const [permissions] = await seed.query<RowDataPacket[]>('SELECT * FROM permissions ORDER BY id')
      await seed.query(await readFile('database/seeds/demo.sql', 'utf8'))
      expect((await seed.query('SELECT * FROM permissions ORDER BY id'))[0]).toEqual(permissions)
      expect((await seed.query('SELECT * FROM role_permissions ORDER BY role_id,permission_id'))[0]).toEqual(grants)
      expect((await seed.query<RowDataPacket[]>('SELECT * FROM venue_settings'))[0]).toHaveLength(6)
      const [examples] = await seed.query<RowDataPacket[]>('SELECT guest_type,is_birthday,late_confirmed_at FROM reservations WHERE venue_id=1 AND id IN (5,6,7) ORDER BY id')
      expect(examples[0]).toMatchObject({ guest_type: 'NEW', is_birthday: 0 })
      expect(examples[0]?.late_confirmed_at).not.toBeNull()
      expect(examples[1]).toMatchObject({ guest_type: 'REGULAR', is_birthday: 0, late_confirmed_at: null })
      expect(examples[2]).toMatchObject({ guest_type: 'REGULAR', is_birthday: 1, late_confirmed_at: null })
      await expect(seed.query(await readFile('database/seeds/demo.sql', 'utf8'))).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
    } finally {
      await seed.end()
      await databasePool.query(`DROP DATABASE \`${seedDatabase}\``)
    }
  }, 30_000)
})

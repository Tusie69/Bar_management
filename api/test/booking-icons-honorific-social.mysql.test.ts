/**
 * Migration 0016 added is_boss_table, is_designated, social_platform and
 * honorific to `reservations`, but no API read or wrote them: the receptionist's
 * icons, Mr/Ms and Social platform were collected and then dropped in silence.
 *
 * These tests pin the wiring: the three fields round-trip through create,
 * create-and-assign and update, bad values are refused with a 400 of their own,
 * the platform is cleared whenever the source leaves SOCIAL, and a booking
 * written before 0016 (all four columns at their defaults) still reads back.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  checkInBooking,
  createAndAssignBooking,
  createBooking,
  getBookingById,
  listBookings,
  updateBooking,
  type CreateAndAssignBookingInput,
} from '../src/modules/bookings/booking.repository.js'
import { getFloorProjection } from '../src/modules/tables/floor-projection.repository.js'
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

const now = new Date(`${businessDate}T19:00:00+07:00`)
const expectedAt = `${businessDate}T21:00:00+07:00`

interface FlagRow extends RowDataPacket {
  is_boss_table: number
  is_designated: number
  social_platform: string | null
  honorific: string | null
}

async function storedFlags(id: number): Promise<FlagRow> {
  const [rows] = await databasePool.execute<FlagRow[]>(
    'SELECT is_boss_table, is_designated, social_platform, honorific FROM reservations WHERE id = ?',
    [id],
  )
  return rows[0]!
}

/** The fixture only seeds HOTLINE; SOCIAL is the source that carries a platform. */
async function addSocialSource(): Promise<void> {
  await databasePool.execute(
    "INSERT INTO booking_sources (organization_id, code, name) VALUES (?, 'SOCIAL', 'Social')",
    [actor.organizationId],
  )
}

const base = {
  guestName: 'Khach icon',
  partySize: 2,
  expectedAt,
  businessDate,
  sourceCode: 'HOTLINE',
} as const

/** Repository input: the extras are contextually typed, so 'IG' stays a SocialPlatform. */
function input<T extends Partial<CreateAndAssignBookingInput>>(extra: T = {} as T) {
  return { ...base, ...extra }
}

/** HTTP body: deliberately untyped, so a test can send a value the API must refuse. */
function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...base, ...extra }
}

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code
}

mysqlDescribe('0016 icons, honorific and Social platform through the API', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addSocialSource()
  })
  afterAll(clearFixture)

  it('stores and returns the three fields on create', async () => {
    const booking = await createBooking(
      actor,
      input({
        sourceCode: 'SOCIAL',
        socialPlatform: 'IG',
        honorific: 'MR',
        iconFlags: { isBossTable: true, isDesignated: false },
      }),
      now,
    )
    expect(booking.iconKeys).toEqual(['star'])
    expect(booking.honorific).toBe('MR')
    expect(booking.socialPlatform).toBe('IG')
    expect(await storedFlags(booking.id)).toMatchObject({
      is_boss_table: 1,
      is_designated: 0,
      social_platform: 'IG',
      honorific: 'MR',
    })
    // The same values come back through detail and list, not just the create reply.
    expect(await getBookingById(actor, booking.id)).toMatchObject({
      iconKeys: ['star'],
      honorific: 'MR',
      socialPlatform: 'IG',
    })
    const listed = (await listBookings(actor, businessDate)).find((row) => row.id === booking.id)
    expect(listed).toMatchObject({ iconKeys: ['star'], honorific: 'MR', socialPlatform: 'IG' })
  })

  it('stores the three fields on create-and-assign too', async () => {
    const booking = await createAndAssignBooking(
      actor,
      input({
        tableIds: [tableId],
        sourceCode: 'SOCIAL',
        socialPlatform: 'GG_REVIEW',
        honorific: 'MS',
        iconFlags: { isBossTable: true, isDesignated: true },
      }),
      now,
    )
    expect(booking.iconKeys).toEqual(['star', 'pin'])
    expect(booking.honorific).toBe('MS')
    expect(booking.socialPlatform).toBe('GG_REVIEW')
  })

  it('never stores a platform for a source that is not SOCIAL', async () => {
    const booking = await createBooking(actor, input({ sourceCode: 'HOTLINE', socialPlatform: 'FB' }), now)
    expect(booking.socialPlatform).toBeNull()
    expect((await storedFlags(booking.id)).social_platform).toBeNull()
  })

  it('edits each field and clears it again on update', async () => {
    const created = await createBooking(
      actor,
      input({
        sourceCode: 'SOCIAL',
        socialPlatform: 'FB',
        honorific: 'MR',
        iconFlags: { isBossTable: true, isDesignated: false },
      }),
      now,
    )
    const edited = await updateBooking(
      actor,
      created.id,
      {
        ...input({ sourceCode: 'SOCIAL' }),
        socialPlatform: 'TIKTOK',
        honorific: 'MS',
        iconFlags: { isBossTable: false, isDesignated: true },
        expectedVersion: created.version,
      },
      now,
    )
    expect(edited).toMatchObject({ iconKeys: ['pin'], honorific: 'MS', socialPlatform: 'TIKTOK' })

    const cleared = await updateBooking(
      actor,
      created.id,
      {
        ...input({ sourceCode: 'SOCIAL' }),
        socialPlatform: null,
        honorific: null,
        iconFlags: { isBossTable: false, isDesignated: false },
        expectedVersion: edited.version,
      },
      now,
    )
    expect(cleared).toMatchObject({ iconKeys: [], honorific: null, socialPlatform: null })
  })

  it('keeps the stored values when the update omits the fields', async () => {
    const created = await createBooking(
      actor,
      input({
        sourceCode: 'SOCIAL',
        socialPlatform: 'IG',
        honorific: 'MR',
        iconFlags: { isBossTable: true, isDesignated: true },
      }),
      now,
    )
    const edited = await updateBooking(
      actor,
      created.id,
      { ...input({ sourceCode: 'SOCIAL', partySize: 5 }), expectedVersion: created.version },
      now,
    )
    expect(edited).toMatchObject({ iconKeys: ['star', 'pin'], honorific: 'MR', socialPlatform: 'IG' })
  })

  it('clears the platform when the update moves the booking off SOCIAL', async () => {
    const created = await createBooking(actor, input({ sourceCode: 'SOCIAL', socialPlatform: 'THREADS' }), now)
    expect(created.socialPlatform).toBe('THREADS')
    const moved = await updateBooking(
      actor,
      created.id,
      { ...input({ sourceCode: 'HOTLINE' }), expectedVersion: created.version },
      now,
    )
    expect(moved.sourceCode).toBe('HOTLINE')
    expect(moved.socialPlatform).toBeNull()
    expect((await storedFlags(created.id)).social_platform).toBeNull()
  })

  it('also clears the platform when the client still sends one with the new source', async () => {
    const created = await createBooking(actor, input({ sourceCode: 'SOCIAL', socialPlatform: 'FB' }), now)
    const moved = await updateBooking(
      actor,
      created.id,
      { ...input({ sourceCode: 'HOTLINE' }), socialPlatform: 'FB', expectedVersion: created.version },
      now,
    )
    expect(moved.socialPlatform).toBeNull()
  })

  it('counts a changed icon alone as a change worth saving', async () => {
    const created = await createBooking(actor, input(), now)
    const edited = await updateBooking(
      actor,
      created.id,
      { ...input(), iconFlags: { isBossTable: true, isDesignated: false }, expectedVersion: created.version },
      now,
    )
    expect(edited.iconKeys).toEqual(['star'])
    expect(edited.version).toBe(created.version + 1)
  })

  it('reads a booking written before 0016 back as "nothing set"', async () => {
    const created = await createBooking(actor, input(), now)
    // A row at the migration's defaults is exactly what an older booking looks like.
    await databasePool.execute(
      `UPDATE reservations SET is_boss_table = 0, is_designated = 0, social_platform = NULL, honorific = NULL
       WHERE id = ?`,
      [created.id],
    )
    expect(await getBookingById(actor, created.id)).toMatchObject({
      iconKeys: [],
      honorific: null,
      socialPlatform: null,
    })
  })

  it('carries the honorific and icons into the floor claim, before and after check-in', async () => {
    const booking = await createAndAssignBooking(
      actor,
      input({ tableIds: [tableId], honorific: 'MS', iconFlags: { isBossTable: true, isDesignated: false } }),
      now,
    )
    const reserved = (await getFloorProjection(actor, businessDate, now)).tables
      .find((entry) => Number(entry.tableId) === tableId)?.claim
    expect(reserved).toMatchObject({ kind: 'RESERVATION', honorific: 'MS', iconKeys: ['star'] })

    await checkInBooking(actor, booking.id, booking.version, now)
    const seated = (await getFloorProjection(actor, businessDate, now)).tables
      .find((entry) => Number(entry.tableId) === tableId)?.claim
    expect(seated).toMatchObject({ kind: 'VISIT', honorific: 'MS', iconKeys: ['star'] })
  })

  it('refuses a bad value over HTTP with a 400 and its own code', async () => {
    const { agent, csrfToken } = await login()
    const post = (body: Record<string, unknown>) =>
      agent.post('/api/v1/bookings').set('Origin', env.webOrigin).set('X-CSRF-Token', csrfToken).send(body)

    const badHonorific = await post(body({ honorific: 'MRS' }))
    expect(badHonorific.status).toBe(400)
    expect(errorCode(badHonorific.body)).toBe('INVALID_HONORIFIC')

    const badPlatform = await post(body({ sourceCode: 'SOCIAL', socialPlatform: 'FACEBOOK' }))
    expect(badPlatform.status).toBe(400)
    expect(errorCode(badPlatform.body)).toBe('INVALID_SOCIAL_PLATFORM')

    const badIcon = await post(body({ iconKeys: ['rocket'] }))
    expect(badIcon.status).toBe(400)
    expect(errorCode(badIcon.body)).toBe('INVALID_ICON_KEYS')
  })

  it('round-trips the three fields over HTTP', async () => {
    const { agent, csrfToken } = await login()
    const created = await agent
      .post('/api/v1/bookings')
      .set('Origin', env.webOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send(body({ sourceCode: 'SOCIAL', socialPlatform: 'IG', honorific: 'MR', iconKeys: ['star', 'pin'] }))
    expect(created.status).toBe(201)
    const booking = (created.body as { booking: { id: number; version: number } }).booking
    expect(booking).toMatchObject({ iconKeys: ['star', 'pin'], honorific: 'MR', socialPlatform: 'IG' })

    const updated = await agent
      .put(`/api/v1/bookings/${booking.id}`)
      .set('Origin', env.webOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send({
        ...body({ sourceCode: 'HOTLINE' }),
        iconKeys: [],
        honorific: null,
        socialPlatform: 'IG',
        version: booking.version,
      })
    expect(updated.status).toBe(200)
    expect((updated.body as { booking: Record<string, unknown> }).booking).toMatchObject({
      iconKeys: [],
      honorific: null,
      socialPlatform: null,
    })
  })
})

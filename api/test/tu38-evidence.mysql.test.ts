/**
 * TU-38 — HTTP evidence for the Sổ lượt tới quán statistics.
 *
 * Drives the real Express app over HTTP (login, cookies, CSRF, RBAC and all) against the
 * integration database and prints each request and response, so the transcript in
 * fix-reports/TU-38_TURN_STATISTICS.md is a recording rather than a hand-written example.
 *
 * Run with --disableConsoleIntercept to see the transcript:
 *   $env:RUN_MYSQL_INTEGRATION='1'; $env:DB_NAME='gam21_platform_it_test'; $env:NODE_ENV='test'
 *   npx vitest run test/tu38-evidence.mysql.test.ts --disableConsoleIntercept
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { databasePool } from '../src/database/pool.js'
import {
  checkInBooking,
  createAndAssignBooking,
} from '../src/modules/bookings/booking.repository.js'
import { createLayoutGroup } from '../src/modules/tables/table-layout-group.repository.js'
import { closeVisit } from '../src/modules/visits/visit.repository.js'
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

const b3 = 9840
const b4 = 9841
const b5 = 9842
const deviceActor = { ...actor, authSessionId: 25_201 }

async function serve(name: string, tableIds: number[], partySize: number): Promise<void> {
  const booking = await createAndAssignBooking(actor, {
    guestName: name,
    partySize,
    expectedAt: `${businessDate}T21:00:00+07:00`,
    businessDate,
    sourceCode: 'HOTLINE',
    tableIds,
    capacityOverrideConfirmed: true,
  })
  await checkInBooking(actor, booking.id, booking.version, new Date(`${businessDate}T21:30:00+07:00`))
  const [rows] = await databasePool.execute<(RowDataPacket & { visit_id: number })[]>(
    'SELECT visit_id FROM reservations WHERE id = ?', [booking.id],
  )
  const visitId = Number(rows[0]!.visit_id)
  const [visits] = await databasePool.execute<(RowDataPacket & { version: number })[]>(
    'SELECT version FROM visits WHERE id = ?', [visitId],
  )
  await closeVisit(actor, {
    visitId, expectedVersion: Number(visits[0]!.version), mode: 'MANUAL', reason: 'GUEST_LEFT',
  })
}

mysqlDescribe('TU-38 HTTP evidence', () => {
  beforeAll(async () => {
    await initializeFixture()
    await resetFixture()
    await databasePool.execute(
      `INSERT INTO dining_tables
        (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
       VALUES (?, ?, ?, ?, 'B3', 'B3', 'TABLE', 4, 10, 20),
         (?, ?, ?, ?, 'B4', 'B4', 'TABLE', 4, 20, 20),
         (?, ?, ?, ?, 'B5', 'B5', 'TABLE', 4, 30, 20)`,
      [b3, actor.organizationId, actor.venueId, tableId,
        b4, actor.organizationId, actor.venueId, tableId,
        b5, actor.organizationId, actor.venueId, tableId],
    )
    await createLayoutGroup(deviceActor, { tableCodes: ['B3', 'B4'] })
    await serve('Nhóm bạn Hà', [b3], 6)
    await serve('Nhóm bạn Hà 2', [b3], 4)
    await serve('Anh Minh', [b5], 3)
  }, 120_000)
  afterAll(clearFixture)

  it('records the transcript of each documented call', async () => {
    const owner = await login('integration_owner')
    const reception = await login('integration_reception')
    const base = `/api/v1/visits/turns/summary?from=${businessDate}&to=${businessDate}`

    const calls: readonly (readonly [string, string, Awaited<ReturnType<typeof owner.agent.get>>])[] = [
      ['owner, one operating day', base, await owner.agent.get(base)],
      ['owner, including zero-turn scopes', `${base}&includeZeroScopes=true`,
        await owner.agent.get(`${base}&includeZeroScopes=true`)],
      ['owner, a month', `/api/v1/visits/turns/summary?from=${businessDate.slice(0, 7)}-01&to=${businessDate.slice(0, 7)}-31`,
        await owner.agent.get(`/api/v1/visits/turns/summary?from=${businessDate.slice(0, 7)}-01&to=${businessDate.slice(0, 7)}-31`)],
      ['receptionist, no report.read', base, await reception.agent.get(base)],
      ['owner, invalid includeZeroScopes', `${base}&includeZeroScopes=1`,
        await owner.agent.get(`${base}&includeZeroScopes=1`)],
    ]

    for (const [label, path, response] of calls) {
      console.log([
        `### ${label}`,
        '',
        '```http',
        `GET ${path}`,
        '',
        `HTTP/1.1 ${response.status}`,
        '```',
        '',
        '```json',
        JSON.stringify(response.body, null, 2),
        '```',
        '',
      ].join('\n'))
    }

    expect(calls.map(([, , response]) => response.status)).toEqual([200, 200, 200, 403, 400])
  }, 120_000)
})

/**
 * TU-38 AC07 — one month of sample data, measured, with the query plans printed.
 *
 * Kept apart from the behaviour suite: this file seeds thousands of rows and its job is
 * to produce evidence (milliseconds and EXPLAIN), not to assert business rules.
 *
 * Run with:
 *   $env:RUN_MYSQL_INTEGRATION='1'; $env:DB_NAME='gam21_platform_it_test'; $env:NODE_ENV='test'
 *   npx vitest run test/tu38-turn-statistics-benchmark.mysql.test.ts
 */
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { databasePool } from '../src/database/pool.js'
import { summarizeTableTurns, turnProjection } from '../src/modules/visits/table-turn.repository.js'
import { actor, clearFixture, initializeFixture, resetFixture, tableId } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const firstTableId = 9850
/**
 * 30 tables × 30 operating days × 2 parties a night = 1 800 turns in a month of a busy bar.
 *
 * Three months are seeded and one is queried: with only the target month in the table the
 * optimizer would rightly scan it whole, and the plan would prove nothing about the index.
 */
const tableCount = 30
const dayCount = 30
const turnsPerTablePerDay = 2
const months = ['07', '08', '09'] as const
const month = '2030-09'
const from = `${month}-01`
const to = `${month}-30`
const budgetMs = 2000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

async function seedMonth(): Promise<number> {
  const tables: unknown[] = []
  const tableValues: string[] = []
  for (let index = 0; index < tableCount; index++) {
    tableValues.push("(?, ?, ?, ?, ?, ?, 'TABLE', 4, ?, 0, 0)")
    tables.push(firstTableId + index, actor.organizationId, actor.venueId, tableId,
      `P${pad(index + 1)}`, `P${pad(index + 1)}`, (index + 1) * 10)
  }
  await databasePool.query(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y, is_spare)
     VALUES ${tableValues.join(',')}`,
    tables,
  )

  let id = 500_000
  const visitRows: unknown[][] = []
  const turnRows: unknown[][] = []
  let targetMonthTurns = 0
  for (const monthPart of months) {
    for (let day = 1; day <= dayCount; day++) {
      const businessDate = `2030-${monthPart}-${pad(day)}`
      for (let index = 0; index < tableCount; index++) {
        for (let turnNo = 1; turnNo <= turnsPerTablePerDay; turnNo++) {
          id += 1
          const seated = `${businessDate} ${pad(12 + turnNo)}:00:00.000`
          const released = `${businessDate} ${pad(13 + turnNo)}:00:00.000`
          visitRows.push([id, actor.organizationId, actor.venueId, 'WALK_IN', 2 + (index % 6),
            seated, businessDate, released, 'GUEST_LEFT', actor.userId, actor.userId, `Khách ${id}`])
          turnRows.push([id, actor.organizationId, actor.venueId, businessDate, 'TABLE',
            firstTableId + index, turnNo, id, `["P${pad(index + 1)}"]`, `[${firstTableId + index}]`,
            `Khách ${id}`, 2 + (index % 6), 'WALK_IN', seated, released, 'GUEST_LEFT', released, actor.userId])
          if (businessDate.startsWith(month)) targetMonthTurns += 1
        }
      }
    }
  }

  const chunk = 500
  for (let offset = 0; offset < visitRows.length; offset += chunk) {
    const slice = visitRows.slice(offset, offset + chunk)
    await databasePool.query(
      `INSERT INTO visits (id, organization_id, venue_id, origin, guest_count, started_at, business_date,
         ended_at, end_reason, ended_by_user_id, created_by_user_id, contact_name)
       VALUES ${slice.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
      slice.flat(),
    )
  }
  for (let offset = 0; offset < turnRows.length; offset += chunk) {
    const slice = turnRows.slice(offset, offset + chunk)
    await databasePool.query(
      `INSERT INTO table_turns (visit_id, organization_id, venue_id, business_date, scope, table_id,
         turn_no, id, table_codes_snapshot, member_table_ids, guest_name, guest_count, origin,
         seated_at, released_at, end_reason, completed_at, closed_by_user_id)
       VALUES ${slice.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
      slice.flat(),
    )
  }
  await databasePool.query('ANALYZE TABLE visits, table_turns, dining_tables, table_allocations')
  return targetMonthTurns
}

interface ExplainRow extends RowDataPacket {
  EXPLAIN: string
}

/** The four aggregates the endpoint runs, named so the printed plans can be told apart. */
const aggregateQueries: readonly (readonly [string, string])[] = [
  ['totals', `SELECT COUNT(CASE WHEN t.counted = 1 THEN 1 END) AS turns,
      COUNT(CASE WHEN t.status = 'OPEN' THEN 1 END) AS open_total,
      COALESCE(SUM(IF(t.counted = 1, t.guest_count, 0)), 0) AS guests
    FROM turns t WHERE t.counted = 1`],
  ['byBusinessDate', `SELECT t.business_date, COUNT(*) AS turns, SUM(t.guest_count) AS guests
    FROM turns t WHERE t.counted = 1 GROUP BY t.business_date ORDER BY t.business_date`],
  ['byMonth', `SELECT DATE_FORMAT(t.business_date, '%Y-%m') AS month, COUNT(*) AS turns,
      SUM(t.guest_count) AS guests FROM turns t WHERE t.counted = 1 GROUP BY month ORDER BY month`],
  ['byScope', `SELECT scope, table_id, group_id, COUNT(*) AS turns, SUM(guest_count) AS guests
    FROM turns t WHERE t.counted = 1 GROUP BY scope, table_id, group_id`],
]

mysqlDescribe('TU-38 AC07 one-month benchmark', () => {
  let seeded = 0
  beforeAll(async () => {
    await initializeFixture()
    await resetFixture()
    seeded = await seedMonth()
  }, 300_000)
  afterAll(clearFixture)

  it('answers a one-month summary well under 2000ms and reads the whole month', async () => {
    const query = { from, to, countedOnly: true }
    // One warm run, so the number reported is a served request and not a cold buffer pool.
    await summarizeTableTurns(actor, query)

    const samples: number[] = []
    for (let run = 0; run < 5; run++) {
      const started = performance.now()
      const summary = await summarizeTableTurns(actor, query)
      samples.push(performance.now() - started)
      expect(summary.completedTotal).toBe(seeded)
      expect(summary.byMonth).toEqual([{ month, turns: seeded, guests: summary.guestTotal }])
      expect(summary.byBusinessDate).toHaveLength(dayCount)
      expect(summary.byScope).toHaveLength(tableCount)
      expect(summary.scopeTotal).toBe(tableCount + 1)
      expect(summary.averagePerScope).toBeGreaterThan(0)
    }
    const slowest = Math.max(...samples)
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!
    console.log(`[TU-38 AC07] ${seeded} turns / ${dayCount} days — median ${median.toFixed(1)}ms, slowest ${slowest.toFixed(1)}ms, budget ${budgetMs}ms`)
    expect(slowest).toBeLessThan(budgetMs)
  }, 120_000)

  it('plans every aggregate on an index rather than a full scan of the ledger', async () => {
    const values = [actor.organizationId, actor.venueId, from, to]
    for (const [name, sql] of aggregateQueries) {
      const [rows] = await databasePool.query<ExplainRow[]>(
        `EXPLAIN FORMAT=TREE ${turnProjection} ${sql}`, values,
      )
      const plan = rows[0]!.EXPLAIN
      console.log(`[TU-38 AC07] EXPLAIN ${name}\n${plan}`)
      // Each visit's turn is a unique lookup on uq_turn_visit, and `visits` is reached
      // through an index rather than scanned. Which index the optimizer picks for the month
      // is its call and is printed above rather than asserted: at this sample size the two
      // candidates cost the same, because the venue holds only the seeded months.
      expect(plan).toContain('uq_turn_visit')
      expect(plan).toMatch(/Index (lookup|range scan) on visits using ix_visits_(org_venue_date|org_venue|venue_date)/)
      expect(plan).not.toMatch(/Table scan on (visits|table_turns)\b/)
    }
  }, 120_000)

  it('reads one month through ix_visits_org_venue_date when that index is used', async () => {
    // Migration 0031 carries both equalities plus the range, so this is the plan the
    // predicate deserves: an index range the size of the month, not of the venue's history.
    const predicate = (hint: string) => `SELECT COUNT(*) FROM visits ${hint}
      WHERE organization_id = ? AND venue_id = ? AND business_date BETWEEN ? AND ?`
    const values = [actor.organizationId, actor.venueId, from, to]
    const [forced] = await databasePool.query<ExplainRow[]>(
      `EXPLAIN FORMAT=TREE ${predicate('FORCE INDEX (ix_visits_org_venue_date)')}`, values,
    )
    console.log(`[TU-38 AC07] EXPLAIN target_visits, forced\n${forced[0]!.EXPLAIN}`)
    expect(forced[0]!.EXPLAIN).toContain('ix_visits_org_venue_date')

    const [chosen] = await databasePool.query<ExplainRow[]>(
      `EXPLAIN FORMAT=TREE ${predicate('')}`, values,
    )
    console.log(`[TU-38 AC07] EXPLAIN target_visits, optimizer's choice\n${chosen[0]!.EXPLAIN}`)
    expect(chosen[0]!.EXPLAIN).not.toMatch(/Table scan on visits\b/)
  }, 120_000)
})

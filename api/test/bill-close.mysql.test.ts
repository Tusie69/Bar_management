/**
 * TU-45 — chốt bill, qua Express + MySQL thật.
 *
 * Mọi khẳng định ở đây đi qua HTTP và database. Phân quyền, cách ly venue, khóa
 * chống hai bill, snapshot giá và đồng thời là những thứ chỉ đúng khi database
 * đúng; mock chúng nghĩa là xác nhận một cái bảng do chính test khai.
 *
 * Bảy Acceptance Criteria của thẻ việc nằm ở đây:
 *
 * 1. Tính đúng: tạm tính → VAT 10% → làm tròn LÊN nghìn.
 * 2. Bàn ghép ra ĐÚNG MỘT bill.
 * 3. Sửa giá menu sau khi chốt KHÔNG đổi bill đã chốt.
 * 4. Một Phiên không có hai bill đang mở.
 * 5. Chốt bill rồi thì không gọi thêm món được.
 * 6. Phục vụ không chốt được bill; Thu ngân chốt được.
 * 7. Hủy bill trả 501 "Đang phát triển" và không đổi gì.
 *
 * Cần `RUN_MYSQL_INTEGRATION=1`, `DB_NAME=gam21_platform_it_test` và migration
 * 0048 đã áp dụng. Thiếu thì cả file skip — và một file skip KHÔNG phải là bằng
 * chứng rằng tiền đã được tính đúng.
 */
import type { RowDataPacket } from 'mysql2/promise'
import request, { type Agent } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createWalkIn } from '../src/modules/bookings/booking.repository.js'
import { applyVariantPriceWithinTransaction } from '../src/modules/menu/menu-price.repository.js'
import { mergeVisitTables } from '../src/modules/visits/visit.repository.js'
import type {
  BillListView,
  BillPreviewView,
  BillView,
  SessionBillsView,
} from '../src/modules/bills/bill.model.js'
import {
  actor,
  businessDate,
  clearFixture,
  initializeFixture,
  resetFixture,
  tableId,
} from './support/integration-fixture.js'
import {
  insertMenuCategory,
  insertMenuItem,
  insertMenuPrice,
  insertMenuVariant,
} from './support/menu-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const password = 'Bill-TU45-Password-01'
const cashierUserId = 9871
const waiterUserId = 9872
const barUserId = 9873
const secondTableId = 9874

interface SignedIn {
  agent: Agent
  csrfToken: string
}

interface Seeded {
  visitId: number
  glassVariantId: number
  glassPriceId: number
  foodVariantId: number
  foodPriceId: number
}

async function seedAccount(id: number, username: string, role: string): Promise<void> {
  const passwordHash = await hashPassword(password)
  await databasePool.execute(
    'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)',
    [id, username, username, passwordHash],
  )
  await databasePool.execute(
    'INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)',
    [id, actor.organizationId, id],
  )
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     SELECT ?, ?, id, ? FROM roles WHERE code = ?`,
    [actor.organizationId, id, actor.venueId, role],
  )
}

async function signIn(username: string, portal: string): Promise<SignedIn> {
  const agent = request.agent(app)
  const response = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin)
    .send({ username, password, portal })
  expect(response.status, `${username} phải đăng nhập được tại /${portal}`).toBe(200)
  return { agent, csrfToken: (response.body as { csrfToken: string }).csrfToken }
}

function post(session: SignedIn, path: string, body: Record<string, unknown>) {
  return session.agent.post(path).set('Origin', env.webOrigin)
    .set('X-CSRF-Token', session.csrfToken).send(body)
}

function get(session: SignedIn, path: string) {
  return session.agent.get(path).set('Origin', env.webOrigin)
}

/**
 * Giá được chọn để tạm tính ra 209.600đ — đúng bộ T2 của `bill-total.test.ts`,
 * tức là đúng ví dụ 230.560đ → 231.000đ mà anh Luân đã chốt (TN-06, 18/11).
 */
const GLASS_PRICE_VND = 100_000
const FOOD_PRICE_VND = 9_600

async function seed(): Promise<Seeded> {
  await databasePool.execute(
    `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'A2', 'A2', 'TABLE', 4, 50, 60)`,
    [secondTableId, actor.organizationId, actor.venueId, tableId],
  )
  const walkIn = await createWalkIn(actor, { tableIds: [tableId], partySize: 4, businessDate })

  const barCategory = await insertMenuCategory(actor.venueId, 'WHISKY')
  const whisky = await insertMenuItem({
    venueId: actor.venueId, categoryId: barCategory, code: 'MACALLAN_12',
    name: 'MACALLAN 12', station: 'BAR', verifiedByUserId: actor.userId,
  })
  const glassVariantId = await insertMenuVariant({
    venueId: actor.venueId, itemId: whisky, code: 'GLASS', unit: 'GLASS',
  })
  const glassPriceId = await insertMenuPrice(actor.venueId, glassVariantId, GLASS_PRICE_VND)

  const foodCategory = await insertMenuCategory(actor.venueId, 'FOOD')
  const snack = await insertMenuItem({
    venueId: actor.venueId, categoryId: foodCategory, code: 'PEANUT',
    name: 'ĐẬU PHỘNG', station: 'KITCHEN', verifiedByUserId: actor.userId,
  })
  const foodVariantId = await insertMenuVariant({
    venueId: actor.venueId, itemId: snack, code: 'PORTION', unit: 'PORTION',
  })
  const foodPriceId = await insertMenuPrice(actor.venueId, foodVariantId, FOOD_PRICE_VND)

  return { visitId: walkIn.visitId, glassVariantId, glassPriceId, foodVariantId, foodPriceId }
}

let keyCounter = 0
function nextKey(): string {
  keyCounter += 1
  return `tu45-bill-key-${String(keyCounter).padStart(6, '0')}`
}

/** Gửi một đơn hai món: 2 ly × 100.000đ + 1 phần × 9.600đ = 209.600đ. */
async function submitOrder(session: SignedIn, seeded: Seeded, visitId: number) {
  const response = await post(session, '/api/v1/waiter/orders', {
    visitId,
    idempotencyKey: nextKey(),
    lines: [
      { variantId: seeded.glassVariantId, priceId: seeded.glassPriceId, priceVersion: 1, quantity: 2 },
      { variantId: seeded.foodVariantId, priceId: seeded.foodPriceId, priceVersion: 1, quantity: 1 },
    ],
  })
  expect(response.status, JSON.stringify(response.body)).toBe(201)
  return response
}

async function countBills(visitId: number): Promise<number> {
  const [rows] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM bills WHERE venue_id = ? AND visit_id = ?',
    [actor.venueId, visitId],
  )
  return Number(rows[0]!.total)
}

mysqlDescribe('TU-45 — chốt bill', () => {
  let cashier: SignedIn
  let waiter: SignedIn
  let bar: SignedIn
  let seeded: Seeded

  beforeAll(async () => {
    await initializeFixture()
  })

  afterAll(async () => {
    await clearFixture()
  })

  beforeEach(async () => {
    await resetFixture()
    await seedAccount(cashierUserId, 'tu45_cashier', 'CASHIER')
    await seedAccount(waiterUserId, 'tu45_waiter', 'WAITER')
    await seedAccount(barUserId, 'tu45_bar', 'BAR')
    cashier = await signIn('tu45_cashier', 'cashier')
    waiter = await signIn('tu45_waiter', 'waiter')
    // Bar đăng nhập qua cổng `waiter` (0027 nới CHECK portal); vai khác nhau,
    // cổng dùng chung với Phục vụ.
    bar = await signIn('tu45_bar', 'waiter')
    seeded = await seed()
  })

  describe('AC1 — tính đúng tiền', () => {
    it('tạm tính 209.600đ → VAT 20.960đ → làm tròn lên 231.000đ', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)

      const preview = await get(cashier, `/api/v1/bills/preview?visitId=${seeded.visitId}`)
      expect(preview.status).toBe(200)
      const view = (preview.body as { preview: BillPreviewView }).preview
      expect(view.subtotalVnd).toBe(209_600)
      expect(view.vatRateBasisPoints).toBe(1000)
      expect(view.vatVnd).toBe(20_960)
      expect(view.preRoundTotalVnd).toBe(230_560)
      expect(view.roundingAdjustmentVnd).toBe(440)
      expect(view.totalVnd).toBe(231_000)
      expect(view.blockers).toEqual([])

      const closed = await post(cashier, '/api/v1/bills', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), expectedTotalVnd: 231_000,
      })
      expect(closed.status, JSON.stringify(closed.body)).toBe(201)
      const bill = (closed.body as { bill: BillView }).bill
      expect(bill.totalVnd).toBe(231_000)
      expect(bill.status).toBe('AWAITING_PAYMENT')
      expect(bill.billCode).toMatch(/^B\d{6}-\d{4}$/)
      expect(bill.shortCode).toBe('B0001')
      expect(bill.revision).toBe(1)
    })

    it('ledger ba hàng, cộng lại đúng tổng phải trả', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const bill = (closed.body as { bill: BillView }).bill

      expect(bill.charges.map((charge) => charge.chargeCode))
        .toEqual(['ITEM_SUBTOTAL', 'VAT', 'FINAL_ROUNDING'])
      expect(bill.charges.reduce((sum, charge) => sum + charge.signedAmountVnd, 0)).toBe(bill.totalVnd)
      expect(bill.charges[1]?.rateBasisPoints).toBe(1000)
      expect(bill.charges[1]?.explanation).toBe('VAT 10%')
    })

    it('tổng tạm tính cộng đúng bằng tay từ các dòng bill', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const bill = (closed.body as { bill: BillView }).bill

      expect(bill.lines.reduce((sum, line) => sum + line.amountVnd, 0)).toBe(bill.subtotalVnd)
      expect(bill.lines).toHaveLength(2)
      expect(bill.lineCount).toBe(2)
      expect(bill.itemCount).toBe(3)
    })

    it('thuế suất đọc từ venue, không hard-code 10%', async () => {
      await databasePool.execute('UPDATE venues SET vat_rate_basis_points = 800 WHERE id = ?', [actor.venueId])
      await submitOrder(waiter, seeded, seeded.visitId)

      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const bill = (closed.body as { bill: BillView }).bill
      expect(bill.vatRateBasisPoints).toBe(800)
      expect(bill.vatVnd).toBe(16_768)
      expect(bill.totalVnd).toBe(227_000)
    })

    it('tiền lưu trong database là số nguyên đồng, không phải DECIMAL hay float', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })

      const [columns] = await databasePool.execute<(RowDataPacket & { COLUMN_NAME: string; DATA_TYPE: string })[]>(
        `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('bills', 'bill_lines', 'bill_charge_lines')
            AND COLUMN_NAME LIKE '%_vnd'`,
        [env.database.name],
      )
      expect(columns.length).toBeGreaterThan(0)
      for (const column of columns) {
        expect(['bigint', 'smallint'], `${column.COLUMN_NAME} phải là số nguyên`).toContain(column.DATA_TYPE)
      }
    })
  })

  describe('AC2 — bàn ghép ra đúng một bill', () => {
    it('cụm hai bàn, một Phiên, một bill; mã bàn có đủ A1 và A2', async () => {
      const merged = await mergeVisitTables({ ...actor }, {
        visitId: seeded.visitId,
        expectedVersion: 1,
        tableIds: [tableId, secondTableId],
      })
      expect(merged.group.tableIds.sort()).toEqual([tableId, secondTableId].sort())

      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      expect(closed.status, JSON.stringify(closed.body)).toBe(201)
      const bill = (closed.body as { bill: BillView }).bill

      expect(bill.tableCodes.sort()).toEqual(['A1', 'A2'])
      expect(await countBills(seeded.visitId)).toBe(1)
    })

    it('một cụm cho ra đúng một hàng trên Màn 1, không phải một hàng mỗi bàn', async () => {
      await mergeVisitTables({ ...actor }, {
        visitId: seeded.visitId, expectedVersion: 1, tableIds: [tableId, secondTableId],
      })
      await submitOrder(waiter, seeded, seeded.visitId)

      const list = await get(cashier, `/api/v1/bills?businessDate=${businessDate}`)
      expect(list.status).toBe(200)
      const view = list.body as BillListView
      expect(view.items).toHaveLength(1)
      expect(view.items[0]?.tableCodes.sort()).toEqual(['A1', 'A2'])
      expect(view.counts).toEqual({ all: 1, serving: 1, awaitingPayment: 0 })
    })

    it('số đếm bộ lọc đổi sau khi chốt bill', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })

      const list = await get(cashier, `/api/v1/bills?businessDate=${businessDate}`)
      const view = list.body as BillListView
      expect(view.counts).toEqual({ all: 1, serving: 0, awaitingPayment: 1 })
      expect(view.items[0]?.status).toBe('AWAITING_PAYMENT')
      expect(view.items[0]?.totalVnd).toBe(231_000)
    })

    /**
     * V12 bỏ ràng buộc "mỗi Phiên một hoá đơn mở", nên đây là hàng rào chống
     * một lỗi cụ thể: `LEFT JOIN bills` thẳng sẽ nhân hàng của Phiên lên theo
     * số hoá đơn chưa thu, và Thu ngân thấy hai thẻ cho cùng một bàn.
     */
    it('hai hoá đơn chưa thu cộng một đợt mới vẫn là MỘT hàng, nợ là tổng cả ba', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const first = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      expect(first.status, JSON.stringify(first.body)).toBe(201)
      await submitOrder(waiter, seeded, seeded.visitId)
      const second = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      expect(second.status, JSON.stringify(second.body)).toBe(201)
      // Đợt thứ ba: gọi thêm sau khi đã xuất hai hoá đơn, chưa lên tờ nào.
      await submitOrder(waiter, seeded, seeded.visitId)

      const view = (await get(cashier, `/api/v1/bills?businessDate=${businessDate}`)).body as BillListView
      expect(view.items).toHaveLength(1)
      const row = view.items[0]
      expect(row?.unpaidBillCount).toBe(2)
      // Hai tờ đã xuất (231.000 mỗi tờ) cộng đợt chưa xuất (231.000).
      expect(row?.dueTotalVnd).toBe(693_000)
      // `totalVnd` vẫn là của tờ cũ nhất — tờ sẽ được thu trước.
      expect(row?.totalVnd).toBe(231_000)
      expect(row?.billId).toBe((first.body as { bill: BillView }).bill.id)
      expect(view.counts).toEqual({ all: 1, serving: 0, awaitingPayment: 1 })
    })
  })

  describe('AC3 — sửa giá menu sau khi chốt không đổi bill đã chốt', () => {
    it('đổi giá ly từ 100.000đ lên 500.000đ: bill vẫn 231.000đ', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const billId = (closed.body as { bill: BillView }).bill.id

      const connection = await databasePool.getConnection()
      try {
        await connection.beginTransaction()
        await applyVariantPriceWithinTransaction(
          connection,
          { organizationId: actor.organizationId, venueId: actor.venueId },
          {
            variantId: seeded.glassVariantId,
            amountVnd: 500_000,
            effectiveFrom: new Date(Date.now() + 1_000),
            source: 'TEST',
          },
        )
        await connection.commit()
      } finally {
        connection.release()
      }

      const reread = await get(cashier, `/api/v1/bills/${billId}`)
      const bill = (reread.body as { bill: BillView }).bill
      expect(bill.subtotalVnd).toBe(209_600)
      expect(bill.totalVnd).toBe(231_000)
      expect(bill.lines.find((line) => line.itemCode === 'MACALLAN_12')?.unitPriceVnd).toBe(GLASS_PRICE_VND)
    })

    it('đổi TÊN món sau khi chốt: bill vẫn in tên cũ', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const billId = (closed.body as { bill: BillView }).bill.id

      await databasePool.execute(
        "UPDATE menu_items SET name = 'TÊN MỚI HOÀN TOÀN' WHERE venue_id = ? AND code = 'MACALLAN_12'",
        [actor.venueId],
      )

      const reread = await get(cashier, `/api/v1/bills/${billId}`)
      const bill = (reread.body as { bill: BillView }).bill
      expect(bill.lines.map((line) => line.itemName)).toContain('MACALLAN 12')
      expect(bill.lines.map((line) => line.itemName)).not.toContain('TÊN MỚI HOÀN TOÀN')
    })

    it('luật tiền đã dùng được chép vào bill, nên đổi cấu hình không viết lại bill cũ', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const billId = (closed.body as { bill: BillView }).bill.id

      await databasePool.execute('UPDATE venues SET vat_rate_basis_points = 500 WHERE id = ?', [actor.venueId])

      const [rows] = await databasePool.execute<(RowDataPacket & { pricing_policy_snapshot: unknown })[]>(
        'SELECT pricing_policy_snapshot FROM bills WHERE id = ?',
        [billId],
      )
      const raw = rows[0]!.pricing_policy_snapshot
      const snapshot = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
      expect(snapshot).toEqual({
        vatRateBasisPoints: 1000,
        vatMode: 'EXCLUSIVE',
        vatBasis: 'TOTAL',
        roundingMode: 'UP',
        roundingScope: 'FINAL_TOTAL',
        roundingUnitVnd: 1000,
      })

      const reread = await get(cashier, `/api/v1/bills/${billId}`)
      expect((reread.body as { bill: BillView }).bill.totalVnd).toBe(231_000)
    })
  })

  describe('AC4 — một Phiên không có hai bill đang mở', () => {
    it('V12 — xuất hoá đơn lần hai khi KHÔNG còn món mới: 422, không tạo bill rỗng', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const first = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      expect(first.status).toBe(201)

      const second = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      expect(second.status).toBe(422)
      expect((second.body as { error: { code: string } }).error.code).toBe('BILL_EMPTY')
      expect(await countBills(seeded.visitId)).toBe(1)
    })

    it('V12 — gọi thêm rồi xuất tiếp: bill THỨ HAI, chỉ chứa món mới', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const first = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const billOne = (first.body as { bill: BillView }).bill
      expect(billOne.totalVnd).toBe(231_000)

      // Khách gọi thêm 2 phần đậu phộng sau khi đã cầm hoá đơn (TN-02-K6).
      const extra = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ variantId: seeded.foodVariantId, priceId: seeded.foodPriceId, priceVersion: 1, quantity: 2 }],
      })
      expect(extra.status, JSON.stringify(extra.body)).toBe(201)

      const second = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      expect(second.status, JSON.stringify(second.body)).toBe(201)
      const billTwo = (second.body as { bill: BillView }).bill

      // Bill 2 CHỈ có món mới — không lặp lại món của bill 1.
      expect(billTwo.id).not.toBe(billOne.id)
      expect(billTwo.lines).toHaveLength(1)
      expect(billTwo.lines[0]?.itemCode).toBe('PEANUT')
      expect(billTwo.lines[0]?.quantity).toBe(2)
      expect(billTwo.subtotalVnd).toBe(19_200)
      expect(billTwo.revision).toBe(2)
      expect(await countBills(seeded.visitId)).toBe(2)

      // Và bill 1 không đổi một đồng nào.
      const reread = await get(cashier, `/api/v1/bills/${billOne.id}`)
      expect((reread.body as { bill: BillView }).bill.totalVnd).toBe(231_000)
    })

    it('bấm hai lần với CÙNG mã chống trùng: trả lại đúng bill cũ, không tạo bill thứ hai', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const key = nextKey()
      const first = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: key })
      expect(first.status).toBe(201)

      const replay = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: key })
      expect(replay.status).toBe(201)
      expect(replay.headers['idempotent-replayed']).toBe('true')
      expect((replay.body as { bill: BillView }).bill.id).toBe((first.body as { bill: BillView }).bill.id)
      expect(await countBills(seeded.visitId)).toBe(1)
    })

    it('hai máy bấm Chốt ĐỒNG THỜI: đúng một bill được tạo', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const results = await Promise.all([
        post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() }),
        post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() }),
      ])
      const created = results.filter((result) => result.status === 201)
      expect(created).toHaveLength(1)
      expect(await countBills(seeded.visitId)).toBe(1)
    })

    it('database chặn một dòng đơn lên CÙNG một dòng bill hai lần', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const billId = (closed.body as { bill: BillView }).bill.id

      const [rows] = await databasePool.execute<(RowDataPacket & {
        id: number; order_line_id: number; bill_line_id: number
      })[]>(
        'SELECT id, order_line_id, bill_line_id FROM bill_line_sources WHERE bill_id = ? LIMIT 1',
        [billId],
      )
      const source = rows[0]!
      // `uq_bill_line_sources_pair` là thứ thay cho "một Phiên một bill" của bản
      // 22/11: V12 cho nhiều bill, nhưng một dòng đơn chỉ góp vào một dòng bill
      // đúng một lần.
      await expect(databasePool.execute(
        `INSERT INTO bill_line_sources
           (organization_id, venue_id, bill_id, bill_line_id, order_line_id, quantity)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [actor.organizationId, actor.venueId, billId, source.bill_line_id, source.order_line_id],
      )).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' })
    })

    it('database chặn tổng không chẵn nghìn', async () => {
      await expect(databasePool.execute(
        `INSERT INTO bills
           (organization_id, venue_id, visit_id, business_date, bill_code, daily_seq, revision, status,
            vat_rate_basis_points, subtotal_vnd, vat_vnd, pre_round_total_vnd, rounding_adjustment_vnd,
            total_vnd, line_count, item_count, pricing_policy_snapshot, closed_by_user_id)
         VALUES (?, ?, ?, ?, 'B999999-0002', 9998, 9, 'AWAITING_PAYMENT',
            1000, 1234, 0, 1234, 0, 1234, 1, 1, CAST('{}' AS JSON), ?)`,
        [actor.organizationId, actor.venueId, seeded.visitId, businessDate, cashierUserId],
      )).rejects.toMatchObject({ errno: 3819 })
    })
  })

  describe('AC5 — chốt bill rồi thì không gọi thêm món', () => {
    it('V12 — gọi thêm SAU khi xuất hoá đơn vẫn được (bản 22/11 chặn, v1.1 cho)', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })

      const extra = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ variantId: seeded.glassVariantId, priceId: seeded.glassPriceId, priceVersion: 1, quantity: 1 }],
      })
      expect(extra.status, JSON.stringify(extra.body)).toBe(201)
    })

    it('V12 — gọi thêm thì Phiên về Đang phục vụ, dù bill cũ chưa thu (TN-13-K4)', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })

      const beforeExtra = await get(waiter, `/api/v1/tables/service?date=${businessDate}`)
      expect(JSON.stringify(beforeExtra.body)).toContain('AWAITING_PAYMENT')

      await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ variantId: seeded.glassVariantId, priceId: seeded.glassPriceId, priceVersion: 1, quantity: 1 }],
      })

      const afterExtra = await get(waiter, `/api/v1/tables/service?date=${businessDate}`)
      expect(JSON.stringify(afterExtra.body)).not.toContain('AWAITING_PAYMENT')
    })

    it('Phiên chuyển sang Chờ thanh toán trên sơ đồ Phục vụ, bàn vẫn là bàn có khách', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })

      const floor = await get(waiter, `/api/v1/tables/service?date=${businessDate}`)
      expect(floor.status, JSON.stringify(floor.body)).toBe(200)
      const body = JSON.stringify(floor.body)
      expect(body).toContain('AWAITING_PAYMENT')
      // Bàn vẫn là bàn CÓ KHÁCH, không phải bàn trống: mockup yêu cầu ô bàn
      // giữ màu xanh và chỉ thêm huy hiệu đồng hồ.
      expect(body).toContain('seated')
    })

    it('chốt bill đẩy con trỏ realtime, nên mọi máy biết phải đọc lại', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const [before] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
        'SELECT change_seq FROM venues WHERE id = ?', [actor.venueId],
      )
      await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const [after] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
        'SELECT change_seq FROM venues WHERE id = ?', [actor.venueId],
      )
      expect(BigInt(after[0]!.change_seq)).toBeGreaterThan(BigInt(before[0]!.change_seq))
    })
  })

  describe('AC6 — ai được chốt bill', () => {
    it('Phục vụ KHÔNG chốt được bill (phân quyền 15/11)', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const response = await post(waiter, '/api/v1/bills', {
        visitId: seeded.visitId, idempotencyKey: nextKey(),
      })
      expect(response.status).toBe(403)
      expect((response.body as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED')
      expect(await countBills(seeded.visitId)).toBe(0)
    })

    it('Bar KHÔNG chốt được bill', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const response = await post(bar, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      expect(response.status).toBe(403)
      expect(await countBills(seeded.visitId)).toBe(0)
    })

    it('Phục vụ ĐỌC được tạm tính và bill — họ là người đưa khách xem', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const preview = await get(waiter, `/api/v1/bills/preview?visitId=${seeded.visitId}`)
      expect(preview.status).toBe(200)
      expect((preview.body as { preview: BillPreviewView }).preview.totalVnd).toBe(231_000)
    })

    it('thiếu header CSRF thì không chốt được', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const response = await cashier.agent.post('/api/v1/bills').set('Origin', env.webOrigin)
        .send({ visitId: seeded.visitId, idempotencyKey: nextKey() })
      expect(response.status).toBe(403)
      expect(await countBills(seeded.visitId)).toBe(0)
    })

    it('bill của quán khác trả 404, không phải 403 — một 403 nói rằng nó tồn tại', async () => {
      const response = await get(cashier, '/api/v1/bills/999999')
      expect(response.status).toBe(404)
      expect((response.body as { error: { code: string } }).error.code).toBe('BILL_NOT_FOUND')
    })
  })

  describe('AC7 — hủy bill là "Đang phát triển"', () => {
    it('trả 501 và không đổi trạng thái bill', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const billId = (closed.body as { bill: BillView }).bill.id

      const voided = await post(cashier, `/api/v1/bills/${billId}/void`, {})
      expect(voided.status).toBe(501)
      const error = (voided.body as { error: { code: string; details?: { status?: string } } }).error
      expect(error.code).toBe('BILL_VOID_NOT_AVAILABLE')
      expect(error.details?.status).toBe('IN_DEVELOPMENT')

      const reread = await get(cashier, `/api/v1/bills/${billId}`)
      expect((reread.body as { bill: BillView }).bill.status).toBe('AWAITING_PAYMENT')
    })

    it('bill mang danh sách tính năng chưa làm, để màn hình dựng nhãn từ dữ liệu thật', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const bill = (closed.body as { bill: BillView }).bill

      const features = bill.notAvailable.map((flag) => flag.feature)
      expect(features).toContain('DISCOUNT')
      expect(features).toContain('SPLIT_BILL')
      expect(features).toContain('E_INVOICE')
      for (const flag of bill.notAvailable) expect(flag.status).toBe('IN_DEVELOPMENT')
    })

    it('Ghi nợ có mặt trong danh sách phương thức nhưng bị khóa', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const methods = (closed.body as { bill: BillView }).bill.paymentMethods

      expect(methods.map((option) => option.method)).toEqual(['CASH', 'BANK_TRANSFER', 'CREDIT'])
      const credit = methods.find((option) => option.method === 'CREDIT')
      expect(credit?.available).toBe(false)
      expect(credit?.status).toBe('IN_DEVELOPMENT')
      expect(credit?.reason).toBe('Đang phát triển')
    })
  })

  describe('chặn những Phiên không chốt được', () => {
    it('bàn chưa gọi món: 422 BILL_EMPTY, và preview nói rõ lý do trước khi bấm', async () => {
      const preview = await get(cashier, `/api/v1/bills/preview?visitId=${seeded.visitId}`)
      const blockers = (preview.body as { preview: BillPreviewView }).preview.blockers
      expect(blockers.map((blocker) => blocker.code)).toContain('BILL_EMPTY')

      const response = await post(cashier, '/api/v1/bills', {
        visitId: seeded.visitId, idempotencyKey: nextKey(),
      })
      expect(response.status).toBe(422)
      expect((response.body as { error: { code: string } }).error.code).toBe('BILL_EMPTY')
    })

    it('còn yêu cầu hủy món chờ duyệt: 409 và nói còn mấy yêu cầu', async () => {
      const order = await submitOrder(waiter, seeded, seeded.visitId)
      const detail = (order.body as {
        order: { orderId: number; lines: { lineNo: number; lineVersion: number }[] }
      }).order
      const line = detail.lines[0]!

      const cancellation = await post(
        waiter,
        `/api/v1/waiter/orders/${detail.orderId}/lines/${line.lineNo}/cancellations`,
        {
          idempotencyKey: nextKey(),
          expectedLineVersion: line.lineVersion,
          quantity: 1,
          reason: 'Khách đổi ý nên xin hủy một ly',
        },
      )
      expect(cancellation.status, JSON.stringify(cancellation.body)).toBe(201)

      const preview = await get(cashier, `/api/v1/bills/preview?visitId=${seeded.visitId}`)
      const blockers = (preview.body as { preview: BillPreviewView }).preview.blockers
      expect(blockers.map((blocker) => blocker.code)).toContain('ORDER_CANCELLATION_PENDING')

      const response = await post(cashier, '/api/v1/bills', {
        visitId: seeded.visitId, idempotencyKey: nextKey(),
      })
      expect(response.status).toBe(409)
      const error = (response.body as { error: { code: string; details?: { pendingCount?: number } } }).error
      expect(error.code).toBe('ORDER_CANCELLATION_PENDING')
      expect(error.details?.pendingCount).toBe(1)
    })

    it('tổng đổi giữa lúc xem và lúc bấm: 409 kèm tổng mới', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const response = await post(cashier, '/api/v1/bills', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), expectedTotalVnd: 100_000,
      })
      expect(response.status).toBe(409)
      const error = (response.body as {
        error: { code: string; details?: { actualTotalVnd?: number } }
      }).error
      expect(error.code).toBe('BILL_TOTAL_CHANGED')
      expect(error.details?.actualTotalVnd).toBe(231_000)
      expect(await countBills(seeded.visitId)).toBe(0)
    })

    it('thiếu mã chống trùng: 400, không tạo bill', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const response = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId })
      expect(response.status).toBe(400)
      expect((response.body as { error: { code: string } }).error.code).toBe('INVALID_IDEMPOTENCY_KEY')
      expect(await countBills(seeded.visitId)).toBe(0)
    })
  })

  describe('NA-45 — GET /bills/session/:visitId', () => {
    it('trả mọi hoá đơn của Phiên cùng phần món chưa xuất', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const billOne = (closed.body as { bill: BillView }).bill

      // Gọi thêm sau khi đã xuất hoá đơn → phần này chưa lên bill nào.
      await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ variantId: seeded.foodVariantId, priceId: seeded.foodPriceId, priceVersion: 1, quantity: 2 }],
      })

      const response = await get(cashier, `/api/v1/bills/session/${seeded.visitId}`)
      expect(response.status, JSON.stringify(response.body)).toBe(200)
      const session = (response.body as { session: SessionBillsView }).session

      expect(session.visitId).toBe(seeded.visitId)
      expect(session.bills.map((bill) => bill.id)).toEqual([billOne.id])
      expect(session.unbilledLineCount).toBe(1)
      expect(session.unbilledLines[0]?.itemCode).toBe('PEANUT')
      // Còn món chưa xuất thì Phiên KHÔNG ở trạng thái chờ thanh toán (TN-13-K4).
      expect(session.status).toBe('SERVING')
    })

    it('mang bối cảnh Phiên mà màn Thu ngân cần, và KHÔNG mang gì về khách', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })

      const response = await get(cashier, `/api/v1/bills/session/${seeded.visitId}`)
      const session = (response.body as { session: SessionBillsView }).session

      expect(session.sessionCode).toBe(`S-${String(seeded.visitId).padStart(4, '0')}`)
      expect(session.code).toBe('A1')
      expect(session.guests).toBe(4)
      // `waiterName` là NHÂN VIÊN gửi đơn, không phải tên khách.
      expect(session.waiterName).toBe('tu45_waiter')
      expect(session.roundCount).toBe(1)
      expect(session.status).toBe('AWAITING_PAYMENT')

      const raw = JSON.stringify(response.body)
      for (const field of ['contactName', 'guestName', 'phoneLast3', 'phoneE164', 'customerId']) {
        expect(raw, `payload không được chứa ${field}`).not.toContain(field)
      }
    })

    it('dòng món mang đợt gọi và trạng thái chế biến', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const bill = (closed.body as { bill: BillView }).bill

      for (const line of bill.lines) {
        expect(line.orderRound).toBe(1)
        // Phiếu Bar/Bếp vừa gửi nên chưa ai mang ra: món đang làm, và vẫn tính tiền.
        expect(line.state).toBe('MAKING')
      }
      expect(bill.lines.reduce((sum, line) => sum + line.amountVnd, 0)).toBe(bill.subtotalVnd)
    })

    it('số đợt của một tờ là số đợt NẰM TRÊN tờ đó, không phải của cả Phiên', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const firstBill = (closed.body as { bill: BillView }).bill
      // Tờ này gom hai đợt đầu.
      expect(firstBill.roundCount).toBe(2)

      // Đợt thứ ba đi vào tờ thứ hai, nên tờ thứ hai chỉ có MỘT đợt dù Phiên đã có ba.
      await submitOrder(waiter, seeded, seeded.visitId)
      const again = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const secondBill = (again.body as { bill: BillView }).bill
      expect(secondBill.roundCount).toBe(1)

      // Còn bối cảnh Phiên vẫn đếm đủ ba đợt.
      const response = await get(cashier, `/api/v1/bills/session/${seeded.visitId}`)
      expect((response.body as { session: SessionBillsView }).session.roundCount).toBe(3)
    })
  })

  describe('quyền riêng tư — bill không mang thông tin khách', () => {
    it('không có tên, số điện thoại hay mã khách ở bất kỳ đâu trong payload', async () => {
      await databasePool.execute(
        "UPDATE visits SET contact_name = 'Anh Tuấn Nguyễn' WHERE id = ?",
        [seeded.visitId],
      )
      await submitOrder(waiter, seeded, seeded.visitId)
      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const raw = JSON.stringify(closed.body)

      expect(raw).not.toContain('Anh Tuấn Nguyễn')
      for (const field of ['customerId', 'contactName', 'guestName', 'phoneLast3', 'phoneE164', 'honorific']) {
        expect(raw, `payload không được chứa ${field}`).not.toContain(field)
      }
      // Người duy nhất có tên trên bill là nhân viên đã chốt nó.
      expect((closed.body as { bill: BillView }).bill.closedBy.displayName).toBe('tu45_cashier')
    })

    it('số điện thoại trong ghi chú món bị lược trước khi vào bill', async () => {
      const order = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{
          variantId: seeded.glassVariantId, priceId: seeded.glassPriceId, priceVersion: 1, quantity: 2,
        }],
      })
      expect(order.status).toBe(201)
      // Ghi chú đi vòng qua API (API đã chặn SĐT lúc ghi) để dựng đúng tình
      // huống dữ liệu cũ: một ghi chú có SĐT đã nằm trong database từ trước.
      await databasePool.execute(
        "UPDATE sales_order_lines SET note = 'Gọi 0912345678 khi xong' WHERE venue_id = ?",
        [actor.venueId],
      )

      const closed = await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })
      const raw = JSON.stringify(closed.body)
      expect(raw).not.toContain('0912345678')

      const [rows] = await databasePool.execute<(RowDataPacket & { note: string | null })[]>(
        'SELECT note FROM bill_lines WHERE venue_id = ?', [actor.venueId],
      )
      expect(rows[0]?.note).not.toContain('0912345678')
    })

    it('nhật ký thao tác không mang dòng món và không mang ghi chú', async () => {
      await submitOrder(waiter, seeded, seeded.visitId)
      await post(cashier, '/api/v1/bills', { visitId: seeded.visitId, idempotencyKey: nextKey() })

      const [rows] = await databasePool.execute<(RowDataPacket & { action: string; changes: unknown })[]>(
        "SELECT action, changes FROM operation_log WHERE action = 'BILL_CLOSED' AND venue_id = ?",
        [actor.venueId],
      )
      expect(rows).toHaveLength(1)
      const raw = rows[0]!.changes
      const changes = JSON.stringify(typeof raw === 'string' ? JSON.parse(raw) : raw)
      expect(changes).toContain('bill_closed')
      expect(changes).toContain('231000')
      expect(changes).not.toContain('lines')
      expect(changes).not.toContain('note')
      expect(changes).not.toContain('MACALLAN')
    })
  })
})

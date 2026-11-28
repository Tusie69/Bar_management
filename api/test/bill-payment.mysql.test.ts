/**
 * TU-46 — thu tiền, qua Express + MySQL thật.
 *
 * Acceptance Criteria của thẻ nằm ở đây:
 *
 * 1. Tiền mặt một bước; thiếu tiền thì bị từ chối; tiền thừa tính đúng.
 * 2. Chuyển khoản sinh QR đúng số tiền + mã bill, lưu chuỗi cùng giao dịch.
 * 3. Xác nhận tay cần tick; QR không tự đóng bill.
 * 4. **Ghi nợ bị từ chối** ở API và ở database.
 * 5. **Không thanh toán hai lần** — bốn đường khác nhau.
 * 6. Thanh toán xong: Phiên đóng, bàn về Trống, **lượt khách +1 một lần cho cụm**,
 *    và **cụm vẫn giữ quan hệ ghép**.
 * 7. Nhật ký ghi đủ mà không mang chuỗi QR hay thông tin khách.
 *
 * Cần `RUN_MYSQL_INTEGRATION=1` và `DB_NAME=gam21_platform_it_test`. Thiếu thì
 * cả file skip — và một file skip KHÔNG phải bằng chứng rằng tiền không bị thu
 * hai lần.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import request, { type Agent } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createWalkIn } from '../src/modules/bookings/booking.repository.js'
import { mergeVisitTables } from '../src/modules/visits/visit.repository.js'
import { crc16CcittFalse } from '../src/modules/bills/vietqr.js'
import type { BillView, PaymentView, SettlementView } from '../src/modules/bills/bill.model.js'
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

const password = 'Bill-TU46-Password-01'
const cashierUserId = 9861
const waiterUserId = 9862
const secondCashierUserId = 9863
const secondTableId = 9864

interface SignedIn {
  agent: Agent
  csrfToken: string
}

interface Seeded {
  visitId: number
  variantId: number
  priceId: number
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

/** 2 × 100.000đ → tạm tính 200.000đ → VAT 20.000đ → tổng 220.000đ, chẵn nghìn. */
const UNIT_PRICE_VND = 100_000
const BILL_TOTAL_VND = 220_000

async function configureQr(): Promise<void> {
  const rows: Array<[string, string]> = [
    ['payment.vietqr.bank_bin', JSON.stringify('970415')],
    ['payment.vietqr.account_number', JSON.stringify('103900007412')],
    ['payment.vietqr.account_name', JSON.stringify('CONG TY 21GAM')],
    ['payment.vietqr.is_demo', 'false'],
  ]
  for (const [key, value] of rows) {
    await databasePool.execute(
      'INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`) VALUES (?, ?, ?, CAST(? AS JSON))',
      [actor.organizationId, actor.venueId, key, value],
    )
  }
}

async function seed(): Promise<Seeded> {
  await databasePool.execute(
    `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'A2', 'A2', 'TABLE', 4, 50, 60)`,
    [secondTableId, actor.organizationId, actor.venueId, tableId],
  )
  const walkIn = await createWalkIn(actor, { tableIds: [tableId], partySize: 4, businessDate })
  const category = await insertMenuCategory(actor.venueId, 'WHISKY')
  const item = await insertMenuItem({
    venueId: actor.venueId, categoryId: category, code: 'MACALLAN_12',
    name: 'MACALLAN 12', station: 'BAR', verifiedByUserId: actor.userId,
  })
  const variantId = await insertMenuVariant({
    venueId: actor.venueId, itemId: item, code: 'GLASS', unit: 'GLASS',
  })
  const priceId = await insertMenuPrice(actor.venueId, variantId, UNIT_PRICE_VND)
  return { visitId: walkIn.visitId, variantId, priceId }
}

let keyCounter = 0
function nextKey(): string {
  keyCounter += 1
  return `tu46-pay-key-${String(keyCounter).padStart(6, '0')}`
}

mysqlDescribe('TU-46 — thanh toán', () => {
  let cashier: SignedIn
  let otherCashier: SignedIn
  let waiter: SignedIn
  let seeded: Seeded

  beforeAll(async () => {
    await initializeFixture()
  })

  afterAll(async () => {
    await clearFixture()
  })

  beforeEach(async () => {
    await resetFixture()
    await seedAccount(cashierUserId, 'tu46_cashier', 'CASHIER')
    await seedAccount(secondCashierUserId, 'tu46_cashier2', 'CASHIER')
    await seedAccount(waiterUserId, 'tu46_waiter', 'WAITER')
    cashier = await signIn('tu46_cashier', 'cashier')
    otherCashier = await signIn('tu46_cashier2', 'cashier')
    waiter = await signIn('tu46_waiter', 'waiter')
    seeded = await seed()
    await configureQr()
  })

  /** Gửi một đơn 2 ly rồi chốt bill. Trả về bill đã chốt. */
  async function closedBill(visitId = seeded.visitId): Promise<BillView> {
    const order = await post(waiter, '/api/v1/waiter/orders', {
      visitId,
      idempotencyKey: nextKey(),
      lines: [{ variantId: seeded.variantId, priceId: seeded.priceId, priceVersion: 1, quantity: 2 }],
    })
    expect(order.status, JSON.stringify(order.body)).toBe(201)
    const closed = await post(cashier, '/api/v1/bills', { visitId, idempotencyKey: nextKey() })
    expect(closed.status, JSON.stringify(closed.body)).toBe(201)
    const bill = (closed.body as { bill: BillView }).bill
    expect(bill.totalVnd).toBe(BILL_TOTAL_VND)
    return bill
  }

  async function countCaptured(billId: number): Promise<number> {
    const [rows] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM bill_payments WHERE bill_id = ? AND status = 'CAPTURED'",
      [billId],
    )
    return Number(rows[0]!.total)
  }

  async function countPending(billId: number): Promise<number> {
    const [rows] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) AS total FROM bill_payments WHERE bill_id = ? AND status = 'PENDING'",
      [billId],
    )
    return Number(rows[0]!.total)
  }

  describe('AC1 — tiền mặt', () => {
    it('một bước: CAPTURED ngay, tiền thừa tính đúng', async () => {
      const bill = await closedBill()
      const response = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: 300_000, idempotencyKey: nextKey(),
      })
      expect(response.status, JSON.stringify(response.body)).toBe(201)
      const body = response.body as { payment: PaymentView; bill: BillView; settlement: SettlementView }

      expect(body.payment.status).toBe('CAPTURED')
      expect(body.payment.method).toBe('CASH')
      expect(body.payment.amountVnd).toBe(BILL_TOTAL_VND)
      expect(body.payment.tenderedAmountVnd).toBe(300_000)
      expect(body.payment.changeAmountVnd).toBe(80_000)
      expect(body.payment.confirmationMode).toBe('MANUAL')
      expect(body.payment.confirmedBy?.displayName).toBe('tu46_cashier')
      expect(body.payment.qr).toBeNull()
      expect(body.bill.status).toBe('PAID')
    })

    it('khách đưa thiếu: 422 kèm số còn thiếu, không ghi giao dịch nào', async () => {
      const bill = await closedBill()
      const response = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: 189_000, idempotencyKey: nextKey(),
      })
      expect(response.status).toBe(422)
      const error = (response.body as { error: { code: string; details?: { shortfallVnd?: number } } }).error
      expect(error.code).toBe('CASH_AMOUNT_INSUFFICIENT')
      expect(error.details?.shortfallVnd).toBe(31_000)
      expect(await countCaptured(bill.id)).toBe(0)
    })

    it('đưa vừa đủ thì tiền thừa bằng 0', async () => {
      const bill = await closedBill()
      const response = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      expect(response.status).toBe(201)
      expect((response.body as { payment: PaymentView }).payment.changeAmountVnd).toBe(0)
    })

    it('database chặn một khoản CAPTURED mà khách đưa thiếu, kể cả khi vòng qua ứng dụng', async () => {
      const bill = await closedBill()
      // Hai lớp cùng chặn, và lớp nào nổ trước không quan trọng:
      // `change_amount_vnd` là cột sinh UNSIGNED nên một hiệu âm không lưu được,
      // và `ck_bill_payments_enough` chặn cùng điều đó. Test khẳng định nó BỊ TỪ
      // CHỐI, không khẳng định mã lỗi nào — ép một mã cụ thể ở đây là buộc một
      // chi tiết của MySQL thành một phần hợp đồng.
      await expect(databasePool.execute(
        `INSERT INTO bill_payments
           (organization_id, venue_id, bill_id, business_date, method, status, amount_vnd,
            tendered_amount_vnd, collected_by_user_id, confirmed_by_user_id, confirmed_at)
         VALUES (?, ?, ?, ?, 'CASH', 'CAPTURED', ?, 1000, ?, ?, UTC_TIMESTAMP(3))`,
        [actor.organizationId, actor.venueId, bill.id, businessDate, BILL_TOTAL_VND,
          cashierUserId, cashierUserId],
      )).rejects.toThrow()
      expect(await countCaptured(bill.id)).toBe(0)
    })
  })

  describe('AC2 + AC3 — chuyển khoản QR', () => {
    it('sinh QR đúng số tiền và mã bill, dừng ở PENDING', async () => {
      const bill = await closedBill()
      const response = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      expect(response.status, JSON.stringify(response.body)).toBe(201)
      const payment = (response.body as { payment: PaymentView }).payment

      expect(payment.status).toBe('PENDING')
      expect(payment.confirmedAt).toBeNull()
      expect((response.body as { bill: BillView }).bill.status).toBe('AWAITING_PAYMENT')

      const qr = payment.qr
      expect(qr).not.toBeNull()
      if (!qr) throw new Error('chuyển khoản phải có QR')
      expect(qr.transferNote).toContain(bill.billCode)
      expect(qr.amountVnd).toBe(BILL_TOTAL_VND)
      // Số tiền nằm trong chuỗi dưới dạng số nguyên đồng, và CRC khớp.
      expect(qr.payload).toContain('5406220000')
      expect(qr.payload.slice(-4)).toBe(crc16CcittFalse(qr.payload.slice(0, -4)))
      // Số tài khoản bị che: ảnh chụp màn hình gửi qua Zalo không mang số đầy đủ.
      expect(qr.beneficiary.accountNumber).toBe('1039••••7412')
      expect(qr.isDemo).toBe(false)
      // Webhook chừa chỗ, không giả lập.
      expect(payment.gatewayConfirmation.status).toBe('IN_DEVELOPMENT')
    })

    it('chuỗi QR được LƯU cùng giao dịch để đối soát', async () => {
      const bill = await closedBill()
      const created = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      const payload = (created.body as { payment: PaymentView }).payment.qr?.payload

      const [rows] = await databasePool.execute<(RowDataPacket & {
        qr_payload: string; qr_payload_sha256: string; qr_transfer_note: string
      })[]>(
        'SELECT qr_payload, qr_payload_sha256, qr_transfer_note FROM bill_payments WHERE bill_id = ?',
        [bill.id],
      )
      expect(rows[0]?.qr_payload).toBe(payload)
      expect(rows[0]?.qr_payload_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(rows[0]?.qr_transfer_note).toContain(bill.billCode)
    })

    it('đọc lại giao dịch KHÔNG tự đóng bill — nút Kiểm tra của Màn 6', async () => {
      const bill = await closedBill()
      const created = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      const paymentId = (created.body as { payment: PaymentView }).payment.id

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const check = await get(cashier, `/api/v1/bills/${bill.id}/payments/${paymentId}`)
        expect(check.status).toBe(200)
        expect((check.body as { payment: PaymentView }).payment.status).toBe('PENDING')
      }
      const reread = await get(cashier, `/api/v1/bills/${bill.id}`)
      expect((reread.body as { bill: BillView }).bill.status).toBe('AWAITING_PAYMENT')
      expect(await countCaptured(bill.id)).toBe(0)
    })

    it('xác nhận mà KHÔNG tick: 422, bill vẫn chờ thanh toán', async () => {
      const bill = await closedBill()
      const created = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      const paymentId = (created.body as { payment: PaymentView }).payment.id

      const response = await post(cashier, `/api/v1/bills/${bill.id}/payments/${paymentId}/confirm`, {
        observedTransfer: false, idempotencyKey: nextKey(),
      })
      expect(response.status).toBe(422)
      expect((response.body as { error: { code: string } }).error.code).toBe('TRANSFER_NOT_OBSERVED')
      expect(await countCaptured(bill.id)).toBe(0)
    })

    it('xác nhận tay có tick: CAPTURED, mang cờ MANUAL và tên người xác nhận', async () => {
      const bill = await closedBill()
      const created = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      const paymentId = (created.body as { payment: PaymentView }).payment.id

      const confirmed = await post(cashier, `/api/v1/bills/${bill.id}/payments/${paymentId}/confirm`, {
        observedTransfer: true, idempotencyKey: nextKey(),
      })
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
      const body = confirmed.body as { payment: PaymentView; bill: BillView }
      expect(body.payment.status).toBe('CAPTURED')
      expect(body.payment.confirmationMode).toBe('MANUAL')
      expect(body.payment.confirmedBy?.displayName).toBe('tu46_cashier')
      expect(body.bill.status).toBe('PAID')
    })

    it('TN-08-K6 — đang chờ nhận tiền mà đổi sang Tiền mặt: đổi được, QR không treo', async () => {
      const bill = await closedBill()
      const created = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      const pendingId = (created.body as { payment: PaymentView }).payment.id

      const cash = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      expect(cash.status, JSON.stringify(cash.body)).toBe(201)
      expect((cash.body as { bill: BillView }).bill.status).toBe('PAID')

      const [rows] = await databasePool.execute<(RowDataPacket & { status: string; failure_code: string | null })[]>(
        'SELECT status, failure_code FROM bill_payments WHERE id = ?', [pendingId],
      )
      expect(rows[0]?.status, 'dòng QR không được nằm treo ở PENDING').toBe('CANCELLED')
      expect(rows[0]?.failure_code).toBe('METHOD_SWITCHED')
      expect(await countCaptured(bill.id)).toBe(1)
    })

    it('chưa cấu hình tài khoản: 409, và tiền mặt VẪN dùng được', async () => {
      await databasePool.execute(
        "DELETE FROM venue_settings WHERE venue_id = ? AND `key` LIKE 'payment.vietqr.%'",
        [actor.venueId],
      )
      const bill = await closedBill()
      const qr = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      expect(qr.status).toBe(409)
      expect((qr.body as { error: { code: string } }).error.code).toBe('PAYMENT_QR_NOT_CONFIGURED')

      const cash = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      expect(cash.status, JSON.stringify(cash.body)).toBe(201)
    })

    /**
     * Bấm "Chuyển khoản" lần nữa — tải lại trang, mạng chập, hoặc lần xác nhận
     * trước hỏng giữa chừng — phải cho lại ĐÚNG giao dịch đang chờ. Sinh mã
     * thứ hai là hai dòng tiền cho một tờ hoá đơn; trả 409 thì một lần xác
     * nhận hỏng khoá luôn đường thu tiền của bill cho tới khi có người sửa tay.
     */
    it('bấm chuyển khoản lần nữa cho lại đúng giao dịch đang chờ, không sinh mã thứ hai', async () => {
      const bill = await closedBill()
      const first = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      expect(first.status).toBe(201)
      const firstPayment = (first.body as { payment: { id: number; status: string; qr: { payload: string } | null } }).payment

      const second = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      expect(second.status, JSON.stringify(second.body)).toBe(201)
      const secondPayment = (second.body as { payment: { id: number; status: string; qr: { payload: string } | null } }).payment
      expect(secondPayment.id).toBe(firstPayment.id)
      expect(secondPayment.status).toBe('PENDING')
      // Cùng một chuỗi QR: khách đang cầm tờ hoá đơn có mã đó.
      expect(secondPayment.qr?.payload).toBe(firstPayment.qr?.payload)
      expect(await countPending(bill.id)).toBe(1)

      // Và giao dịch đó vẫn xác nhận được bình thường.
      const confirmed = await post(
        cashier,
        `/api/v1/bills/${bill.id}/payments/${firstPayment.id}/confirm`,
        { observedTransfer: true, idempotencyKey: nextKey() },
      )
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    })
  })

  describe('hoá đơn sau khi Phiên đã đóng', () => {
    /**
     * Thu xong bill cuối thì Phiên đóng và bàn được trả. Tờ hoá đơn đọc lại
     * sau đó — in biên nhận, Kế toán đối soát — vẫn phải nói khách ngồi bàn
     * nào. Một biên nhận ghi "Bàn —" là một biên nhận không đối soát được.
     */
    it('vẫn giữ mã bàn sau khi bàn đã được trả', async () => {
      const bill = await closedBill()
      const paid = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      expect(paid.status, JSON.stringify(paid.body)).toBe(201)
      const settlement = (paid.body as { settlement: { releasedTables: string[] } | null }).settlement
      expect(settlement?.releasedTables.length, 'Phiên phải đóng và trả bàn').toBeGreaterThan(0)

      const reread = await get(cashier, `/api/v1/bills/${bill.id}`)
      expect(reread.status).toBe(200)
      const view = (reread.body as { bill: { tableCodes: string[]; code: string } }).bill
      expect(view.tableCodes.length).toBeGreaterThan(0)
      expect(view.code).not.toBe('—')
    })
  })

  describe('AC4 — Ghi nợ bị từ chối', () => {
    it('API trả 422 kèm nhãn Đang phát triển', async () => {
      const bill = await closedBill()
      const response = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CREDIT', idempotencyKey: nextKey(),
      })
      expect(response.status).toBe(422)
      const error = (response.body as {
        error: { code: string; details?: { status?: string; feature?: string } }
      }).error
      expect(error.code).toBe('PAYMENT_METHOD_NOT_AVAILABLE')
      expect(error.details?.status).toBe('IN_DEVELOPMENT')
      expect(error.details?.feature).toBe('CREDIT')
      expect(await countCaptured(bill.id)).toBe(0)
    })

    it('database cũng từ chối, nên bật Ghi nợ là một migration chứ không phải một dòng quên', async () => {
      const bill = await closedBill()
      await expect(databasePool.execute(
        `INSERT INTO bill_payments
           (organization_id, venue_id, bill_id, business_date, method, status, amount_vnd,
            collected_by_user_id)
         VALUES (?, ?, ?, ?, 'CREDIT', 'PENDING', ?, ?)`,
        [actor.organizationId, actor.venueId, bill.id, businessDate, BILL_TOTAL_VND, cashierUserId],
      )).rejects.toMatchObject({ errno: 3819 })
    })

    it('phương thức lạ bị từ chối ở tầng kiểm hình dạng', async () => {
      const bill = await closedBill()
      const response = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BITCOIN', idempotencyKey: nextKey(),
      })
      expect(response.status).toBe(400)
      expect((response.body as { error: { code: string } }).error.code).toBe('INVALID_PAYMENT_METHOD')
    })
  })

  describe('AC5 — KHÔNG thanh toán hai lần', () => {
    it('đường 1: cùng mã chống trùng → trả lại kết quả cũ, một giao dịch', async () => {
      const bill = await closedBill()
      const key = nextKey()
      const first = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: 300_000, idempotencyKey: key,
      })
      expect(first.status).toBe(201)

      const replay = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: 300_000, idempotencyKey: key,
      })
      expect(replay.status).toBe(201)
      expect(replay.headers['idempotent-replayed']).toBe('true')
      expect((replay.body as { payment: PaymentView }).payment.id)
        .toBe((first.body as { payment: PaymentView }).payment.id)
      expect(await countCaptured(bill.id)).toBe(1)
    })

    it('đường 2: mã khác, tuần tự → 409 kèm ai thu lúc nào', async () => {
      const bill = await closedBill()
      await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: 300_000, idempotencyKey: nextKey(),
      })

      const second = await post(otherCashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: 300_000, idempotencyKey: nextKey(),
      })
      expect(second.status).toBe(409)
      const error = (second.body as {
        error: { code: string; details?: { paidBy?: string; paidAt?: string; method?: string } }
      }).error
      expect(error.code).toBe('BILL_ALREADY_PAID')
      // Màn hình phải nói được "thiết bị khác đã thu, ai, lúc nào".
      expect(error.details?.paidBy).toBe('tu46_cashier')
      expect(error.details?.paidAt).toBeTruthy()
      expect(error.details?.method).toBe('CASH')
      expect(await countCaptured(bill.id)).toBe(1)
    })

    it('đường 3: hai thiết bị bấm ĐỒNG THỜI → đúng một giao dịch', async () => {
      const bill = await closedBill()
      const results = await Promise.all([
        post(cashier, `/api/v1/bills/${bill.id}/payments`, {
          method: 'CASH', tenderedAmountVnd: 300_000, idempotencyKey: nextKey(),
        }),
        post(otherCashier, `/api/v1/bills/${bill.id}/payments`, {
          method: 'CASH', tenderedAmountVnd: 300_000, idempotencyKey: nextKey(),
        }),
      ])
      expect(results.filter((result) => result.status === 201)).toHaveLength(1)
      expect(await countCaptured(bill.id)).toBe(1)
    })

    it('đường 4: INSERT thẳng vào database vòng qua ứng dụng → ER_DUP_ENTRY', async () => {
      const bill = await closedBill()
      await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      await expect(databasePool.execute(
        `INSERT INTO bill_payments
           (organization_id, venue_id, bill_id, business_date, method, status, amount_vnd,
            tendered_amount_vnd, collected_by_user_id, confirmed_by_user_id, confirmed_at)
         VALUES (?, ?, ?, ?, 'CASH', 'CAPTURED', ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [actor.organizationId, actor.venueId, bill.id, businessDate, BILL_TOTAL_VND,
          BILL_TOTAL_VND, cashierUserId, cashierUserId],
      )).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' })
      expect(await countCaptured(bill.id)).toBe(1)
    })

    it('xác nhận chuyển khoản lần hai: 409 PAYMENT_NOT_PENDING', async () => {
      const bill = await closedBill()
      const created = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      const paymentId = (created.body as { payment: PaymentView }).payment.id
      await post(cashier, `/api/v1/bills/${bill.id}/payments/${paymentId}/confirm`, {
        observedTransfer: true, idempotencyKey: nextKey(),
      })

      const again = await post(cashier, `/api/v1/bills/${bill.id}/payments/${paymentId}/confirm`, {
        observedTransfer: true, idempotencyKey: nextKey(),
      })
      expect(again.status).toBe(409)
      expect(await countCaptured(bill.id)).toBe(1)
    })
  })

  describe('AC6 — Phiên đóng, bàn về Trống, lượt khách +1', () => {
    it('một bàn: Phiên đóng, bàn nhả, lượt khách được ghi', async () => {
      const bill = await closedBill()
      const response = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      const settlement = (response.body as { settlement: SettlementView }).settlement
      expect(settlement.releasedTables).toEqual(['A1'])
      expect(settlement.turn?.counted).toBe(true)

      const [visits] = await databasePool.execute<(RowDataPacket & {
        ended_at: Date | null; paid_marked_at: Date | null; paid_marked_by_user_id: number | null
      })[]>(
        'SELECT ended_at, paid_marked_at, paid_marked_by_user_id FROM visits WHERE id = ?',
        [seeded.visitId],
      )
      expect(visits[0]?.ended_at).not.toBeNull()
      expect(visits[0]?.paid_marked_at).not.toBeNull()
      expect(Number(visits[0]?.paid_marked_by_user_id)).toBe(cashierUserId)

      const [allocations] = await databasePool.execute<(RowDataPacket & { open_count: number })[]>(
        `SELECT COUNT(*) AS open_count FROM table_allocations
          WHERE visit_id = ? AND kind = 'USAGE' AND released_at IS NULL`,
        [seeded.visitId],
      )
      expect(Number(allocations[0]?.open_count)).toBe(0)
    })

    it('cụm bàn ghép: MỘT lượt khách cho cả cụm, không phải một lượt mỗi bàn', async () => {
      const merged = await mergeVisitTables({ ...actor }, {
        visitId: seeded.visitId, expectedVersion: 1, tableIds: [tableId, secondTableId],
      })
      const groupId = merged.group.id

      const bill = await closedBill()
      const response = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      expect(response.status, JSON.stringify(response.body)).toBe(201)
      const settlement = (response.body as { settlement: SettlementView }).settlement
      expect(settlement.releasedTables.sort()).toEqual(['A1', 'A2'])

      // Một đoàn khách = một lượt, không phải một lượt mỗi bàn.
      const [turns] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
        'SELECT COUNT(*) AS total FROM table_turns WHERE visit_id = ?',
        [seeded.visitId],
      )
      expect(Number(turns[0]?.total)).toBe(1)

      // Cụm do "ghép bàn cho Phiên" sinh ra là cụm CLAIM tạm thời, và nó được
      // thu hồi ĐÚNG NHƯ khi bấm Trả bàn thủ công (`dissolveUnusedGroups` chỉ
      // chạm origin CLAIM). Làm khác đi nghĩa là bàn trả bằng thanh toán và bàn
      // trả bằng nút Trả bàn để lại hai trạng thái mặt bằng khác nhau.
      //
      // "Cụm vẫn viền ghép" của TN-12 nói về cụm LAYOUT của Lễ tân (G01) — xem
      // test ngay dưới.
      const [groups] = await databasePool.execute<(RowDataPacket & { origin: string })[]>(
        'SELECT origin FROM table_groups WHERE id = ?',
        [groupId],
      )
      expect(groups[0]?.origin).toBe('CLAIM')
    })

    it('cụm LAYOUT của Lễ tân VẪN giữ quan hệ ghép sau khi thanh toán (TN-12)', async () => {
      const [layout] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO table_groups
           (organization_id, venue_id, origin, business_date, symbol_no, name, formed_at, formed_by_user_id)
         VALUES (?, ?, 'LAYOUT', ?, 7, 'G07', UTC_TIMESTAMP(3), ?)`,
        [actor.organizationId, actor.venueId, businessDate, cashierUserId],
      )
      const layoutGroupId = Number(layout.insertId)
      await databasePool.execute(
        'UPDATE table_allocations SET group_id = ? WHERE visit_id = ? AND released_at IS NULL',
        [layoutGroupId, seeded.visitId],
      )

      const bill = await closedBill()
      const paid = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      expect(paid.status, JSON.stringify(paid.body)).toBe(201)

      const [groups] = await databasePool.execute<(RowDataPacket & { dissolved_at: Date | null })[]>(
        'SELECT dissolved_at FROM table_groups WHERE id = ?',
        [layoutGroupId],
      )
      expect(groups[0]?.dissolved_at ?? null).toBeNull()
    })

    it('V12 — Phiên có 2 bill, thu bill 1: Phiên CHƯA đóng, bàn vẫn xanh (TN-13-K3)', async () => {
      const billOne = await closedBill()
      // Khách gọi thêm sau khi đã cầm hoá đơn → bill thứ hai.
      await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ variantId: seeded.variantId, priceId: seeded.priceId, priceVersion: 1, quantity: 1 }],
      })
      const second = await post(cashier, '/api/v1/bills', {
        visitId: seeded.visitId, idempotencyKey: nextKey(),
      })
      expect(second.status, JSON.stringify(second.body)).toBe(201)

      const paid = await post(cashier, `/api/v1/bills/${billOne.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      expect(paid.status).toBe(201)
      // Không có settlement: Phiên chưa đóng vì còn bill 2 chưa thu.
      expect((paid.body as { settlement: SettlementView | null }).settlement).toBeNull()

      const [visits] = await databasePool.execute<(RowDataPacket & { ended_at: Date | null })[]>(
        'SELECT ended_at FROM visits WHERE id = ?', [seeded.visitId],
      )
      expect(visits[0]?.ended_at ?? null).toBeNull()
    })

    it('V12 — thu nốt bill cuối thì Phiên mới đóng và lượt khách +1', async () => {
      const billOne = await closedBill()
      await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ variantId: seeded.variantId, priceId: seeded.priceId, priceVersion: 1, quantity: 1 }],
      })
      const second = await post(cashier, '/api/v1/bills', {
        visitId: seeded.visitId, idempotencyKey: nextKey(),
      })
      const billTwo = (second.body as { bill: BillView }).bill

      await post(cashier, `/api/v1/bills/${billOne.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      const last = await post(cashier, `/api/v1/bills/${billTwo.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: billTwo.totalVnd, idempotencyKey: nextKey(),
      })
      expect(last.status, JSON.stringify(last.body)).toBe(201)
      const settlement = (last.body as { settlement: SettlementView | null }).settlement
      expect(settlement).not.toBeNull()
      expect(settlement?.releasedTables).toEqual(['A1'])

      // Hai bill, nhưng ĐÚNG MỘT lượt khách.
      const [turns] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
        'SELECT COUNT(*) AS total FROM table_turns WHERE visit_id = ?', [seeded.visitId],
      )
      expect(Number(turns[0]?.total)).toBe(1)
    })

    it('V12 — thu hết bill nhưng còn món chưa lên hoá đơn: Phiên KHÔNG đóng (TN-13-K4)', async () => {
      const bill = await closedBill()
      // Gọi thêm nhưng CHƯA xuất hoá đơn cho phần đó.
      await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ variantId: seeded.variantId, priceId: seeded.priceId, priceVersion: 1, quantity: 1 }],
      })

      const paid = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      expect(paid.status).toBe(201)
      expect((paid.body as { settlement: SettlementView | null }).settlement).toBeNull()

      const [visits] = await databasePool.execute<(RowDataPacket & { ended_at: Date | null })[]>(
        'SELECT ended_at FROM visits WHERE id = ?', [seeded.visitId],
      )
      expect(visits[0]?.ended_at ?? null, 'bàn còn khách đang ăn thì không được trả về Trống').toBeNull()
    })

    it('thanh toán xong thì không gọi thêm món được nữa', async () => {
      const bill = await closedBill()
      await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      const extra = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ variantId: seeded.variantId, priceId: seeded.priceId, priceVersion: 1, quantity: 1 }],
      })
      expect(extra.status).toBe(409)
    })

    it('đẩy con trỏ realtime, nên mọi máy thấy bàn về Trống mà không cần F5', async () => {
      const bill = await closedBill()
      const [before] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
        'SELECT change_seq FROM venues WHERE id = ?', [actor.venueId],
      )
      await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      const [after] = await databasePool.execute<(RowDataPacket & { change_seq: string })[]>(
        'SELECT change_seq FROM venues WHERE id = ?', [actor.venueId],
      )
      expect(BigInt(after[0]!.change_seq)).toBeGreaterThan(BigInt(before[0]!.change_seq))
    })

    it('một lần thu thất bại không để lại bàn đã nhả — cùng một transaction', async () => {
      const bill = await closedBill()
      const failed = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: 1_000, idempotencyKey: nextKey(),
      })
      expect(failed.status).toBe(422)

      const [visits] = await databasePool.execute<(RowDataPacket & { ended_at: Date | null })[]>(
        'SELECT ended_at FROM visits WHERE id = ?', [seeded.visitId],
      )
      expect(visits[0]?.ended_at ?? null).toBeNull()
    })
  })

  describe('AC7 — quyền và nhật ký', () => {
    it('Phục vụ KHÔNG thu tiền được (phân quyền 15/11)', async () => {
      const bill = await closedBill()
      const response = await post(waiter, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: 300_000, idempotencyKey: nextKey(),
      })
      expect(response.status).toBe(403)
      expect(await countCaptured(bill.id)).toBe(0)
    })

    it('thiếu CSRF thì không thu được', async () => {
      const bill = await closedBill()
      const response = await cashier.agent.post(`/api/v1/bills/${bill.id}/payments`)
        .set('Origin', env.webOrigin)
        .send({ method: 'CASH', tenderedAmountVnd: 300_000, idempotencyKey: nextKey() })
      expect(response.status).toBe(403)
      expect(await countCaptured(bill.id)).toBe(0)
    })

    it('nhật ký ghi đủ số tiền nhưng KHÔNG mang chuỗi QR hay số tài khoản', async () => {
      const bill = await closedBill()
      const created = await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'BANK_TRANSFER', idempotencyKey: nextKey(),
      })
      const paymentId = (created.body as { payment: PaymentView }).payment.id
      await post(cashier, `/api/v1/bills/${bill.id}/payments/${paymentId}/confirm`, {
        observedTransfer: true, idempotencyKey: nextKey(),
      })

      const [rows] = await databasePool.execute<(RowDataPacket & { action: string; changes: unknown })[]>(
        `SELECT action, changes FROM operation_log
          WHERE venue_id = ? AND action LIKE 'BILL_PAYMENT%' ORDER BY id`,
        [actor.venueId],
      )
      expect(rows.map((row) => row.action)).toEqual(['BILL_PAYMENT_PENDING', 'BILL_PAYMENT_CONFIRMED'])
      const raw = rows.map((row) => {
        const value = row.changes
        return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value)
      }).join(' ')
      expect(raw).toContain('220000')
      expect(raw).toContain(bill.billCode)
      expect(raw).not.toContain('qrPayload')
      expect(raw).not.toContain('103900007412')
      expect(raw).not.toContain('00020101')
    })

    it('đóng Phiên sau thanh toán có dòng nhật ký riêng, khác Trả bàn thủ công', async () => {
      const bill = await closedBill()
      await post(cashier, `/api/v1/bills/${bill.id}/payments`, {
        method: 'CASH', tenderedAmountVnd: BILL_TOTAL_VND, idempotencyKey: nextKey(),
      })
      const [rows] = await databasePool.execute<(RowDataPacket & { action: string })[]>(
        "SELECT action FROM operation_log WHERE venue_id = ? AND action LIKE 'VISIT_CLOSED%'",
        [actor.venueId],
      )
      expect(rows.map((row) => row.action)).toEqual(['VISIT_CLOSED_AFTER_PAYMENT'])
    })

    it('endpoint Trả bàn thủ công vẫn từ chối chế độ AFTER_PAYMENT', async () => {
      // Trả bàn sau thanh toán đi theo luồng bill; endpoint kia không biết gì về
      // bill, nên cho nó "đóng sau khi thanh toán" là trả bàn mà không thu tiền.
      const bill = await closedBill()
      expect(bill.status).toBe('AWAITING_PAYMENT')
      const response = await post(cashier, `/api/v1/visits/${seeded.visitId}/close`, {
        version: 1, mode: 'AFTER_PAYMENT', reason: 'GUEST_LEFT',
      })
      expect(response.status).toBe(409)
      expect((response.body as { error: { code: string } }).error.code)
        .toBe('PAYMENT_VERIFICATION_UNAVAILABLE')
    })
  })
})

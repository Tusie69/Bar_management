/**
 * Module Phục vụ 5 — theo dõi và điều chỉnh đơn đã gửi, qua Express + MySQL thật.
 *
 * Mọi khẳng định ở đây đi qua HTTP: đơn được tạo bằng endpoint của Module 3,
 * phiếu được quầy nhận bằng endpoint của Module 4, rồi mới tới sửa số lượng và
 * hủy món. Mock những bước đó sẽ kiểm một thế giới trong đó Bar không bao giờ
 * bấm nhận phiếu — đúng cái thế giới mà module này tồn tại để xử lý.
 *
 * Cần `RUN_MYSQL_INTEGRATION=1`, `DB_NAME=*_test` và migration 0040.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createWalkIn } from '../src/modules/bookings/booking.repository.js'
import { mergeVisitTables } from '../src/modules/visits/visit.repository.js'
import type { WaiterOrderDetail, WaiterOrderListView } from '../src/modules/orders/order.model.js'
import type { CancellationQueueView } from '../src/modules/orders/order-adjustment.repository.js'
import {
  actor,
  businessDate,
  clearFixture,
  initializeFixture,
  loginAtPortal,
  otherVenueId,
  resetFixture,
  seedFixtureAccount,
  tableId,
} from './support/integration-fixture.js'
import { insertMenuCategory, insertMenuItem, insertMenuPrice, insertMenuVariant } from './support/menu-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const waiterUserId = 9931
const cashierUserId = 9932
const barUserId = 9933
const secondTableId = 9934

interface Session {
  cookie: string
  csrfToken: string
}

let keyCounter = 0
const idem = () => `m5-${String(++keyCounter).padStart(10, '0')}`

async function signIn(username: string, portal: 'waiter' | 'cashier' | 'admin' | 'preparation' | 'receptionist'):
Promise<Session> {
  const signed = await loginAtPortal(username, portal)
  expect(signed.status, `${username} phải đăng nhập được tại /${portal}`).toBe(200)
  const cookies = signed.headers['set-cookie'] as unknown as string[]
  return { cookie: cookies[0]!, csrfToken: (signed.body as { csrfToken: string }).csrfToken }
}

function send(session: Session, method: 'post' | 'patch', path: string, body: Record<string, unknown> = {}) {
  return request(app)[method](path)
    .set('Origin', env.webOrigin)
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrfToken)
    .send(body)
}

function read(session: Session, path: string) {
  return request(app).get(path).set('Cookie', session.cookie)
}

interface Seeded {
  visitId: number
  glassVariantId: number
  glassPriceId: number
  foodVariantId: number
  foodPriceId: number
}

async function seedCatalog(): Promise<Seeded> {
  await databasePool.execute(
    `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'M5', 'M5', 'TABLE', 4, 60, 60)`,
    [secondTableId, actor.organizationId, actor.venueId, tableId],
  )
  const visit = await createWalkIn(actor, { tableIds: [tableId], partySize: 4, businessDate })
  const barCategory = await insertMenuCategory(actor.venueId, 'WHISKY')
  const whisky = await insertMenuItem({
    venueId: actor.venueId, categoryId: barCategory, code: 'MACALLAN_12', name: 'MACALLAN 12',
    station: 'BAR', verifiedByUserId: actor.userId,
  })
  const glassVariantId = await insertMenuVariant({
    venueId: actor.venueId, itemId: whisky, code: 'GLASS', unit: 'GLASS',
  })
  const glassPriceId = await insertMenuPrice(actor.venueId, glassVariantId, 380_000)

  const foodCategory = await insertMenuCategory(actor.venueId, 'FOOD')
  const fries = await insertMenuItem({
    venueId: actor.venueId, categoryId: foodCategory, code: 'TRUFFLE_FRIES', name: 'TRUFFLE FRIES',
    station: 'KITCHEN', verifiedByUserId: actor.userId,
  })
  const foodVariantId = await insertMenuVariant({
    venueId: actor.venueId, itemId: fries, code: 'PORTION', unit: 'PORTION',
  })
  const foodPriceId = await insertMenuPrice(actor.venueId, foodVariantId, 180_000)
  return { visitId: visit.visitId, glassVariantId, glassPriceId, foodVariantId, foodPriceId }
}

/** Một đơn hai dòng: 3 ly cho Bar, 1 phần cho Bếp. */
async function createOrder(waiter: Session, seeded: Seeded, glassQuantity = 3): Promise<WaiterOrderDetail> {
  const response = await send(waiter, 'post', '/api/v1/waiter/orders', {
    visitId: seeded.visitId,
    idempotencyKey: idem(),
    lines: [
      { variantId: seeded.glassVariantId, priceId: seeded.glassPriceId, priceVersion: 1, quantity: glassQuantity },
      { variantId: seeded.foodVariantId, priceId: seeded.foodPriceId, priceVersion: 1, quantity: 1 },
    ],
  })
  expect(response.status, JSON.stringify(response.body)).toBe(201)
  return (response.body as { order: WaiterOrderDetail }).order
}

function barTicket(order: WaiterOrderDetail) {
  const ticket = order.tickets.find((candidate) => candidate.station === 'BAR')
  expect(ticket, 'đơn phải có phiếu Bar').toBeDefined()
  return ticket!
}

async function advanceBarTicket(
  bar: Session,
  ticketId: number,
  toStatus: 'ACCEPTED' | 'PREPARING' | 'READY',
  expectedVersion: number,
): Promise<number> {
  const response = await send(bar, 'post', `/api/v1/preparation/bar/tickets/${ticketId}/transition`, {
    toStatus,
    expectedVersion,
    idempotencyKey: idem(),
  })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return (response.body as { ticket: { version: number } }).ticket.version
}

async function lineRow(orderId: number, lineNo: number) {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    quantity: number
    cancelled_quantity: number
    net_quantity: number
    version: number
  })[]>(
    'SELECT quantity, cancelled_quantity, net_quantity, version FROM sales_order_lines WHERE order_id = ? AND line_no = ?',
    [orderId, lineNo],
  )
  return rows[0]!
}

async function orderRow(orderId: number) {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    item_count: number
    cancelled_item_count: number
    total_amount_vnd: string | number
    cancelled_amount_vnd: string | number
  })[]>(
    'SELECT item_count, cancelled_item_count, total_amount_vnd, cancelled_amount_vnd FROM sales_orders WHERE id = ?',
    [orderId],
  )
  return rows[0]!
}

async function ticketRow(ticketId: number) {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    status: string
    item_count: number
    cancelled_item_count: number
    version: number
  })[]>(
    'SELECT status, item_count, cancelled_item_count, version FROM preparation_tickets WHERE id = ?',
    [ticketId],
  )
  return rows[0]!
}

async function auditRows(action: string) {
  const [rows] = await databasePool.execute<(RowDataPacket & {
    actor_user_id: number
    entity_id: number
    changes: unknown
  })[]>(
    'SELECT actor_user_id, entity_id, changes FROM operation_log WHERE action = ? ORDER BY id',
    [action],
  )
  return rows
}

async function requestCancellation(
  session: Session,
  order: WaiterOrderDetail,
  input: { lineNo?: number; quantity?: number; reason?: string; acknowledgeWaste?: boolean } = {},
) {
  const lineNo = input.lineNo ?? 1
  const line = order.lines.find((candidate) => candidate.lineNo === lineNo)!
  return send(session, 'post', `/api/v1/waiter/orders/${order.orderId}/lines/${lineNo}/cancellations`, {
    expectedLineVersion: line.lineVersion,
    quantity: input.quantity ?? 1,
    ...(input.reason === undefined ? { reason: 'Khách đổi ý' } : { reason: input.reason }),
    ...(input.acknowledgeWaste === undefined ? {} : { acknowledgeWaste: input.acknowledgeWaste }),
    idempotencyKey: idem(),
  })
}

mysqlDescribe('Module Phục vụ 5 — theo dõi và điều chỉnh đơn', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await seedFixtureAccount(waiterUserId, 'module5_phucvu', 'WAITER')
    await seedFixtureAccount(cashierUserId, 'module5_thungan', 'CASHIER')
    await seedFixtureAccount(barUserId, 'module5_bar', 'BAR')
  })
  afterAll(async () => {
    await clearFixture()
    await databasePool.end()
  })

  describe('1. Đơn của Phiên, không của bàn', () => {
    it('trả về dòng món kèm version, phần còn lại và trạng thái chế biến', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)

      const response = await read(waiter, `/api/v1/waiter/visits/${seeded.visitId}/orders`)
      expect(response.status).toBe(200)
      const view = response.body as unknown as WaiterOrderListView
      expect(view).toMatchObject({
        visitId: seeded.visitId,
        orderCount: 1,
        totalAmountVnd: 380_000 * 3 + 180_000,
        cancelledAmountVnd: 0,
        netAmountVnd: 380_000 * 3 + 180_000,
      })
      expect(view.orders[0]).toMatchObject({ visitSequence: 1, cancelledItemCount: 0 })

      const detail = await read(waiter, `/api/v1/waiter/orders/${order.orderId}`)
      const lines = (detail.body as { order: WaiterOrderDetail }).order.lines
      expect(lines[0]).toMatchObject({
        lineNo: 1,
        quantity: 3,
        cancelledQuantity: 0,
        netQuantity: 3,
        netTotalVnd: 1_140_000,
        lineVersion: 1,
        preparationStation: 'BAR',
        preparationStatus: 'SUBMITTED',
        canAdjustQuantity: true,
        pendingCancellation: null,
      })
      expect(lines[1]).toMatchObject({ preparationStation: 'KITCHEN', preparationStatus: 'SUBMITTED' })
    })

    it('Phiên khác không thấy đơn của Phiên này', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      await createOrder(waiter, seeded)
      const other = await createWalkIn(actor, { tableIds: [secondTableId], partySize: 2, businessDate })
      const response = await read(waiter, `/api/v1/waiter/visits/${other.visitId}/orders`)
      expect(response.status).toBe(200)
      expect((response.body as unknown as WaiterOrderListView).orderCount).toBe(0)
    })

    it('món READY hiện trạng thái trong màn đơn của Phiên và trong thông báo của người đã gọi', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const bar = await signIn('module5_bar', 'preparation')
      const order = await createOrder(waiter, seeded)
      const ticket = barTicket(order)
      let version = await advanceBarTicket(bar, ticket.ticketId, 'ACCEPTED', ticket.status === 'SUBMITTED' ? 1 : 1)
      version = await advanceBarTicket(bar, ticket.ticketId, 'PREPARING', version)
      await advanceBarTicket(bar, ticket.ticketId, 'READY', version)

      const detail = await read(waiter, `/api/v1/waiter/orders/${order.orderId}`)
      const lines = (detail.body as { order: WaiterOrderDetail }).order.lines
      expect(lines[0]).toMatchObject({ preparationStatus: 'READY', canAdjustQuantity: false })
      // Dòng của Bếp chưa ai nhận: trạng thái của nó không bị kéo theo.
      expect(lines[1]).toMatchObject({ preparationStatus: 'SUBMITTED', canAdjustQuantity: true })

      // Module 4 gửi thông báo READY cho chính người đã gọi món.
      const notifications = await read(waiter, '/api/v1/preparation/ready-notifications')
      expect(notifications.status).toBe(200)
      const body = notifications.body as { notifications: { ticketId: number; orderedByUserId: number }[] }
      expect(body.notifications.some((entry) => entry.ticketId === ticket.ticketId)).toBe(true)
      expect(body.notifications.every((entry) => entry.orderedByUserId === waiterUserId)).toBe(true)
    })
  })

  describe('2. Sửa số lượng khi quầy chưa nhận phiếu', () => {
    it('giảm số lượng và cập nhật đơn, phiếu, lịch sử và nhật ký cùng lúc', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)
      const ticket = barTicket(order)

      const response = await send(waiter, 'patch', `/api/v1/waiter/orders/${order.orderId}/lines/1`, {
        expectedLineVersion: 1,
        quantity: 1,
        reason: 'Khách bớt một ly',
        idempotencyKey: idem(),
      })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
      const updated = (response.body as { order: WaiterOrderDetail }).order
      expect(updated.lines[0]).toMatchObject({ quantity: 1, netQuantity: 1, lineVersion: 2 })
      expect(updated.itemCount).toBe(2)
      expect(updated.totalAmountVnd).toBe(380_000 + 180_000)

      expect(await lineRow(order.orderId, 1)).toMatchObject({ quantity: 1, cancelled_quantity: 0, version: 2 })
      const ticketAfter = await ticketRow(ticket.ticketId)
      expect(Number(ticketAfter.item_count)).toBe(1)
      // Phiếu đổi version: Bar phải tải lại trước khi nhận, thay vì nhận một
      // con số đã cũ.
      expect(Number(ticketAfter.version)).toBe(2)

      const [changes] = await databasePool.execute<(RowDataPacket & {
        change_kind: string
        quantity_before: number
        quantity_after: number
        amount_delta_vnd: string | number
        reason: string | null
      })[]>('SELECT change_kind, quantity_before, quantity_after, amount_delta_vnd, reason FROM sales_order_line_changes')
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({ change_kind: 'QUANTITY_ADJUSTED', quantity_before: 3, quantity_after: 1 })
      expect(Number(changes[0]!.amount_delta_vnd)).toBe(-760_000)
      expect(changes[0]!.reason).toBe('Khách bớt một ly')

      const audit = await auditRows('SALES_ORDER_LINE_ADJUSTED')
      expect(audit).toHaveLength(1)
      expect(Number(audit[0]!.actor_user_id)).toBe(waiterUserId)
      const changesJson = typeof audit[0]!.changes === 'string'
        ? audit[0]!.changes
        : JSON.stringify(audit[0]!.changes)
      expect(changesJson).toContain('"quantityBefore":3')
      expect(changesJson).toContain('"quantityAfter":1')
      // Lý do là ô gõ tự do: nhật ký chỉ ghi có hay không, nguyên văn nằm ở
      // bảng lịch sử dòng.
      expect(changesJson).not.toContain('Khách bớt một ly')
      expect(changesJson).toContain('"hasReason":true')
    })

    it('tăng số lượng cũng đi qua cùng một đường', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)
      const response = await send(waiter, 'patch', `/api/v1/waiter/orders/${order.orderId}/lines/1`, {
        expectedLineVersion: 1, quantity: 5, idempotencyKey: idem(),
      })
      expect(response.status).toBe(200)
      expect((response.body as { order: WaiterOrderDetail }).order.totalAmountVnd).toBe(380_000 * 5 + 180_000)
      expect(Number((await ticketRow(barTicket(order).ticketId)).item_count)).toBe(5)
    })

    it('version cũ bị từ chối', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)
      await send(waiter, 'patch', `/api/v1/waiter/orders/${order.orderId}/lines/1`, {
        expectedLineVersion: 1, quantity: 2, idempotencyKey: idem(),
      })
      const stale = await send(waiter, 'patch', `/api/v1/waiter/orders/${order.orderId}/lines/1`, {
        expectedLineVersion: 1, quantity: 4, idempotencyKey: idem(),
      })
      expect(stale.status).toBe(409)
      expect((stale.body as { error: { code: string } }).error.code).toBe('ORDER_LINE_VERSION_CONFLICT')
      expect((await lineRow(order.orderId, 1)).quantity).toBe(2)
    })

    it('quầy đã nhận phiếu thì khóa sửa số lượng', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const bar = await signIn('module5_bar', 'preparation')
      const order = await createOrder(waiter, seeded)
      await advanceBarTicket(bar, barTicket(order).ticketId, 'ACCEPTED', 1)

      const response = await send(waiter, 'patch', `/api/v1/waiter/orders/${order.orderId}/lines/1`, {
        expectedLineVersion: 1, quantity: 1, idempotencyKey: idem(),
      })
      expect(response.status).toBe(409)
      const error = (response.body as { error: { code: string; details: { ticketStatus: string } } }).error
      expect(error.code).toBe('ORDER_LINE_ALREADY_ACCEPTED')
      expect(error.details.ticketStatus).toBe('ACCEPTED')
      expect((await lineRow(order.orderId, 1)).quantity).toBe(3)

      // Dòng của Bếp vẫn sửa được: phiếu của Bếp chưa ai nhận.
      const kitchen = await send(waiter, 'patch', `/api/v1/waiter/orders/${order.orderId}/lines/2`, {
        expectedLineVersion: 1, quantity: 3, idempotencyKey: idem(),
      })
      expect(kitchen.status).toBe(200)
    })

    it('Lễ tân không có quyền sửa số lượng', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)
      const receptionist = await signIn('integration_reception', 'receptionist')
      const response = await send(receptionist, 'patch', `/api/v1/waiter/orders/${order.orderId}/lines/1`, {
        expectedLineVersion: 1, quantity: 1, idempotencyKey: idem(),
      })
      expect(response.status).toBe(403)
      expect((await lineRow(order.orderId, 1)).quantity).toBe(3)
    })

    it('gọi thêm tạo đơn mới và không chạm vào đơn đã gửi', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const first = await createOrder(waiter, seeded)
      const second = await createOrder(waiter, seeded, 1)
      expect(second.visitSequence).toBe(2)
      expect(second.orderId).not.toBe(first.orderId)
      const firstAfter = await orderRow(first.orderId)
      expect(Number(firstAfter.item_count)).toBe(4)
      expect(Number(firstAfter.total_amount_vnd)).toBe(380_000 * 3 + 180_000)
    })
  })

  describe('3. Phục vụ không tự hủy món', () => {
    it('yêu cầu hủy được ghi lại nhưng chưa hủy gì', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)
      const response = await requestCancellation(waiter, order, { quantity: 2, reason: 'Khách đổi ý' })
      expect(response.status, JSON.stringify(response.body)).toBe(201)
      expect((response.body as { cancellation: { status: string; policy: string } }).cancellation)
        .toMatchObject({ status: 'PENDING', policy: 'STANDARD', version: 1 })

      // Chưa có gì bị hủy: đó là cả điểm của việc phê duyệt.
      expect(await lineRow(order.orderId, 1)).toMatchObject({ quantity: 3, cancelled_quantity: 0 })
      expect(Number((await orderRow(order.orderId)).cancelled_amount_vnd)).toBe(0)

      const detail = await read(waiter, `/api/v1/waiter/orders/${order.orderId}`)
      expect((detail.body as { order: WaiterOrderDetail }).order.lines[0]!.pendingCancellation)
        .toMatchObject({ quantity: 2, reason: 'Khách đổi ý', requestedByUserId: waiterUserId })

      const audit = await auditRows('SALES_ORDER_CANCELLATION_REQUESTED')
      expect(audit).toHaveLength(1)
      expect(Number(audit[0]!.actor_user_id)).toBe(waiterUserId)
    })

    it('Phục vụ không phê duyệt được, kể cả yêu cầu của chính mình', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)
      const created = await requestCancellation(waiter, order)
      const cancellationId = (created.body as { cancellation: { cancellationId: number } }).cancellation.cancellationId

      for (const path of ['approve', 'reject']) {
        const response = await send(waiter, 'post', `/api/v1/orders/cancellations/${cancellationId}/${path}`, {
          expectedVersion: 1, idempotencyKey: idem(),
        })
        expect(response.status, path).toBe(403)
      }
      expect((await read(waiter, '/api/v1/orders/cancellations')).status).toBe(403)
      expect(await lineRow(order.orderId, 1)).toMatchObject({ cancelled_quantity: 0 })
    })

    it('thiếu lý do thì không tạo được yêu cầu', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)
      const response = await requestCancellation(waiter, order, { reason: '   ' })
      expect(response.status).toBe(400)
      expect((response.body as { error: { code: string } }).error.code).toBe('CANCEL_REASON_REQUIRED')
    })

    it('một dòng chỉ có một yêu cầu đang chờ, và không sửa số lượng khi đang chờ', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)
      expect((await requestCancellation(waiter, order)).status).toBe(201)

      const second = await requestCancellation(waiter, order)
      expect(second.status).toBe(409)
      expect((second.body as { error: { code: string } }).error.code).toBe('ORDER_CANCELLATION_PENDING')

      const adjust = await send(waiter, 'patch', `/api/v1/waiter/orders/${order.orderId}/lines/1`, {
        expectedLineVersion: 1, quantity: 1, idempotencyKey: idem(),
      })
      expect(adjust.status).toBe(409)
      expect((adjust.body as { error: { code: string } }).error.code).toBe('ORDER_LINE_CANCELLATION_PENDING')
    })

    it('không hủy nhiều hơn phần còn lại của dòng', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const order = await createOrder(waiter, seeded)
      const response = await requestCancellation(waiter, order, { quantity: 4 })
      expect(response.status).toBe(409)
      expect((response.body as { error: { code: string } }).error.code).toBe('ORDER_LINE_QUANTITY_EXCEEDED')
    })
  })

  describe('4. Phê duyệt và từ chối', () => {
    it('duyệt cập nhật dòng, đơn và phiếu trong cùng một lần, không xoá dòng nào', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const cashier = await signIn('module5_thungan', 'cashier')
      const order = await createOrder(waiter, seeded)
      const ticket = barTicket(order)
      const created = await requestCancellation(waiter, order, { quantity: 2, reason: 'Khách đổi ý' })
      const cancellationId = (created.body as { cancellation: { cancellationId: number } }).cancellation.cancellationId

      const queue = await read(cashier, '/api/v1/orders/cancellations')
      expect(queue.status).toBe(200)
      const queueView = queue.body as unknown as CancellationQueueView
      expect(queueView.pendingCount).toBe(1)
      expect(queueView.entries[0]).toMatchObject({
        cancellationId,
        status: 'PENDING',
        policy: 'STANDARD',
        lineNo: 1,
        itemName: 'MACALLAN 12',
        station: 'BAR',
        ticketStatusAtRequest: 'SUBMITTED',
        quantity: 2,
        amountVnd: 760_000,
        reason: 'Khách đổi ý',
        requestedByUserId: waiterUserId,
        tableCodes: ['A1'],
      })

      const approved = await send(cashier, 'post', `/api/v1/orders/cancellations/${cancellationId}/approve`, {
        expectedVersion: 1, note: 'Đã xác nhận với khách', idempotencyKey: idem(),
      })
      expect(approved.status, JSON.stringify(approved.body)).toBe(200)
      expect(approved.body).toMatchObject({ cancellationId, status: 'APPROVED', version: 2 })

      const line = await lineRow(order.orderId, 1)
      // Dòng gốc còn nguyên: số lượng đã gọi vẫn là 3, phần bị hủy nằm riêng.
      expect(line).toMatchObject({ quantity: 3, cancelled_quantity: 2, net_quantity: 1 })
      const orderAfter = await orderRow(order.orderId)
      expect(Number(orderAfter.total_amount_vnd)).toBe(380_000 * 3 + 180_000)
      expect(Number(orderAfter.cancelled_amount_vnd)).toBe(760_000)
      expect(Number(orderAfter.cancelled_item_count)).toBe(2)
      expect(Number((await ticketRow(ticket.ticketId)).cancelled_item_count)).toBe(2)

      const detail = (approved.body as { order: WaiterOrderDetail }).order
      expect(detail.netAmountVnd).toBe(380_000 + 180_000)
      expect(detail.lines[0]).toMatchObject({ cancelledQuantity: 2, netQuantity: 1, pendingCancellation: null })

      const [changes] = await databasePool.execute<(RowDataPacket & {
        change_kind: string
        cancelled_after: number
        amount_delta_vnd: string | number
        cancellation_id: number | null
      })[]>('SELECT change_kind, cancelled_after, amount_delta_vnd, cancellation_id FROM sales_order_line_changes')
      expect(changes[0]).toMatchObject({ change_kind: 'CANCELLATION_APPROVED', cancelled_after: 2 })
      expect(Number(changes[0]!.amount_delta_vnd)).toBe(-760_000)
      expect(Number(changes[0]!.cancellation_id)).toBe(cancellationId)

      const audit = await auditRows('SALES_ORDER_CANCELLATION_APPROVED')
      expect(audit).toHaveLength(1)
      expect(Number(audit[0]!.actor_user_id)).toBe(cashierUserId)
      const json = typeof audit[0]!.changes === 'string' ? audit[0]!.changes : JSON.stringify(audit[0]!.changes)
      // Người yêu cầu và người duyệt là hai người khác nhau trên cùng một dòng.
      expect(json).toContain(`"requestedByUserId":${waiterUserId}`)
      expect(json).not.toContain('Đã xác nhận với khách')
    })

    it('từ chối không hủy gì và đóng yêu cầu', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const cashier = await signIn('module5_thungan', 'cashier')
      const order = await createOrder(waiter, seeded)
      const created = await requestCancellation(waiter, order, { quantity: 2 })
      const cancellationId = (created.body as { cancellation: { cancellationId: number } }).cancellation.cancellationId

      const rejected = await send(cashier, 'post', `/api/v1/orders/cancellations/${cancellationId}/reject`, {
        expectedVersion: 1, note: 'Món đã pha', idempotencyKey: idem(),
      })
      expect(rejected.status).toBe(200)
      expect(rejected.body).toMatchObject({ status: 'REJECTED', version: 2 })
      expect(await lineRow(order.orderId, 1)).toMatchObject({ quantity: 3, cancelled_quantity: 0 })
      expect(Number((await orderRow(order.orderId)).cancelled_amount_vnd)).toBe(0)
      expect(await auditRows('SALES_ORDER_CANCELLATION_REJECTED')).toHaveLength(1)

      // Yêu cầu đã đóng thì dòng được sửa số lượng lại được, và xin hủy lại được.
      expect((await requestCancellation(waiter, order)).status).toBe(201)
    })

    it('quyết định hai lần và version cũ đều bị từ chối', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const cashier = await signIn('module5_thungan', 'cashier')
      const order = await createOrder(waiter, seeded)
      const created = await requestCancellation(waiter, order)
      const cancellationId = (created.body as { cancellation: { cancellationId: number } }).cancellation.cancellationId

      const stale = await send(cashier, 'post', `/api/v1/orders/cancellations/${cancellationId}/approve`, {
        expectedVersion: 99, idempotencyKey: idem(),
      })
      expect(stale.status).toBe(409)
      expect((stale.body as { error: { code: string } }).error.code).toBe('ORDER_CANCELLATION_VERSION_CONFLICT')

      expect((await send(cashier, 'post', `/api/v1/orders/cancellations/${cancellationId}/approve`, {
        expectedVersion: 1, idempotencyKey: idem(),
      })).status).toBe(200)
      const again = await send(cashier, 'post', `/api/v1/orders/cancellations/${cancellationId}/approve`, {
        expectedVersion: 2, idempotencyKey: idem(),
      })
      expect(again.status).toBe(409)
      expect((again.body as { error: { code: string } }).error.code).toBe('ORDER_CANCELLATION_ALREADY_DECIDED')
      expect((await lineRow(order.orderId, 1)).cancelled_quantity).toBe(1)
    })

    it('hàng chờ và quyết định chỉ chạm tới yêu cầu của địa điểm mình', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const cashier = await signIn('module5_thungan', 'cashier')
      await createOrder(waiter, seeded)

      // Dựng một chuỗi hoàn chỉnh ở venue khác bằng SQL: không có đường nào qua
      // HTTP để tạo nó, và đó chính là điều cần kiểm — endpoint lọc theo venue
      // của SESSION, không theo id mà client gửi.
      const foreignCategory = await insertMenuCategory(otherVenueId, 'FOREIGN')
      const foreignItem = await insertMenuItem({
        venueId: otherVenueId, categoryId: foreignCategory, code: 'FOREIGN', name: 'Foreign secret',
        verifiedByUserId: actor.userId,
      })
      const foreignVariant = await insertMenuVariant({
        venueId: otherVenueId, itemId: foreignItem, code: 'GLASS', unit: 'GLASS',
      })
      const foreignPrice = await insertMenuPrice(otherVenueId, foreignVariant, 999_000)
      const [foreignVisit] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO visits (organization_id, venue_id, origin, guest_count, started_at, business_date,
           created_by_user_id)
         VALUES (?, ?, 'WALK_IN', 2, UTC_TIMESTAMP(3), ?, ?)`,
        [actor.organizationId, otherVenueId, businessDate, actor.userId],
      )
      const foreignVisitId = Number(foreignVisit.insertId)
      const [foreignOrder] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO sales_orders (organization_id, venue_id, visit_id, visit_sequence, business_date,
           ordered_by_user_id, ordered_by_membership_id, line_count, item_count, total_amount_vnd)
         VALUES (?, ?, ?, 1, ?, ?, ?, 1, 1, 999000)`,
        [actor.organizationId, otherVenueId, foreignVisitId, businessDate, actor.userId, actor.membershipId],
      )
      const foreignOrderId = Number(foreignOrder.insertId)
      const [foreignLine] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO sales_order_lines (organization_id, venue_id, order_id, line_no, menu_item_id,
           menu_item_variant_id, price_id, price_version, item_code, item_name, variant_display_name, unit_code,
           preparation_station, unit_price_vnd, quantity)
         VALUES (?, ?, ?, 1, ?, ?, ?, 1, 'FOREIGN', 'Foreign secret', 'Ly', 'GLASS', 'BAR', 999000, 1)`,
        [actor.organizationId, otherVenueId, foreignOrderId, foreignItem, foreignVariant, foreignPrice],
      )
      const [foreignCancellation] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO sales_order_cancellations (organization_id, venue_id, visit_id, order_id, line_id, line_no,
           quantity, reason, policy, status, station, ticket_status_at_request, requested_by_user_id,
           requested_by_membership_id)
         VALUES (?, ?, ?, ?, ?, 1, 1, 'Foreign reason', 'STANDARD', 'PENDING', 'BAR', 'SUBMITTED', ?, ?)`,
        [actor.organizationId, otherVenueId, foreignVisitId, foreignOrderId, Number(foreignLine.insertId),
          actor.userId, actor.membershipId],
      )

      const queue = await read(cashier, '/api/v1/orders/cancellations')
      const view = queue.body as unknown as CancellationQueueView
      expect(view.entries).toEqual([])
      expect(view.pendingCount).toBe(0)
      expect(JSON.stringify(queue.body)).not.toContain('Foreign secret')
      expect(JSON.stringify(queue.body)).not.toContain('Foreign reason')

      const decided = await send(
        cashier,
        'post',
        `/api/v1/orders/cancellations/${Number(foreignCancellation.insertId)}/approve`,
        { expectedVersion: 1, idempotencyKey: idem() },
      )
      expect(decided.status).toBe(404)
      expect((decided.body as { error: { code: string } }).error.code).toBe('ORDER_CANCELLATION_NOT_FOUND')
    })
  })

  describe('5. Món đã làm xong cần policy riêng', () => {
    async function readyOrder(waiter: Session, bar: Session, seeded: Seeded): Promise<WaiterOrderDetail> {
      const order = await createOrder(waiter, seeded)
      const ticket = barTicket(order)
      let version = await advanceBarTicket(bar, ticket.ticketId, 'ACCEPTED', 1)
      version = await advanceBarTicket(bar, ticket.ticketId, 'PREPARING', version)
      await advanceBarTicket(bar, ticket.ticketId, 'READY', version)
      const detail = await read(waiter, `/api/v1/waiter/orders/${order.orderId}`)
      return (detail.body as { order: WaiterOrderDetail }).order
    }

    it('Phục vụ không hủy được món đã READY bằng đường thường', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const bar = await signIn('module5_bar', 'preparation')
      const order = await readyOrder(waiter, bar, seeded)
      const response = await requestCancellation(waiter, order)
      expect(response.status).toBe(403)
      expect((response.body as { error: { code: string } }).error.code).toBe('ORDER_CANCEL_READY_DENIED')
    })

    it('người có quyền ghi hao vẫn phải xác nhận rõ ràng', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const bar = await signIn('module5_bar', 'preparation')
      const owner = await signIn('integration_owner', 'admin')
      const order = await readyOrder(waiter, bar, seeded)

      const refused = await requestCancellation(owner, order)
      expect(refused.status).toBe(409)
      expect((refused.body as { error: { code: string } }).error.code).toBe('ORDER_LINE_ALREADY_READY')

      const accepted = await requestCancellation(owner, order, { acknowledgeWaste: true, reason: 'Khách bỏ về' })
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(201)
      expect((accepted.body as { cancellation: { policy: string } }).cancellation.policy).toBe('READY_WASTE')

      const [rows] = await databasePool.execute<(RowDataPacket & { policy: string; ticket_status_at_request: string })[]>(
        'SELECT policy, ticket_status_at_request FROM sales_order_cancellations',
      )
      expect(rows[0]).toMatchObject({ policy: 'READY_WASTE', ticket_status_at_request: 'READY' })
    })
  })

  describe('6. Đồng thời và đổi bàn', () => {
    it('Bar nhận phiếu đúng lúc Phục vụ sửa số lượng: chỉ một bên thắng', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const bar = await signIn('module5_bar', 'preparation')
      const order = await createOrder(waiter, seeded)
      const ticket = barTicket(order)

      const [adjust, accept] = await Promise.all([
        send(waiter, 'patch', `/api/v1/waiter/orders/${order.orderId}/lines/1`, {
          expectedLineVersion: 1, quantity: 1, idempotencyKey: idem(),
        }),
        send(bar, 'post', `/api/v1/preparation/bar/tickets/${ticket.ticketId}/transition`, {
          toStatus: 'ACCEPTED', expectedVersion: 1, idempotencyKey: idem(),
        }),
      ])

      const line = await lineRow(order.orderId, 1)
      const ticketAfter = await ticketRow(ticket.ticketId)
      // Bất biến: số món trên phiếu luôn khớp số lượng của dòng. Không bao giờ
      // có cảnh Bar nhận 3 ly trong khi đơn đã thành 1.
      expect(Number(ticketAfter.item_count)).toBe(Number(line.quantity))

      if (adjust.status === 200) {
        // Phục vụ thắng: phiếu đổi version, nên lần nhận của Bar phải tải lại.
        expect(Number(line.quantity)).toBe(1)
        expect(accept.status).toBe(409)
        expect(['PREPARATION_VERSION_CONFLICT', 'CONCURRENT_UPDATE_RETRY'])
          .toContain((accept.body as { error: { code: string } }).error.code)
        expect(ticketAfter.status).toBe('SUBMITTED')
      } else {
        // Bar thắng: dòng giữ nguyên 3 và Phục vụ nhận đúng lý do bị khóa.
        expect(accept.status).toBe(200)
        expect(Number(line.quantity)).toBe(3)
        expect(adjust.status).toBe(409)
        expect(['ORDER_LINE_ALREADY_ACCEPTED', 'CONCURRENT_UPDATE_RETRY'])
          .toContain((adjust.body as { error: { code: string } }).error.code)
      }
    })

    it('hai lần duyệt đồng thời cùng một yêu cầu chỉ hủy một lần', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const cashier = await signIn('module5_thungan', 'cashier')
      const order = await createOrder(waiter, seeded)
      const created = await requestCancellation(waiter, order, { quantity: 2 })
      const cancellationId = (created.body as { cancellation: { cancellationId: number } }).cancellation.cancellationId

      const results = await Promise.all([
        send(cashier, 'post', `/api/v1/orders/cancellations/${cancellationId}/approve`, {
          expectedVersion: 1, idempotencyKey: idem(),
        }),
        send(cashier, 'post', `/api/v1/orders/cancellations/${cancellationId}/approve`, {
          expectedVersion: 1, idempotencyKey: idem(),
        }),
      ])
      expect(results.filter((response) => response.status === 200)).toHaveLength(1)
      expect((await lineRow(order.orderId, 1)).cancelled_quantity).toBe(2)
      expect(Number((await orderRow(order.orderId)).cancelled_amount_vnd)).toBe(760_000)
    })

    it('ghép bàn không làm mất đơn, phần đã hủy hay yêu cầu đang chờ', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module5_phucvu', 'waiter')
      const cashier = await signIn('module5_thungan', 'cashier')
      const order = await createOrder(waiter, seeded)
      const approved = await requestCancellation(waiter, order, { quantity: 1 })
      const cancellationId = (approved.body as { cancellation: { cancellationId: number } }).cancellation.cancellationId
      await send(cashier, 'post', `/api/v1/orders/cancellations/${cancellationId}/approve`, {
        expectedVersion: 1, idempotencyKey: idem(),
      })
      // Yêu cầu thứ hai, còn đang chờ, trên dòng của Bếp.
      await requestCancellation(waiter, order, { lineNo: 2, quantity: 1 })

      await mergeVisitTables({ ...actor }, {
        visitId: seeded.visitId, expectedVersion: 1, tableIds: [tableId, secondTableId],
      })

      const view = (await read(waiter, `/api/v1/waiter/visits/${seeded.visitId}/orders`))
        .body as unknown as WaiterOrderListView
      expect(view.tableCodes).toEqual(['A1', 'M5'])
      expect(view.orders.map((entry) => entry.orderId)).toEqual([order.orderId])
      expect(view.cancelledAmountVnd).toBe(380_000)
      expect(view.netAmountVnd).toBe(380_000 * 2 + 180_000)

      const detail = (await read(waiter, `/api/v1/waiter/orders/${order.orderId}`))
        .body as { order: WaiterOrderDetail }
      expect(detail.order.lines[0]).toMatchObject({ cancelledQuantity: 1, netQuantity: 2 })
      expect(detail.order.lines[1]!.pendingCancellation).toMatchObject({ quantity: 1 })

      // Hàng chờ của người duyệt vẫn thấy yêu cầu đang chờ sau khi đổi bàn,
      // với mã bàn đã cập nhật: đơn đi theo Phiên, không theo bàn.
      const queue = (await read(cashier, '/api/v1/orders/cancellations')).body as unknown as CancellationQueueView
      expect(queue.entries).toHaveLength(1)
      expect(queue.entries[0]).toMatchObject({ lineNo: 2, tableCodes: ['A1', 'M5'] })
    })
  })
})

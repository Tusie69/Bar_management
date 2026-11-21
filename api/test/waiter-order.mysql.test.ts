/**
 * Module Phục vụ 3 — giỏ gọi món và gửi đơn, qua Express + MySQL thật.
 *
 * Mọi khẳng định ở đây đi qua HTTP và database. Phân quyền, cách ly venue,
 * snapshot giá, chống trùng và đồng thời là những thứ chỉ đúng khi database
 * đúng; mock chúng nghĩa là xác nhận một cái bảng do chính test khai.
 *
 * Cần `RUN_MYSQL_INTEGRATION=1`, `DB_NAME=gam21_platform_it_test` và migration
 * 0036 đã áp dụng. Thiếu thì cả file skip — và một file skip KHÔNG phải là
 * bằng chứng rằng đơn đã được chốt giá đúng.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import request, { type Agent } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { createWalkIn } from '../src/modules/bookings/booking.repository.js'
import { applyVariantPriceWithinTransaction } from '../src/modules/menu/menu-price.repository.js'
import { mergeVisitTables } from '../src/modules/visits/visit.repository.js'
import { MAX_LINE_QUANTITY, MAX_UNIT_PRICE_VND } from '../src/modules/orders/order.repository.js'
import type { WaiterOrderDetail, WaiterOrderListView } from '../src/modules/orders/order.model.js'
import {
  actor,
  businessDate,
  clearFixture,
  initializeFixture,
  resetFixture,
  tableId,
  otherVenueId,
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

const password = 'Waiter-Module3-Password-01'
const waiterUserId = 9881
const receptionistUserId = 9882
const barUserId = 9884
const secondTableId = 9883

interface SignedIn {
  agent: Agent
  csrfToken: string
}

interface SeededCatalog {
  visitId: number
  glassVariantId: number
  glassPriceId: number
  bottleVariantId: number
  bottlePriceId: number
  foodVariantId: number
  foodPriceId: number
  unavailableVariantId: number
  unavailablePriceId: number
  foreignVariantId: number
  foreignPriceId: number
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

async function seedCatalog(): Promise<SeededCatalog> {
  await databasePool.execute(
    `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'W9', 'W9', 'TABLE', 4, 50, 60)`,
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
  const bottleVariantId = await insertMenuVariant({
    venueId: actor.venueId, itemId: whisky, code: 'BOTTLE', unit: 'BOTTLE',
  })
  const glassPriceId = await insertMenuPrice(actor.venueId, glassVariantId, 380_000)
  const bottlePriceId = await insertMenuPrice(actor.venueId, bottleVariantId, 6_500_000)

  const foodCategory = await insertMenuCategory(actor.venueId, 'FOOD')
  const fries = await insertMenuItem({
    venueId: actor.venueId, categoryId: foodCategory, code: 'TRUFFLE_FRIES',
    name: 'TRUFFLE FRIES', station: 'KITCHEN', verifiedByUserId: actor.userId,
  })
  const foodVariantId = await insertMenuVariant({
    venueId: actor.venueId, itemId: fries, code: 'PORTION', unit: 'PORTION',
  })
  const foodPriceId = await insertMenuPrice(actor.venueId, foodVariantId, 180_000)

  const soldOut = await insertMenuItem({
    venueId: actor.venueId, categoryId: barCategory, code: 'SOLD_OUT',
    name: 'HẾT HÀNG', station: 'BAR', verifiedByUserId: actor.userId,
  })
  const unavailableVariantId = await insertMenuVariant({
    venueId: actor.venueId, itemId: soldOut, code: 'GLASS', unit: 'GLASS',
    availability: 'TEMPORARILY_UNAVAILABLE',
  })
  const unavailablePriceId = await insertMenuPrice(actor.venueId, unavailableVariantId, 250_000)

  // Món của venue khác: mồi phát hiện rò rỉ chéo địa điểm.
  const foreignCategory = await insertMenuCategory(otherVenueId, 'FOREIGN')
  const foreignItem = await insertMenuItem({
    venueId: otherVenueId, categoryId: foreignCategory, code: 'FOREIGN',
    name: 'Foreign secret', verifiedByUserId: actor.userId,
  })
  const foreignVariantId = await insertMenuVariant({
    venueId: otherVenueId, itemId: foreignItem, code: 'GLASS', unit: 'GLASS',
  })
  const foreignPriceId = await insertMenuPrice(otherVenueId, foreignVariantId, 999_000)

  return {
    visitId: walkIn.visitId,
    glassVariantId, glassPriceId, bottleVariantId, bottlePriceId,
    foodVariantId, foodPriceId, unavailableVariantId, unavailablePriceId,
    foreignVariantId, foreignPriceId,
  }
}

let keyCounter = 0
function nextKey(): string {
  keyCounter += 1
  return `m3-order-key-${String(keyCounter).padStart(6, '0')}`
}

function glassLine(seeded: SeededCatalog, quantity = 2, note?: string) {
  return {
    variantId: seeded.glassVariantId,
    priceId: seeded.glassPriceId,
    priceVersion: 1,
    quantity,
    ...(note === undefined ? {} : { note }),
  }
}

function foodLine(seeded: SeededCatalog, quantity = 1) {
  return { variantId: seeded.foodVariantId, priceId: seeded.foodPriceId, priceVersion: 1, quantity }
}

async function countOrders(visitId: number): Promise<number> {
  const [rows] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM sales_orders WHERE venue_id = ? AND visit_id = ?',
    [actor.venueId, visitId],
  )
  return Number(rows[0]!.total)
}

async function repriceGlass(seeded: SeededCatalog, amountVnd: number): Promise<number> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await applyVariantPriceWithinTransaction(
      connection,
      { organizationId: actor.organizationId, venueId: actor.venueId },
      {
        variantId: seeded.glassVariantId,
        amountVnd,
        effectiveFrom: new Date(Date.now() - 60_000),
        source: 'TEST',
      },
    )
    await connection.commit()
    return result.priceId
  } finally {
    connection.release()
  }
}

mysqlDescribe('Module Phục vụ 3 — giỏ gọi món và gửi đơn', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await seedAccount(waiterUserId, 'module3_phucvu', 'WAITER')
    await seedAccount(receptionistUserId, 'module3_letan', 'RECEPTIONIST')
    // L9: Bartender lên đơn cho khách gọi tại quầy (câu trả lời Q1).
    await seedAccount(barUserId, 'module3_bar', 'BAR')
  })
  afterAll(async () => {
    await clearFixture()
    await databasePool.end()
  })

  describe('1. Tạo đơn và snapshot giá', () => {
    it('chép tên món, đơn vị, giá và quầy chế biến vào dòng đơn', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [glassLine(seeded, 2, 'ít đá'), foodLine(seeded, 3)],
      })
      expect(response.status, JSON.stringify(response.body)).toBe(201)
      const order = (response.body as { order: WaiterOrderDetail }).order
      expect(order).toMatchObject({
        visitId: seeded.visitId,
        visitSequence: 1,
        status: 'SUBMITTED',
        orderedByUserId: waiterUserId,
        orderedByDisplayName: 'module3_phucvu',
        lineCount: 2,
        itemCount: 5,
        totalAmountVnd: 380_000 * 2 + 180_000 * 3,
      })
      expect(order.lines[0]).toMatchObject({
        lineNo: 1,
        variantId: seeded.glassVariantId,
        itemCode: 'MACALLAN_12',
        itemName: 'MACALLAN 12',
        variantDisplayName: 'Ly',
        unitCode: 'GLASS',
        preparationStation: 'BAR',
        unitPriceVnd: 380_000,
        priceId: seeded.glassPriceId,
        priceVersion: 1,
        quantity: 2,
        lineTotalVnd: 760_000,
        note: 'ít đá',
      })
      expect(order.lines[1]).toMatchObject({
        variantId: seeded.foodVariantId,
        preparationStation: 'KITCHEN',
        unitPriceVnd: 180_000,
        lineTotalVnd: 540_000,
        note: null,
      })
    })

    it('một Phiên nhận nhiều đơn, mỗi lần bấm là một đơn mới', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const first = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)],
      })
      const second = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [foodLine(seeded, 2)],
      })
      expect([first.status, second.status]).toEqual([201, 201])
      expect((first.body as { order: WaiterOrderDetail }).order.visitSequence).toBe(1)
      expect((second.body as { order: WaiterOrderDetail }).order.visitSequence).toBe(2)
      const list = await waiter.agent.get(`/api/v1/waiter/visits/${seeded.visitId}/orders`)
      const view = list.body as unknown as WaiterOrderListView
      expect(view.orderCount).toBe(2)
      expect(view.orders.map((order) => order.visitSequence)).toEqual([2, 1])
      expect(view.totalAmountVnd).toBe(380_000 + 180_000 * 2)
    })

    it('snapshot giá bất biến khi giá đổi sau khi đơn đã gửi', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const created = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 2)],
      })
      const orderId = (created.body as { order: WaiterOrderDetail }).order.orderId
      await repriceGlass(seeded, 420_000)
      const detail = await waiter.agent.get(`/api/v1/waiter/orders/${orderId}`)
      const order = (detail.body as { order: WaiterOrderDetail }).order
      expect(order.lines[0]).toMatchObject({
        unitPriceVnd: 380_000,
        priceId: seeded.glassPriceId,
        lineTotalVnd: 760_000,
      })
      expect(order.totalAmountVnd).toBe(760_000)
    })
  })

  describe('2. Routing Bar / Bếp', () => {
    it('đơn có cả đồ uống và đồ ăn sinh hai phiếu, đơn chỉ có đồ uống sinh một', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const mixed = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [glassLine(seeded, 1), foodLine(seeded, 2)],
      })
      const mixedOrder = (mixed.body as { order: WaiterOrderDetail }).order
      expect(mixedOrder.stations).toEqual(['BAR', 'KITCHEN'])
      expect(mixedOrder.tickets).toEqual([
        expect.objectContaining({ station: 'BAR', status: 'SUBMITTED', lineCount: 1, itemCount: 1 }),
        expect.objectContaining({ station: 'KITCHEN', status: 'SUBMITTED', lineCount: 1, itemCount: 2 }),
      ])
      const barOnly = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)],
      })
      const barOrder = (barOnly.body as { order: WaiterOrderDetail }).order
      expect(barOrder.tickets.map((ticket) => ticket.station)).toEqual(['BAR'])
    })
  })

  describe('3. Kiểm lại ở máy chủ', () => {
    it('giá đổi thì trả MENU_PRICE_CHANGED kèm giá mới và KHÔNG tạo đơn', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const newPriceId = await repriceGlass(seeded, 420_000)
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [glassLine(seeded, 2), foodLine(seeded, 1)],
      })
      expect(response.status).toBe(409)
      const error = (response.body as { error: { code: string; details: { changes: unknown[] } } }).error
      expect(error.code).toBe('MENU_PRICE_CHANGED')
      expect(error.details.changes).toEqual([
        expect.objectContaining({
          variantId: seeded.glassVariantId,
          itemName: 'MACALLAN 12',
          variantDisplayName: 'Ly',
          submittedPriceId: seeded.glassPriceId,
          currentPriceId: newPriceId,
          currentAmountVnd: 420_000,
        }),
      ])
      // Cả đơn bị bỏ: dòng đồ ăn hợp lệ cũng không được gửi một mình.
      expect(await countOrders(seeded.visitId)).toBe(0)
    })

    it('priceVersion lệch cũng là giá đã đổi', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ ...glassLine(seeded, 1), priceVersion: 99 }],
      })
      expect(response.status).toBe(409)
      expect((response.body as { error: { code: string } }).error.code).toBe('MENU_PRICE_CHANGED')
      expect(await countOrders(seeded.visitId)).toBe(0)
    })

    it('món tạm hết thì rollback toàn bộ đơn', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [
          glassLine(seeded, 1),
          {
            variantId: seeded.unavailableVariantId,
            priceId: seeded.unavailablePriceId,
            priceVersion: 1,
            quantity: 1,
          },
        ],
      })
      expect(response.status).toBe(409)
      const error = (response.body as { error: { code: string; details: { variants: unknown[] } } }).error
      expect(error.code).toBe('MENU_ITEM_UNAVAILABLE')
      expect(error.details.variants).toEqual([
        expect.objectContaining({ variantId: seeded.unavailableVariantId, reason: 'TEMPORARILY_UNAVAILABLE' }),
      ])
      expect(await countOrders(seeded.visitId)).toBe(0)
      const [lines] = await databasePool.execute<RowDataPacket[]>('SELECT 1 FROM sales_order_lines LIMIT 1')
      expect(lines).toHaveLength(0)
    })

    it('món chưa duyệt, đã tắt hoặc khóa bán đều không gửi được', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const category = await insertMenuCategory(actor.venueId, 'HIDDEN')
      const pendingItem = await insertMenuItem({
        venueId: actor.venueId, categoryId: category, code: 'PENDING', name: 'Chờ duyệt',
        sourceStatus: 'PENDING_VERIFICATION', verifiedByUserId: actor.userId,
      })
      const pendingVariant = await insertMenuVariant({
        venueId: actor.venueId, itemId: pendingItem, code: 'GLASS', unit: 'GLASS',
      })
      const pendingPrice = await insertMenuPrice(actor.venueId, pendingVariant, 100_000)
      const blockedItem = await insertMenuItem({
        venueId: actor.venueId, categoryId: category, code: 'BLOCKED', name: 'Khóa bán',
        verifiedByUserId: actor.userId,
      })
      const blockedVariant = await insertMenuVariant({
        venueId: actor.venueId, itemId: blockedItem, code: 'GLASS', unit: 'GLASS', isSellable: false,
      })
      const blockedPrice = await insertMenuPrice(actor.venueId, blockedVariant, 100_000)

      for (const [variantId, priceId, reason] of [
        [pendingVariant, pendingPrice, 'NOT_IN_CATALOG'],
        [blockedVariant, blockedPrice, 'NOT_SELLABLE'],
      ] as const) {
        const response = await post(waiter, '/api/v1/waiter/orders', {
          visitId: seeded.visitId,
          idempotencyKey: nextKey(),
          lines: [{ variantId, priceId, priceVersion: 1, quantity: 1 }],
        })
        expect(response.status, `variant ${variantId}`).toBe(409)
        const error = (response.body as { error: { code: string; details: { variants: { reason: string }[] } } }).error
        expect(error.code).toBe('MENU_ITEM_UNAVAILABLE')
        expect(error.details.variants[0]!.reason).toBe(reason)
      }
      expect(await countOrders(seeded.visitId)).toBe(0)
    })

    it('Phiên đã đóng và Phiên chờ thanh toán đều không gửi đơn được', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      await databasePool.execute(
        'UPDATE visits SET paid_marked_at = UTC_TIMESTAMP(3), paid_marked_by_user_id = ? WHERE id = ?',
        [actor.userId, seeded.visitId],
      )
      const paid = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)],
      })
      expect(paid.status).toBe(409)
      expect((paid.body as { error: { code: string } }).error.code).toBe('VISIT_NOT_ORDERABLE')

      await databasePool.execute(
        `UPDATE visits SET paid_marked_at = NULL, paid_marked_by_user_id = NULL,
           ended_at = UTC_TIMESTAMP(3), ended_by_user_id = ?, end_reason = 'GUEST_LEFT'
         WHERE id = ?`,
        [actor.userId, seeded.visitId],
      )
      const closed = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)],
      })
      expect(closed.status).toBe(409)
      expect((closed.body as { error: { code: string } }).error.code).toBe('VISIT_CLOSED')
      expect(await countOrders(seeded.visitId)).toBe(0)
    })

    it('Phiên đã nhả hết bàn thì không còn gọi món được', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      await databasePool.execute(
        `UPDATE table_allocations
         SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?, release_reason = 'GUEST_LEFT'
         WHERE venue_id = ? AND visit_id = ? AND kind = 'USAGE'`,
        [actor.userId, actor.venueId, seeded.visitId],
      )
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)],
      })
      expect(response.status).toBe(409)
      expect((response.body as { error: { code: string } }).error.code).toBe('VISIT_NOT_SEATED')
    })
  })

  describe('4. Phân quyền và cách ly địa điểm', () => {
    it('Lễ tân không có order.create và không gửi được đơn', async () => {
      const seeded = await seedCatalog()
      const receptionist = await signIn('module3_letan', 'receptionist')
      const response = await post(receptionist, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)],
      })
      expect(response.status).toBe(403)
      expect(await countOrders(seeded.visitId)).toBe(0)
      expect((await receptionist.agent.get(`/api/v1/waiter/visits/${seeded.visitId}/orders`)).status).toBe(403)
    })

    // L9 — bốn khẳng định này là toàn bộ phạm vi mới của vai BAR: vào được cổng
    // Phục vụ, gửi được đơn đứng tên mình, và KHÔNG chạm tới phần phê duyệt hủy
    // hay dữ liệu khách. Nếu một trong hai điều sau đổi, nó phải đổi ở đây
    // trước khi đổi ngoài sản phẩm.
    it('Bartender đăng nhập cổng Phục vụ và gửi được đơn đứng tên mình', async () => {
      const seeded = await seedCatalog()
      const bar = await signIn('module3_bar', 'waiter')
      const response = await post(bar, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 2)],
      })
      expect(response.status, JSON.stringify(response.body)).toBe(201)
      const order = (response.body as { order: WaiterOrderDetail }).order
      expect(order).toMatchObject({
        status: 'SUBMITTED',
        orderedByUserId: barUserId,
        orderedByDisplayName: 'module3_bar',
      })
      // Và nó đọc lại được đơn của bàn, nên màn Đơn của bàn không trống.
      const list = await bar.agent.get(`/api/v1/waiter/visits/${seeded.visitId}/orders`)
      expect(list.status).toBe(200)
      expect((list.body as WaiterOrderListView).orders).toHaveLength(1)
    })

    it('Bartender gửi được yêu cầu hủy nhưng không phê duyệt được', async () => {
      const seeded = await seedCatalog()
      const bar = await signIn('module3_bar', 'waiter')
      const created = await post(bar, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 2)],
      })
      expect(created.status).toBe(201)
      const order = (created.body as { order: WaiterOrderDetail }).order

      const requested = await post(
        bar,
        `/api/v1/waiter/orders/${order.orderId}/lines/1/cancellations`,
        {
          quantity: 1,
          reason: 'Khách đổi ý',
          expectedLineVersion: order.lines[0]!.lineVersion,
          idempotencyKey: nextKey(),
        },
      )
      expect(requested.status, JSON.stringify(requested.body)).toBe(201)

      // Vừa xin vừa duyệt thì bước duyệt không còn nghĩa gì.
      const queue = await bar.agent.get('/api/v1/orders/cancellations')
      expect(queue.status).toBe(403)
    })

    it('Bartender không đọc được dữ liệu khách', async () => {
      await seedCatalog()
      const bar = await signIn('module3_bar', 'waiter')
      // Danh sách bàn đầy đủ cần customer.view_masked; BAR không có quyền đó.
      expect((await bar.agent.get('/api/v1/tables')).status).toBe(403)
    })

    it('Bartender vẫn đăng nhập được cổng chế biến', async () => {
      const preparation = await signIn('module3_bar', 'preparation')
      expect(preparation.csrfToken).toBeTruthy()
    })

    it('không gửi được đơn mà không có CSRF token', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const response = await waiter.agent.post('/api/v1/waiter/orders').set('Origin', env.webOrigin)
        .send({ visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)] })
      expect(response.status).toBe(403)
      expect(await countOrders(seeded.visitId)).toBe(0)
    })

    it('biến thể của địa điểm khác không tồn tại với máy Phục vụ của quán này', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{
          variantId: seeded.foreignVariantId,
          priceId: seeded.foreignPriceId,
          priceVersion: 1,
          quantity: 1,
        }],
      })
      expect(response.status).toBe(409)
      const error = (response.body as { error: { code: string; details: { variants: { reason: string }[] } } }).error
      expect(error.code).toBe('MENU_ITEM_UNAVAILABLE')
      expect(error.details.variants[0]!.reason).toBe('NOT_IN_CATALOG')
      expect(JSON.stringify(response.body)).not.toContain('Foreign secret')
      expect(await countOrders(seeded.visitId)).toBe(0)
    })

    it('đơn của Phiên ở địa điểm khác không đọc được qua endpoint này', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      // Một Phiên và một đơn thuộc venue khác, dựng thẳng bằng SQL: không có
      // đường nào qua HTTP để tạo chúng, và đó chính là điều cần kiểm — endpoint
      // lọc theo venue của SESSION, không theo id mà client gửi.
      const [foreignVisit] = await databasePool.execute<ResultSetHeader>(
        `INSERT INTO visits (organization_id, venue_id, origin, guest_count, started_at, business_date, created_by_user_id)
         VALUES (?, ?, 'WALK_IN', 2, UTC_TIMESTAMP(3), ?, ?)`,
        [actor.organizationId, otherVenueId, businessDate, actor.userId],
      )
      const foreignVisitId = Number(foreignVisit.insertId)
      await databasePool.execute(
        `INSERT INTO sales_orders (organization_id, venue_id, visit_id, visit_sequence, business_date,
           ordered_by_user_id, ordered_by_membership_id, line_count, item_count, total_amount_vnd)
         VALUES (?, ?, ?, 1, ?, ?, ?, 1, 1, 999000)`,
        [actor.organizationId, otherVenueId, foreignVisitId, businessDate, actor.userId, actor.membershipId],
      )
      expect((await waiter.agent.get(`/api/v1/waiter/visits/${foreignVisitId}/orders`)).status).toBe(404)

      const own = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)],
      })
      const ownOrderId = (own.body as { order: WaiterOrderDetail }).order.orderId
      const [foreignOrders] = await databasePool.execute<(RowDataPacket & { id: number })[]>(
        'SELECT id FROM sales_orders WHERE venue_id = ?',
        [otherVenueId],
      )
      const foreignOrderId = Number(foreignOrders[0]!.id)
      expect((await waiter.agent.get(`/api/v1/waiter/orders/${foreignOrderId}`)).status).toBe(404)
      expect((await waiter.agent.get(`/api/v1/waiter/orders/${ownOrderId}`)).status).toBe(200)
    })
  })

  describe('5. Chống trùng và double submit', () => {
    it('gửi lại cùng mã và cùng payload trả lại đúng đơn cũ, không tạo đơn thứ hai', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const key = nextKey()
      const body = { visitId: seeded.visitId, idempotencyKey: key, lines: [glassLine(seeded, 2)] }
      const first = await post(waiter, '/api/v1/waiter/orders', body)
      const second = await post(waiter, '/api/v1/waiter/orders', body)
      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      expect(second.headers['idempotent-replayed']).toBe('true')
      expect((second.body as { order: WaiterOrderDetail }).order.orderId)
        .toBe((first.body as { order: WaiterOrderDetail }).order.orderId)
      expect(await countOrders(seeded.visitId)).toBe(1)
    })

    it('cùng mã nhưng payload khác bị từ chối thay vì trả lại đơn của lần trước', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const key = nextKey()
      const first = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: key, lines: [glassLine(seeded, 2)],
      })
      expect(first.status).toBe(201)
      const second = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: key, lines: [glassLine(seeded, 3)],
      })
      expect(second.status).toBe(422)
      expect((second.body as { error: { code: string } }).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
      expect(await countOrders(seeded.visitId)).toBe(1)
    })

    it('hai lần bấm đồng thời cùng mã chỉ tạo một đơn', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const body = { visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 2)] }
      const [left, right] = await Promise.all([
        post(waiter, '/api/v1/waiter/orders', body),
        post(waiter, '/api/v1/waiter/orders', body),
      ])
      const statuses = [left.status, right.status].sort((a, b) => a - b)
      // Lần thứ hai chờ ở INSERT của mã chống trùng: nó trả lại đơn vừa tạo
      // (201 replay) hoặc báo yêu cầu trước đang xử lý (409). Cả hai đều không
      // được là một đơn thứ hai.
      expect(statuses[0]).toBe(201)
      expect([201, 409]).toContain(statuses[1])
      expect(await countOrders(seeded.visitId)).toBe(1)
    })

    it('hai lần bấm đồng thời với hai mã khác nhau tạo hai đơn có số thứ tự khác nhau', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const [left, right] = await Promise.all([
        post(waiter, '/api/v1/waiter/orders', {
          visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)],
        }),
        post(waiter, '/api/v1/waiter/orders', {
          visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [foodLine(seeded, 1)],
        }),
      ])
      expect([left.status, right.status]).toEqual([201, 201])
      const sequences = [left, right]
        .map((response) => (response.body as { order: WaiterOrderDetail }).order.visitSequence)
        .sort((a, b) => a - b)
      expect(sequences).toEqual([1, 2])
    })

    it('lỗi nghiệp vụ không tiêu mã chống trùng: sửa giỏ rồi bấm lại vẫn gửi được', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const key = nextKey()
      const rejected = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: key,
        lines: [{
          variantId: seeded.unavailableVariantId,
          priceId: seeded.unavailablePriceId,
          priceVersion: 1,
          quantity: 1,
        }],
      })
      expect(rejected.status).toBe(409)
      const retried = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: key, lines: [glassLine(seeded, 1)],
      })
      expect(retried.status, JSON.stringify(retried.body)).toBe(201)
      expect(await countOrders(seeded.visitId)).toBe(1)
    })
  })

  describe('6. Đơn đi theo Phiên, không theo bàn', () => {
    it('ghép thêm bàn không làm mất đơn đã gửi', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const created = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 2)],
      })
      const orderId = (created.body as { order: WaiterOrderDetail }).order.orderId
      await mergeVisitTables({ ...actor }, {
        visitId: seeded.visitId,
        expectedVersion: 1,
        tableIds: [tableId, secondTableId],
      })
      const list = await waiter.agent.get(`/api/v1/waiter/visits/${seeded.visitId}/orders`)
      const view = list.body as unknown as WaiterOrderListView
      expect(view.tableCodes).toEqual(['A1', 'W9'])
      expect(view.orders.map((order) => order.orderId)).toEqual([orderId])
      const [tickets] = await databasePool.execute<(RowDataPacket & { visit_id: number })[]>(
        'SELECT visit_id FROM preparation_tickets WHERE venue_id = ? AND order_id = ?',
        [actor.venueId, orderId],
      )
      expect(tickets.map((row) => Number(row.visit_id))).toEqual([seeded.visitId])
      const [pipeline] = await databasePool.execute<(RowDataPacket & { events: number; outbox: number })[]>(
        `SELECT
          (SELECT COUNT(*) FROM preparation_ticket_events e
            JOIN preparation_tickets t ON t.id = e.ticket_id WHERE t.order_id = ?) events,
          (SELECT COUNT(*) FROM preparation_print_outbox p
            JOIN preparation_tickets t ON t.id = p.ticket_id WHERE t.order_id = ?) outbox`,
        [orderId, orderId],
      )
      expect(Number(pipeline[0]!.events)).toBe(1)
      expect(Number(pipeline[0]!.outbox)).toBe(1)
    })
  })

  describe('7. Nhật ký', () => {
    it('ghi một dòng SALES_ORDER_CREATED với người gọi món, không ghi nội dung ghi chú', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const secret = 'khach chi Nhung 0912345789'
      const key = nextKey()
      const created = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: key,
        lines: [glassLine(seeded, 2, secret)],
      })
      expect(created.status).toBe(201)
      const orderId = (created.body as { order: WaiterOrderDetail }).order.orderId
      const [rows] = await databasePool.execute<(RowDataPacket & {
        actor_user_id: number
        entity_id: number
        idempotency_key: string | null
        changes: unknown
      })[]>(
        `SELECT actor_user_id, entity_id, idempotency_key, changes FROM operation_log
         WHERE action = 'SALES_ORDER_CREATED' AND venue_id = ?`,
        [actor.venueId],
      )
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      expect(Number(row.actor_user_id)).toBe(waiterUserId)
      expect(Number(row.entity_id)).toBe(orderId)
      expect(row.idempotency_key).toBe(key)
      const changes = typeof row.changes === 'string' ? row.changes : JSON.stringify(row.changes)
      expect(changes).not.toContain(secret)
      expect(changes).not.toContain('0912345789')
      expect(changes).toContain('"hasNote":true')
      expect(changes).toContain('MACALLAN_12')
      // Ghi chú vẫn tới được Bar: nó nằm ở dòng đơn, không ở nhật ký.
      const [lines] = await databasePool.execute<(RowDataPacket & { note: string | null })[]>(
        'SELECT note FROM sales_order_lines WHERE venue_id = ? AND order_id = ?',
        [actor.venueId, orderId],
      )
      expect(lines[0]!.note).toBe(secret)
    })

    it('đẩy con trỏ realtime của địa điểm đúng một lần cho mỗi đơn', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const [before] = await databasePool.execute<(RowDataPacket & { change_seq: number })[]>(
        'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
        [actor.organizationId, actor.venueId],
      )
      await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId, idempotencyKey: nextKey(), lines: [glassLine(seeded, 1)],
      })
      const [after] = await databasePool.execute<(RowDataPacket & { change_seq: number })[]>(
        'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
        [actor.organizationId, actor.venueId],
      )
      expect(Number(after[0]!.change_seq)).toBe(Number(before[0]!.change_seq) + 1)
    })
  })

  describe('8. Cùng một món, nhiều customize', () => {
    it('hai ghi chú khác nhau thành hai dòng, và Bar nhận đủ hai', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [glassLine(seeded, 2, 'ít đá'), glassLine(seeded, 1, 'không đá')],
      })
      expect(response.status, JSON.stringify(response.body)).toBe(201)
      const order = (response.body as { order: WaiterOrderDetail }).order
      expect(order.lineCount).toBe(2)
      expect(order.itemCount).toBe(3)
      expect(order.totalAmountVnd).toBe(380_000 * 3)
      expect(order.lines.map((line) => [line.lineNo, line.variantId, line.quantity, line.note])).toEqual([
        [1, seeded.glassVariantId, 2, 'ít đá'],
        [2, seeded.glassVariantId, 1, 'không đá'],
      ])
      // Phiếu của Bar mang cả hai dòng: một phiếu, hai customize.
      expect(order.tickets).toEqual([
        expect.objectContaining({ station: 'BAR', lineCount: 2, itemCount: 3 }),
      ])
      const [lines] = await databasePool.execute<
        (RowDataPacket & { note: string | null; line_total_vnd: string | number })[]
      >(
        'SELECT note, line_total_vnd FROM sales_order_lines WHERE venue_id = ? AND order_id = ? ORDER BY line_no',
        [actor.venueId, order.orderId],
      )
      expect(lines.map((row) => row.note)).toEqual(['ít đá', 'không đá'])
      expect(lines.map((row) => Number(row.line_total_vnd))).toEqual([760_000, 380_000])
    })

    it('cùng món cùng ghi chú thì phải gộp: payload hai dòng bị từ chối', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [glassLine(seeded, 2, 'ít đá'), glassLine(seeded, 1, 'Ít  Đá')],
      })
      expect(response.status).toBe(400)
      expect((response.body as { error: { code: string } }).error.code).toBe('ORDER_DUPLICATE_LINE')
      expect(await countOrders(seeded.visitId)).toBe(0)
    })
  })

  describe('9. Một lỗi mang mọi vấn đề của giỏ', () => {
    it('giỏ vừa có món hết vừa có giá đổi trả về cả hai trong một lần', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const newPriceId = await repriceGlass(seeded, 420_000)
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [
          glassLine(seeded, 2),
          { variantId: seeded.unavailableVariantId, priceId: seeded.unavailablePriceId, priceVersion: 1, quantity: 1 },
          foodLine(seeded, 1),
        ],
      })
      expect(response.status).toBe(409)
      const error = (
        response.body as { error: { code: string; details: { variants: unknown[]; changes: unknown[] } } }
      ).error
      expect(error.code).toBe('ORDER_LINES_REJECTED')
      expect(error.details.variants).toEqual([
        expect.objectContaining({ variantId: seeded.unavailableVariantId, reason: 'TEMPORARILY_UNAVAILABLE' }),
      ])
      expect(error.details.changes).toEqual([
        expect.objectContaining({
          variantId: seeded.glassVariantId,
          currentPriceId: newPriceId,
          currentAmountVnd: 420_000,
        }),
      ])
      expect(await countOrders(seeded.visitId)).toBe(0)
    })

    it('mỗi loại lỗi riêng vẫn giữ mã cũ, và details luôn có đủ hai mảng', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const soldOut = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [
          { variantId: seeded.unavailableVariantId, priceId: seeded.unavailablePriceId, priceVersion: 1, quantity: 1 },
        ],
      })
      const soldOutError = (soldOut.body as { error: { code: string; details: { changes: unknown[] } } }).error
      expect(soldOutError.code).toBe('MENU_ITEM_UNAVAILABLE')
      expect(soldOutError.details.changes).toEqual([])

      await repriceGlass(seeded, 420_000)
      const repriced = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [glassLine(seeded, 1)],
      })
      const repricedError = (repriced.body as { error: { code: string; details: { variants: unknown[] } } }).error
      expect(repricedError.code).toBe('MENU_PRICE_CHANGED')
      expect(repricedError.details.variants).toEqual([])
    })

    it('hai dòng cùng biến thể chỉ sinh MỘT mục trong lỗi', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      await repriceGlass(seeded, 420_000)
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [glassLine(seeded, 2, 'ít đá'), glassLine(seeded, 1, 'không đá')],
      })
      expect(response.status).toBe(409)
      const error = (response.body as { error: { details: { changes: unknown[] } } }).error
      expect(error.details.changes).toHaveLength(1)
    })
  })

  describe('10. Giới hạn tiền', () => {
    it('giá trong danh mục vượt trần thì không chép vào dòng đơn', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const category = await insertMenuCategory(actor.venueId, 'LUXURY')
      const itemId = await insertMenuItem({
        venueId: actor.venueId,
        categoryId: category,
        code: 'TOO_RICH',
        name: 'Quá đắt',
        verifiedByUserId: actor.userId,
      })
      const variantId = await insertMenuVariant({ venueId: actor.venueId, itemId, code: 'BOTTLE', unit: 'BOTTLE' })
      const priceId = await insertMenuPrice(actor.venueId, variantId, MAX_UNIT_PRICE_VND + 1)
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [{ variantId, priceId, priceVersion: 1, quantity: 1 }],
      })
      expect(response.status).toBe(409)
      const error = (response.body as { error: { code: string; details: { maxUnitPriceVnd: number } } }).error
      expect(error.code).toBe('MENU_PRICE_OUT_OF_RANGE')
      expect(error.details.maxUnitPriceVnd).toBe(MAX_UNIT_PRICE_VND)
      expect(await countOrders(seeded.visitId)).toBe(0)
    })

    it('database từ chối một dòng đơn có đơn giá vượt trần', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      const created = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines: [glassLine(seeded, 1)],
      })
      const order = (created.body as { order: WaiterOrderDetail }).order
      const line = order.lines[0]!
      // Ràng buộc nằm ở database, không chỉ ở code: một lần INSERT tay cũng bị chặn.
      await expect(
        databasePool.execute(
          'INSERT INTO sales_order_lines'
            + ' (organization_id, venue_id, order_id, line_no, menu_item_id, menu_item_variant_id, price_id,'
            + '  price_version, item_code, item_name, variant_display_name, unit_code, preparation_station,'
            + '  unit_price_vnd, quantity)'
            + " VALUES (?, ?, ?, 99, ?, ?, ?, 1, 'X', 'X', 'Ly', 'GLASS', 'BAR', ?, 1)",
          [
            actor.organizationId,
            actor.venueId,
            order.orderId,
            line.menuItemId,
            line.variantId,
            line.priceId,
            MAX_UNIT_PRICE_VND + 1,
          ],
        ),
      ).rejects.toThrow(/ck_sales_order_lines_price|Check constraint/i)
    })

    it('đơn lớn nhất hợp lệ vẫn giữ tổng tiền chính xác tới từng đồng', async () => {
      const seeded = await seedCatalog()
      const waiter = await signIn('module3_phucvu', 'waiter')
      // Hai dòng ở trần đơn giá và trần số lượng: con số này phải khớp tuyệt
      // đối, không phải "gần đúng". Nó là lý do trần tiền tồn tại.
      const category = await insertMenuCategory(actor.venueId, 'CAP')
      const lines: { variantId: number; priceId: number; priceVersion: number; quantity: number }[] = []
      for (const code of ['CAP_A', 'CAP_B']) {
        const itemId = await insertMenuItem({
          venueId: actor.venueId,
          categoryId: category,
          code,
          name: code,
          verifiedByUserId: actor.userId,
        })
        const variantId = await insertMenuVariant({ venueId: actor.venueId, itemId, code: 'BOTTLE', unit: 'BOTTLE' })
        const priceId = await insertMenuPrice(actor.venueId, variantId, MAX_UNIT_PRICE_VND)
        lines.push({ variantId, priceId, priceVersion: 1, quantity: MAX_LINE_QUANTITY })
      }
      const response = await post(waiter, '/api/v1/waiter/orders', {
        visitId: seeded.visitId,
        idempotencyKey: nextKey(),
        lines,
      })
      expect(response.status, JSON.stringify(response.body)).toBe(201)
      const order = (response.body as { order: WaiterOrderDetail }).order
      const expected = 2 * MAX_LINE_QUANTITY * MAX_UNIT_PRICE_VND
      expect(order.totalAmountVnd).toBe(expected)
      expect(Number.isSafeInteger(order.totalAmountVnd)).toBe(true)
      expect(order.lines.map((line) => line.lineTotalVnd)).toEqual([
        MAX_LINE_QUANTITY * MAX_UNIT_PRICE_VND,
        MAX_LINE_QUANTITY * MAX_UNIT_PRICE_VND,
      ])
      // Đọc lại từ database: BIGINT về dưới dạng chuỗi, nên đây là chỗ một con
      // số bị làm tròn sẽ lộ ra.
      const detail = await waiter.agent.get('/api/v1/waiter/orders/' + order.orderId)
      expect((detail.body as { order: WaiterOrderDetail }).order.totalAmountVnd).toBe(expected)
    })
  })
})

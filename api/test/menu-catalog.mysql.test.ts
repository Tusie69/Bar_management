import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createWalkIn } from '../src/modules/bookings/booking.repository.js'
import { createMenuVariantPrice } from '../src/modules/menu/menu-price.repository.js'
import { databasePool } from '../src/database/pool.js'
import { normalizeSearchText } from '../src/lib/search-text.js'
import type { WaiterMenuView } from '../src/modules/menu/menu.model.js'
import {
  actor,
  businessDate,
  clearFixture,
  initializeFixture,
  login,
  resetFixture,
  tableId,
  otherVenueId,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' ? describe : describe.skip

interface SeededCatalog {
  visitId: number
  verifiedItemId: number
  glassVariantId: number
}

async function insertCategory(venueId: number, code: string): Promise<number> {
  const [result] = await databasePool.execute<ResultSetHeader>(
    'INSERT INTO menu_categories (venue_id, code, name, display_order) VALUES (?, ?, ?, 1)',
    [venueId, code, code],
  )
  return Number(result.insertId)
}

async function insertItem(input: {
  venueId: number
  categoryId: number
  code: string
  name: string
  sourceStatus?: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED'
  isActive?: boolean
}): Promise<number> {
  // 0034: `ck_menu_items_verified_audit` buộc mọi dòng VERIFIED phải mang
  // người duyệt, thời điểm duyệt và vân tay đã duyệt. Fixture phải dựng dữ
  // liệu hợp lệ như dữ liệu thật, nếu không nó đang kiểm một trạng thái mà
  // database không cho phép tồn tại.
  const status = input.sourceStatus ?? 'VERIFIED'
  const verified = status === 'VERIFIED'
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO menu_items (
       venue_id, category_id, code, name, normalized_name, preparation_station, source_status, is_active,
       verified_digest, verified_at, verified_by_user_id
     ) VALUES (?, ?, ?, ?, ?, 'BAR', ?, ?, ?, ?, ?)`,
    [input.venueId, input.categoryId, input.code, input.name, normalizeSearchText(input.name),
      status, input.isActive === false ? 0 : 1,
      verified ? 'f'.repeat(64) : null, verified ? new Date() : null, verified ? actor.userId : null],
  )
  return Number(result.insertId)
}

async function insertVariant(input: {
  venueId: number
  itemId: number
  code: string
  unit: 'GLASS' | 'BOTTLE'
  availability?: 'AVAILABLE' | 'TEMPORARILY_UNAVAILABLE'
  isSellable?: boolean
}): Promise<number> {
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO menu_item_variants (
       venue_id, menu_item_id, code, unit_code, display_name, is_sellable, availability_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.venueId, input.itemId, input.code, input.unit, input.unit === 'GLASS' ? 'Ly' : 'Chai',
      input.isSellable === false ? 0 : 1, input.availability ?? 'AVAILABLE'],
  )
  return Number(result.insertId)
}

async function insertPrice(venueId: number, variantId: number, amountVnd: number): Promise<number> {
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO menu_variant_prices (
       venue_id, variant_id, amount_vnd, effective_from, is_active, source
     ) VALUES (?, ?, ?, '2020-01-01 00:00:00.000', 1, 'TEST')`,
    [venueId, variantId, amountVnd],
  )
  return Number(result.insertId)
}

async function seedCatalog(): Promise<SeededCatalog> {
  const walkIn = await createWalkIn(actor, { tableIds: [tableId], partySize: 4, businessDate })
  const categoryId = await insertCategory(actor.venueId, 'WHISKY')
  const verifiedItemId = await insertItem({
    venueId: actor.venueId,
    categoryId,
    code: 'MACALLAN_12',
    name: 'SƯƠNG MÙ MACALLAN 12',
  })
  const glassVariantId = await insertVariant({ venueId: actor.venueId, itemId: verifiedItemId, code: 'GLASS', unit: 'GLASS' })
  const bottleVariantId = await insertVariant({
    venueId: actor.venueId,
    itemId: verifiedItemId,
    code: 'BOTTLE',
    unit: 'BOTTLE',
    availability: 'TEMPORARILY_UNAVAILABLE',
  })
  await insertPrice(actor.venueId, glassVariantId, 380_000)
  await insertPrice(actor.venueId, bottleVariantId, 6_500_000)

  const pending = await insertItem({
    venueId: actor.venueId, categoryId, code: 'PENDING', name: 'Pending', sourceStatus: 'PENDING_VERIFICATION',
  })
  await insertPrice(actor.venueId, await insertVariant({ venueId: actor.venueId, itemId: pending, code: 'PENDING', unit: 'GLASS' }), 100_000)
  const inactive = await insertItem({ venueId: actor.venueId, categoryId, code: 'INACTIVE', name: 'Inactive', isActive: false })
  await insertPrice(actor.venueId, await insertVariant({ venueId: actor.venueId, itemId: inactive, code: 'INACTIVE', unit: 'GLASS' }), 100_000)
  const noPrice = await insertItem({ venueId: actor.venueId, categoryId, code: 'NO_PRICE', name: 'No price' })
  await insertVariant({ venueId: actor.venueId, itemId: noPrice, code: 'NO_PRICE', unit: 'GLASS' })
  const blocked = await insertItem({ venueId: actor.venueId, categoryId, code: 'BLOCKED', name: 'Blocked' })
  await insertPrice(actor.venueId, await insertVariant({
    venueId: actor.venueId, itemId: blocked, code: 'BLOCKED', unit: 'GLASS', isSellable: false,
  }), 100_000)

  const foreignCategory = await insertCategory(otherVenueId, 'FOREIGN')
  const foreignItem = await insertItem({ venueId: otherVenueId, categoryId: foreignCategory, code: 'FOREIGN', name: 'Foreign secret' })
  await insertPrice(otherVenueId, await insertVariant({ venueId: otherVenueId, itemId: foreignItem, code: 'FOREIGN', unit: 'GLASS' }), 999_000)
  return { visitId: walkIn.visitId, verifiedItemId, glassVariantId }
}

mysqlDescribe('waiter menu catalog', () => {
  beforeAll(initializeFixture)
  beforeEach(resetFixture)
  afterAll(clearFixture)

  it('requires order.read and validates an open seated visit in the actor venue', async () => {
    const seeded = await seedCatalog()
    const receptionist = await login('integration_reception')
    expect((await receptionist.agent.get(`/api/v1/waiter/menu?visitId=${seeded.visitId}`)).status).toBe(403)
    const owner = await login('integration_owner')
    expect((await owner.agent.get('/api/v1/waiter/menu?visitId=999999')).status).toBe(404)
    await databasePool.execute(
      'UPDATE visits SET paid_marked_at = UTC_TIMESTAMP(3), paid_marked_by_user_id = ? WHERE id = ?',
      [actor.userId, seeded.visitId],
    )
    expect((await owner.agent.get(`/api/v1/waiter/menu?visitId=${seeded.visitId}`)).status).toBe(409)
  })

  it('returns only verified active sellable items with current prices and no internal fields', async () => {
    const seeded = await seedCatalog()
    const owner = await login('integration_owner')
    const response = await owner.agent.get(`/api/v1/waiter/menu?visitId=${seeded.visitId}`)
    expect(response.status).toBe(200)
    const body = response.body as unknown as WaiterMenuView
    expect(body.visit).toMatchObject({ visitId: seeded.visitId, tableCodes: ['A1'], guestCount: 4, status: 'OPEN' })
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: seeded.verifiedItemId,
      name: 'SƯƠNG MÙ MACALLAN 12',
      availabilityStatus: 'AVAILABLE',
      preparationStation: 'BAR',
    })
    expect(body.items[0]?.variants).toEqual([
      expect.objectContaining({ unitCode: 'GLASS', amountVnd: 380_000, availabilityStatus: 'AVAILABLE', priceVersion: 1 }),
      expect.objectContaining({ unitCode: 'BOTTLE', amountVnd: 6_500_000, availabilityStatus: 'TEMPORARILY_UNAVAILABLE', priceVersion: 1 }),
    ])
    const serialized = JSON.stringify(body)
    for (const forbidden of ['cost', 'supplier', 'recipe', 'sourceReference', 'importKey', 'phone']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
    expect(serialized).not.toContain('Foreign secret')
    expect(serialized).not.toContain('Pending')
    expect(serialized).not.toContain('Inactive')
    expect(serialized).not.toContain('No price')
    expect(serialized).not.toContain('Blocked')
  })

  it('searches without accents and filters availability without leaking other variants', async () => {
    const seeded = await seedCatalog()
    const owner = await login('integration_owner')
    const search = await owner.agent.get(`/api/v1/waiter/menu?visitId=${seeded.visitId}&search=suong%20mu`)
    const searchBody = search.body as unknown as WaiterMenuView
    expect(searchBody.items.map((item) => item.id)).toEqual([seeded.verifiedItemId])
    const unavailable = await owner.agent.get(
      `/api/v1/waiter/menu?visitId=${seeded.visitId}&availability=TEMPORARILY_UNAVAILABLE`,
    )
    const unavailableBody = unavailable.body as unknown as WaiterMenuView
    expect(unavailableBody.items[0]?.variants).toEqual([
      expect.objectContaining({ unitCode: 'BOTTLE', amountVnd: 6_500_000 }),
    ])
  })

  it('rejects overlapping price windows and a stale variant version', async () => {
    const seeded = await seedCatalog()
    await expect(createMenuVariantPrice(actor, {
      variantId: seeded.glassVariantId,
      expectedVariantVersion: 1,
      amountVnd: 400_000,
      effectiveFrom: '2030-01-01T00:00:00.000Z',
      source: 'TEST',
    })).rejects.toMatchObject({ status: 409, code: 'MENU_PRICE_WINDOW_OVERLAP' })
    await databasePool.execute(
      'UPDATE menu_variant_prices SET effective_to = ? WHERE venue_id = ? AND variant_id = ?',
      ['2029-01-01 00:00:00.000', actor.venueId, seeded.glassVariantId],
    )
    await expect(createMenuVariantPrice(actor, {
      variantId: seeded.glassVariantId,
      expectedVariantVersion: 999,
      amountVnd: 400_000,
      effectiveFrom: '2030-01-01T00:00:00.000Z',
      source: 'TEST',
    })).rejects.toMatchObject({ status: 409, code: 'MENU_VARIANT_VERSION_CONFLICT' })
  })

  it('enforces one open active price in the database', async () => {
    const seeded = await seedCatalog()
    await expect(insertPrice(actor.venueId, seeded.glassVariantId, 400_000)).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' })
    const [rows] = await databasePool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM menu_variant_prices WHERE venue_id = ? AND variant_id = ?',
      [actor.venueId, seeded.glassVariantId],
    )
    expect(Number(rows[0]?.total)).toBe(1)
  })
})

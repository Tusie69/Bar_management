import type { ResultSetHeader } from 'mysql2/promise'

import { databasePool } from '../../src/database/pool.js'
import { normalizeSearchText } from '../../src/lib/search-text.js'

/**
 * Dựng danh mục món cho test integration.
 *
 * `insertItem` ghi đủ ba cột mà `ck_menu_items_verified_audit` (0034) đòi ở mọi
 * dòng VERIFIED. Một fixture dựng trạng thái mà database không cho phép tồn tại
 * là một fixture đang kiểm một thế giới khác.
 */
export async function insertMenuCategory(venueId: number, code: string): Promise<number> {
  const [result] = await databasePool.execute<ResultSetHeader>(
    'INSERT INTO menu_categories (venue_id, code, name, display_order) VALUES (?, ?, ?, 1)',
    [venueId, code, code],
  )
  return Number(result.insertId)
}

export async function insertMenuItem(input: {
  venueId: number
  categoryId: number
  code: string
  name: string
  station?: 'BAR' | 'KITCHEN'
  sourceStatus?: 'PENDING_VERIFICATION' | 'REVIEW_REQUIRED' | 'VERIFIED' | 'REJECTED'
  isActive?: boolean
  verifiedByUserId: number
}): Promise<number> {
  const status = input.sourceStatus ?? 'VERIFIED'
  const verified = status === 'VERIFIED'
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO menu_items (
       venue_id, category_id, code, name, normalized_name, preparation_station, source_status, is_active,
       verified_digest, verified_at, verified_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.venueId, input.categoryId, input.code, input.name, normalizeSearchText(input.name),
      input.station ?? 'BAR', status, input.isActive === false ? 0 : 1,
      verified ? 'f'.repeat(64) : null, verified ? new Date() : null, verified ? input.verifiedByUserId : null],
  )
  return Number(result.insertId)
}

export async function insertMenuVariant(input: {
  venueId: number
  itemId: number
  code: string
  unit: 'GLASS' | 'BOTTLE' | 'PORTION'
  displayName?: string
  availability?: 'AVAILABLE' | 'TEMPORARILY_UNAVAILABLE' | 'DISCONTINUED'
  isSellable?: boolean
  isActive?: boolean
}): Promise<number> {
  const names = { GLASS: 'Ly', BOTTLE: 'Chai', PORTION: 'Phần' }
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO menu_item_variants (
       venue_id, menu_item_id, code, unit_code, display_name, is_active, is_sellable, availability_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.venueId, input.itemId, input.code, input.unit, input.displayName ?? names[input.unit],
      input.isActive === false ? 0 : 1, input.isSellable === false ? 0 : 1, input.availability ?? 'AVAILABLE'],
  )
  return Number(result.insertId)
}

/** Giá mở, hiệu lực từ 2020 — luôn là giá hiện hành trong mọi test. */
export async function insertMenuPrice(venueId: number, variantId: number, amountVnd: number): Promise<number> {
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO menu_variant_prices (
       venue_id, variant_id, amount_vnd, effective_from, is_active, source
     ) VALUES (?, ?, ?, '2020-01-01 00:00:00.000', 1, 'TEST')`,
    [venueId, variantId, amountVnd],
  )
  return Number(result.insertId)
}

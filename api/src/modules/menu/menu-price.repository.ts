import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

export interface CreateMenuPriceInput {
  variantId: number
  expectedVariantVersion: number
  amountVnd: number
  effectiveFrom: string
  effectiveTo?: string | null
  source: string
  sourceReference?: string
}

interface VariantRow extends RowDataPacket {
  id: number
  version: number
}

function instant(value: Date | string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value.endsWith('Z') ? value : `${value}Z`)
  if (!Number.isFinite(parsed)) throw new AppError(400, 'INVALID_PRICE_WINDOW', 'Khoảng hiệu lực giá không hợp lệ.')
  return parsed
}

export function priceWindowsOverlap(
  left: { effectiveFrom: Date | string; effectiveTo: Date | string | null },
  right: { effectiveFrom: Date | string; effectiveTo: Date | string | null },
): boolean {
  const leftEnd = left.effectiveTo === null ? Number.POSITIVE_INFINITY : instant(left.effectiveTo)
  const rightEnd = right.effectiveTo === null ? Number.POSITIVE_INFINITY : instant(right.effectiveTo)
  return instant(left.effectiveFrom) < rightEnd && instant(right.effectiveFrom) < leftEnd
}

/**
 * Phạm vi địa điểm của một lần ghi giá.
 *
 * Importer chạy từ dòng lệnh và không có session, nên nó không dựng được một
 * `AuthenticatedActor`. Nó vẫn phải đi qua đúng ranh giới ghi giá này, nên
 * ranh giới nhận một scope tối thiểu thay vì một actor.
 */
export interface MenuPriceScope {
  organizationId: number
  venueId: number
}

export interface VariantPriceWrite {
  variantId: number
  amountVnd: number
  /** Mốc bắt đầu hiệu lực của giá mới. */
  effectiveFrom: Date
  source: string
  sourceReference?: string | null
  /** Chỉ dùng cho dòng importer tạo lần đầu; bỏ trống cho mọi lần ghi sau. */
  importKey?: string | null
}

export type VariantPriceAction = 'UNCHANGED' | 'CREATED' | 'REPRICED'

export interface VariantPriceWriteResult {
  action: VariantPriceAction
  /** Dòng giá đang mở sau thao tác. */
  priceId: number
  /** Dòng giá vừa bị đóng lại, nếu có. */
  closedPriceId: number | null
}

interface ActivePriceRow extends RowDataPacket {
  id: number
  amount_vnd: string | number
  effective_from: Date | string
  effective_to: Date | string | null
}

/**
 * Khoá và đọc mọi khoảng giá đang active của một biến thể.
 *
 * `FOR UPDATE` là thứ làm cho việc kiểm chồng khoảng có nghĩa: không khoá thì
 * hai lần ghi song song cùng đọc thấy "không chồng" rồi cùng chèn.
 */
async function lockActivePriceWindows(
  connection: PoolConnection,
  scope: MenuPriceScope,
  variantId: number,
): Promise<ActivePriceRow[]> {
  const [rows] = await connection.execute<ActivePriceRow[]>(
    `SELECT id, amount_vnd, effective_from, effective_to FROM menu_variant_prices
     WHERE venue_id = ? AND variant_id = ? AND is_active = 1
     ORDER BY effective_from, id FOR UPDATE`,
    [scope.venueId, variantId],
  )
  return rows
}

/**
 * Chèn một dòng giá sau khi đã kiểm chồng khoảng với các dòng ĐÃ KHOÁ.
 *
 * Unique key `uq_menu_prices_one_open_active` chỉ chặn hai giá cùng mở vô thời
 * hạn; nó KHÔNG chặn hai khoảng hữu hạn chồng nhau. Luật đó nằm ở đây, và đây
 * là nơi duy nhất trong mã nguồn được phép INSERT vào `menu_variant_prices`.
 */
async function insertPriceRow(
  connection: PoolConnection,
  scope: MenuPriceScope,
  windows: readonly { effective_from: Date | string; effective_to: Date | string | null }[],
  input: {
    variantId: number
    amountVnd: number
    effectiveFrom: Date
    effectiveTo: Date | null
    source: string
    sourceReference?: string | null
    importKey?: string | null
  },
): Promise<number> {
  const incoming = { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo }
  const clash = windows.some((window) =>
    priceWindowsOverlap(incoming, { effectiveFrom: window.effective_from, effectiveTo: window.effective_to }))
  if (clash) throw new AppError(409, 'MENU_PRICE_WINDOW_OVERLAP', 'Khoảng hiệu lực giá bị chồng với giá đã có.')
  const [inserted] = await connection.execute<ResultSetHeader>(
    `INSERT INTO menu_variant_prices (
       venue_id, variant_id, import_key, amount_vnd, effective_from, effective_to, is_active, source, source_reference
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [scope.venueId, input.variantId, input.importKey ?? null, input.amountVnd, input.effectiveFrom,
      input.effectiveTo, input.source, input.sourceReference ?? null],
  )
  return Number(inserted.insertId)
}

/**
 * Đặt giá hiện hành của một biến thể, bên trong một transaction đang mở.
 *
 * Ba kết quả, và chỉ ba:
 * - `UNCHANGED`: giá đang mở đã đúng bằng số tiền này. KHÔNG ghi gì — không
 *   dòng mới, không version, không `updated_at`. Đây là điều kiện để chạy lại
 *   importer không sinh ra thay đổi giả.
 * - `REPRICED`: đã có giá khác đang mở. Dòng cũ được ĐÓNG LẠI tại
 *   `effectiveFrom` của giá mới và giữ nguyên là lịch sử, rồi mở dòng mới.
 *   Trước đây importer UPDATE thẳng lên dòng cũ, nên mỗi lần đổi giá là một
 *   lần xoá mất giá đã bán.
 * - `CREATED`: biến thể chưa có giá nào đang mở.
 *
 * Lùi ngày bị từ chối: đóng một dòng tại thời điểm trước khi nó bắt đầu vi
 * phạm `ck_menu_prices_window`, và tạo ra một khoảng giá âm mà không ai đọc
 * được.
 */
export async function applyVariantPriceWithinTransaction(
  connection: PoolConnection,
  scope: MenuPriceScope,
  input: VariantPriceWrite,
): Promise<VariantPriceWriteResult> {
  if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd <= 0) {
    throw new AppError(400, 'INVALID_MENU_PRICE', 'Giá bán phải là số nguyên VND lớn hơn 0.')
  }
  const windows = await lockActivePriceWindows(connection, scope, input.variantId)
  const open = windows.find((window) => window.effective_to === null)
  if (open && Number(open.amount_vnd) === input.amountVnd) {
    return { action: 'UNCHANGED', priceId: Number(open.id), closedPriceId: null }
  }
  if (open) {
    if (instant(open.effective_from) >= input.effectiveFrom.getTime()) {
      throw new AppError(409, 'MENU_PRICE_BACKDATED',
        'Giá mới phải bắt đầu sau giá đang áp dụng. Chọn mốc hiệu lực muộn hơn.')
    }
    await connection.execute(
      `UPDATE menu_variant_prices SET effective_to = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE venue_id = ? AND id = ? AND effective_to IS NULL`,
      [input.effectiveFrom, scope.venueId, Number(open.id)],
    )
    const remaining = windows
      .filter((window) => Number(window.id) !== Number(open.id))
      .concat([{ ...open, effective_to: input.effectiveFrom }])
    const priceId = await insertPriceRow(connection, scope, remaining, {
      variantId: input.variantId,
      amountVnd: input.amountVnd,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      source: input.source,
      sourceReference: input.sourceReference ?? null,
      importKey: input.importKey ?? null,
    })
    return { action: 'REPRICED', priceId, closedPriceId: Number(open.id) }
  }
  const priceId = await insertPriceRow(connection, scope, windows, {
    variantId: input.variantId,
    amountVnd: input.amountVnd,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    source: input.source,
    sourceReference: input.sourceReference ?? null,
    importKey: input.importKey ?? null,
  })
  return { action: 'CREATED', priceId, closedPriceId: null }
}

/**
 * Price-history write boundary for future admin/iPOS integration.
 *
 * The row lock and expected variant version form the concurrency guard. The
 * database unique key additionally prevents two open-ended active prices.
 */
export async function createMenuVariantPrice(actor: AuthenticatedActor, input: CreateMenuPriceInput): Promise<{
  priceId: number
  priceVersion: number
  variantVersion: number
}> {
  if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd <= 0) {
    throw new AppError(400, 'INVALID_MENU_PRICE', 'Giá bán phải là số nguyên VND lớn hơn 0.')
  }
  const from = instant(input.effectiveFrom)
  const to = input.effectiveTo === undefined || input.effectiveTo === null ? null : instant(input.effectiveTo)
  if (to !== null && to <= from) {
    throw new AppError(400, 'INVALID_PRICE_WINDOW', 'effectiveTo phải lớn hơn effectiveFrom.')
  }
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [variants] = await connection.execute<VariantRow[]>(
      `SELECT id, version FROM menu_item_variants
       WHERE venue_id = ? AND id = ? FOR UPDATE`,
      [actor.venueId, input.variantId],
    )
    const variant = variants[0]
    if (!variant) throw new AppError(404, 'MENU_VARIANT_NOT_FOUND', 'Không tìm thấy biến thể trong địa điểm này.')
    if (Number(variant.version) !== input.expectedVariantVersion) {
      throw new AppError(409, 'MENU_VARIANT_VERSION_CONFLICT', 'Giá hoặc biến thể đã thay đổi. Hãy tải lại danh mục.')
    }
    const scope = { organizationId: actor.organizationId, venueId: actor.venueId }
    const windows = await lockActivePriceWindows(connection, scope, input.variantId)
    const insertedId = await insertPriceRow(connection, scope, windows, {
      variantId: input.variantId,
      amountVnd: input.amountVnd,
      effectiveFrom: new Date(from),
      effectiveTo: to === null ? null : new Date(to),
      source: input.source,
      sourceReference: input.sourceReference ?? null,
    })
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE menu_item_variants
       SET version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE venue_id = ? AND id = ? AND version = ?`,
      [actor.venueId, input.variantId, input.expectedVariantVersion],
    )
    if (updated.affectedRows !== 1) throw new AppError(409, 'MENU_VARIANT_VERSION_CONFLICT', 'Biến thể đã thay đổi.')
    await connection.execute(
      `UPDATE venues SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND id = ?`,
      [actor.organizationId, actor.venueId],
    )
    await connection.commit()
    return { priceId: insertedId, priceVersion: 1, variantVersion: input.expectedVariantVersion + 1 }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

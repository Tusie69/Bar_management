/**
 * Module Phục vụ 2 — ghi một kế hoạch import vào database.
 *
 * Nằm trong `src/modules` chứ không trong `scripts/`: một script chỉ chạy
 * được bằng cách chạy nó, nên luật "chạy lại không đổi gì" không test được
 * nếu nó sống trong script. Ở đây nó là một hàm, và
 * `test/menu-import-idempotency.mysql.test.ts` gọi thẳng nó hai lần.
 *
 * Nguyên tắc của toàn bộ file này: KHÔNG ghi khi nguồn không đổi. Bản trước
 * dùng `ON DUPLICATE KEY UPDATE ... updated_at = UTC_TIMESTAMP(3)` nên mỗi
 * lần chạy lại đều là một lần ghi, và vì `source_status` nằm trong câu UPDATE
 * đó, mọi món đã đối chiếu đều rơi về trạng thái chờ và biến mất khỏi menu.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { databasePool } from '../../database/pool.js'
import {
  MENU_IMPORT_SOURCE,
  menuItemDigest,
  menuItemSnapshot,
  type ImportCategory,
  type ImportItem,
  type MenuImportPlan,
} from './import-mapping.js'
import { applyVariantPriceWithinTransaction } from './menu-price.repository.js'
import type { MenuSourceStatus } from './menu-verification.js'

export interface MenuImportScope {
  organizationId: number
  venueId: number
}

/**
 * Số lần ghi thật sự, tách khỏi số dòng đã xử lý.
 *
 * Chạy lại importer trên cùng một file phải cho `changed = false` và mọi ô
 * `*Created` / `*Updated` bằng 0. Đó là định nghĩa vận hành của "idempotent"
 * mà bản trước không đạt: nó xử lý đúng số dòng nhưng vẫn ghi lại tất cả.
 */
export interface MenuImportTally {
  categoriesCreated: number
  categoriesUpdated: number
  itemsCreated: number
  itemsUpdated: number
  itemsUnchanged: number
  /** Món đã VERIFIED nhưng nguồn vừa đổi: chuyển sang REVIEW_REQUIRED. */
  itemsSentToReview: number
  /** Món đã bị từ chối: nội dung cập nhật, trạng thái giữ nguyên REJECTED. */
  itemsRejectedKept: number
  variantsCreated: number
  variantsUpdated: number
  /** Biến thể do chính nguồn này tạo nhưng không còn trong file: tắt, không xoá. */
  variantsDeactivated: number
  pricesCreated: number
  pricesRepriced: number
  pricesUnchanged: number
  /** Có ít nhất một thay đổi thật, nên mới được tăng `venues.change_seq`. */
  changed: boolean
}

export interface MenuImportOutcome {
  tally: MenuImportTally
  /** Mã món đã nhập từ nguồn này nhưng không còn trong file. */
  orphanedItemCodes: string[]
}

export function emptyMenuImportTally(): MenuImportTally {
  return {
    categoriesCreated: 0,
    categoriesUpdated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsSentToReview: 0,
    itemsRejectedKept: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    variantsDeactivated: 0,
    pricesCreated: 0,
    pricesRepriced: 0,
    pricesUnchanged: 0,
    changed: false,
  }
}

interface CategoryRow extends RowDataPacket {
  id: number
  name: string
  parent_id: number | null
  display_order: number
}

/**
 * Đọc trước rồi mới ghi, thay vì `ON DUPLICATE KEY UPDATE`.
 *
 * `is_active` KHÔNG bị ép về 1: tắt một nhóm món là quyết định vận hành của
 * quán, không phải thuộc tính của file Excel.
 */
async function upsertCategory(
  connection: PoolConnection,
  venueId: number,
  category: ImportCategory,
  parentId: number | null,
  tally: MenuImportTally,
): Promise<number> {
  const [rows] = await connection.execute<CategoryRow[]>(
    `SELECT id, name, parent_id, display_order FROM menu_categories
     WHERE venue_id = ? AND code = ? FOR UPDATE`,
    [venueId, category.code],
  )
  const existing = rows[0]
  if (!existing) {
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO menu_categories (venue_id, code, name, parent_id, display_order, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [venueId, category.code, category.name, parentId, category.displayOrder],
    )
    tally.categoriesCreated += 1
    tally.changed = true
    return Number(inserted.insertId)
  }
  const unchanged =
    existing.name === category.name &&
    Number(existing.parent_id ?? 0) === Number(parentId ?? 0) &&
    Number(existing.display_order) === category.displayOrder
  if (unchanged) return Number(existing.id)
  await connection.execute(
    `UPDATE menu_categories SET name = ?, parent_id = ?, display_order = ?, updated_at = UTC_TIMESTAMP(3)
     WHERE venue_id = ? AND id = ?`,
    [category.name, parentId, category.displayOrder, venueId, Number(existing.id)],
  )
  tally.categoriesUpdated += 1
  tally.changed = true
  return Number(existing.id)
}

interface ExistingItemRow extends RowDataPacket {
  id: number
  import_digest: string | null
  source_status: MenuSourceStatus
}

interface ExistingVariantRow extends RowDataPacket {
  id: number
  unit_code: string
  display_name: string
  quantity_in_unit: number | null
  is_sellable: number
  display_order: number
}

/**
 * Trạng thái mới của một món khi nguồn đã thay đổi.
 *
 * - `VERIFIED` → `REVIEW_REQUIRED`: đã có người duyệt, và nguồn đổi sau lần
 *   duyệt đó. Không hạ về `PENDING_VERIFICATION` vì hai trạng thái khác nghĩa
 *   nhau; người đối chiếu cần biết đây là "duyệt lại một thay đổi", và
 *   `verified_snapshot` cho họ thấy thay đổi đó là gì.
 * - `REJECTED` → `REJECTED`: ai đó đã cố ý loại món này. Một lần sửa file
 *   Excel không được đưa nó trở lại hàng đợi duyệt sau lưng người đã loại.
 * - còn lại: giữ nguyên. Món chưa ai xem vẫn là chưa ai xem.
 */
export function nextSourceStatus(current: MenuSourceStatus): MenuSourceStatus {
  return current === 'VERIFIED' ? 'REVIEW_REQUIRED' : current
}

async function upsertItem(
  connection: PoolConnection,
  scope: MenuImportScope,
  categoryIdValue: number,
  categoryCode: string,
  item: ImportItem,
  effectiveFrom: Date,
  tally: MenuImportTally,
): Promise<void> {
  const { venueId } = scope
  const digest = menuItemDigest(menuItemSnapshot(item, categoryCode))
  const [existingRows] = await connection.execute<ExistingItemRow[]>(
    'SELECT id, import_digest, source_status FROM menu_items WHERE venue_id = ? AND import_key = ? FOR UPDATE',
    [venueId, item.importKey],
  )
  const existing = existingRows[0]

  if (existing && existing.import_digest === digest) {
    // Nguồn không đổi: không chạm vào dòng này, nên không hạ trạng thái đã
    // duyệt, không tăng version và không đụng `updated_at`.
    tally.itemsUnchanged += 1
    return
  }

  let itemId: number
  if (!existing) {
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO menu_items (
         venue_id, category_id, code, import_key, import_digest, name, normalized_name, description, note,
         preparation_station, source_status, is_active, display_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_VERIFICATION', 1, ?)`,
      [venueId, categoryIdValue, item.code, item.importKey, digest, item.name, item.normalizedName,
        item.description, item.note, item.preparationStation, item.displayOrder],
    )
    itemId = Number(inserted.insertId)
    tally.itemsCreated += 1
  } else {
    itemId = Number(existing.id)
    const status = nextSourceStatus(existing.source_status)
    if (existing.source_status === 'VERIFIED') tally.itemsSentToReview += 1
    if (status === 'REJECTED') tally.itemsRejectedKept += 1
    // `is_active` và `verified_*` không nằm trong câu UPDATE: cái đầu là quyết
    // định vận hành của quán, cái sau là bằng chứng của lần duyệt trước và là
    // thứ `menu:verify` dựng diff từ đó.
    await connection.execute(
      `UPDATE menu_items
       SET category_id = ?, code = ?, import_digest = ?, name = ?, normalized_name = ?, description = ?,
           note = ?, preparation_station = ?, source_status = ?, display_order = ?,
           version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE venue_id = ? AND id = ?`,
      [categoryIdValue, item.code, digest, item.name, item.normalizedName, item.description, item.note,
        item.preparationStation, status, item.displayOrder, venueId, itemId],
    )
    tally.itemsUpdated += 1
  }
  tally.changed = true
  if (!itemId) throw new Error(`Không xác định được id món ở dòng ${item.rowNumber}.`)

  for (const itemVariant of item.variants) {
    const [variantRows] = await connection.execute<ExistingVariantRow[]>(
      `SELECT id, unit_code, display_name, quantity_in_unit, is_sellable, display_order
       FROM menu_item_variants WHERE menu_item_id = ? AND import_key = ? FOR UPDATE`,
      [itemId, itemVariant.importKey],
    )
    const existingVariant = variantRows[0]
    let variantId: number
    if (!existingVariant) {
      const [inserted] = await connection.execute<ResultSetHeader>(
        `INSERT INTO menu_item_variants (
           venue_id, menu_item_id, code, import_key, unit_code, display_name, quantity_in_unit,
           is_active, is_sellable, availability_status, display_order
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'AVAILABLE', ?)`,
        [venueId, itemId, itemVariant.code, itemVariant.importKey, itemVariant.unitCode,
          itemVariant.displayName, itemVariant.quantityInUnit, itemVariant.isSellable ? 1 : 0,
          itemVariant.displayOrder],
      )
      variantId = Number(inserted.insertId)
      tally.variantsCreated += 1
    } else {
      variantId = Number(existingVariant.id)
      const same =
        existingVariant.unit_code === itemVariant.unitCode &&
        existingVariant.display_name === itemVariant.displayName &&
        (existingVariant.quantity_in_unit === null ? null : Number(existingVariant.quantity_in_unit))
          === itemVariant.quantityInUnit &&
        Number(existingVariant.is_sellable) === (itemVariant.isSellable ? 1 : 0) &&
        Number(existingVariant.display_order) === itemVariant.displayOrder
      if (!same) {
        // `is_active` và `availability_status` là trạng thái vận hành (hết
        // hàng, ngừng bán tạm thời) và không thuộc về file Excel.
        await connection.execute(
          `UPDATE menu_item_variants
           SET code = ?, unit_code = ?, display_name = ?, quantity_in_unit = ?, is_sellable = ?,
               display_order = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
           WHERE venue_id = ? AND id = ?`,
          [itemVariant.code, itemVariant.unitCode, itemVariant.displayName, itemVariant.quantityInUnit,
            itemVariant.isSellable ? 1 : 0, itemVariant.displayOrder, venueId, variantId],
        )
        tally.variantsUpdated += 1
      }
    }
    if (!variantId) throw new Error(`Không xác định được id biến thể ở dòng ${item.rowNumber}.`)

    // Giá đi qua ĐÚNG ranh giới mà API quản trị dùng, nên importer không thể
    // tạo hai khoảng giá chồng nhau — thứ mà unique key của database không bắt
    // được, vì nó chỉ chặn hai giá cùng mở vô thời hạn.
    const price = await applyVariantPriceWithinTransaction(connection, scope, {
      variantId,
      amountVnd: itemVariant.amountVnd,
      effectiveFrom,
      source: MENU_IMPORT_SOURCE,
      sourceReference: `Danh mục món!${item.rowNumber}`,
      ...(existingVariant ? {} : { importKey: itemVariant.importKey }),
    })
    if (price.action === 'CREATED') tally.pricesCreated += 1
    else if (price.action === 'REPRICED') tally.pricesRepriced += 1
    else tally.pricesUnchanged += 1
  }

  await deactivateRetiredVariants(connection, venueId, itemId, item, tally)
}

/**
 * Biến thể của món này mà nguồn không còn ghi nữa.
 *
 * L10: dòng "lon / chai" một giá từng được nhập thành MỘT biến thể `OTHER` bị
 * khoá bán. Lần nhập lại ánh xạ nó thành `CAN` + `BOTTLE`, nhưng biến thể
 * `OTHER` cũ vẫn nằm đó và `AMBIGUOUS_UNIT` tiếp tục chặn duyệt món — nên sửa
 * ánh xạ mà không dọn biến thể cũ thì sáu món nước ngọt vẫn không bán được.
 *
 * Ba giới hạn, để việc dọn này không trở thành một lệnh xoá dữ liệu:
 *
 * - Chỉ TẮT (`is_active = 0`), không `DELETE`. Dòng đơn đã bán tham chiếu
 *   biến thể, và lịch sử giá là bằng chứng kế toán.
 * - Chỉ những biến thể có `import_key`, tức do importer tạo. Biến thể thêm tay
 *   trong màn quản trị không có `import_key` và không bao giờ bị lệnh này chạm
 *   tới. Món đang xét luôn là món của nguồn này (nó vừa được khớp theo
 *   `import_key` của plan), nên mọi biến thể có `import_key` ở đây đều cùng
 *   nguồn.
 * - Chỉ những dòng còn `is_active = 1`, nên lần chạy thứ hai trên cùng file
 *   không ghi gì và `changed` không bị bật lại — đó là điều kiện để
 *   `venues.change_seq` không tăng khi nguồn không đổi.
 */
async function deactivateRetiredVariants(
  connection: PoolConnection,
  venueId: number,
  itemId: number,
  item: ImportItem,
  tally: MenuImportTally,
): Promise<void> {
  const keys = item.variants.map((itemVariant) => itemVariant.importKey)
  const keyFilter = keys.length ? ` AND import_key NOT IN (${keys.map(() => '?').join(', ')})` : ''
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE menu_item_variants
     SET is_active = 0, version = version + 1, updated_at = UTC_TIMESTAMP(3)
     WHERE venue_id = ? AND menu_item_id = ? AND is_active = 1 AND import_key IS NOT NULL${keyFilter}`,
    [venueId, itemId, ...keys],
  )
  if (result.affectedRows > 0) {
    tally.variantsDeactivated += result.affectedRows
    tally.changed = true
  }
}

/**
 * Món đã nhập từ nguồn này nhưng không còn trong file.
 *
 * Importer KHÔNG tự xoá hay tự ẩn chúng: bỏ một dòng khỏi Excel có thể là sửa
 * nguồn, cũng có thể là lỗi lưu file, và hai khả năng đó không phân biệt được
 * từ đây. Nó báo mã món để người chạy tự quyết.
 */
async function orphanedItemCodes(
  connection: PoolConnection,
  venueId: number,
  plan: MenuImportPlan,
): Promise<string[]> {
  const keys = new Set(plan.items.map((item) => item.importKey))
  const [rows] = await connection.execute<(RowDataPacket & { code: string; import_key: string })[]>(
    'SELECT code, import_key FROM menu_items WHERE venue_id = ? AND import_key IS NOT NULL',
    [venueId],
  )
  return rows.filter((row) => !keys.has(row.import_key)).map((row) => row.code).sort()
}

/** Ghi toàn bộ kế hoạch trong một transaction. Lỗi ở bất kỳ dòng nào là rollback cả lượt. */
export async function applyMenuImportPlan(
  scope: MenuImportScope,
  plan: MenuImportPlan,
  options: { effectiveFrom: Date },
): Promise<MenuImportOutcome> {
  if (plan.errors.length) throw new Error(`Validation thất bại với ${plan.errors.length} lỗi; không ghi dữ liệu.`)
  const tally = emptyMenuImportTally()
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [venues] = await connection.execute<RowDataPacket[]>(
      'SELECT 1 FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE',
      [scope.organizationId, scope.venueId],
    )
    if (!venues[0]) throw new Error('Venue không tồn tại trong organization đã chọn.')
    const ids = new Map<string, number>()
    const codes = new Map<string, string>()
    for (const category of plan.categories.filter((value) => value.parentKey === null)) {
      ids.set(category.key, await upsertCategory(connection, scope.venueId, category, null, tally))
      codes.set(category.key, category.code)
    }
    for (const category of plan.categories.filter((value) => value.parentKey !== null)) {
      const parentId = ids.get(category.parentKey!)
      if (!parentId) throw new Error(`Thiếu category cha cho ${category.name}.`)
      ids.set(category.key, await upsertCategory(connection, scope.venueId, category, parentId, tally))
      codes.set(category.key, category.code)
    }
    for (const item of plan.items) {
      const itemCategoryId = ids.get(item.categoryKey)
      const itemCategoryCode = codes.get(item.categoryKey)
      if (!itemCategoryId || !itemCategoryCode) throw new Error(`Thiếu category cho dòng ${item.rowNumber}.`)
      await upsertItem(connection, scope, itemCategoryId, itemCategoryCode, item, options.effectiveFrom, tally)
    }
    const orphans = await orphanedItemCodes(connection, scope.venueId, plan)
    // `change_seq` chỉ tăng khi có thay đổi thật. Tăng vô điều kiện sẽ bắt mọi
    // máy Phục vụ đang mở tải lại danh mục sau một lần chạy không đổi gì.
    if (tally.changed) {
      await connection.execute(
        `UPDATE venues SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE organization_id = ? AND id = ?`,
        [scope.organizationId, scope.venueId],
      )
    }
    await connection.commit()
    return { tally, orphanedItemCodes: orphans }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

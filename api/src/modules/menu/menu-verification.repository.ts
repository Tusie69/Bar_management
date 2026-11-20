/**
 * Module Phục vụ 2 — đọc hàng đợi đối chiếu và ghi kết quả duyệt.
 *
 * Nằm trong `src/modules` chứ không nằm trong script: duyệt món là nghiệp vụ,
 * và màn quản trị sau này phải gọi đúng hàm này thay vì viết lại câu UPDATE.
 * `menu:verify` chỉ là một lớp vỏ dòng lệnh quanh nó.
 *
 * Không có đường tắt nào khác tới `source_status = 'VERIFIED'`: ràng buộc
 * `ck_menu_items_verified_audit` của migration 0034 bắt buộc mọi dòng VERIFIED
 * phải có người duyệt, thời điểm duyệt và vân tay đã duyệt, nên một lệnh
 * UPDATE tay thiếu ba thứ đó sẽ bị database từ chối.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import type { MenuItemSnapshot } from './import-mapping.js'
import {
  diffMenuSnapshots,
  verificationBlockers,
  type MenuSourceStatus,
  type SnapshotDiffEntry,
  type VerificationBlocker,
  type VerificationCandidate,
  type VerificationOptions,
  type VerificationVariant,
} from './menu-verification.js'

export interface VerificationScope {
  organizationId: number
  venueId: number
}

export interface VerificationQuery extends VerificationOptions {
  /** Chỉ xét món có giá đến từ nguồn này. */
  source: string
  /** Giới hạn vào một số mã món cụ thể. */
  itemCodes?: readonly string[]
}

export interface VerificationEntry {
  candidate: VerificationCandidate
  blockers: VerificationBlocker[]
  diff: SnapshotDiffEntry[]
  /** Vân tay nội dung hiện tại; dùng để phát hiện import xen giữa plan và apply. */
  importDigest: string | null
}

export interface VerificationPlan {
  scope: VerificationScope
  source: string
  entries: VerificationEntry[]
  verifiable: VerificationEntry[]
  blocked: VerificationEntry[]
}

interface ItemRow extends RowDataPacket {
  id: number
  code: string
  name: string
  normalized_name: string
  description: string | null
  note: string | null
  preparation_station: 'BAR' | 'KITCHEN'
  display_order: number
  is_active: number
  source_status: MenuSourceStatus
  import_digest: string | null
  verified_snapshot: unknown
  category_code: string
  same_name_count: number
}

interface VariantRow extends RowDataPacket {
  menu_item_id: number
  id: number
  code: string
  unit_code: string
  display_name: string
  quantity_in_unit: number | null
  is_sellable: number
  display_order: number
  amount_vnd: string | number | null
}

/** `verified_snapshot` về từ mysql2 có thể là object hoặc chuỗi tuỳ cấu hình driver. */
function parseSnapshot(value: unknown): MenuItemSnapshot | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as MenuItemSnapshot
    } catch {
      return null
    }
  }
  return value as MenuItemSnapshot
}

/**
 * Nội dung hiện tại của một món, dựng theo ĐÚNG hình dạng `MenuItemSnapshot`
 * mà importer ghi, để diff so được hai bên với nhau.
 */
function currentSnapshot(item: ItemRow, variants: VariantRow[]): MenuItemSnapshot {
  return {
    categoryCode: item.category_code,
    name: item.name,
    description: item.description,
    note: item.note,
    preparationStation: item.preparation_station,
    displayOrder: Number(item.display_order),
    variants: [...variants]
      .sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0))
      .map((variant) => ({
        code: variant.code,
        unitCode: variant.unit_code as MenuItemSnapshot['variants'][number]['unitCode'],
        displayName: variant.display_name,
        quantityInUnit: variant.quantity_in_unit === null ? null : Number(variant.quantity_in_unit),
        isSellable: Number(variant.is_sellable) === 1,
        displayOrder: Number(variant.display_order),
        amountVnd: variant.amount_vnd === null ? 0 : Number(variant.amount_vnd),
      })),
  }
}

/**
 * Hàng đợi đối chiếu: món chưa ai duyệt, và món đã duyệt nhưng nguồn vừa đổi.
 *
 * Món `REJECTED` không có ở đây. Ai đó đã cố ý loại nó, và đưa nó trở lại hàng
 * đợi vì một lần import là đi ngược quyết định đó sau lưng họ.
 */
export async function buildVerificationPlan(
  scope: VerificationScope,
  query: VerificationQuery,
): Promise<VerificationPlan> {
  const codeFilter = query.itemCodes?.length
    ? ` AND mi.code IN (${query.itemCodes.map(() => '?').join(',')})`
    : ''
  const [items] = await databasePool.execute<ItemRow[]>(
    `SELECT mi.id, mi.code, mi.name, mi.normalized_name, mi.description, mi.note, mi.preparation_station,
            mi.display_order, mi.is_active, mi.source_status, mi.import_digest, mi.verified_snapshot,
            mc.code AS category_code,
            (SELECT COUNT(*) FROM menu_items AS peer
              WHERE peer.venue_id = mi.venue_id AND peer.normalized_name = mi.normalized_name) AS same_name_count
     FROM menu_items AS mi
     JOIN menu_categories AS mc ON mc.venue_id = mi.venue_id AND mc.id = mi.category_id
     WHERE mi.venue_id = ?
       AND mi.source_status IN ('PENDING_VERIFICATION','REVIEW_REQUIRED')
       AND EXISTS (
         SELECT 1 FROM menu_item_variants AS v
         JOIN menu_variant_prices AS p ON p.venue_id = v.venue_id AND p.variant_id = v.id
         WHERE v.venue_id = mi.venue_id AND v.menu_item_id = mi.id AND p.source = ?
       )${codeFilter}
     ORDER BY mi.display_order, mi.id`,
    [scope.venueId, query.source, ...(query.itemCodes ?? [])],
  )
  if (!items.length) {
    return { scope, source: query.source, entries: [], verifiable: [], blocked: [] }
  }
  const [variants] = await databasePool.execute<VariantRow[]>(
    `SELECT v.menu_item_id, v.id, v.code, v.unit_code, v.display_name, v.quantity_in_unit,
            v.is_sellable, v.display_order, p.amount_vnd
     FROM menu_item_variants AS v
     LEFT JOIN menu_variant_prices AS p
       ON p.venue_id = v.venue_id AND p.variant_id = v.id AND p.is_active = 1 AND p.effective_to IS NULL
     WHERE v.venue_id = ? AND v.is_active = 1
       AND v.menu_item_id IN (${items.map(() => '?').join(',')})
     ORDER BY v.display_order, v.id`,
    [scope.venueId, ...items.map((item) => Number(item.id))],
  )
  const byItem = new Map<number, VariantRow[]>()
  for (const variant of variants) {
    const list = byItem.get(Number(variant.menu_item_id)) ?? []
    list.push(variant)
    byItem.set(Number(variant.menu_item_id), list)
  }

  const entries = items.map((item): VerificationEntry => {
    const itemVariants = byItem.get(Number(item.id)) ?? []
    const snapshot = currentSnapshot(item, itemVariants)
    const candidate: VerificationCandidate = {
      itemId: Number(item.id),
      code: item.code,
      name: item.name,
      normalizedName: item.normalized_name,
      sourceStatus: item.source_status,
      isActive: Number(item.is_active) === 1,
      sameNameCount: Number(item.same_name_count),
      variants: itemVariants.map((variant) => ({
        code: variant.code,
        unitCode: variant.unit_code as VerificationVariant['unitCode'],
        displayName: variant.display_name,
        isSellable: Number(variant.is_sellable) === 1,
        amountVnd: variant.amount_vnd === null ? null : Number(variant.amount_vnd),
      })),
      snapshot,
      verifiedSnapshot: parseSnapshot(item.verified_snapshot),
    }
    const blockers = verificationBlockers(candidate, query)
    return {
      candidate,
      blockers,
      diff: diffMenuSnapshots(candidate.verifiedSnapshot, snapshot),
      importDigest: item.import_digest,
    }
  })

  return {
    scope,
    source: query.source,
    entries,
    verifiable: entries.filter((entry) => entry.blockers.length === 0),
    blocked: entries.filter((entry) => entry.blockers.length > 0),
  }
}

export interface VerificationActor {
  userId: number
  membershipId: number
}

export interface VerificationResult {
  verified: string[]
  /** Món đã bị import hoặc người khác đổi giữa lúc dựng plan và lúc duyệt. */
  skippedStale: string[]
}

/**
 * Ghi kết quả duyệt trong một transaction.
 *
 * Mỗi món được đọc lại `FOR UPDATE` và đối chiếu `import_digest` với vân tay
 * lúc dựng plan. Lệch nhau nghĩa là có một lần import xen vào giữa, và nội
 * dung người vận hành vừa đọc không còn là nội dung sắp được duyệt — món đó bị
 * bỏ qua thay vì duyệt nhầm một thay đổi chưa ai nhìn.
 */
export async function applyVerification(
  scope: VerificationScope,
  actor: VerificationActor,
  entries: readonly VerificationEntry[],
): Promise<VerificationResult> {
  if (!entries.length) return { verified: [], skippedStale: [] }
  const blocked = entries.filter((entry) => entry.blockers.length > 0)
  if (blocked.length) {
    throw new AppError(409, 'MENU_VERIFICATION_BLOCKED',
      `Có ${blocked.length} món còn vướng điều kiện chặn; không duyệt được.`)
  }
  const verified: string[] = []
  const skippedStale: string[] = []
  const connection: PoolConnection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    for (const entry of entries) {
      const [rows] = await connection.execute<(RowDataPacket & {
        id: number; version: number; import_digest: string | null; source_status: MenuSourceStatus
      })[]>(
        'SELECT id, version, import_digest, source_status FROM menu_items WHERE venue_id = ? AND id = ? FOR UPDATE',
        [scope.venueId, entry.candidate.itemId],
      )
      const row = rows[0]
      if (!row || row.import_digest !== entry.importDigest
        || (row.source_status !== 'PENDING_VERIFICATION' && row.source_status !== 'REVIEW_REQUIRED')) {
        skippedStale.push(entry.candidate.code)
        continue
      }
      await connection.execute(
        `UPDATE menu_items
         SET source_status = 'VERIFIED', verified_digest = import_digest, verified_snapshot = CAST(? AS JSON),
             verified_at = UTC_TIMESTAMP(3), verified_by_user_id = ?, version = version + 1,
             updated_at = UTC_TIMESTAMP(3)
         WHERE venue_id = ? AND id = ? AND version = ?`,
        [JSON.stringify(entry.candidate.snapshot), actor.userId, scope.venueId, Number(row.id), Number(row.version)],
      )
      await connection.execute<ResultSetHeader>(
        `INSERT INTO operation_log
           (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, action, entity_type,
            entity_id, entity_version_before, entity_version_after, changes, reason_code, is_undoable)
         VALUES (?, ?, 'USER', ?, ?, 'MENU_ITEM_VERIFIED', 'menu_item', ?, ?, ?, CAST(? AS JSON), 'MANUAL', 0)`,
        [scope.organizationId, scope.venueId, actor.userId, actor.membershipId, Number(row.id),
          Number(row.version), Number(row.version) + 1,
          JSON.stringify([{
            type: 'menu_item_verified',
            itemCode: entry.candidate.code,
            previousStatus: row.source_status,
            digest: entry.importDigest,
            changedFields: entry.diff.map((change) => change.field),
          }])],
      )
      verified.push(entry.candidate.code)
    }
    if (verified.length) {
      await connection.execute(
        `UPDATE venues SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE organization_id = ? AND id = ?`,
        [scope.organizationId, scope.venueId],
      )
    }
    await connection.commit()
    return { verified, skippedStale }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

import type { RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { normalizeSearchText } from '../../lib/search-text.js'
import { currentPricePredicate, menuSourcePredicate } from './menu-catalog-sql.js'
import type {
  MenuAvailability,
  MenuUnitCode,
  WaiterMenuCategory,
  WaiterMenuItem,
  WaiterMenuQuery,
  WaiterMenuVariant,
  WaiterMenuView,
  WaiterMenuVisit,
} from './menu.model.js'

interface VisitRow extends RowDataPacket {
  id: number
  guest_count: number
  started_at: Date | string
  ended_at: Date | string | null
  paid_marked_at: Date | string | null
  table_codes: string | null
}

interface CategoryRow extends RowDataPacket {
  id: number
  code: string
  name: string
  parent_id: number | null
  display_order: number
}

interface MenuRow extends RowDataPacket {
  item_id: number
  item_code: string
  category_id: number
  item_name: string
  description: string | null
  preparation_station: 'BAR' | 'KITCHEN'
  item_display_order: number
  variant_id: number
  unit_code: MenuUnitCode
  variant_display_name: string
  quantity_in_unit: number | null
  availability_status: MenuAvailability
  variant_display_order: number
  amount_vnd: string | number
  price_id: number
  price_version: number
  effective_from: Date | string
}

interface VersionRow extends RowDataPacket {
  catalog_version: Date | string | null
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

async function openVisit(actor: AuthenticatedActor, visitId: number): Promise<WaiterMenuVisit> {
  const [rows] = await databasePool.execute<VisitRow[]>(
    `SELECT v.id, v.guest_count, v.started_at, v.ended_at, v.paid_marked_at,
       GROUP_CONCAT(DISTINCT dt.code ORDER BY dt.code SEPARATOR ',') AS table_codes
     FROM visits v
     LEFT JOIN table_allocations ta
       ON ta.organization_id = v.organization_id AND ta.venue_id = v.venue_id
      AND ta.visit_id = v.id AND ta.kind = 'USAGE' AND ta.released_at IS NULL
     LEFT JOIN dining_tables dt
       ON dt.organization_id = ta.organization_id AND dt.venue_id = ta.venue_id AND dt.id = ta.table_id
     WHERE v.organization_id = ? AND v.venue_id = ? AND v.id = ?
     GROUP BY v.id, v.guest_count, v.started_at, v.ended_at, v.paid_marked_at`,
    [actor.organizationId, actor.venueId, visitId],
  )
  const visit = rows[0]
  if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy Phiên bàn trong địa điểm này.')
  if (visit.ended_at !== null) throw new AppError(409, 'VISIT_CLOSED', 'Phiên bàn đã kết thúc.')
  if (visit.paid_marked_at !== null) {
    throw new AppError(409, 'VISIT_NOT_ORDERABLE', 'Phiên bàn đang chờ hoàn tất thanh toán, không thể mở gọi món.')
  }
  if (!visit.table_codes) throw new AppError(409, 'VISIT_NOT_SEATED', 'Phiên chưa gắn với bàn đang có khách.')
  return {
    visitId: Number(visit.id),
    tableCodes: visit.table_codes.split(','),
    guestCount: Number(visit.guest_count),
    startedAt: isoDateTime(visit.started_at),
    status: 'OPEN',
  }
}

/**
 * Module 3 kiểm lại đúng hai vị từ này trước khi tạo order line, nên chúng nằm
 * ở `menu-catalog-sql.ts` thay vì ở đây.
 */
const sourcePredicate = (): string => menuSourcePredicate('mi')
const pricePredicate = (alias = 'p'): string => currentPricePredicate(alias)

async function listCategories(actor: AuthenticatedActor): Promise<WaiterMenuCategory[]> {
  const [rows] = await databasePool.execute<CategoryRow[]>(
    `SELECT mc.id, mc.code, mc.name, mc.parent_id, mc.display_order
     FROM menu_categories mc
     WHERE mc.venue_id = ? AND mc.is_active = 1
       AND (
         EXISTS (
           SELECT 1 FROM menu_items mi
           JOIN menu_item_variants mv ON mv.venue_id = mi.venue_id AND mv.menu_item_id = mi.id
           JOIN menu_variant_prices p ON p.venue_id = mv.venue_id AND p.variant_id = mv.id
           WHERE mi.venue_id = mc.venue_id AND mi.category_id = mc.id
             AND mi.is_active = 1 AND ${sourcePredicate()}
             AND mv.is_active = 1 AND mv.is_sellable = 1
             AND mv.availability_status <> 'DISCONTINUED' AND ${pricePredicate()}
         )
         OR EXISTS (
           SELECT 1 FROM menu_categories child
           JOIN menu_items mi ON mi.venue_id = child.venue_id AND mi.category_id = child.id
           JOIN menu_item_variants mv ON mv.venue_id = mi.venue_id AND mv.menu_item_id = mi.id
           JOIN menu_variant_prices p ON p.venue_id = mv.venue_id AND p.variant_id = mv.id
           WHERE child.venue_id = mc.venue_id AND child.parent_id = mc.id
             AND child.is_active = 1 AND mi.is_active = 1 AND ${sourcePredicate()}
             AND mv.is_active = 1 AND mv.is_sellable = 1
             AND mv.availability_status <> 'DISCONTINUED' AND ${pricePredicate()}
         )
       )
     ORDER BY mc.display_order, mc.id`,
    [actor.venueId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    displayOrder: Number(row.display_order),
  }))
}

async function listItems(actor: AuthenticatedActor, query: WaiterMenuQuery): Promise<WaiterMenuItem[]> {
  const conditions = [
    'mi.venue_id = ?',
    'mi.is_active = 1',
    sourcePredicate(),
    'mc.is_active = 1',
    'mv.is_active = 1',
    'mv.is_sellable = 1',
    "mv.availability_status <> 'DISCONTINUED'",
    pricePredicate(),
  ]
  const parameters: Array<string | number> = [actor.venueId]
  if (query.categoryId !== undefined) {
    conditions.push('(mi.category_id = ? OR mc.parent_id = ?)')
    parameters.push(query.categoryId, query.categoryId)
  }
  if (query.search) {
    conditions.push("mi.normalized_name LIKE ? ESCAPE '\\\\'")
    parameters.push(`%${escapeLike(normalizeSearchText(query.search))}%`)
  }
  if (query.availability) {
    conditions.push('mv.availability_status = ?')
    parameters.push(query.availability)
  }
  if (query.itemId !== undefined) {
    conditions.push('mi.id = ?')
    parameters.push(query.itemId)
  }

  const [rows] = await databasePool.execute<MenuRow[]>(
    `SELECT mi.id AS item_id, mi.code AS item_code, mi.category_id, mi.name AS item_name,
       mi.description, mi.preparation_station, mi.display_order AS item_display_order,
       mv.id AS variant_id, mv.unit_code, mv.display_name AS variant_display_name,
       mv.quantity_in_unit, mv.availability_status, mv.display_order AS variant_display_order,
       p.amount_vnd, p.id AS price_id, p.version AS price_version, p.effective_from
     FROM menu_items mi
     JOIN menu_categories mc ON mc.venue_id = mi.venue_id AND mc.id = mi.category_id
     JOIN menu_item_variants mv ON mv.venue_id = mi.venue_id AND mv.menu_item_id = mi.id
     JOIN menu_variant_prices p ON p.venue_id = mv.venue_id AND p.variant_id = mv.id
     WHERE ${conditions.join('\n       AND ')}
     ORDER BY mc.display_order, mi.display_order, mi.id, mv.display_order, mv.id`,
    parameters,
  )

  const items = new Map<number, WaiterMenuItem>()
  for (const row of rows) {
    const id = Number(row.item_id)
    let item = items.get(id)
    if (!item) {
      item = {
        id,
        code: row.item_code,
        categoryId: Number(row.category_id),
        name: row.item_name,
        description: row.description,
        preparationStation: row.preparation_station,
        availabilityStatus: 'TEMPORARILY_UNAVAILABLE',
        displayOrder: Number(row.item_display_order),
        variants: [],
      }
      items.set(id, item)
    }
    const variant: WaiterMenuVariant = {
      variantId: Number(row.variant_id),
      unitCode: row.unit_code,
      displayName: row.variant_display_name,
      quantityInUnit: row.quantity_in_unit === null ? null : Number(row.quantity_in_unit),
      availabilityStatus: row.availability_status,
      amountVnd: Number(row.amount_vnd),
      priceId: Number(row.price_id),
      priceVersion: Number(row.price_version),
      effectiveFrom: isoDateTime(row.effective_from),
    }
    item.variants.push(variant)
    if (variant.availabilityStatus === 'AVAILABLE') item.availabilityStatus = 'AVAILABLE'
  }
  return [...items.values()]
}

async function catalogVersion(actor: AuthenticatedActor): Promise<string> {
  const [rows] = await databasePool.execute<VersionRow[]>(
    `SELECT MAX(changed_at) AS catalog_version FROM (
       SELECT MAX(updated_at) AS changed_at FROM menu_categories WHERE venue_id = ?
       UNION ALL SELECT MAX(updated_at) FROM menu_items WHERE venue_id = ?
       UNION ALL SELECT MAX(updated_at) FROM menu_item_variants WHERE venue_id = ?
       UNION ALL SELECT MAX(updated_at) FROM menu_variant_prices WHERE venue_id = ?
     ) versions`,
    [actor.venueId, actor.venueId, actor.venueId, actor.venueId],
  )
  const value = rows[0]?.catalog_version
  return value ? isoDateTime(value) : 'empty'
}

export async function getWaiterMenu(actor: AuthenticatedActor, query: WaiterMenuQuery): Promise<WaiterMenuView> {
  const visit = await openVisit(actor, query.visitId)
  const [categories, items, version] = await Promise.all([
    listCategories(actor),
    listItems(actor, query),
    catalogVersion(actor),
  ])
  return { catalogVersion: version, visit, categories, items }
}

export async function getWaiterMenuItem(actor: AuthenticatedActor, query: WaiterMenuQuery): Promise<{
  catalogVersion: string
  visit: WaiterMenuVisit
  item: WaiterMenuItem
}> {
  const view = await getWaiterMenu(actor, query)
  const item = view.items[0]
  if (!item) throw new AppError(404, 'MENU_ITEM_NOT_FOUND', 'Món không tồn tại hoặc hiện không được phép bán.')
  return { catalogVersion: view.catalogVersion, visit: view.visit, item }
}

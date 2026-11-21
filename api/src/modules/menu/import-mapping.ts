import { createHash } from 'node:crypto'

import { normalizeSearchText } from '../../lib/search-text.js'
import type { MenuUnitCode } from './menu.model.js'

export const MENU_IMPORT_SOURCE = '21GAM_MARKETING_MENU_V1'
export const MENU_IMPORT_EFFECTIVE_FROM = '2026-11-18T00:00:00.000Z'

export interface MenuWorkbookRow {
  rowNumber: number
  sequence: number
  group: string
  category: string
  name: string
  description: string | null
  glassShotPriceThousands: unknown
  bottlePriceThousands: unknown
  sellingUnit: string
  note: string | null
}

export interface ImportCategory {
  key: string
  code: string
  name: string
  parentKey: string | null
  displayOrder: number
}

export interface ImportVariant {
  importKey: string
  code: string
  unitCode: MenuUnitCode
  displayName: string
  quantityInUnit: number | null
  isSellable: boolean
  displayOrder: number
  amountVnd: number
}

export interface ImportItem {
  rowNumber: number
  importKey: string
  code: string
  categoryKey: string
  name: string
  normalizedName: string
  description: string | null
  note: string | null
  preparationStation: 'BAR' | 'KITCHEN'
  displayOrder: number
  variants: ImportVariant[]
}

export interface ImportIssue {
  rowNumber: number | null
  code: string
  message: string
}

/**
 * Nội dung nguồn của một món, ở dạng so sánh được.
 *
 * Đây là thứ importer ghi xuống và là thứ người đối chiếu duyệt. Nó CỐ Ý
 * không chứa id, version, thời điểm hay bất cứ thứ gì do database sinh ra:
 * hai lần đọc cùng một file Excel phải cho ra hai snapshot bằng nhau từng byte,
 * nếu không thì vân tay đổi mỗi lần chạy và toàn bộ cơ chế idempotency vô nghĩa.
 */
export interface MenuItemSnapshot {
  categoryCode: string
  name: string
  description: string | null
  note: string | null
  preparationStation: 'BAR' | 'KITCHEN'
  displayOrder: number
  variants: {
    code: string
    unitCode: MenuUnitCode
    displayName: string
    quantityInUnit: number | null
    isSellable: boolean
    displayOrder: number
    amountVnd: number
  }[]
}

/**
 * Snapshot của một món, với thứ tự khoá và thứ tự biến thể cố định.
 *
 * Thứ tự là một phần của hợp đồng: `JSON.stringify` giữ nguyên thứ tự chèn,
 * nên một object dựng theo thứ tự khác sẽ cho vân tay khác dù nội dung y hệt.
 */
export function menuItemSnapshot(item: ImportItem, categoryCode: string): MenuItemSnapshot {
  return {
    categoryCode,
    name: item.name,
    description: item.description,
    note: item.note,
    preparationStation: item.preparationStation,
    displayOrder: item.displayOrder,
    variants: [...item.variants]
      .sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0))
      .map((variant) => ({
        code: variant.code,
        unitCode: variant.unitCode,
        displayName: variant.displayName,
        quantityInUnit: variant.quantityInUnit,
        isSellable: variant.isSellable,
        displayOrder: variant.displayOrder,
        amountVnd: variant.amountVnd,
      })),
  }
}

/**
 * Vân tay của nội dung nguồn.
 *
 * Importer so vân tay này với `menu_items.import_digest` trước khi ghi. Bằng
 * nhau nghĩa là nguồn không đổi, và dòng đó không được đụng tới: không tăng
 * version, không đổi `updated_at`, không tăng `venues.change_seq`, và trên hết
 * là không hạ `VERIFIED` xuống trạng thái chờ duyệt.
 */
export function menuItemDigest(snapshot: MenuItemSnapshot): string {
  return hash(JSON.stringify(snapshot))
}

export interface MenuImportPlan {
  source: string
  groups: number
  classifications: number
  categories: ImportCategory[]
  items: ImportItem[]
  variantCount: number
  priceCount: number
  warnings: ImportIssue[]
  errors: ImportIssue[]
  verificationRowCount: number
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableCode(prefix: string, value: string): string {
  return `${prefix}_${hash(value).slice(0, 16).toUpperCase()}`
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizedKey(value: string): string {
  return normalizeSearchText(cleanText(value)).replace(/\s+/g, ' ')
}

export function thousandsToVnd(value: unknown, rowNumber: number, field: string, errors: ImportIssue[]): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    errors.push({ rowNumber, code: 'INVALID_PRICE', message: `${field} phải là số nguyên nghìn đồng lớn hơn 0.` })
    return null
  }
  const amount = value * 1_000
  if (!Number.isSafeInteger(amount)) {
    errors.push({ rowNumber, code: 'PRICE_OUT_OF_RANGE', message: `${field} vượt phạm vi số nguyên an toàn.` })
    return null
  }
  return amount
}

function variant(
  itemKey: string,
  unitCode: MenuUnitCode,
  displayName: string,
  amountVnd: number,
  displayOrder: number,
  quantityInUnit: number | null = null,
  isSellable = true,
): ImportVariant {
  const importKey = hash(`${itemKey}|${unitCode}`)
  return {
    importKey,
    code: stableCode('XLSX_VAR', importKey),
    unitCode,
    displayName,
    quantityInUnit,
    isSellable,
    displayOrder,
    amountVnd,
  }
}

function mapVariants(
  row: MenuWorkbookRow,
  itemKey: string,
  firstPrice: number | null,
  bottlePrice: number | null,
  warnings: ImportIssue[],
  errors: ImportIssue[],
): ImportVariant[] {
  const unit = normalizedKey(row.sellingUnit)
  const blockedByStartingPrice = row.name.toUpperCase() === '(SPECIAL COCKTAIL)'
  if (blockedByStartingPrice) {
    warnings.push({
      rowNumber: row.rowNumber,
      code: 'STARTING_PRICE_REQUIRES_VERIFICATION',
      message: 'Giá 300++ là giá khởi điểm; biến thể được lưu nhưng không được phép bán.',
    })
  }

  const make = (
    code: MenuUnitCode,
    label: string,
    price: number | null,
    order: number,
    quantity: number | null = null,
    sellable = !blockedByStartingPrice,
  ) => price === null ? [] : [variant(itemKey, code, label, price, order, quantity, sellable)]

  switch (unit) {
    case 'ly / chai':
      return [
        ...make('GLASS', 'Ly', firstPrice, 1),
        ...make('BOTTLE', 'Chai', bottlePrice, 2),
      ]
    case 'ly':
      if (bottlePrice !== null) warnings.push({ rowNumber: row.rowNumber, code: 'UNEXPECTED_BOTTLE_PRICE', message: 'Đơn vị ly có thêm giá chai; giá chai không được tự ánh xạ.' })
      return make('GLASS', 'Ly', firstPrice, 1)
    case 'shot':
      return make('SHOT', 'Shot', firstPrice, 1)
    case 'chai':
      return make('BOTTLE', 'Chai', bottlePrice ?? firstPrice, 1)
    case 'phan':
      return make('PORTION', 'Phần', firstPrice, 1)
    case 'binh chia':
      return make('SHARING_JUG', 'Bình chia', firstPrice, 1)
    case 'combo 6 shot':
      return make('SHOT_COMBO_6', 'Combo 6 shot', firstPrice, 1, 6)
    case 'combo 12 shot':
      return make('SHOT_COMBO_12', 'Combo 12 shot', firstPrice, 1, 12)
    case 'lon / chai': {
      const prices = [firstPrice, bottlePrice].filter((price): price is number => price !== null)
      if (prices.length === 1) {
        // L10 / câu trả lời Q5: lon hay chai CÙNG giá, khách chọn kiểu nào thì
        // phục vụ kiểu đó. Nguồn chỉ có một giá nên không còn gì mơ hồ về tiền;
        // thứ chưa biết trước đây là đơn vị, và câu trả lời là "cả hai". Bản cũ
        // gộp thành một biến thể OTHER rồi khoá bán, nên sáu món nước ngọt
        // không xuất hiện trên màn Gọi món và Bar cũng không biết khách muốn
        // lon hay chai.
        const amount = prices[0]!
        return [
          ...make('CAN', 'Lon', amount, 1),
          ...make('BOTTLE', 'Chai', amount, 2),
        ]
      }
      errors.push({
        rowNumber: row.rowNumber,
        code: 'AMBIGUOUS_CAN_OR_BOTTLE_PRICES',
        message: 'Không thể ánh xạ an toàn giá của “lon / chai”.',
      })
      return []
    }
    default:
      errors.push({
        rowNumber: row.rowNumber,
        code: 'UNMAPPED_SELLING_UNIT',
        message: `Không ánh xạ được đơn vị bán “${row.sellingUnit}”.`,
      })
      return []
  }
}

export function buildMenuImportPlan(rows: MenuWorkbookRow[]): MenuImportPlan {
  const warnings: ImportIssue[] = []
  const errors: ImportIssue[] = []
  const categories: ImportCategory[] = []
  const items: ImportItem[] = []
  const groupKeys = new Map<string, string>()
  const categoryKeys = new Map<string, string>()
  const duplicateNames = new Map<string, number[]>()
  const duplicateVerificationRows = new Set<number>()

  for (const row of rows) {
    const groupName = cleanText(row.group)
    const categoryName = cleanText(row.category)
    const groupNaturalKey = normalizedKey(groupName)
    let groupKey = groupKeys.get(groupNaturalKey)
    if (!groupKey) {
      groupKey = `${MENU_IMPORT_SOURCE}|group|${groupNaturalKey}`
      groupKeys.set(groupNaturalKey, groupKey)
      categories.push({
        key: groupKey,
        code: stableCode('XLSX_GROUP', groupKey),
        name: groupName,
        parentKey: null,
        displayOrder: groupKeys.size,
      })
    }

    const categoryNaturalKey = `${groupNaturalKey}|${normalizedKey(categoryName)}`
    let categoryKey = categoryKeys.get(categoryNaturalKey)
    if (!categoryKey) {
      categoryKey = `${MENU_IMPORT_SOURCE}|category|${categoryNaturalKey}`
      categoryKeys.set(categoryNaturalKey, categoryKey)
      categories.push({
        key: categoryKey,
        code: stableCode('XLSX_CAT', categoryKey),
        name: categoryName,
        parentKey: groupKey,
        displayOrder: categoryKeys.size,
      })
    }

    const name = cleanText(row.name)
    const normalizedName = normalizedKey(name)
    const description = row.description ? cleanText(row.description) : null
    const itemNaturalKey = `${MENU_IMPORT_SOURCE}|${categoryNaturalKey}|${normalizedName}|${normalizedKey(description ?? '')}`
    const itemKey = hash(itemNaturalKey)
    const firstPrice = thousandsToVnd(row.glassShotPriceThousands, row.rowNumber, 'Giá ly-shot', errors)
    const bottlePrice = thousandsToVnd(row.bottlePriceThousands, row.rowNumber, 'Giá chai', errors)
    const variants = mapVariants(row, itemKey, firstPrice, bottlePrice, warnings, errors)
    if (variants.length === 0) {
      errors.push({ rowNumber: row.rowNumber, code: 'NO_VALID_PRICE', message: 'Món không có biến thể với giá hợp lệ.' })
    }
    const specialNote = name.toUpperCase() === '(SPECIAL COCKTAIL)'
      ? 'Giá nguồn là 300++ (giá khởi điểm); ý nghĩa phần ++ chưa được xác nhận. Không được phép bán.'
      : null
    const note = [row.note ? cleanText(row.note) : null, specialNote].filter(Boolean).join(' ') || null
    items.push({
      rowNumber: row.rowNumber,
      importKey: itemKey,
      code: stableCode('XLSX_ITEM', itemKey),
      categoryKey,
      name,
      normalizedName,
      description,
      note,
      preparationStation: groupNaturalKey === 'do an' ? 'KITCHEN' : 'BAR',
      displayOrder: row.sequence,
      variants,
    })
    const duplicates = duplicateNames.get(normalizedName) ?? []
    duplicates.push(row.rowNumber)
    duplicateNames.set(normalizedName, duplicates)
  }

  for (const [name, rowNumbers] of duplicateNames) {
    if (rowNumbers.length > 1) {
      for (const rowNumber of rowNumbers) duplicateVerificationRows.add(rowNumber)
      warnings.push({
        rowNumber: rowNumbers[0] ?? null,
        code: 'DUPLICATE_ITEM_NAME',
        message: `Tên chuẩn hóa “${name}” xuất hiện ở các dòng ${rowNumbers.join(', ')}; các món được giữ riêng theo phân loại/mô tả.`,
      })
    }
  }

  const verificationRows = new Set(
    warnings
      .filter((issue) => ['STARTING_PRICE_REQUIRES_VERIFICATION', 'DUPLICATE_ITEM_NAME'].includes(issue.code))
      .map((issue) => issue.rowNumber)
      .filter((rowNumber): rowNumber is number => rowNumber !== null),
  )
  for (const rowNumber of duplicateVerificationRows) verificationRows.add(rowNumber)
  return {
    source: MENU_IMPORT_SOURCE,
    groups: groupKeys.size,
    classifications: categoryKeys.size,
    categories,
    items,
    variantCount: items.reduce((total, item) => total + item.variants.length, 0),
    priceCount: items.reduce((total, item) => total + item.variants.length, 0),
    warnings,
    errors,
    verificationRowCount: verificationRows.size,
  }
}

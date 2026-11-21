/**
 * Module Phục vụ 2 — luật đối chiếu danh mục món, viết thành hàm thuần.
 *
 * Duyệt một món nghĩa là cho phép nó xuất hiện trên máy Phục vụ với một mức
 * giá. Đó là một quyết định về tiền, nên luật chặn phải test được bằng assert
 * chứ không nằm rải trong một script dòng lệnh.
 *
 * Nguyên tắc: mặc định là KHÔNG duyệt. Mọi thứ còn mơ hồ ở nguồn — giá
 * `300++`, dòng `lon / chai` chỉ có một giá, tên trùng chưa xử lý — đều là
 * chặn cứng, và chỉ mở được bằng một tham số nêu đích danh mã món.
 */
import type { MenuItemSnapshot } from './import-mapping.js'
import type { MenuUnitCode } from './menu.model.js'

export type MenuSourceStatus = 'PENDING_VERIFICATION' | 'REVIEW_REQUIRED' | 'VERIFIED' | 'REJECTED'

export type VerificationBlockerCode =
  | 'ITEM_INACTIVE'
  | 'NO_VARIANT'
  | 'VARIANT_NOT_SELLABLE'
  | 'AMBIGUOUS_UNIT'
  | 'MISSING_PRICE'
  | 'DUPLICATE_NAME'

export interface VerificationBlocker {
  code: VerificationBlockerCode
  message: string
}

export interface VerificationVariant {
  code: string
  /** Giá trị đã bị `ck_menu_variants_unit` giới hạn ở tầng database. */
  unitCode: MenuUnitCode
  displayName: string
  isSellable: boolean
  /** Giá đang mở, hoặc `null` nếu biến thể chưa có giá hiện hành. */
  amountVnd: number | null
}

export interface VerificationCandidate {
  itemId: number
  code: string
  name: string
  normalizedName: string
  sourceStatus: MenuSourceStatus
  isActive: boolean
  /** Số món trong cùng địa điểm dùng chung `normalized_name` này. */
  sameNameCount: number
  variants: VerificationVariant[]
  snapshot: MenuItemSnapshot
  /** Nội dung đã được duyệt lần trước; `null` khi món chưa từng được duyệt. */
  verifiedSnapshot: MenuItemSnapshot | null
}

export interface VerificationOptions {
  /** Mã món được phép duyệt dù trùng tên với món khác. Phải nêu đích danh. */
  allowDuplicateNameCodes?: readonly string[]
}

/**
 * `OTHER` là "chưa biết đây là đơn vị gì". Duyệt một dòng như thế là chốt một
 * đơn vị bán mà không ai chọn, nên nó vẫn là chặn cứng.
 *
 * L10: importer KHÔNG còn sinh `OTHER` cho dòng "lon / chai" một giá — câu trả
 * lời Q5 nói rõ hai đơn vị cùng giá, nên nó ánh xạ thành `CAN` + `BOTTLE`. Luật
 * ở đây giữ nguyên vì `OTHER` vẫn tới được từ dữ liệu nhập trước bản sửa và từ
 * các biến thể tạo tay trong màn quản trị.
 */
const AMBIGUOUS_UNITS: readonly string[] = ['OTHER']

export function verificationBlockers(
  candidate: VerificationCandidate,
  options: VerificationOptions = {},
): VerificationBlocker[] {
  const blockers: VerificationBlocker[] = []
  if (!candidate.isActive) {
    blockers.push({ code: 'ITEM_INACTIVE', message: 'Món đang tắt trong danh mục.' })
  }
  if (!candidate.variants.length) {
    blockers.push({ code: 'NO_VARIANT', message: 'Món chưa có biến thể nào để bán.' })
  }
  const locked = candidate.variants.filter((variant) => !variant.isSellable)
  if (locked.length) {
    blockers.push({
      code: 'VARIANT_NOT_SELLABLE',
      message: `Biến thể đang khoá bán, cần chốt giá và đơn vị với iPOS trước: ${locked.map((variant) => variant.displayName).join(', ')}.`,
    })
  }
  const ambiguous = candidate.variants.filter((variant) => AMBIGUOUS_UNITS.includes(String(variant.unitCode)))
  if (ambiguous.length) {
    blockers.push({
      code: 'AMBIGUOUS_UNIT',
      message: `Đơn vị bán chưa rõ (${ambiguous.map((variant) => variant.unitCode).join(', ')}); nguồn ghi hai đơn vị nhưng chỉ có một giá.`,
    })
  }
  const unpriced = candidate.variants.filter((variant) => variant.amountVnd === null || variant.amountVnd <= 0)
  if (unpriced.length) {
    blockers.push({
      code: 'MISSING_PRICE',
      message: `Biến thể chưa có giá hiện hành: ${unpriced.map((variant) => variant.displayName).join(', ')}.`,
    })
  }
  if (candidate.sameNameCount > 1 && !(options.allowDuplicateNameCodes ?? []).includes(candidate.code)) {
    blockers.push({
      code: 'DUPLICATE_NAME',
      message: `Tên trùng với ${candidate.sameNameCount - 1} món khác trong quán. Duyệt bằng --allow-duplicate-name=${candidate.code} sau khi đã đối chiếu.`,
    })
  }
  return blockers
}

export interface SnapshotDiffEntry {
  field: string
  before: unknown
  after: unknown
}

function scalarDiff(field: string, before: unknown, after: unknown, into: SnapshotDiffEntry[]): void {
  if (before !== after) into.push({ field, before, after })
}

/**
 * Khác biệt giữa nội dung đã duyệt và nội dung hiện tại, theo từng trường.
 *
 * Đây là thứ `menu:verify` in ra trước khi hỏi. Một dòng "món X đã thay đổi"
 * không đủ để ai đó bấm duyệt: cái cần biết là giá đi từ bao nhiêu lên bao
 * nhiêu, và biến thể nào vừa xuất hiện.
 */
export function diffMenuSnapshots(
  before: MenuItemSnapshot | null,
  after: MenuItemSnapshot,
): SnapshotDiffEntry[] {
  if (before === null) return []
  const entries: SnapshotDiffEntry[] = []
  scalarDiff('categoryCode', before.categoryCode, after.categoryCode, entries)
  scalarDiff('name', before.name, after.name, entries)
  scalarDiff('description', before.description, after.description, entries)
  scalarDiff('note', before.note, after.note, entries)
  scalarDiff('preparationStation', before.preparationStation, after.preparationStation, entries)
  scalarDiff('displayOrder', before.displayOrder, after.displayOrder, entries)

  const beforeVariants = new Map(before.variants.map((variant) => [variant.code, variant]))
  const afterVariants = new Map(after.variants.map((variant) => [variant.code, variant]))
  for (const [code, afterVariant] of afterVariants) {
    const beforeVariant = beforeVariants.get(code)
    if (!beforeVariant) {
      entries.push({ field: `variants[${code}]`, before: null, after: afterVariant })
      continue
    }
    scalarDiff(`variants[${code}].unitCode`, beforeVariant.unitCode, afterVariant.unitCode, entries)
    scalarDiff(`variants[${code}].displayName`, beforeVariant.displayName, afterVariant.displayName, entries)
    scalarDiff(`variants[${code}].quantityInUnit`, beforeVariant.quantityInUnit, afterVariant.quantityInUnit, entries)
    scalarDiff(`variants[${code}].isSellable`, beforeVariant.isSellable, afterVariant.isSellable, entries)
    scalarDiff(`variants[${code}].displayOrder`, beforeVariant.displayOrder, afterVariant.displayOrder, entries)
    scalarDiff(`variants[${code}].amountVnd`, beforeVariant.amountVnd, afterVariant.amountVnd, entries)
  }
  for (const [code, beforeVariant] of beforeVariants) {
    if (!afterVariants.has(code)) entries.push({ field: `variants[${code}]`, before: beforeVariant, after: null })
  }
  return entries
}

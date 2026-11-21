export type MenuAvailability = "AVAILABLE" | "TEMPORARILY_UNAVAILABLE"
export type MenuUnitCode =
  "GLASS" | "SHOT" | "BOTTLE" | "PORTION" | "SHARING_JUG" | "SHOT_COMBO_6" | "SHOT_COMBO_12" | "CAN" | "OTHER"

export interface WaiterMenuVisit {
  visitId: number
  tableCodes: string[]
  guestCount: number
  startedAt: string
  status: "OPEN"
}

export interface WaiterMenuCategory {
  id: number
  code: string
  name: string
  parentId: number | null
  displayOrder: number
}

export interface WaiterMenuVariant {
  variantId: number
  unitCode: MenuUnitCode
  displayName: string
  quantityInUnit: number | null
  availabilityStatus: MenuAvailability
  amountVnd: number
  priceId: number
  priceVersion: number
  effectiveFrom: string
}

export interface WaiterMenuItem {
  id: number
  code: string
  categoryId: number
  name: string
  description: string | null
  preparationStation: "BAR" | "KITCHEN"
  availabilityStatus: MenuAvailability
  displayOrder: number
  variants: WaiterMenuVariant[]
}

export interface WaiterMenuView {
  catalogVersion: string
  visit: WaiterMenuVisit
  categories: WaiterMenuCategory[]
  items: WaiterMenuItem[]
}

/**
 * API trả cả nhóm cha và classification con. Thứ tự hiển thị phải giữ các
 * classification cạnh nhóm của chúng, thay vì phụ thuộc thứ tự mảng/ID từ DB.
 */
export function orderedMenuCategories(categories: readonly WaiterMenuCategory[]): WaiterMenuCategory[] {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const children = new Map<number | null, WaiterMenuCategory[]>()
  const compare = (left: WaiterMenuCategory, right: WaiterMenuCategory) =>
    left.displayOrder - right.displayOrder || left.id - right.id

  for (const category of categories) {
    const parentId = category.parentId !== null && byId.has(category.parentId) ? category.parentId : null
    const siblings = children.get(parentId) ?? []
    siblings.push(category)
    children.set(parentId, siblings)
  }
  for (const siblings of children.values()) siblings.sort(compare)

  const ordered: WaiterMenuCategory[] = []
  const visited = new Set<number>()
  const append = (category: WaiterMenuCategory) => {
    if (visited.has(category.id)) return
    visited.add(category.id)
    ordered.push(category)
    for (const child of children.get(category.id) ?? []) append(child)
  }
  for (const root of children.get(null) ?? []) append(root)
  // Dữ liệu lỗi có vòng lặp vẫn phải render được, không làm mất danh mục.
  for (const category of [...categories].sort(compare)) append(category)
  return ordered
}

export function normalizeMenuSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, (letter) => (letter === "Đ" ? "D" : "d"))
    .toLowerCase()
    .trim()
}

export function categoryMatches(
  item: WaiterMenuItem,
  categoryId: number | null,
  categories: WaiterMenuCategory[],
): boolean {
  if (categoryId === null) return true
  if (item.categoryId === categoryId) return true
  return categories.some((category) => category.id === item.categoryId && category.parentId === categoryId)
}

export function filterMenuItems(
  items: WaiterMenuItem[],
  categories: WaiterMenuCategory[],
  categoryId: number | null,
  search: string,
): WaiterMenuItem[] {
  const needle = normalizeMenuSearch(search)
  return items.filter(
    (item) =>
      categoryMatches(item, categoryId, categories) && (!needle || normalizeMenuSearch(item.name).includes(needle)),
  )
}

/* ------------------------- Module Phục vụ 3 (v1.1) ----------------------- */

/**
 * Giá đại diện của một món khi lọc và sắp xếp: giá RẺ NHẤT còn bán được.
 *
 * Lọc "dưới 300k" phải giữ lại món có ly 280k dù chai của nó 2.3 triệu —
 * khách hỏi món trong tầm tiền, không hỏi đơn vị trong tầm tiền. `null` khi
 * món không còn đơn vị nào bán được.
 */
export function menuItemFromPrice(item: WaiterMenuItem): number | null {
  const amounts = item.variants
    .filter((variant) => variant.availabilityStatus === "AVAILABLE")
    .map((variant) => variant.amountVnd)
  return amounts.length === 0 ? null : Math.min(...amounts)
}

export type MenuSort = "default" | "price_asc" | "price_desc" | "name"

export const MENU_SORT_LABEL: Record<MenuSort, string> = {
  default: "Thứ tự danh mục",
  price_asc: "Giá thấp → cao",
  price_desc: "Giá cao → thấp",
  name: "Tên A → Z",
}

export interface MenuQuery {
  categoryId: number | null
  search: string
  /** Khoảng giá tính theo `menuItemFromPrice`; `null` nghĩa là không giới hạn. */
  minVnd: number | null
  maxVnd: number | null
  sort: MenuSort
}

export const EMPTY_MENU_QUERY: MenuQuery = {
  categoryId: null,
  search: "",
  minVnd: null,
  maxVnd: null,
  sort: "default",
}

/** Số bộ lọc đang bật, để nút "☰" đeo một con số thay vì im lặng. */
export function activeFilterCount(query: MenuQuery): number {
  let count = 0
  if (query.minVnd !== null) count += 1
  if (query.maxVnd !== null) count += 1
  if (query.sort !== "default") count += 1
  return count
}

/**
 * Lọc theo danh mục, từ khóa và khoảng giá, rồi sắp xếp.
 *
 * Món không còn đơn vị nào bán được vẫn ĐI QUA bộ lọc giá: nhân viên cần thấy
 * nó để trả lời khách "món đó hết rồi", và một món biến mất khỏi danh sách là
 * một câu hỏi không có câu trả lời.
 */
export function queryMenuItems(
  items: WaiterMenuItem[],
  categories: WaiterMenuCategory[],
  query: MenuQuery,
): WaiterMenuItem[] {
  const filtered = filterMenuItems(items, categories, query.categoryId, query.search).filter((item) => {
    const price = menuItemFromPrice(item)
    if (price === null) return true
    if (query.minVnd !== null && price < query.minVnd) return false
    if (query.maxVnd !== null && price > query.maxVnd) return false
    return true
  })
  if (query.sort === "default") return filtered
  const sorted = [...filtered]
  if (query.sort === "name") {
    sorted.sort((left, right) => left.name.localeCompare(right.name, "vi"))
    return sorted
  }
  // Món hết hàng không có giá để so; dồn chúng xuống cuối thay vì để chúng
  // nhảy lên đầu danh sách "giá thấp → cao" với một giá trị giả.
  const direction = query.sort === "price_asc" ? 1 : -1
  sorted.sort((left, right) => {
    const leftPrice = menuItemFromPrice(left)
    const rightPrice = menuItemFromPrice(right)
    if (leftPrice === null) return rightPrice === null ? 0 : 1
    if (rightPrice === null) return -1
    return (leftPrice - rightPrice) * direction
  })
  return sorted
}

/**
 * Danh mục mở sẵn khi vào màn Gọi món: Signature Cocktails.
 *
 * Tìm theo `code` trước vì mã là thứ ổn định; tên hiển thị đổi theo mùa menu.
 * Không tìm thấy thì trả `null` — màn mở ở "Tất cả", đúng như hôm nay, chứ
 * không mở một nhóm ngẫu nhiên.
 */
export function defaultCategoryId(categories: readonly WaiterMenuCategory[]): number | null {
  const byCode = categories.find((category) => category.code.toUpperCase() === "SIGNATURE")
  if (byCode) return byCode.id
  const byName = categories.find((category) => normalizeMenuSearch(category.name).startsWith("signature"))
  return byName?.id ?? null
}

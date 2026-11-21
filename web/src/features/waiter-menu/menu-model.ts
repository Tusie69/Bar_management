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

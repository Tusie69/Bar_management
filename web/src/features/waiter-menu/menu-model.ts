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

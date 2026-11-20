export type MenuAvailability = 'AVAILABLE' | 'TEMPORARILY_UNAVAILABLE'
export type MenuUnitCode =
  | 'GLASS'
  | 'SHOT'
  | 'BOTTLE'
  | 'PORTION'
  | 'SHARING_JUG'
  | 'SHOT_COMBO_6'
  | 'SHOT_COMBO_12'
  | 'CAN'
  | 'OTHER'

export interface WaiterMenuVisit {
  visitId: number
  tableCodes: string[]
  guestCount: number
  startedAt: string
  status: 'OPEN'
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
  preparationStation: 'BAR' | 'KITCHEN'
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

export interface WaiterMenuQuery {
  visitId: number
  categoryId?: number
  search?: string
  availability?: MenuAvailability
  itemId?: number
}

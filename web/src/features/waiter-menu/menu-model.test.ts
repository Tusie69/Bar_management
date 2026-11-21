import { describe, expect, it } from "vitest"
import {
  categoryMatches,
  filterMenuItems,
  normalizeMenuSearch,
  orderedMenuCategories,
  type WaiterMenuCategory,
  type WaiterMenuItem,
} from "./menu-model"
import { formatVnd, menuPriceSummary } from "./menu-price"

const categories: WaiterMenuCategory[] = [
  { id: 1, code: "DRINK", name: "Đồ uống", parentId: null, displayOrder: 1 },
  { id: 2, code: "WHISKY", name: "Whisky", parentId: 1, displayOrder: 1 },
]
const item: WaiterMenuItem = {
  id: 10,
  code: "MACALLAN",
  categoryId: 2,
  name: "MACALLAN 12",
  description: "Single malt",
  preparationStation: "BAR",
  availabilityStatus: "AVAILABLE",
  displayOrder: 1,
  variants: [
    {
      variantId: 1,
      unitCode: "GLASS",
      displayName: "Ly",
      quantityInUnit: null,
      availabilityStatus: "AVAILABLE",
      amountVnd: 380_000,
      priceId: 11,
      priceVersion: 1,
      effectiveFrom: "2030-01-01T00:00:00.000Z",
    },
    {
      variantId: 2,
      unitCode: "BOTTLE",
      displayName: "Chai",
      quantityInUnit: null,
      availabilityStatus: "AVAILABLE",
      amountVnd: 6_500_000,
      priceId: 12,
      priceVersion: 1,
      effectiveFrom: "2030-01-01T00:00:00.000Z",
    },
  ],
}

describe("waiter menu model", () => {
  it("searches Vietnamese names with or without accents and ignores case", () => {
    const accented = { ...item, name: "SƯƠNG MÙ NGANG MẮT" }
    expect(normalizeMenuSearch(accented.name)).toBe("suong mu ngang mat")
    expect(filterMenuItems([accented], categories, null, "suong mu")).toEqual([accented])
    expect(filterMenuItems([accented], categories, null, "NGANG MẮT")).toEqual([accented])
  })

  it("matches both a leaf category and its parent group", () => {
    expect(categoryMatches(item, 2, categories)).toBe(true)
    expect(categoryMatches(item, 1, categories)).toBe(true)
    expect(categoryMatches(item, 999, categories)).toBe(false)
  })

  it("orders classifications by parent group and sibling displayOrder", () => {
    const input: WaiterMenuCategory[] = [
      { id: 4, code: "B", name: "B", parentId: 1, displayOrder: 2 },
      { id: 2, code: "SECOND", name: "Second", parentId: null, displayOrder: 2 },
      { id: 1, code: "FIRST", name: "First", parentId: null, displayOrder: 1 },
      { id: 3, code: "A", name: "A", parentId: 1, displayOrder: 1 },
    ]
    expect(orderedMenuCategories(input).map((category) => category.id)).toEqual([1, 3, 4, 2])
  })

  it("formats integer VND without converting back to thousands", () => {
    expect(formatVnd(280_000)).toBe("280.000đ")
    expect(formatVnd(6_500_000)).toBe("6.500.000đ")
    expect(menuPriceSummary(item.variants)).toBe("380.000đ – 6.500.000đ")
  })

  it("does not invent a glass price for a bottle-only item", () => {
    expect(menuPriceSummary([item.variants[1]!])).toBe("6.500.000đ")
  })
})

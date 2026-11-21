import { describe, expect, it } from "vitest"
import {
  EMPTY_MENU_QUERY,
  activeFilterCount,
  categoryMatches,
  defaultCategoryId,
  filterMenuItems,
  menuItemFromPrice,
  normalizeMenuSearch,
  orderedMenuCategories,
  queryMenuItems,
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

/* ------------------------- Module Phục vụ 3 (v1.1) ----------------------- */

describe("lọc giá, sắp xếp và danh mục mặc định", () => {
  const cats: WaiterMenuCategory[] = [
    { id: 1, code: "COCKTAIL", name: "Cocktail", parentId: null, displayOrder: 1 },
    { id: 5, code: "SIGNATURE", name: "Signature Cocktails", parentId: 1, displayOrder: 1 },
  ]
  function priced(id: number, name: string, amounts: number[], available = true): WaiterMenuItem {
    return {
      id,
      code: `I${id}`,
      categoryId: 5,
      name,
      description: null,
      preparationStation: "BAR",
      availabilityStatus: "AVAILABLE",
      displayOrder: id,
      variants: amounts.map((amountVnd, index) => ({
        variantId: id * 10 + index,
        unitCode: "GLASS" as const,
        displayName: "Ly",
        quantityInUnit: null,
        availabilityStatus: available ? ("AVAILABLE" as const) : ("TEMPORARILY_UNAVAILABLE" as const),
        amountVnd,
        priceId: 1,
        priceVersion: 1,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      })),
    }
  }

  const ly = priced(1, "Ly rẻ", [280_000])
  const chai = priced(2, "Có cả chai", [280_000, 2_300_000])
  const đắt = priced(3, "Chỉ chai", [2_300_000])
  const hết = priced(4, "Hết hàng", [100_000], false)
  const all = [ly, chai, đắt, hết]

  it("giá đại diện là giá rẻ nhất còn bán được", () => {
    expect(menuItemFromPrice(chai)).toBe(280_000)
    expect(menuItemFromPrice(hết)).toBeNull()
  })

  /**
   * Khách hỏi món trong tầm tiền, không hỏi đơn vị trong tầm tiền: món có ly
   * 280k phải còn trong kết quả "dưới 500k" dù chai của nó 2,3 triệu.
   */
  it("món có cả ly và chai vẫn qua bộ lọc khi giá ly nằm trong khoảng", () => {
    const result = queryMenuItems(all, cats, { ...EMPTY_MENU_QUERY, maxVnd: 500_000 })
    expect(result.map((entry) => entry.id)).toContain(2)
    expect(result.map((entry) => entry.id)).not.toContain(3)
  })

  /** Món hết hàng phải còn để nhân viên trả lời khách "món đó hết rồi". */
  it("món hết hàng không bị bộ lọc giá loại bỏ", () => {
    const result = queryMenuItems(all, cats, { ...EMPTY_MENU_QUERY, maxVnd: 50_000 })
    expect(result.map((entry) => entry.id)).toEqual([4])
  })

  it("sắp xếp theo giá, món hết hàng dồn xuống cuối", () => {
    const result = queryMenuItems(all, cats, { ...EMPTY_MENU_QUERY, sort: "price_asc" })
    expect(result.map((entry) => entry.id)).toEqual([1, 2, 3, 4])
    const desc = queryMenuItems(all, cats, { ...EMPTY_MENU_QUERY, sort: "price_desc" })
    expect(desc.at(-1)?.id).toBe(4)
  })

  it("mặc định giữ nguyên thứ tự danh mục", () => {
    expect(queryMenuItems(all, cats, EMPTY_MENU_QUERY).map((entry) => entry.id)).toEqual([1, 2, 3, 4])
  })

  it("đếm đúng số bộ lọc đang bật", () => {
    expect(activeFilterCount(EMPTY_MENU_QUERY)).toBe(0)
    expect(activeFilterCount({ ...EMPTY_MENU_QUERY, maxVnd: 500_000, sort: "name" })).toBe(2)
    // Danh mục và từ khóa KHÔNG tính: chúng đã hiện rõ trên màn.
    expect(activeFilterCount({ ...EMPTY_MENU_QUERY, categoryId: 5, search: "ốc" })).toBe(0)
  })

  it("danh mục mặc định tìm theo mã, không theo tên hiển thị", () => {
    expect(defaultCategoryId(cats)).toBe(5)
    expect(defaultCategoryId([{ id: 9, code: "X", name: "Signature Cocktails", parentId: null, displayOrder: 1 }])).toBe(9)
    expect(defaultCategoryId([{ id: 9, code: "X", name: "Bia", parentId: null, displayOrder: 1 }])).toBeNull()
  })
})

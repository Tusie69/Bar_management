import { describe, expect, it } from "vitest"
import { addToCart, emptyCart, type Cart } from "./cart-model"
import { cardAddMode, cardCartLine, cardCartQuantity, cardPriceLabel, defaultVariant } from "./menu-card-model"
import type { WaiterMenuItem, WaiterMenuVariant } from "./menu-model"
import { formatVnd } from "./menu-price"

function variant(overrides: Partial<WaiterMenuVariant> = {}): WaiterMenuVariant {
  return {
    variantId: 1,
    unitCode: "GLASS",
    displayName: "Ly",
    quantityInUnit: null,
    availabilityStatus: "AVAILABLE",
    amountVnd: 280_000,
    priceId: 11,
    priceVersion: 1,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function item(variants: WaiterMenuVariant[], overrides: Partial<WaiterMenuItem> = {}): WaiterMenuItem {
  return {
    id: 90,
    code: "VOOC",
    categoryId: 5,
    name: "VỎ ỐC THÌ THẦM",
    description: "Gin, chanh, syrup",
    preparationStation: "BAR",
    availabilityStatus: "AVAILABLE",
    displayOrder: 1,
    variants,
    ...overrides,
  }
}

describe("defaultVariant / cardAddMode", () => {
  it("một đơn vị bán: bấm + thêm thẳng", () => {
    const one = item([variant()])
    expect(cardAddMode(one)).toBe("direct")
    expect(defaultVariant(one)?.variantId).toBe(1)
  })

  /**
   * Chai 2,3 triệu và ly 280k là hai biến thể. Đoán sai là sai tiền triệu trên
   * hoá đơn, nên thẻ KHÔNG đoán — nó mở cửa sổ chi tiết.
   */
  it("nhiều đơn vị bán: bấm + mở cửa sổ chi tiết, không đoán", () => {
    const many = item([
      variant({ variantId: 1, displayName: "Ly", amountVnd: 280_000 }),
      variant({ variantId: 2, displayName: "Chai", unitCode: "BOTTLE", amountVnd: 2_300_000 }),
    ])
    expect(cardAddMode(many)).toBe("sheet")
  })

  it("hết sạch mọi đơn vị: nút + tắt", () => {
    const sold = item([variant({ availabilityStatus: "TEMPORARILY_UNAVAILABLE" })])
    expect(cardAddMode(sold)).toBe("blocked")
    expect(defaultVariant(sold)).toBeNull()
  })

  it("đơn vị hết hàng không được chọn làm mặc định", () => {
    const mixed = item([
      variant({ variantId: 1, amountVnd: 100_000, availabilityStatus: "TEMPORARILY_UNAVAILABLE" }),
      variant({ variantId: 2, amountVnd: 280_000 }),
    ])
    expect(cardAddMode(mixed)).toBe("direct")
    expect(defaultVariant(mixed)?.variantId).toBe(2)
  })

  it("giá 0 hoặc vượt trần không dùng được, nên không thành mặc định", () => {
    const broken = item([variant({ variantId: 1, amountVnd: 0 }), variant({ variantId: 2, amountVnd: 280_000 })])
    expect(defaultVariant(broken)?.variantId).toBe(2)
  })
})

describe("cardPriceLabel", () => {
  it("một đơn vị: giá kèm tên đơn vị", () => {
    expect(cardPriceLabel(item([variant()]), formatVnd)).toBe("280.000đ · Ly")
  })

  /**
   * Nhiều đơn vị hiện KHOẢNG giá. Một con số đơn lẻ trông như giá của món, và
   * nhân viên sẽ đọc nó cho khách nghe trước khi biết khách muốn chai.
   */
  it("nhiều đơn vị: khoảng giá, không phải giá rẻ nhất", () => {
    const many = item([variant({ variantId: 1, amountVnd: 280_000 }), variant({ variantId: 2, amountVnd: 2_300_000 })])
    expect(cardPriceLabel(many, formatVnd)).toBe("280.000đ – 2.300.000đ")
  })

  it("nhiều đơn vị cùng giá: chỉ hiện một giá, không lặp lại khoảng giá", () => {
    const samePrice = item([
      variant({ variantId: 1, displayName: "Lon", amountVnd: 65_000 }),
      variant({ variantId: 2, displayName: "Chai", unitCode: "BOTTLE", amountVnd: 65_000 }),
    ])
    expect(cardPriceLabel(samePrice, formatVnd)).toBe("65.000đ")
  })

  /**
   * Khách vẫn hỏi giá của món đã hết. Nhãn "Tạm hết" cạnh tên món đã nói món
   * hết; giấu luôn con số thì nhân viên phải mở cửa sổ chi tiết chỉ để đọc một
   * cái giá.
   */
  it("món hết hàng vẫn hiện giá để còn trả lời khách", () => {
    const sold = item([variant({ availabilityStatus: "TEMPORARILY_UNAVAILABLE", amountVnd: 1_400_000 })])
    expect(cardPriceLabel(sold, formatVnd)).toBe("1.400.000đ · Ly")
  })

  it("giá 0 thì không hiện một con số không đọc được cho khách", () => {
    const broken = item([variant({ availabilityStatus: "TEMPORARILY_UNAVAILABLE", amountVnd: 0 })])
    expect(cardPriceLabel(broken, formatVnd)).toBe("Chưa có giá")
  })
})

describe("cardCartLine / cardCartQuantity", () => {
  const one = item([variant()])
  function cartWith(note: string): Cart {
    return addToCart(emptyCart(1, "k"), { item: one, variant: variant(), quantity: 2, note }, "line", "next")
  }

  it("− / + trên thẻ chỉ điều khiển dòng KHÔNG ghi chú", () => {
    expect(cardCartLine(cartWith(""), one)?.quantity).toBe(2)
    expect(cardCartLine(cartWith("Ít đá"), one)).toBeNull()
  })

  it("số trên thẻ đếm mọi dòng của món, kể cả dòng có ghi chú", () => {
    expect(cardCartQuantity(cartWith("Ít đá"), one)).toBe(2)
  })

  it("giỏ rỗng thì không có dòng nào để bớt", () => {
    expect(cardCartLine(emptyCart(1, "k"), one)).toBeNull()
    expect(cardCartQuantity(emptyCart(1, "k"), one)).toBe(0)
  })
})

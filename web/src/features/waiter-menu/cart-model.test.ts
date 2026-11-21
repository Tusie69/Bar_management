import { describe, expect, it } from "vitest"
import {
  MAX_CART_LINES,
  MAX_LINE_NOTE_LENGTH,
  MAX_LINE_QUANTITY,
  MAX_ORDER_TOTAL_VND,
  MAX_UNIT_PRICE_VND,
  addToCart,
  applyPriceChanges,
  cartExceedsMoneyLimit,
  cartIsFull,
  cartItemCount,
  cartPayload,
  cartStations,
  cartTotalVnd,
  customizationKey,
  describePriceChanges,
  emptyCart,
  isOrderableAmount,
  normalizeNote,
  parseCart,
  reconcileCart,
  removeLine,
  removeVariants,
  setLineNote,
  setLineQuantity,
  type Cart,
} from "./cart-model"
import type { WaiterMenuItem, WaiterMenuVariant } from "./menu-model"

const KEY_A = "cart-key-aaaaaaaa"
const KEY_B = "cart-key-bbbbbbbb"
const LINE_1 = "line-00000001"
const LINE_2 = "line-00000002"

function variant(overrides: Partial<WaiterMenuVariant> = {}): WaiterMenuVariant {
  return {
    variantId: 1,
    unitCode: "GLASS",
    displayName: "Ly",
    quantityInUnit: null,
    availabilityStatus: "AVAILABLE",
    amountVnd: 380_000,
    priceId: 11,
    priceVersion: 1,
    effectiveFrom: "2029-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function item(overrides: Partial<WaiterMenuItem> = {}): WaiterMenuItem {
  return {
    id: 7,
    code: "MACALLAN_12",
    categoryId: 2,
    name: "MACALLAN 12",
    description: null,
    preparationStation: "BAR",
    availabilityStatus: "AVAILABLE",
    displayOrder: 1,
    variants: [variant()],
    ...overrides,
  }
}

const food = item({
  id: 9,
  code: "TRUFFLE_FRIES",
  name: "TRUFFLE FRIES",
  preparationStation: "KITCHEN",
  variants: [variant({ variantId: 2, unitCode: "PORTION", displayName: "Phần", amountVnd: 180_000, priceId: 12 })],
})

function cartWithGlass(quantity = 2, note = ""): Cart {
  return addToCart(emptyCart(5, KEY_A), { item: item(), variant: variant(), quantity, note }, KEY_B, LINE_1)
}

describe("giỏ gọi món", () => {
  it("chép giá, tên món và quầy chế biến vào dòng giỏ, kèm định danh dòng", () => {
    const cart = cartWithGlass(2, " ít  đá ")
    expect(cart.lines).toEqual([
      {
        cartLineId: LINE_1,
        variantId: 1,
        itemId: 7,
        itemName: "MACALLAN 12",
        variantDisplayName: "Ly",
        unitCode: "GLASS",
        preparationStation: "BAR",
        amountVnd: 380_000,
        priceId: 11,
        priceVersion: 1,
        quantity: 2,
        // Khoảng trắng bên trong được gộp: "ít  đá" và "ít đá" là một lời nhắn.
        note: "ít đá",
      },
    ])
    expect(cart.submitKey).toBe(KEY_B)
  })

  it("chặn số lượng ngoài khoảng và cắt ghi chú quá dài", () => {
    const tooMany = addToCart(
      emptyCart(5, KEY_A),
      { item: item(), variant: variant(), quantity: 500, note: "x".repeat(400) },
      KEY_B,
      LINE_1,
    )
    expect(tooMany.lines[0]!.quantity).toBe(MAX_LINE_QUANTITY)
    expect(tooMany.lines[0]!.note).toHaveLength(MAX_LINE_NOTE_LENGTH)
    expect(setLineQuantity(tooMany, LINE_1, 9_999, KEY_A).lines[0]!.quantity).toBe(MAX_LINE_QUANTITY)
  })

  it("số lượng về 0 là bỏ dòng khỏi giỏ", () => {
    expect(setLineQuantity(cartWithGlass(1), LINE_1, 0, KEY_A).lines).toEqual([])
    expect(removeLine(cartWithGlass(1), LINE_1, KEY_A).lines).toEqual([])
  })

  it("tổng tiền, số món và quầy chế biến tính từ dòng giỏ", () => {
    const cart = addToCart(cartWithGlass(2), { item: food, variant: food.variants[0]!, quantity: 3 }, KEY_A, LINE_2)
    expect(cartItemCount(cart)).toBe(5)
    expect(cartTotalVnd(cart)).toBe(380_000 * 2 + 180_000 * 3)
    expect(cartStations(cart)).toEqual(["BAR", "KITCHEN"])
    expect(cartStations(cartWithGlass(1))).toEqual(["BAR"])
  })

  it("payload chỉ mang bảy trường được phép gửi, không mang cartLineId", () => {
    const cart = setLineNote(cartWithGlass(2), LINE_1, "ít đá", KEY_A)
    const payload = cartPayload(cart)
    expect(payload).toEqual({
      visitId: 5,
      idempotencyKey: KEY_A,
      lines: [{ variantId: 1, priceId: 11, priceVersion: 1, quantity: 2, note: "ít đá" }],
    })
    expect(Object.keys(payload.lines[0]!).sort()).toEqual(["note", "priceId", "priceVersion", "quantity", "variantId"])
  })

  it("ghi chú rỗng không xuất hiện trong payload", () => {
    expect(cartPayload(cartWithGlass(1)).lines[0]).toEqual({
      variantId: 1,
      priceId: 11,
      priceVersion: 1,
      quantity: 1,
    })
  })

  it("thao tác trên một cartLineId không tồn tại không đổi giỏ và không đổi mã", () => {
    const cart = cartWithGlass(2)
    expect(setLineQuantity(cart, "khong-ton-tai", 3, KEY_A)).toBe(cart)
    expect(setLineNote(cart, "khong-ton-tai", "x", KEY_A)).toBe(cart)
    expect(removeLine(cart, "khong-ton-tai", KEY_A)).toBe(cart)
    expect(removeVariants(cart, [404], KEY_A)).toBe(cart)
  })
})

describe("cùng biến thể, hai customize", () => {
  const glassNoIce = { item: item(), variant: variant(), quantity: 1, note: "không đá" }

  it("khác ghi chú thì thành hai dòng riêng", () => {
    const cart = addToCart(cartWithGlass(2, "ít đá"), glassNoIce, KEY_A, LINE_2)
    expect(cart.lines).toHaveLength(2)
    expect(cart.lines.map((line) => [line.cartLineId, line.note, line.quantity])).toEqual([
      [LINE_1, "ít đá", 2],
      [LINE_2, "không đá", 1],
    ])
    // Cả hai customize đều tới Bar: hai dòng trong payload, cùng variantId.
    expect(cartPayload(cart).lines).toEqual([
      { variantId: 1, priceId: 11, priceVersion: 1, quantity: 2, note: "ít đá" },
      { variantId: 1, priceId: 11, priceVersion: 1, quantity: 1, note: "không đá" },
    ])
    expect(cartItemCount(cart)).toBe(3)
    expect(cartTotalVnd(cart)).toBe(380_000 * 3)
  })

  it("cùng ghi chú thì gộp số lượng vào đúng dòng cũ", () => {
    const cart = addToCart(cartWithGlass(2, "ít đá"), { ...glassNoIce, note: "ít đá" }, KEY_A, LINE_2)
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]).toMatchObject({ cartLineId: LINE_1, quantity: 3, note: "ít đá" })
  })

  it("ghi chú khác nhau chỉ ở dấu, chữ hoa hay khoảng trắng vẫn là một customize", () => {
    for (const note of ["ít đá", "Ít  Đá", "IT DA", " it da "]) {
      const cart = addToCart(cartWithGlass(2, "ít đá"), { ...glassNoIce, note }, KEY_A, LINE_2)
      expect(cart.lines, note).toHaveLength(1)
      expect(cart.lines[0]!.quantity).toBe(3)
    }
    expect(customizationKey({ variantId: 1, note: "Ít  Đá" })).toBe(customizationKey({ variantId: 1, note: "it da" }))
    expect(customizationKey({ variantId: 1, note: "ít đá" })).not.toBe(
      customizationKey({ variantId: 1, note: "không đá" }),
    )
  })

  it("thêm lần nữa không xoá ghi chú đã có, vì đó là một customize khác", () => {
    const withNote = cartWithGlass(1, "ít đá")
    const plain = addToCart(withNote, { item: item(), variant: variant(), quantity: 1 }, KEY_A, LINE_2)
    expect(plain.lines.map((line) => line.note)).toEqual(["ít đá", ""])
  })

  it("sửa ghi chú chỉ chạm đúng dòng được chỉ định", () => {
    const cart = addToCart(cartWithGlass(2, "ít đá"), glassNoIce, KEY_A, LINE_2)
    const updated = setLineNote(cart, LINE_2, "nhiều đá", KEY_B)
    expect(updated.lines.map((line) => line.note)).toEqual(["ít đá", "nhiều đá"])
    const reduced = setLineQuantity(updated, LINE_2, 5, KEY_A)
    expect(reduced.lines.map((line) => line.quantity)).toEqual([2, 5])
    expect(removeLine(reduced, LINE_1, KEY_B).lines.map((line) => line.cartLineId)).toEqual([LINE_2])
  })

  it("sửa ghi chú thành trùng dòng khác thì GỘP hai dòng lại", () => {
    const cart = addToCart(cartWithGlass(2, "ít đá"), glassNoIce, KEY_A, LINE_2)
    const merged = setLineNote(cart, LINE_2, "ít đá", KEY_B)
    expect(merged.lines).toHaveLength(1)
    expect(merged.lines[0]).toMatchObject({ cartLineId: LINE_1, quantity: 3, note: "ít đá" })
    // Nếu không gộp, payload mang một cặp trùng khít và máy chủ từ chối cả đơn.
    expect(cartPayload(merged).lines).toHaveLength(1)
  })

  it("món hết hàng bỏ MỌI dòng của biến thể đó, và giá mới áp cho cả hai", () => {
    const cart = addToCart(cartWithGlass(2, "ít đá"), glassNoIce, KEY_A, LINE_2)
    expect(removeVariants(cart, [1], KEY_B).lines).toEqual([])
    const repriced = applyPriceChanges(
      cart,
      [
        {
          variantId: 1,
          itemName: "MACALLAN 12",
          variantDisplayName: "Ly",
          submittedPriceId: 11,
          submittedPriceVersion: 1,
          currentPriceId: 21,
          currentPriceVersion: 1,
          currentAmountVnd: 420_000,
        },
      ],
      KEY_B,
    )
    expect(repriced.lines.map((line) => [line.amountVnd, line.priceId])).toEqual([
      [420_000, 21],
      [420_000, 21],
    ])
  })

  it("không nhận thêm dòng khi đã đầy giỏ, kể cả customize mới", () => {
    let cart = emptyCart(5, KEY_A)
    for (let index = 1; index <= MAX_CART_LINES; index += 1) {
      cart = addToCart(
        cart,
        { item: item(), variant: variant(), quantity: 1, note: `ghi chu ${index}` },
        KEY_A,
        `line-${index}`,
      )
    }
    expect(cart.lines).toHaveLength(MAX_CART_LINES)
    expect(cartIsFull(cart)).toBe(true)
    const overflow = addToCart(cart, { item: item(), variant: variant(), quantity: 1, note: "mot nua" }, KEY_B, "x")
    expect(overflow).toBe(cart)
  })
})

describe("giới hạn tiền", () => {
  it("nhận diện giá dùng được", () => {
    expect(isOrderableAmount(380_000)).toBe(true)
    expect(isOrderableAmount(MAX_UNIT_PRICE_VND)).toBe(true)
    for (const bad of [0, -1, 1.5, MAX_UNIT_PRICE_VND + 1, Number.MAX_SAFE_INTEGER, Number.NaN, Infinity]) {
      expect(isOrderableAmount(bad), String(bad)).toBe(false)
    }
  })

  it("không thêm vào giỏ một biến thể có giá vượt trần hoặc bằng 0", () => {
    for (const amountVnd of [0, MAX_UNIT_PRICE_VND + 1, Number.MAX_SAFE_INTEGER]) {
      const cart = addToCart(
        emptyCart(5, KEY_A),
        { item: item(), variant: variant({ amountVnd }), quantity: 1 },
        KEY_B,
        LINE_1,
      )
      expect(cart.lines, String(amountVnd)).toEqual([])
      expect(cart.submitKey).toBe(KEY_A)
    }
  })

  it("tổng tiền của giỏ hợp lệ luôn là số nguyên chính xác", () => {
    let cart = emptyCart(5, KEY_A)
    for (let index = 1; index <= MAX_CART_LINES; index += 1) {
      cart = addToCart(
        cart,
        {
          item: item(),
          variant: variant({ amountVnd: MAX_UNIT_PRICE_VND }),
          quantity: MAX_LINE_QUANTITY,
          note: `n${index}`,
        },
        KEY_A,
        `line-${index}`,
      )
    }
    const total = cartTotalVnd(cart)
    expect(total).toBe(MAX_ORDER_TOTAL_VND)
    expect(Number.isSafeInteger(total)).toBe(true)
    expect(cartExceedsMoneyLimit(cart)).toBe(false)
  })

  it("giỏ mang giá đã mất chính xác thì bị khóa gửi", () => {
    // Chỉ xuất hiện khi một nháp cũ hoặc một payload lạ lọt vào: `addToCart`
    // không tạo ra dòng như thế. Nút gửi phải khóa thay vì gửi một tổng sai.
    const poisoned: Cart = {
      ...cartWithGlass(1),
      lines: [{ ...cartWithGlass(1).lines[0]!, amountVnd: Number.MAX_SAFE_INTEGER }],
    }
    expect(cartExceedsMoneyLimit(poisoned)).toBe(true)
    expect(cartExceedsMoneyLimit(cartWithGlass(2))).toBe(false)
  })

  it("nháp mang giá ngoài khoảng bị bỏ khi đọc lại", () => {
    const draft = cartWithGlass(1)
    const poisoned = {
      visitId: 5,
      lines: [{ ...draft.lines[0], amountVnd: MAX_UNIT_PRICE_VND + 1 }],
      submitKey: draft.submitKey,
    }
    expect(parseCart(poisoned, 5, KEY_A)).toBeNull()
  })

  it("reconcile bỏ dòng có giá không dùng được dù món vẫn còn bán", () => {
    const draft = cartWithGlass(1)
    const poisoned: Cart = { ...draft, lines: [{ ...draft.lines[0]!, amountVnd: Number.MAX_SAFE_INTEGER }] }
    const result = reconcileCart(poisoned, [item()], KEY_B)
    expect(result.dropped).toHaveLength(1)
    expect(result.cart.lines).toEqual([])
  })
})

describe("giá đổi", () => {
  const change = {
    variantId: 1,
    itemName: "MACALLAN 12",
    variantDisplayName: "Ly",
    submittedPriceId: 11,
    submittedPriceVersion: 1,
    currentPriceId: 21,
    currentPriceVersion: 1,
    currentAmountVnd: 420_000,
  }

  it("ghép giá cũ trong giỏ với giá mới của máy chủ", () => {
    expect(describePriceChanges(cartWithGlass(2), [change])).toEqual([{ ...change, previousAmountVnd: 380_000 }])
  })

  it("chỉ cập nhật giỏ khi được gọi, và cập nhật đúng dòng", () => {
    const cart = addToCart(cartWithGlass(2), { item: food, variant: food.variants[0]!, quantity: 1 }, KEY_A, LINE_2)
    const updated = applyPriceChanges(cart, [change], KEY_B)
    expect(updated.lines[0]).toMatchObject({ amountVnd: 420_000, priceId: 21 })
    expect(updated.lines[1]).toMatchObject({ amountVnd: 180_000, priceId: 12 })
    expect(cartTotalVnd(updated)).toBe(420_000 * 2 + 180_000)
    // Giỏ cũ không bị sửa: xác nhận giá là một bước riêng, không phải tác dụng phụ.
    expect(cartTotalVnd(cart)).toBe(380_000 * 2 + 180_000)
  })

  it("thay đổi không liên quan tới giỏ thì không sinh mã mới", () => {
    const cart = cartWithGlass(1)
    expect(applyPriceChanges(cart, [{ ...change, variantId: 999 }], KEY_B)).toBe(cart)
  })
})

describe("soi giỏ với danh mục vừa tải", () => {
  it("bỏ dòng mà món không còn trong danh mục hoặc đang tạm hết", () => {
    const cart = addToCart(cartWithGlass(2), { item: food, variant: food.variants[0]!, quantity: 1 }, KEY_A, LINE_2)
    const result = reconcileCart(
      cart,
      [item({ variants: [variant({ availabilityStatus: "TEMPORARILY_UNAVAILABLE" })] })],
      KEY_B,
    )
    expect(result.dropped.map((line) => line.cartLineId).sort()).toEqual([LINE_1, LINE_2])
    expect(result.cart.lines).toEqual([])
    expect(result.cart.submitKey).toBe(KEY_B)
  })

  it("KHÔNG tự sửa giá khi danh mục có giá khác", () => {
    const cart = cartWithGlass(2)
    const result = reconcileCart(cart, [item({ variants: [variant({ amountVnd: 420_000, priceId: 21 })] })], KEY_B)
    expect(result.dropped).toEqual([])
    expect(result.cart).toBe(cart)
    expect(result.cart.lines[0]).toMatchObject({ amountVnd: 380_000, priceId: 11 })
  })
})

describe("đọc nháp đã lưu", () => {
  const draft = addToCart(
    cartWithGlass(2, "ít đá"),
    { item: item(), variant: variant(), quantity: 1, note: "không đá" },
    KEY_A,
    LINE_2,
  )

  it("đọc lại đúng giỏ của cùng Phiên, giữ hai dòng cùng biến thể", () => {
    const parsed = parseCart(JSON.parse(JSON.stringify(draft)), 5, KEY_B)
    expect(parsed).toEqual(draft)
    expect(parsed?.lines).toHaveLength(2)
  })

  it("bỏ nháp của Phiên khác", () => {
    expect(parseCart(draft, 6, KEY_A)).toBeNull()
  })

  it.each([
    ["không phải object", 42],
    ["thiếu lines", { visitId: 5 }],
    ["lines rỗng", { visitId: 5, lines: [] }],
    ["dòng thiếu priceId", { visitId: 5, lines: [{ ...draft.lines[0], priceId: undefined }] }],
    ["dòng có giá âm", { visitId: 5, lines: [{ ...draft.lines[0], amountVnd: -1 }] }],
    ["dòng có quầy lạ", { visitId: 5, lines: [{ ...draft.lines[0], preparationStation: "ROOFTOP" }] }],
  ])("trả null cho nháp sai hình dạng: %s", (_name, value) => {
    expect(parseCart(value, 5, KEY_A)).toBeNull()
  })

  it("gộp dòng trùng customize và cấp id cho nháp của bản trước", () => {
    const legacy = {
      visitId: 5,
      lines: [
        { ...draft.lines[0], cartLineId: undefined },
        { ...draft.lines[0], cartLineId: undefined },
        { ...draft.lines[1], cartLineId: undefined },
      ],
      submitKey: "x",
    }
    const parsed = parseCart(legacy, 5, KEY_A)
    expect(parsed?.lines).toHaveLength(2)
    expect(parsed?.lines.map((line) => line.cartLineId)).toEqual(["draft-1", "draft-3"])
    expect(parsed?.lines.map((line) => line.note)).toEqual(["ít đá", "không đá"])
    expect(parsed?.submitKey).toBe(KEY_A)
  })

  it("hai dòng khác customize nhưng trùng cartLineId: chỉ giữ dòng đầu", () => {
    const broken = { visitId: 5, lines: [draft.lines[0], { ...draft.lines[1], cartLineId: LINE_1 }] }
    expect(parseCart(broken, 5, KEY_A)?.lines).toHaveLength(1)
  })

  it("normalizeNote cắt và gộp khoảng trắng", () => {
    expect(normalizeNote("  ít   đá  ")).toBe("ít đá")
    expect(normalizeNote("x".repeat(300))).toHaveLength(MAX_LINE_NOTE_LENGTH)
  })
})

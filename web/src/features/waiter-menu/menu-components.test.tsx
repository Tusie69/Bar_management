import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CartBar, CartLineList, OrderSentBanner } from "./cart-sheet"
import { emptyCart, type CartLine } from "./cart-model"
import { MenuCategoryTabs } from "./menu-category-tabs"
import { MenuItemCard } from "./menu-item-card"
import { MenuItemList } from "./menu-item-list"
import type { WaiterMenuCategory, WaiterMenuItem } from "./menu-model"
import { QuantityStepper } from "./quantity-stepper"

const item: WaiterMenuItem = {
  id: 1,
  code: "BOTTLE_ONLY",
  categoryId: 2,
  name: "BOTTLE ONLY",
  description: null,
  preparationStation: "BAR",
  availabilityStatus: "TEMPORARILY_UNAVAILABLE",
  displayOrder: 1,
  variants: [
    {
      variantId: 1,
      unitCode: "BOTTLE",
      displayName: "Chai",
      quantityInUnit: null,
      availabilityStatus: "TEMPORARILY_UNAVAILABLE",
      amountVnd: 1_400_000,
      priceId: 2,
      priceVersion: 3,
      effectiveFrom: "2030-01-01T00:00:00.000Z",
    },
  ],
}

describe("waiter menu presentation", () => {
  it("groups API classifications under parents, keeps displayOrder, and includes Tất cả", () => {
    const categories: WaiterMenuCategory[] = [
      { id: 2, code: "SPIRIT", name: "Rượu mạnh", parentId: null, displayOrder: 2 },
      { id: 3, code: "GIN", name: "Gin", parentId: 2, displayOrder: 1 },
      { id: 4, code: "CLASSIC", name: "Classic Cocktails", parentId: 1, displayOrder: 2 },
      { id: 1, code: "COCKTAIL", name: "Cocktail", parentId: null, displayOrder: 1 },
      { id: 5, code: "SIGNATURE", name: "Signature Cocktails", parentId: 1, displayOrder: 1 },
    ]
    const html = renderToStaticMarkup(
      <MenuCategoryTabs categories={categories} selected={null} onSelect={() => undefined} />,
    )
    expect(html.indexOf("Tất cả")).toBeLessThan(html.indexOf("Cocktail"))
    expect(html.indexOf("Cocktail")).toBeLessThan(html.indexOf("Signature Cocktails"))
    expect(html.indexOf("Signature Cocktails")).toBeLessThan(html.indexOf("Classic Cocktails"))
    expect(html.indexOf("Cocktail")).toBeLessThan(html.indexOf("Rượu mạnh"))
    expect(html.indexOf("Rượu mạnh")).toBeLessThan(html.indexOf("Gin"))
  })

  it("labels temporarily unavailable items and never renders a fake zero glass price", () => {
    const html = renderToStaticMarkup(
      <MenuItemCard item={item} quantity={0} onOpen={noop} onAdd={noop} onRemove={null} />,
    )
    expect(html).toContain("Tạm hết")
    expect(html).toContain("1.400.000đ")
    expect(html).not.toContain(">0đ<")
    expect(html).not.toContain("Ly")
  })

  /**
   * v1.1: thẻ chỉ còn tên · giá · − / +. Mô tả và quầy chế biến rời khỏi thẻ
   * và chỉ còn trong cửa sổ chi tiết.
   */
  it("thẻ một hàng: không còn mô tả, quầy chế biến hay mũi tên", () => {
    const html = renderToStaticMarkup(
      <MenuItemCard item={item} quantity={0} onOpen={noop} onAdd={noop} onRemove={null} />,
    )
    expect(html).not.toContain("Quầy bar")
    expect(html).not.toContain("Bếp")
    expect(html).not.toContain(item.description ?? "@@không có@@")
  })

  it("món đang có trong giỏ: viền nổi, hiện số lượng và nút bớt", () => {
    const html = renderToStaticMarkup(
      <MenuItemCard item={item} quantity={3} onOpen={noop} onAdd={noop} onRemove={noop} />,
    )
    expect(html).toContain("border-primary")
    expect(html).toContain(">3<")
    expect(html).toContain(`Bớt một phần ${item.name}`)
  })

  it("renders a clear empty state without cart or send-order controls", () => {
    const html = renderToStaticMarkup(
      <MenuItemList items={[]} cart={emptyCart(1, "k")} onOpen={noop} onAdd={noop} onRemove={noop} />,
    )
    expect(html).toContain("Không tìm thấy món")
    expect(html).not.toContain("Giỏ")
    expect(html).not.toContain("Gửi đơn")
  })
})

const cartLine: CartLine = {
  cartLineId: "line-1",
  variantId: 1,
  itemId: 7,
  itemName: "MACALLAN 12",
  variantDisplayName: "Ly",
  unitCode: "GLASS",
  preparationStation: "BAR",
  amountVnd: 380_000,
  priceId: 11,
  priceVersion: 1,
  quantity: 3,
  note: "ít đá",
}

const noop = () => undefined

describe("giỏ gọi món — phần nhìn", () => {
  it("không hiện thanh giỏ khi giỏ trống", () => {
    expect(renderToStaticMarkup(<CartBar itemCount={0} totalVnd={0} onOpen={noop} />)).toBe("")
  })

  it("thanh giỏ nói số món và tổng tiền", () => {
    const html = renderToStaticMarkup(<CartBar itemCount={4} totalVnd={1_320_000} onOpen={noop} />)
    expect(html).toContain("4 món")
    expect(html).toContain("1.320.000đ")
  })

  it("dòng giỏ hiện đơn vị, đơn giá, quầy chế biến và thành tiền", () => {
    const html = renderToStaticMarkup(
      <CartLineList lines={[cartLine]} onQuantityChange={noop} onNoteChange={noop} onRemove={noop} />,
    )
    expect(html).toContain("MACALLAN 12")
    expect(html).toContain("Ly")
    expect(html).toContain("380.000đ")
    expect(html).toContain("Quầy bar")
    // Thành tiền của dòng, không phải đơn giá: 3 × 380.000.
    expect(html).toContain("1.140.000đ")
    expect(html).toContain("ít đá")
    expect(html).toContain("Bỏ MACALLAN 12 Ly · ít đá khỏi giỏ")
    expect(html).toContain('aria-label="Số lượng MACALLAN 12 Ly · ít đá"')
  })

  it("giỏ trống nói rõ là trống, không hiện một dòng 0 món", () => {
    const html = renderToStaticMarkup(
      <CartLineList lines={[]} onQuantityChange={noop} onNoteChange={noop} onRemove={noop} />,
    )
    expect(html).toContain("Giỏ đang trống")
    expect(html).not.toContain("0đ")
  })

  it("nút giảm của dòng giỏ xuống được tới 0 (bỏ món), nút của ô chọn món thì không", () => {
    const inCart = renderToStaticMarkup(
      <CartLineList
        lines={[{ ...cartLine, quantity: 1 }]}
        onQuantityChange={noop}
        onNoteChange={noop}
        onRemove={noop}
      />,
    )
    expect(inCart).not.toContain('disabled=""')
    const stepper = renderToStaticMarkup(<QuantityStepper value={1} onChange={noop} label="MACALLAN 12" />)
    expect(stepper).toContain('disabled=""')
  })

  it("hai dòng cùng biến thể khác ghi chú hiện riêng, mỗi dòng một nút bỏ riêng", () => {
    const noIce: CartLine = { ...cartLine, cartLineId: "line-2", quantity: 1, note: "không đá" }
    const html = renderToStaticMarkup(
      <CartLineList lines={[cartLine, noIce]} onQuantityChange={noop} onNoteChange={noop} onRemove={noop} />,
    )
    expect(html).toContain("ít đá")
    expect(html).toContain("không đá")
    // Nhãn phải phân biệt được hai dòng: hai nút "Bỏ MACALLAN 12 khỏi giỏ"
    // giống nhau thì không ai (và không test nào) biết nút nào bỏ dòng nào.
    expect(html).toContain("Bỏ MACALLAN 12 Ly · ít đá khỏi giỏ")
    expect(html).toContain("Bỏ MACALLAN 12 Ly · không đá khỏi giỏ")
    expect(html).toContain('aria-label="Số lượng MACALLAN 12 Ly · ít đá"')
    expect(html).toContain('aria-label="Số lượng MACALLAN 12 Ly · không đá"')
    // Hai dòng, hai thành tiền riêng: 3 ly và 1 ly.
    expect(html).toContain("1.140.000đ")
    expect(html).toContain("380.000đ")
  })

  /**
   * v1.1: thông báo thu về MỘT dòng. Chi tiết đơn nằm sau nút "Xem" — một cú
   * bấm cho người cần, thay vì ba dòng chiếm chỗ của danh sách món.
   */
  it("báo đã lên đơn gọn một dòng, có nút Xem và nút đóng", () => {
    const html = renderToStaticMarkup(
      <OrderSentBanner tableLabel="A3" submittedAtLabel="21:42" onView={noop} onDismiss={noop} />,
    )
    expect(html).toContain("Đã lên đơn cho A3 · 21:42")
    expect(html).toContain(">Xem<")
    expect(html).toContain("Đóng thông báo đã lên đơn")
    // Không còn kể số món, quầy nhận và tổng tiền ngay trên dải báo.
    expect(html).not.toContain("Quầy bar và Bếp")
  })
})

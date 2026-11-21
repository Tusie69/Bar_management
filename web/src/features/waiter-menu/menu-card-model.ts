/**
 * Module Phục vụ 3 (v1.1) — luật của THẺ MÓN một hàng.
 *
 * Mockup bỏ mô tả, quầy và mũi tên khỏi thẻ, chỉ còn tên · giá · − / +. Nhờ
 * thẻ thấp, một màn thấy khoảng 11 món thay vì 5–6.
 *
 * Cái khó không nằm ở giao diện mà ở câu hỏi: bấm "+" thì thêm CÁI GÌ? Một
 * chai Johnnie Walker 2.300.000đ và một ly cùng món 280.000đ là hai biến thể;
 * đoán sai là sai tiền triệu trên hoá đơn. Luật ở đây trả lời câu đó, và nó là
 * hàm thuần để test được mà không cần DOM.
 */
import type { Cart, CartLine } from "./cart-model"
import { isOrderableAmount } from "./cart-model"
import type { WaiterMenuItem, WaiterMenuVariant } from "./menu-model"

/** Biến thể còn bán được: còn hàng VÀ có giá dùng được. */
export function sellableVariants(item: WaiterMenuItem): WaiterMenuVariant[] {
  return item.variants.filter(
    (variant) => variant.availabilityStatus === "AVAILABLE" && isOrderableAmount(variant.amountVnd),
  )
}

/**
 * Biến thể mà nút "+" trên thẻ sẽ thêm.
 *
 * Rẻ nhất trong số còn bán được. Đây là lựa chọn an toàn khi phải đoán: đoán
 * nhầm sang đơn vị rẻ hơn thì nhân viên thấy ngay trong giỏ và sửa được; đoán
 * nhầm sang chai thì khách nhận hoá đơn mới biết.
 *
 * Nó chỉ được DÙNG khi món có đúng một biến thể bán được — xem `cardAddMode`.
 * Với món nhiều đơn vị, hàm này chỉ phục vụ việc hiện giá "từ bao nhiêu".
 */
export function defaultVariant(item: WaiterMenuItem): WaiterMenuVariant | null {
  const sellable = sellableVariants(item)
  if (sellable.length === 0) return null
  return sellable.reduce((cheapest, variant) => (variant.amountVnd < cheapest.amountVnd ? variant : cheapest))
}

/**
 * Bấm "+" trên thẻ thì làm gì.
 *
 * - `direct`: món có đúng một đơn vị bán — thêm thẳng vào giỏ, không hỏi.
 * - `sheet`: món có từ hai đơn vị trở lên — MỞ cửa sổ chi tiết. Không đoán.
 * - `blocked`: không còn đơn vị nào bán được — nút tắt.
 */
export type CardAddMode = "direct" | "sheet" | "blocked"

export function cardAddMode(item: WaiterMenuItem): CardAddMode {
  const sellable = sellableVariants(item)
  if (sellable.length === 0) return "blocked"
  return sellable.length === 1 ? "direct" : "sheet"
}

/**
 * Dòng giỏ mà "−" / "+" trên thẻ điều khiển.
 *
 * Chỉ dòng KHÔNG ghi chú. Một dòng "ít đá" là một yêu cầu riêng của khách;
 * nút "−" trên thẻ mà bớt mất nó sẽ xoá một lời nhắn mà không ai thấy. Muốn
 * sửa dòng có ghi chú thì vào giỏ.
 */
export function cardCartLine(cart: Cart, item: WaiterMenuItem): CartLine | null {
  const variant = defaultVariant(item)
  if (variant === null) return null
  return cart.lines.find((line) => line.variantId === variant.variantId && line.note === "") ?? null
}

/** Tổng số phần của món này trong giỏ, mọi biến thể và mọi ghi chú. */
export function cardCartQuantity(cart: Cart, item: WaiterMenuItem): number {
  const ids = new Set(item.variants.map((variant) => variant.variantId))
  return cart.lines.reduce((total, line) => (ids.has(line.variantId) ? total + line.quantity : total), 0)
}

/**
 * Dòng giá trên thẻ: "280.000đ · Ly", hoặc "280.000đ – 2.300.000đ" khi món có
 * nhiều đơn vị.
 *
 * Món nhiều đơn vị hiện KHOẢNG giá chứ không hiện giá rẻ nhất kèm tên đơn vị:
 * một con số đơn lẻ trông như giá của món, và nhân viên sẽ đọc nó cho khách
 * nghe trước khi biết khách muốn chai.
 *
 * Món HẾT HÀNG vẫn hiện giá. Khách vẫn hỏi "chai đó bao nhiêu?" và câu trả lời
 * đúng là "1.400.000đ, nhưng hết rồi" — nhãn "Tạm hết" cạnh tên món đã nói
 * phần sau, nên dòng giá không cần nói lại và không nên giấu con số đi.
 *
 * Giá 0 hoặc vượt trần tiền thì KHÔNG hiện: nó không phải một con số đọc được
 * cho khách, và hiện nó ra là mời người ta đọc nhầm.
 */
export function cardPriceLabel(item: WaiterMenuItem, format: (amountVnd: number) => string): string {
  const sellable = sellableVariants(item)
  const quotable = sellable.length > 0 ? sellable : item.variants.filter((v) => isOrderableAmount(v.amountVnd))
  if (quotable.length === 0) return "Chưa có giá"
  if (quotable.length === 1) {
    const only = quotable[0]
    return `${format(only.amountVnd)} · ${only.displayName}`
  }
  const amounts = quotable.map((variant) => variant.amountVnd)
  return `${format(Math.min(...amounts))} – ${format(Math.max(...amounts))}`
}

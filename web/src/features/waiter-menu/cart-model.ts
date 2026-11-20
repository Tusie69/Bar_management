/**
 * Module Phục vụ 3 — giỏ gọi món, viết thành hàm thuần.
 *
 * Mọi luật của giỏ (gộp dòng, tăng giảm số lượng, tổng tiền, payload gửi lên,
 * giữ giỏ khi lỗi) nằm ở đây và test được mà không cần DOM. Component chỉ render
 * và gọi — cùng quy ước mà `waiter-rearrange.ts` đang dùng.
 *
 * Ba điều quan trọng:
 *
 * 1. **Định danh dòng là `cartLineId`, không phải `variantId`.** Một bàn gọi
 *    "hai ly Macallan, một ly không đá" là hai dòng cùng biến thể. Nếu sửa và
 *    xóa đi theo `variantId` thì chạm vào dòng nào cũng sửa cả hai, và lời nhắn
 *    của dòng kia biến mất trên đường tới Bar.
 * 2. **Không tự sửa giá.** Khi máy chủ nói giá đã đổi, `applyPriceChanges` chỉ
 *    chạy SAU khi nhân viên bấm xác nhận. Một giỏ tự cập nhật giá nghĩa là khách
 *    nghe một giá và trả một giá khác.
 * 3. **Không tự xóa mình.** Giỏ chỉ trống khi máy chủ trả về đơn; mọi lỗi đều
 *    giữ nguyên giỏ, vì gõ lại mười món bên cạnh bàn khách là việc không ai muốn
 *    làm hai lần.
 */
import type { MenuAvailability, MenuUnitCode, WaiterMenuItem, WaiterMenuVariant } from "./menu-model"
import { normalizeMenuSearch } from "./menu-model"

/** Khớp giới hạn của máy chủ (`order.repository.ts`). Lệch nhau thì UI hứa điều server từ chối. */
export const MAX_CART_LINES = 50
export const MAX_LINE_QUANTITY = 99
export const MAX_LINE_NOTE_LENGTH = 200

/**
 * Trần tiền, khớp `ck_sales_order_lines_price` và `ck_sales_orders_total`.
 *
 * Tiền đi qua JSON dưới dạng `number`, và JavaScript chỉ chính xác tới 9,007e15.
 * Ba trần nhân với nhau (50 × 99 × 1e9 = 4,95e12) vẫn nằm trong khoảng đó, nên
 * mọi tổng hiện trên màn hình đúng tới từng đồng. Một con số vượt khoảng sẽ bị
 * làm tròn âm thầm: màn hình hiện một tổng, hoá đơn in một tổng khác.
 */
export const MAX_UNIT_PRICE_VND = 1_000_000_000
export const MAX_ORDER_TOTAL_VND = MAX_CART_LINES * MAX_LINE_QUANTITY * MAX_UNIT_PRICE_VND

export interface CartLine {
  /** Định danh dòng trong giỏ. Mọi thao tác sửa/xóa đi theo giá trị này. */
  cartLineId: string
  variantId: number
  itemId: number
  itemName: string
  variantDisplayName: string
  unitCode: MenuUnitCode
  preparationStation: "BAR" | "KITCHEN"
  /** Giá mà nhân viên ĐANG NHÌN THẤY. Máy chủ vẫn tra lại `priceId`/`priceVersion`. */
  amountVnd: number
  priceId: number
  priceVersion: number
  quantity: number
  note: string
}

export interface Cart {
  visitId: number
  lines: CartLine[]
  /**
   * Mã chống trùng của NỘI DUNG giỏ hiện tại.
   *
   * Nó đổi mỗi lần giỏ đổi, và chỉ khi đó. Hệ quả là hai thứ cùng đúng: bấm
   * gửi hai lần trên cùng một giỏ thì máy chủ trả lại đúng đơn cũ (cùng mã,
   * cùng payload), còn sửa giỏ rồi gửi lại thì đó là một đơn mới (mã mới) chứ
   * không phải một lần dùng lại mã với payload khác — máy chủ từ chối việc đó.
   */
  submitKey: string
}

export interface CartLinePayload {
  variantId: number
  priceId: number
  priceVersion: number
  quantity: number
  note?: string
}

export interface CartPayload {
  visitId: number
  idempotencyKey: string
  lines: CartLinePayload[]
}

export interface MenuPriceChange {
  variantId: number
  itemName: string
  variantDisplayName: string
  submittedPriceId: number
  submittedPriceVersion: number
  currentPriceId: number
  currentPriceVersion: number
  currentAmountVnd: number
}

export interface MenuUnavailableVariant {
  variantId: number
  itemName: string
  variantDisplayName: string
  reason: "TEMPORARILY_UNAVAILABLE" | "NOT_SELLABLE" | "NOT_IN_CATALOG"
}

export function emptyCart(visitId: number, submitKey: string): Cart {
  return { visitId, lines: [], submitKey }
}

function clampQuantity(value: number): number {
  if (!Number.isSafeInteger(value)) return 1
  return Math.min(Math.max(value, 1), MAX_LINE_QUANTITY)
}

/**
 * Ghi chú như nó được LƯU và GỬI.
 *
 * Gộp khoảng trắng bên trong, không chỉ cắt hai đầu: "ít  đá" và "ít đá" là một
 * lời nhắn, và nếu chúng khác nhau thì một cú chạm phím space sẽ thành hai dòng
 * riêng trên phiếu của Bar.
 */
export function normalizeNote(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_LINE_NOTE_LENGTH)
}

/**
 * Khóa nhận dạng một CUSTOMIZE: biến thể cộng ghi chú đã chuẩn hoá.
 *
 * Chuẩn hoá bỏ dấu và hạ chữ thường, nên "Ít Đá" và "it da" là một customize.
 * Chỉ dùng để SO SÁNH; nội dung lưu vẫn là nguyên văn nhân viên gõ. Máy chủ
 * dùng đúng luật này (`order.route.ts` → `customizationKey`), nên giỏ không bao
 * giờ gửi lên một cặp mà máy chủ coi là trùng.
 */
export function customizationKey(line: { variantId: number; note: string }): string {
  return `${line.variantId}\u0000${normalizeMenuSearch(normalizeNote(line.note))}`
}

/** Giá dùng được cho một dòng đơn: số nguyên dương, trong trần tiền. */
export function isOrderableAmount(amountVnd: number): boolean {
  return Number.isSafeInteger(amountVnd) && amountVnd > 0 && amountVnd <= MAX_UNIT_PRICE_VND
}

export function cartIsFull(cart: Cart): boolean {
  return cart.lines.length >= MAX_CART_LINES
}

export interface AddToCartInput {
  item: WaiterMenuItem
  variant: WaiterMenuVariant
  quantity: number
  note?: string
}

/**
 * Thêm một biến thể vào giỏ.
 *
 * Gộp số lượng CHỈ KHI cùng biến thể và cùng ghi chú đã chuẩn hoá. Khác ghi chú
 * là một dòng mới: đó là hai customize, và Bar phải nhận đủ hai.
 *
 * Giá không dùng được (không phải số nguyên, bằng 0, hoặc vượt trần) thì không
 * vào giỏ: thà không thêm được còn hơn thêm một dòng mà tổng tiền của nó là một
 * con số đã bị làm tròn.
 */
export function addToCart(cart: Cart, input: AddToCartInput, submitKey: string, lineId: string): Cart {
  if (!isOrderableAmount(input.variant.amountVnd)) return cart
  const quantity = clampQuantity(input.quantity)
  const note = normalizeNote(input.note ?? "")
  const key = customizationKey({ variantId: input.variant.variantId, note })
  const existing = cart.lines.find((line) => customizationKey(line) === key)
  if (existing) {
    return {
      ...cart,
      submitKey,
      lines: cart.lines.map((line) =>
        line.cartLineId === existing.cartLineId
          ? {
              ...line,
              quantity: clampQuantity(line.quantity + quantity),
              // Giá mới nhất mà màn hình vừa đọc được: dòng giỏ phải mang đúng
              // `priceId` đã hiện cho nhân viên, không phải cái của lần mở trước.
              amountVnd: input.variant.amountVnd,
              priceId: input.variant.priceId,
              priceVersion: input.variant.priceVersion,
            }
          : line,
      ),
    }
  }
  if (cartIsFull(cart)) return cart
  return {
    ...cart,
    submitKey,
    lines: [
      ...cart.lines,
      {
        cartLineId: lineId,
        variantId: input.variant.variantId,
        itemId: input.item.id,
        itemName: input.item.name,
        variantDisplayName: input.variant.displayName,
        unitCode: input.variant.unitCode,
        preparationStation: input.item.preparationStation,
        amountVnd: input.variant.amountVnd,
        priceId: input.variant.priceId,
        priceVersion: input.variant.priceVersion,
        quantity,
        note,
      },
    ],
  }
}

/** Số lượng về 0 nghĩa là bỏ dòng: nút trừ cuối cùng là nút xóa, không phải một dòng "0 ly". */
export function setLineQuantity(cart: Cart, cartLineId: string, quantity: number, submitKey: string): Cart {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return removeLine(cart, cartLineId, submitKey)
  if (!cart.lines.some((line) => line.cartLineId === cartLineId)) return cart
  return {
    ...cart,
    submitKey,
    lines: cart.lines.map((line) =>
      line.cartLineId === cartLineId ? { ...line, quantity: clampQuantity(quantity) } : line,
    ),
  }
}

/**
 * Sửa ghi chú của một dòng.
 *
 * Nếu ghi chú mới làm dòng này trùng customize với một dòng khác, hai dòng được
 * GỘP lại. Không gộp thì payload mang một cặp trùng khít và máy chủ từ chối cả
 * đơn — vì một lần sửa ghi chú.
 */
export function setLineNote(cart: Cart, cartLineId: string, note: string, submitKey: string): Cart {
  const target = cart.lines.find((line) => line.cartLineId === cartLineId)
  if (!target) return cart
  const updated: CartLine = { ...target, note: normalizeNote(note) }
  const key = customizationKey(updated)
  const twin = cart.lines.find((line) => line.cartLineId !== cartLineId && customizationKey(line) === key)
  if (!twin) {
    return {
      ...cart,
      submitKey,
      lines: cart.lines.map((line) => (line.cartLineId === cartLineId ? updated : line)),
    }
  }
  return {
    ...cart,
    submitKey,
    lines: cart.lines
      .filter((line) => line.cartLineId !== cartLineId)
      .map((line) =>
        line.cartLineId === twin.cartLineId
          ? { ...line, quantity: clampQuantity(line.quantity + updated.quantity) }
          : line,
      ),
  }
}

export function removeLine(cart: Cart, cartLineId: string, submitKey: string): Cart {
  const lines = cart.lines.filter((line) => line.cartLineId !== cartLineId)
  if (lines.length === cart.lines.length) return cart
  return { ...cart, submitKey, lines }
}

export function cartItemCount(cart: Cart): number {
  return cart.lines.reduce((total, line) => total + line.quantity, 0)
}

export function cartTotalVnd(cart: Cart): number {
  return cart.lines.reduce((total, line) => total + line.amountVnd * line.quantity, 0)
}

/**
 * Giỏ có tổng tiền vượt trần, hoặc có dòng mang giá không dùng được.
 *
 * Màn hình khóa nút gửi khi điều này đúng. Gửi lên thì máy chủ cũng từ chối
 * (`ORDER_TOTAL_OUT_OF_RANGE`), nhưng nói trước thì nhân viên không phải đợi
 * một vòng mạng để biết.
 */
export function cartExceedsMoneyLimit(cart: Cart): boolean {
  if (cart.lines.some((line) => !isOrderableAmount(line.amountVnd))) return true
  const total = cartTotalVnd(cart)
  return !Number.isSafeInteger(total) || total > MAX_ORDER_TOTAL_VND
}

export function cartStations(cart: Cart): ("BAR" | "KITCHEN")[] {
  const stations = new Set(cart.lines.map((line) => line.preparationStation))
  return (["BAR", "KITCHEN"] as const).filter((station) => stations.has(station))
}

/**
 * Đúng bảy trường mà hợp đồng cho phép client gửi.
 *
 * Không có `amountVnd`, không có tên món, không có quầy chế biến, và KHÔNG có
 * `cartLineId`: định danh dòng là chuyện riêng của giỏ trên máy Phục vụ. Máy chủ
 * đánh số dòng theo thứ tự nhận được.
 */
export function cartPayload(cart: Cart): CartPayload {
  return {
    visitId: cart.visitId,
    idempotencyKey: cart.submitKey,
    lines: cart.lines.map((line) => ({
      variantId: line.variantId,
      priceId: line.priceId,
      priceVersion: line.priceVersion,
      quantity: line.quantity,
      ...(line.note ? { note: line.note } : {}),
    })),
  }
}

export interface PriceChangeView extends MenuPriceChange {
  /** Giá mà nhân viên đã đọc cho khách, lấy từ dòng giỏ chứ không từ máy chủ. */
  previousAmountVnd: number
}

/**
 * Ghép giá cũ (trong giỏ) với giá mới (từ máy chủ) để hiện "cũ → mới".
 *
 * Máy chủ không gửi lại giá cũ — nó chỉ biết `priceId` mà client đã gửi. Giá mà
 * khách đã nghe nằm trong giỏ, nên nó phải được đọc từ đó.
 */
export function describePriceChanges(cart: Cart, changes: readonly MenuPriceChange[]): PriceChangeView[] {
  return changes.map((change) => {
    const line = cart.lines.find((candidate) => candidate.variantId === change.variantId)
    return { ...change, previousAmountVnd: line?.amountVnd ?? change.currentAmountVnd }
  })
}

/**
 * Chỉ chạy sau khi nhân viên bấm xác nhận giá mới.
 *
 * Giá đi theo BIẾN THỂ, nên mọi dòng của biến thể đó đổi giá cùng lúc — kể cả
 * hai dòng khác ghi chú. Một biến thể có đúng một giá hiện hành.
 */
export function applyPriceChanges(cart: Cart, changes: readonly MenuPriceChange[], submitKey: string): Cart {
  const byVariant = new Map(changes.map((change) => [change.variantId, change]))
  if (!cart.lines.some((line) => byVariant.has(line.variantId))) return cart
  return {
    ...cart,
    submitKey,
    lines: cart.lines.map((line) => {
      const change = byVariant.get(line.variantId)
      if (!change) return line
      return {
        ...line,
        amountVnd: change.currentAmountVnd,
        priceId: change.currentPriceId,
        priceVersion: change.currentPriceVersion,
      }
    }),
  }
}

/** Món hết hàng thì bỏ MỌI dòng của biến thể đó, bất kể ghi chú. */
export function removeVariants(cart: Cart, variantIds: readonly number[], submitKey: string): Cart {
  const drop = new Set(variantIds)
  const lines = cart.lines.filter((line) => !drop.has(line.variantId))
  if (lines.length === cart.lines.length) return cart
  return { ...cart, submitKey, lines }
}

export interface ReconcileResult {
  cart: Cart
  /** Dòng đã bị bỏ vì món không còn bán được. Màn hình phải NÓI RA, không im lặng. */
  dropped: CartLine[]
}

/**
 * Soi giỏ đã lưu với danh mục vừa tải.
 *
 * Bỏ dòng mà món/biến thể không còn trong danh mục, đang tạm hết, hoặc có giá
 * không dùng được — gửi chúng lên chỉ để nhận lỗi. Nhưng KHÔNG sửa giá: giá lệch
 * là việc máy chủ phải phát hiện và nhân viên phải xác nhận, không phải việc giỏ
 * tự xử.
 */
export function reconcileCart(cart: Cart, items: readonly WaiterMenuItem[], submitKey: string): ReconcileResult {
  const available = new Map<number, { availabilityStatus: MenuAvailability; amountVnd: number }>()
  for (const item of items) {
    for (const variant of item.variants) available.set(variant.variantId, variant)
  }
  const dropped = cart.lines.filter((line) => {
    const variant = available.get(line.variantId)
    return !variant || variant.availabilityStatus !== "AVAILABLE" || !isOrderableAmount(line.amountVnd)
  })
  if (dropped.length === 0) return { cart, dropped }
  const remove = new Set(dropped.map((line) => line.cartLineId))
  return {
    cart: { ...cart, submitKey, lines: cart.lines.filter((line) => !remove.has(line.cartLineId)) },
    dropped,
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function parseLine(value: unknown, fallbackLineId: string): CartLine | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (
    !isPositiveInteger(raw.variantId) ||
    !isPositiveInteger(raw.itemId) ||
    !isPositiveInteger(raw.priceId) ||
    !isPositiveInteger(raw.priceVersion) ||
    !isPositiveInteger(raw.quantity) ||
    typeof raw.amountVnd !== "number" ||
    !isOrderableAmount(raw.amountVnd) ||
    typeof raw.itemName !== "string" ||
    typeof raw.variantDisplayName !== "string" ||
    typeof raw.unitCode !== "string" ||
    (raw.preparationStation !== "BAR" && raw.preparationStation !== "KITCHEN")
  ) {
    return null
  }
  return {
    cartLineId: typeof raw.cartLineId === "string" && raw.cartLineId ? raw.cartLineId : fallbackLineId,
    variantId: raw.variantId,
    itemId: raw.itemId,
    itemName: raw.itemName,
    variantDisplayName: raw.variantDisplayName,
    unitCode: raw.unitCode as MenuUnitCode,
    preparationStation: raw.preparationStation,
    amountVnd: raw.amountVnd,
    priceId: raw.priceId,
    priceVersion: raw.priceVersion,
    quantity: clampQuantity(raw.quantity),
    note: typeof raw.note === "string" ? normalizeNote(raw.note) : "",
  }
}

/**
 * Đọc nháp đã lưu.
 *
 * Nháp là dữ liệu nằm ngoài tầm kiểm soát của app (người dùng sửa được, phiên
 * bản cũ ghi được), nên mỗi trường được kiểm lại. Một nháp sai hình dạng trả
 * `null` — giỏ trống là trạng thái sửa được; một dòng rác thì sẽ đi tới tận máy
 * chủ rồi mới sập.
 *
 * Hai dòng trùng customize bị gộp về một, và dòng thiếu `cartLineId` (nháp của
 * bản trước) được cấp một id dẫn xuất từ vị trí — duy nhất trong giỏ vừa đọc.
 */
export function parseCart(value: unknown, visitId: number, submitKey: string): Cart | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (raw.visitId !== visitId) return null
  if (!Array.isArray(raw.lines)) return null
  const lines: CartLine[] = []
  const seenCustomization = new Set<string>()
  const seenLineId = new Set<string>()
  for (const [index, candidate] of raw.lines.slice(0, MAX_CART_LINES).entries()) {
    const line = parseLine(candidate, `draft-${index + 1}`)
    if (!line) continue
    const key = customizationKey(line)
    if (seenCustomization.has(key) || seenLineId.has(line.cartLineId)) continue
    seenCustomization.add(key)
    seenLineId.add(line.cartLineId)
    lines.push(line)
  }
  if (lines.length === 0) return null
  return {
    visitId,
    lines,
    // Nháp mang theo mã cũ chỉ khi nó vẫn còn dạng hợp lệ; nếu không, một mã
    // mới an toàn hơn một mã có thể đã dùng cho một payload khác.
    submitKey:
      typeof raw.submitKey === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw.submitKey) ? raw.submitKey : submitKey,
  }
}

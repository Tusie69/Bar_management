import type { MenuUnitCode } from '../menu/menu.model.js'

export type PreparationStation = 'BAR' | 'KITCHEN'

/**
 * Những gì máy Phục vụ được phép gửi cho MỘT dòng giỏ.
 *
 * Cố ý KHÔNG có `amountVnd`, `itemName`, `unitCode` hay `preparationStation`:
 * client gửi giá thì client quyết định giá. `priceId` + `priceVersion` là cái
 * mà client đã NHÌN THẤY, và server tra lại chúng để biết giá có đổi giữa lúc
 * mở menu và lúc bấm gửi hay không.
 */
export interface WaiterOrderLineInput {
  variantId: number
  priceId: number
  priceVersion: number
  quantity: number
  note?: string
}

export interface WaiterOrderInput {
  visitId: number
  lines: WaiterOrderLineInput[]
  /** Mã chống trùng của lần bấm "Gửi đơn"; bắt buộc. */
  idempotencyKey: string
}

export interface WaiterOrderLine {
  lineNo: number
  menuItemId: number
  variantId: number
  itemCode: string
  itemName: string
  variantDisplayName: string
  unitCode: MenuUnitCode
  preparationStation: PreparationStation
  unitPriceVnd: number
  priceId: number
  priceVersion: number
  quantity: number
  lineTotalVnd: number
  note: string | null

  // ----------------------------------------------------------- Module 5 ----

  /** Phiên bản dòng, dùng cho API sửa số lượng. Lệch nghĩa là máy khác vừa sửa. */
  lineVersion: number
  /** Số món đã bị hủy sau khi được phê duyệt. Dòng gốc không bao giờ bị xoá. */
  cancelledQuantity: number
  /** `quantity - cancelledQuantity`: phần Bar/Bếp còn phải làm và khách còn phải trả. */
  netQuantity: number
  netTotalVnd: number
  /**
   * Trạng thái chế biến của dòng = trạng thái phiếu CỦA QUẦY mang dòng đó.
   *
   * Module 4 nhận việc theo phiếu (một phiếu cho mỗi quầy của một đơn), không
   * theo từng dòng, nên đây là mức chi tiết thật sự có. Nói "dòng này đã
   * ACCEPTED" khi chỉ có phiếu được nhận sẽ là một lời hứa mà dữ liệu không đỡ.
   */
  preparationStatus: PreparationStatus | null
  /** Sửa số lượng chỉ mở khi phiếu còn SUBMITTED và không có yêu cầu hủy đang chờ. */
  canAdjustQuantity: boolean
  /** Yêu cầu hủy đang chờ phê duyệt của dòng này, nếu có. */
  pendingCancellation: PendingCancellationView | null
}

export type PreparationStatus = 'SUBMITTED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COLLECTED'
export type CancellationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type CancellationPolicy = 'STANDARD' | 'READY_WASTE'

export interface PendingCancellationView {
  cancellationId: number
  quantity: number
  reason: string
  policy: CancellationPolicy
  version: number
  requestedByUserId: number
  requestedByDisplayName: string
  requestedAt: string
}

export interface PreparationTicketView {
  ticketId: number
  station: PreparationStation
  status: PreparationStatus
  lineCount: number
  itemCount: number
  /** Module 5: phần đã hủy của phiếu. Hàng đợi đọc `itemCount - cancelledItemCount`. */
  cancelledItemCount: number
}

export interface WaiterOrderSummary {
  orderId: number
  visitId: number
  visitSequence: number
  status: 'SUBMITTED'
  submittedAt: string
  orderedByUserId: number
  orderedByDisplayName: string
  lineCount: number
  itemCount: number
  totalAmountVnd: number
  /** Phần đã hủy (được phê duyệt). `totalAmountVnd` vẫn là tổng lúc gửi đơn. */
  cancelledItemCount: number
  cancelledAmountVnd: number
  /** `totalAmountVnd - cancelledAmountVnd`: số khách còn phải trả cho đơn này. */
  netAmountVnd: number
  stations: PreparationStation[]
}

export interface WaiterOrderDetail extends WaiterOrderSummary {
  businessDate: string
  lines: WaiterOrderLine[]
  tickets: PreparationTicketView[]
}

export interface WaiterOrderListView {
  visitId: number
  tableCodes: string[]
  orderCount: number
  totalAmountVnd: number
  cancelledAmountVnd: number
  netAmountVnd: number
  orders: WaiterOrderSummary[]
}

/**
 * Chi tiết trả về cùng `MENU_PRICE_CHANGED`. UI dùng nó để hỏi lại nhân viên
 * bằng số cụ thể ("380.000đ → 420.000đ") thay vì một câu "giá đã đổi".
 *
 * Server KHÔNG tự đổi giá và không tạo đơn: nó chỉ nói giá mới là bao nhiêu.
 */
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
  reason: 'TEMPORARILY_UNAVAILABLE' | 'NOT_SELLABLE' | 'NOT_IN_CATALOG'
}

/**
 * MỘT lỗi cho cả giỏ, mang cả hai loại vấn đề.
 *
 * Trước đây món hết hàng được báo trước, giá đổi báo sau, nên một giỏ vừa có
 * món hết vừa có giá đổi bắt nhân viên bấm gửi hai lần mới biết hết chuyện —
 * cạnh bàn khách, giữa ca. Cả hai mảng luôn có mặt trong `details`, mảng rỗng
 * nghĩa là loại đó không có vấn đề.
 */
export interface OrderRejectionDetails {
  variants: MenuUnavailableVariant[]
  changes: MenuPriceChange[]
}

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
  /**
   * L5 — lần từ chối GẦN NHẤT của dòng này, và chỉ khi nó còn là trạng thái
   * hiện hành.
   *
   * Trước đây API chỉ join yêu cầu `PENDING`, nên khi Thu ngân từ chối, yêu cầu
   * biến mất khỏi màn Phục vụ mà không để lại dấu vết nào: người gửi không biết
   * mình bị từ chối hay hệ thống mất yêu cầu, và thường bấm xin hủy lại.
   *
   * `null` khi dòng chưa từng bị từ chối, HOẶC khi đã có một yêu cầu mới hơn
   * sau lần từ chối đó (một `PENDING` đang chờ, hoặc một lần `APPROVED`). Lý do:
   * đây là "trạng thái hiện hành", không phải "lịch sử". Dán một cảnh báo đỏ của
   * lần từ chối cũ lên một dòng đang có yêu cầu mới chờ duyệt sẽ nói sai chuyện
   * đang xảy ra. Lịch sử đầy đủ vẫn nằm trong `sales_order_cancellations` và
   * `sales_order_line_changes`; không dòng nào bị xoá.
   */
  lastRejection: LineRejectionView | null
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

/**
 * L5 — một lần từ chối yêu cầu hủy, nhìn từ phía dòng món.
 *
 * `rejectedByUserId` và `rejectedAt` không thể null: `ck_sales_order_cancellations_decision`
 * của migration 0040 bắt buộc mọi dòng khác `PENDING` phải có người quyết định
 * và thời điểm. `decisionNote` thì có thể trống — người duyệt không buộc phải
 * giải thích, và một chuỗi rỗng bịa ra sẽ khó phân biệt với "họ đã viết gì đó".
 */
export interface LineRejectionView {
  cancellationId: number
  /** Số lượng mà yêu cầu bị từ chối đã xin hủy. */
  quantity: number
  /** Lý do Phục vụ đã ghi khi xin hủy. */
  reason: string
  rejectedByUserId: number
  rejectedByDisplayName: string
  rejectedAt: string
  decisionNote: string | null
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

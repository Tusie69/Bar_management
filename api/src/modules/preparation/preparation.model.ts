import type { MenuUnitCode } from '../menu/menu.model.js'

export type PreparationStation = 'BAR' | 'KITCHEN'
export type PreparationStatus = 'SUBMITTED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COLLECTED'

export interface PreparationLineView {
  lineNo: number
  itemName: string
  variantDisplayName: string
  menuItemVariantId: number
  unitCode: MenuUnitCode
  /**
   * L2 — số món Bar/Bếp CÒN PHẢI LÀM: `originalQuantity - cancelledQuantity`.
   *
   * Trường này trước đây là số lượng lúc khách gọi, nên sau khi Thu ngân duyệt
   * hủy một phần, phiếu vẫn ghi "2× KHAY THỊT MUỐI" trong khi khách chỉ còn trả
   * một khay — và Bếp làm hai. Nó là con số duy nhất mà quầy hành động theo,
   * nên nó phải là số còn lại; hai trường dưới đây giữ phần đối chiếu.
   *
   * Không bao giờ âm: `ck_sales_order_lines_cancelled` giữ
   * `cancelled_quantity <= quantity`, và cột sinh `net_quantity` của migration
   * 0040 là UNSIGNED. Giá trị `0` nghĩa là dòng đã bị hủy TOÀN BỘ và quầy không
   * làm gì cả — khác hẳn với "chưa biết", nên dòng vẫn được trả về chứ không bị
   * lọc khỏi phiếu.
   */
  quantity: number
  /** Số đã bị hủy sau khi có người phê duyệt. Dòng gốc không bao giờ bị xoá. */
  cancelledQuantity: number
  /** Số lúc khách gọi. Giữ lại để quầy đối chiếu "đã hủy n trên tổng m". */
  originalQuantity: number
  /** Số phần đã làm xong trên số lượng còn hiệu lực của dòng. */
  doneQuantity: number
  /** Version riêng cho thao tác tiến độ đa thiết bị. */
  progressVersion: number
  note: string | null
  pendingCancellation: {
    cancellationId: number
    quantity: number
    groupId: number | null
  } | null
}

export interface PreparationTicketView {
  ticketId: number
  orderId: number
  visitId: number
  visitSequence: number
  station: PreparationStation
  status: PreparationStatus
  version: number
  submittedAt: string
  acceptedAt: string | null
  startedAt: string | null
  readyAt: string | null
  collectedAt: string | null
  waitSeconds: number
  tableCodes: string[]
  orderedByDisplayName: string
  guestFlags: {
    vip: boolean
    birthday: boolean
    designated: boolean
  }
  lines: PreparationLineView[]
}

export interface PreparationQueueSnapshot {
  station: PreparationStation
  changeCursor: string
  generatedAt: string
  printing: { enabled: boolean }
  limit: number
  tickets: PreparationTicketView[]
}

export type ReadyAudience = 'ORDERED_BY_USER' | 'CASHIER_ROLE'

export interface ReadyNotificationView {
  eventId: number
  ticketId: number
  visitId: number
  orderedByUserId: number
  station: PreparationStation
  audience: ReadyAudience
  createdAt: string
  acknowledgedAt: string | null
  /** Số đơn trong phiên ("Đơn 1"), để Phục vụ đọc được tin mà không phải mở ra. */
  visitSequence: number | null
  /** Bàn đang giữ phiên, ví dụ ["A3"]. Rỗng khi phiên đã trả bàn. */
  tableCodes: string[]
  /** Số món của phiếu này (đã trừ phần bị hủy). */
  itemCount: number
}

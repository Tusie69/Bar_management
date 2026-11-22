/**
 * Module Phục vụ 3 — ba lệnh gọi API của giỏ gọi món.
 *
 * Giống `waiter-menu-api.ts`: chế độ mock của prototype KHÔNG giả lập việc gửi
 * đơn. Nó trả 501 với câu nói rõ lý do, vì một đơn "đã gửi" trong bản demo là
 * một đơn không có ở Bar, và người xem demo sẽ tin rằng luồng này đã chạy. Mock
 * tuân cùng hợp đồng bằng cách từ chối, không bằng cách giả thành công.
 */
import { ApiError, httpClient } from "@/services"
import type { CartPayload } from "./cart-model"

export type PreparationStation = "BAR" | "KITCHEN"

export type PreparationStatus = "SUBMITTED" | "ACCEPTED" | "PREPARING" | "READY" | "COLLECTED"
export type CancellationStatus = "PENDING" | "APPROVED" | "REJECTED"
export type CancellationPolicy = "STANDARD" | "READY_WASTE"

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
 * L5 — lần từ chối gần nhất của một dòng món, khi nó còn là trạng thái hiện
 * hành. Giai đoạn 3 dựng cảnh báo đỏ từ đây; hợp đồng có trước để màn hình
 * không phải đoán hình dạng dữ liệu.
 */
export interface LineRejectionView {
  cancellationId: number
  quantity: number
  reason: string
  rejectedByUserId: number
  rejectedByDisplayName: string
  rejectedAt: string
  /** Người duyệt không buộc phải giải thích, nên có thể `null`. */
  decisionNote: string | null
}

export interface WaiterOrderLine {
  lineNo: number
  menuItemId: number
  variantId: number
  itemCode: string
  itemName: string
  variantDisplayName: string
  unitCode: string
  preparationStation: PreparationStation
  unitPriceVnd: number
  priceId: number
  priceVersion: number
  quantity: number
  lineTotalVnd: number
  note: string | null
  lineVersion: number
  cancelledQuantity: number
  netQuantity: number
  netTotalVnd: number
  preparationStatus: PreparationStatus | null
  canAdjustQuantity: boolean
  pendingCancellation: PendingCancellationView | null
  /**
   * `null` khi dòng chưa từng bị từ chối, hoặc khi sau lần từ chối đó đã có một
   * yêu cầu mới hơn (`pendingCancellation` đang chờ, hoặc đã được duyệt).
   */
  lastRejection: LineRejectionView | null
}

export interface PreparationTicketView {
  ticketId: number
  station: PreparationStation
  status: PreparationStatus
  lineCount: number
  itemCount: number
  cancelledItemCount: number
}

export interface WaiterOrderSummary {
  orderId: number
  visitId: number
  visitSequence: number
  status: "SUBMITTED"
  submittedAt: string
  orderedByUserId: number
  orderedByDisplayName: string
  lineCount: number
  itemCount: number
  totalAmountVnd: number
  cancelledItemCount: number
  cancelledAmountVnd: number
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

export interface CancellationQueueEntry {
  cancellationId: number
  /**
   * Mã nhóm của một lần "Hủy đơn?"; `null` khi đây là yêu cầu lẻ của một món.
   * Hàng chờ gom các dòng cùng `groupId` vào MỘT thẻ và quyết định một lần.
   */
  groupId: number | null
  status: CancellationStatus
  policy: CancellationPolicy
  version: number
  visitId: number
  tableCodes: string[]
  orderId: number
  visitSequence: number
  lineNo: number
  itemName: string
  variantDisplayName: string
  station: PreparationStation
  ticketStatusAtRequest: PreparationStatus
  quantity: number
  unitPriceVnd: number
  amountVnd: number
  reason: string
  requestedByUserId: number
  requestedByDisplayName: string
  requestedAt: string
  decidedByUserId: number | null
  decidedByDisplayName: string | null
  decidedAt: string | null
  decisionNote: string | null
}

export interface CancellationQueueView {
  status: CancellationStatus
  pendingCount: number
  entries: CancellationQueueEntry[]
}

export interface ReadyNotification {
  eventId: number
  ticketId: number
  visitId: number
  orderedByUserId: number
  station: PreparationStation
  audience: "ORDERED_BY_USER" | "CASHIER_ROLE"
  createdAt: string
  acknowledgedAt: string | null
  /** Số đơn trong phiên ("Đơn 1"); null khi phiếu không còn gắn với đơn nào. */
  visitSequence?: number | null
  /** Bàn đang giữ phiên, ví dụ ["A3"]. */
  tableCodes?: string[]
  /** Số món của phiếu, đã trừ phần bị hủy. */
  itemCount?: number
}

function requireHttp(): NonNullable<typeof httpClient> {
  if (!httpClient) {
    throw new ApiError(
      501,
      "ORDER_REQUIRES_HTTP",
      "Gửi đơn cần kết nối API thật: bản demo không tạo đơn và không gửi gì tới Bar/Bếp.",
    )
  }
  return httpClient
}

/**
 * Gửi đơn.
 *
 * `idempotencyKey` nằm trong body (hợp đồng của endpoint). Nó cũng được gắn vào
 * header `Idempotency-Key` để lớp HTTP chung và máy chủ nhìn thấy cùng một mã;
 * máy chủ từ chối nếu hai chỗ lệch nhau.
 */
export async function submitWaiterOrder(payload: CartPayload): Promise<WaiterOrderDetail> {
  const response = await requireHttp().post<{ order: WaiterOrderDetail }>("/waiter/orders", payload, {
    idempotencyKey: payload.idempotencyKey,
  })
  return response.order
}

export async function fetchVisitOrders(visitId: number): Promise<WaiterOrderListView> {
  return requireHttp().get<WaiterOrderListView>(`/waiter/visits/${visitId}/orders`)
}

export async function fetchWaiterOrder(orderId: number): Promise<WaiterOrderDetail> {
  const response = await requireHttp().get<{ order: WaiterOrderDetail }>(`/waiter/orders/${orderId}`)
  return response.order
}

/* ------------------------------- Module 5 ------------------------------- */

/**
 * Sửa số lượng một dòng món.
 *
 * `expectedLineVersion` là số màn hình đang nhìn thấy. Máy chủ từ chối nếu một
 * máy khác vừa sửa dòng đó, nên hai Phục vụ cùng mở một bàn không ghi đè nhau.
 */
export async function adjustOrderLineQuantity(
  orderId: number,
  lineNo: number,
  input: { expectedLineVersion: number; quantity: number; reason?: string; idempotencyKey: string },
): Promise<WaiterOrderDetail> {
  const response = await requireHttp().patch<{ order: WaiterOrderDetail }>(
    `/waiter/orders/${orderId}/lines/${lineNo}`,
    input,
    { idempotencyKey: input.idempotencyKey },
  )
  return response.order
}

/**
 * GỬI yêu cầu hủy món. Nó không hủy gì: quyết định thuộc người có quyền duyệt.
 *
 * `acknowledgeWaste` chỉ gửi khi món đã làm xong, và chỉ người có quyền ghi hao
 * mới đi được đường đó — máy chủ kiểm lại cả hai.
 */
export async function requestLineCancellation(
  orderId: number,
  lineNo: number,
  input: {
    expectedLineVersion: number
    quantity: number
    reason: string
    acknowledgeWaste?: boolean
    idempotencyKey: string
  },
): Promise<{ cancellationId: number; status: CancellationStatus; policy: CancellationPolicy; version: number }> {
  const response = await requireHttp().post<{
    cancellation: { cancellationId: number; status: CancellationStatus; policy: CancellationPolicy; version: number }
  }>(`/waiter/orders/${orderId}/lines/${lineNo}/cancellations`, input, { idempotencyKey: input.idempotencyKey })
  return response.cancellation
}

export async function fetchCancellationQueue(status: CancellationStatus = "PENDING"): Promise<CancellationQueueView> {
  return requireHttp().get<CancellationQueueView>(`/orders/cancellations?status=${status}`)
}

export async function decideCancellation(
  cancellationId: number,
  decision: "approve" | "reject",
  input: { expectedVersion: number; note?: string; idempotencyKey: string },
): Promise<{ cancellationId: number; status: CancellationStatus; version: number; order: WaiterOrderDetail }> {
  return requireHttp().post(`/orders/cancellations/${cancellationId}/${decision}`, input, {
    idempotencyKey: input.idempotencyKey,
  })
}

/**
 * Quyết định CẢ NHÓM "Hủy đơn?" bằng một lần bấm.
 *
 * Không gửi `expectedVersion`: một nhóm có nhiều dòng con, mỗi dòng một phiên
 * bản, và máy chủ khóa rồi quyết định chúng trong cùng một transaction.
 */
export async function decideCancellationGroup(
  groupId: number,
  decision: "approve" | "reject",
  input: { note?: string; idempotencyKey: string },
): Promise<{ groupId: number; status: CancellationStatus; decidedCount: number; order: WaiterOrderDetail }> {
  return requireHttp().post(`/orders/cancellations/groups/${groupId}/${decision}`, input, {
    idempotencyKey: input.idempotencyKey,
  })
}

/** Thông báo món đã xong của CHÍNH người đăng nhập (Module 4 lọc theo audience). */
export async function fetchReadyNotifications(): Promise<ReadyNotification[]> {
  const response = await requireHttp().get<{ notifications: ReadyNotification[] }>("/preparation/ready-notifications")
  return response.notifications
}

/**
 * Module Phục vụ 1 (v1.1) — báo rằng máy này đang mở màn Gọi món của Phiên.
 *
 * Mục đích duy nhất: để sơ đồ của những máy KHÁC tô bàn đó màu "Đang gọi món".
 * Vì vậy lỗi ở đây không bao giờ được chặn việc gọi món — một bàn sai màu là
 * phiền, một màn Gọi món không mở được vì cái dấu đó là hỏng việc. Cả hai hàm
 * nuốt lỗi và chỉ ghi log.
 */
export async function markVisitOrdering(visitId: number): Promise<void> {
  try {
    await requireHttp().put(`/waiter/visits/${visitId}/ordering`, {})
  } catch (error) {
    console.warn("Không báo được trạng thái đang gọi món", error)
  }
}

export async function clearVisitOrdering(visitId: number): Promise<void> {
  try {
    await requireHttp().delete(`/waiter/visits/${visitId}/ordering`)
  } catch (error) {
    console.warn("Không gỡ được trạng thái đang gọi món", error)
  }
}

/* ---------------------- Module Phục vụ 1 (v1.1) ------------------------- */

/** Một món đã gọi của Phiên, gộp qua mọi đơn. Xem api/.../order.model.ts. */
export interface WaiterVisitItem {
  variantId: number
  menuItemId: number
  itemName: string
  variantDisplayName: string
  unitCode: string
  preparationStation: PreparationStation
  note: string | null
  quantity: number
  unitPriceVnd: number
  totalVnd: number
  /** `null` khi món không còn bán được: nút "+" phải tắt kèm lý do. */
  reorder: { priceId: number; priceVersion: number; amountVnd: number } | null
}

export interface WaiterVisitItemsView {
  visitId: number
  tableCodes: string[]
  orderCount: number
  netAmountVnd: number
  items: WaiterVisitItem[]
}

export async function fetchVisitItems(visitId: number): Promise<WaiterVisitItemsView> {
  return requireHttp().get<WaiterVisitItemsView>(`/waiter/visits/${visitId}/items`)
}

/**
 * Module Phục vụ (v1.1) — "Hủy đơn?": xin hủy CẢ ĐƠN.
 *
 * Không hủy gì cả: nó gửi một yêu cầu tới Thu ngân / Admin Edit (chốt Q2 ngày
 * 21/11) và trả về số món, số tiền sẽ bị hủy để màn hình nói lại cho đúng.
 */
export interface OrderCancellationRequestResult {
  groupId: number
  orderId: number
  lineCount: number
  /** Số phần sẽ phải ghi hao nếu được duyệt. 0 nghĩa là chưa món nào làm xong. */
  wasteQuantity: number
  totalQuantity: number
  amountVnd: number
}

/** Món đã làm xong trong đơn; máy chủ trả kèm khi đòi xác nhận ghi hao. */
export interface OrderCancellationWasteLine {
  lineNo: number
  itemName: string
  variantDisplayName: string
  quantity?: number
}

export function readWasteLines(details: Record<string, unknown>): OrderCancellationWasteLine[] {
  const lines = details.wasteLines
  if (!Array.isArray(lines)) return []
  return lines.filter(
    (line): line is OrderCancellationWasteLine =>
      typeof line === "object" && line !== null && typeof (line as OrderCancellationWasteLine).lineNo === "number",
  )
}

export async function requestOrderCancellation(
  orderId: number,
  input: { reason: string; acknowledgeWaste?: boolean; idempotencyKey: string },
): Promise<OrderCancellationRequestResult> {
  const response = await requireHttp().post<{ cancellation: OrderCancellationRequestResult }>(
    `/waiter/orders/${orderId}/cancellations`,
    input,
    { idempotencyKey: input.idempotencyKey },
  )
  return response.cancellation
}

/* ------------------ Module Phục vụ (v1.1) — PV-20: hộp tin ---------------- */

export interface StaffNotification {
  notificationId: number
  kind: "CANCELLATION_DECIDED"
  visitId: number | null
  orderId: number | null
  cancellationGroupId: number | null
  cancellationId: number | null
  decision: "APPROVED" | "REJECTED" | null
  lineCount: number
  quantity: number
  /** Số phần bị ghi hao; 0 nghĩa là không món nào đã làm xong. */
  wasteQuantity: number
  amountVnd: number
  reason: string | null
  decisionNote: string | null
  decidedByUserId: number | null
  decidedByDisplayName: string | null
  decidedAt: string | null
  tableCodes: string[]
  visitSequence: number | null
  createdAt: string
  acknowledgedAt: string | null
}

export async function fetchStaffNotifications(): Promise<StaffNotification[]> {
  const response = await requireHttp().get<{ notifications: StaffNotification[] }>("/waiter/notifications")
  return response.notifications
}

export async function acknowledgeStaffNotification(notificationId: number): Promise<void> {
  await requireHttp().post(`/waiter/notifications/${notificationId}/acknowledge`, {})
}

/* ----------------- Module Phục vụ (v1.1) — PV-18: bill tạm tính ---------- */

export interface VisitBillLine {
  itemName: string
  variantDisplayName: string
  note: string | null
  quantity: number
  unitPriceVnd: number
  amountVnd: number
}

export interface VisitBill {
  visitId: number
  tableCodes: string[]
  orderCount: number
  lines: VisitBillLine[]
  subtotalVnd: number
  /** Điểm cơ bản: 1000 = 10%. */
  vatRateBasisPoints: number
  vatVnd: number
  totalVnd: number
  printedAt: string
}

export async function fetchVisitBill(visitId: number): Promise<VisitBill> {
  const response = await requireHttp().get<{ bill: VisitBill }>(`/waiter/visits/${visitId}/bill`)
  return response.bill
}

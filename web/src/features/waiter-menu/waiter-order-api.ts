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

/** Thông báo món đã xong của CHÍNH người đăng nhập (Module 4 lọc theo audience). */
export async function fetchReadyNotifications(): Promise<ReadyNotification[]> {
  const response = await requireHttp().get<{ notifications: ReadyNotification[] }>("/preparation/ready-notifications")
  return response.notifications
}

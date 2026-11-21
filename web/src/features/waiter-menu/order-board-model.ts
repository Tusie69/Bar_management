/**
 * Module Phục vụ 5 — luật của màn "Đơn của bàn", viết thành hàm thuần.
 *
 * Màn hình không tự suy ra quyền sửa từ giờ máy khách hay từ trạng thái nó đoán:
 * nó đọc `canAdjustQuantity` và `preparationStatus` mà máy chủ đã chiếu. Hai
 * thiết bị cùng mở một bàn phải thấy cùng một bộ nút, và máy chủ vẫn kiểm lại
 * trong transaction — những gì chặn ở đây chỉ để Phục vụ không bấm một cái nút
 * mà họ đã biết trước là lỗi.
 */
import type {
  CancellationPolicy,
  PreparationStatus,
  ReadyNotification,
  WaiterOrderLine,
  WaiterOrderListView,
} from "./waiter-order-api"

export const PREPARATION_LABEL: Record<PreparationStatus, string> = {
  SUBMITTED: "Chờ quầy nhận",
  ACCEPTED: "Quầy đã nhận",
  PREPARING: "Đang làm",
  READY: "Món đã xong",
  COLLECTED: "Đã mang ra",
}

export const POLICY_LABEL: Record<CancellationPolicy, string> = {
  STANDARD: "Hủy món",
  READY_WASTE: "Ghi hao món đã làm",
}

export const STATION_LABEL = { BAR: "Quầy bar", KITCHEN: "Bếp" } as const

export interface LineCapability {
  /** Sửa số lượng: chỉ khi quầy chưa nhận phiếu và không có yêu cầu hủy đang chờ. */
  canAdjust: boolean
  /** Gửi yêu cầu hủy: còn phần chưa hủy và chưa có yêu cầu nào đang chờ. */
  canRequestCancel: boolean
  /**
   * Món đã làm xong: hủy nghĩa là ghi hao. Màn hình phải nói ra điều đó TRƯỚC
   * khi người dùng gõ lý do, không phải sau khi máy chủ trả 409.
   */
  needsWasteAcknowledgement: boolean
  /** Câu cần nói với Phục vụ khi một thao tác bị khóa, hoặc `null`. */
  notice: string | null
}

export function lineCapability(line: WaiterOrderLine): LineCapability {
  const status = line.preparationStatus
  const madeAlready = status === "READY" || status === "COLLECTED"
  if (line.pendingCancellation !== null) {
    return {
      canAdjust: false,
      canRequestCancel: false,
      needsWasteAcknowledgement: madeAlready,
      notice: `Đang chờ phê duyệt hủy ${line.pendingCancellation.quantity} phần.`,
    }
  }
  if (line.netQuantity === 0) {
    return {
      canAdjust: false,
      canRequestCancel: false,
      needsWasteAcknowledgement: false,
      notice: "Dòng món đã bị hủy toàn bộ.",
    }
  }
  return {
    canAdjust: line.canAdjustQuantity,
    canRequestCancel: true,
    needsWasteAcknowledgement: madeAlready,
    notice: line.canAdjustQuantity
      ? null
      : madeAlready
        ? "Món đã làm xong. Hủy món là ghi hao và cần người có quyền phê duyệt."
        : status === "SUBMITTED"
          ? "Dòng đang chờ quầy nhận. Hiện không thể sửa trực tiếp số lượng."
          : "Quầy đã nhận phiếu. Sửa số lượng phải đi qua yêu cầu hủy có phê duyệt.",
  }
}

/** Phần khách còn phải trả cho một dòng, sau phần đã hủy. */
export function lineNetLabel(line: WaiterOrderLine): string {
  return `${line.netQuantity}`
}

export interface OrderBoardTotals {
  orderCount: number
  totalAmountVnd: number
  cancelledAmountVnd: number
  netAmountVnd: number
  hasCancellation: boolean
}

export function orderBoardTotals(view: WaiterOrderListView | undefined): OrderBoardTotals {
  if (!view) {
    return { orderCount: 0, totalAmountVnd: 0, cancelledAmountVnd: 0, netAmountVnd: 0, hasCancellation: false }
  }
  return {
    orderCount: view.orderCount,
    totalAmountVnd: view.totalAmountVnd,
    cancelledAmountVnd: view.cancelledAmountVnd,
    netAmountVnd: view.netAmountVnd,
    hasCancellation: view.cancelledAmountVnd > 0,
  }
}

/**
 * Số trên badge thông báo: những thông báo món-đã-xong CHƯA được xác nhận.
 *
 * Module 4 đã lọc theo audience ở máy chủ, nên mọi dòng tới đây đều thuộc người
 * đang đăng nhập. Đếm cả dòng đã xác nhận sẽ làm badge không bao giờ về 0, và
 * một badge không bao giờ tắt là một badge không ai còn nhìn.
 */
export function readyBadgeCount(notifications: readonly ReadyNotification[] | undefined): number {
  if (!notifications) return 0
  return notifications.filter((entry) => entry.acknowledgedAt === null).length
}

/** Thông báo của đúng một Phiên, để màn "Đơn của bàn" nêu rõ bàn nào vừa có món. */
export function readyNotificationsForVisit(
  notifications: readonly ReadyNotification[] | undefined,
  visitId: number,
): ReadyNotification[] {
  if (!notifications) return []
  return notifications.filter((entry) => entry.visitId === visitId && entry.acknowledgedAt === null)
}

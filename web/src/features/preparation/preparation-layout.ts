import type { RoleCode } from "@/domain/enums"

export type PreparationTicketStatus = "SUBMITTED" | "ACCEPTED" | "PREPARING" | "READY" | "COLLECTED"

export function fixedPreparationStation(role: RoleCode): "BAR" | "KITCHEN" | null {
  return role === "BAR" ? "BAR" : role === "KITCHEN" ? "KITCHEN" : null
}

export function outstandingPreparationCount(
  tickets: ReadonlyArray<{ status: PreparationTicketStatus }> | undefined,
): number {
  return tickets?.filter((ticket) => ticket.status !== "COLLECTED").length ?? 0
}

/**
 * Số giây chờ hiển thị, tính lại từ mốc gửi thay vì sửa snapshot trong cache.
 * `waitSeconds` của máy chủ chỉ là fallback khi timestamp không đọc được.
 */
export function preparationWaitSeconds(submittedAt: string, waitSeconds: number, now: Date): number {
  const submittedMs = Date.parse(submittedAt)
  const nowMs = now.getTime()
  if (Number.isFinite(submittedMs) && Number.isFinite(nowMs)) {
    return Math.max(0, Math.floor((nowMs - submittedMs) / 1000))
  }
  return Number.isFinite(waitSeconds) ? Math.max(0, Math.floor(waitSeconds)) : 0
}

/** Một cột trên mobile, hai trên tablet dọc, bốn trên tablet ngang/desktop. */
export const PREPARATION_QUEUE_LAYOUT_CLASS = "grid gap-3 md:grid-cols-2 xl:grid-cols-4"
export const PREPARATION_ACTION_CLASS = "min-h-11 flex-1"

export function canShowPrintRetry(hasPermission: boolean, printingEnabled: boolean): boolean {
  return hasPermission && printingEnabled
}

/** L2 — ba con số của một dòng phiếu, đúng hình dạng API trả về. */
export interface PreparationLineQuantities {
  /** Số còn phải làm, API đã trừ phần bị hủy. */
  quantity: number
  /** Số đã bị hủy sau khi được phê duyệt. */
  cancelledQuantity: number
  /** Số lúc khách gọi. */
  originalQuantity: number
}

export interface PreparationLineDisplay {
  /** Con số hiện trước tên món. Bằng 0 khi dòng đã bị hủy toàn bộ. */
  quantity: number
  /** Dòng bị hủy toàn bộ: gạch ngang và làm mờ, vì quầy không làm gì cả. */
  fullyCancelled: boolean
  /** Nhãn đỏ, hoặc `null` khi dòng không có gì bị hủy. */
  cancelledLabel: string | null
}

/**
 * L2 — một dòng phiếu đọc như thế nào sau khi có người duyệt hủy.
 *
 * Là hàm thuần, tách khỏi JSX, vì đây là chỗ Bếp quyết định làm bao nhiêu món:
 * "2×" trên một dòng đã hủy một nửa là hai khay thịt bị làm thừa và một lần
 * khách trả tiền cho món mình không gọi. Luật đó phải assert được mà không cần
 * DOM.
 *
 * Con số hiển thị lấy từ `quantity` mà API trả về — API tính nó bằng cột sinh
 * `net_quantity` của database, nên màn hình không tự trừ lần thứ hai và hai
 * thiết bị không bao giờ hiện hai con số khác nhau.
 */
export function preparationLineDisplay(line: PreparationLineQuantities): PreparationLineDisplay {
  const quantity = Math.max(0, line.quantity)
  const cancelled = Math.max(0, line.cancelledQuantity)
  if (cancelled === 0) return { quantity, fullyCancelled: false, cancelledLabel: null }
  // Hủy toàn bộ nhận nhãn riêng chứ không phải "Đã hủy 2, chỉ làm 0": câu sau
  // vẫn đọc như một việc phải làm, và đó đúng là cách Bếp hiểu sai.
  if (quantity === 0) {
    return { quantity: 0, fullyCancelled: true, cancelledLabel: "Đã hủy toàn bộ, không làm" }
  }
  return { quantity, fullyCancelled: false, cancelledLabel: `Đã hủy ${cancelled}, chỉ làm ${quantity}` }
}

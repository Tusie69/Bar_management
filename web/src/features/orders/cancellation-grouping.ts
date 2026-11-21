/**
 * Module Phục vụ (v1.1) — gom hàng chờ duyệt theo lần bấm, không theo dòng món.
 *
 * Máy chủ vẫn trả về một hàng cho MỖI dòng món, và điều đó đúng: người duyệt
 * cần thấy từng món, từng số lượng, từng số tiền. Nhưng một lần Phục vụ bấm
 * "Hủy đơn?" sinh ra bốn hàng như thế, và bốn thẻ rời trong hàng chờ là bốn
 * lần bấm cho MỘT quyết định — mời người ta bấm nhầm ba lần đầu và bỏ sót lần
 * thứ tư.
 *
 * Hàm thuần, nên luật gom kiểm được bằng assert mà không cần DOM.
 */
import type { CancellationQueueEntry } from "@/features/waiter-menu/waiter-order-api"

export interface CancellationLineItem {
  kind: "line"
  key: string
  entry: CancellationQueueEntry
}

export interface CancellationGroupItem {
  kind: "order"
  key: string
  groupId: number
  /** Các dòng của nhóm, giữ thứ tự máy chủ trả về. */
  entries: CancellationQueueEntry[]
  /** Lấy từ dòng đầu: cả nhóm cùng một đơn, một người gửi, một lý do. */
  orderId: number
  visitSequence: number
  tableCodes: string[]
  reason: string
  requestedByDisplayName: string
  requestedAt: string
  totalQuantity: number
  amountVnd: number
  /** Số phần phải ghi hao nếu duyệt. 0 nghĩa là chưa món nào làm xong. */
  wasteQuantity: number
  /** Phiên bản lớn nhất trong nhóm, chỉ để so sánh khi tải lại. */
  entryCount: number
}

export type CancellationQueueItem = CancellationLineItem | CancellationGroupItem

/**
 * Gom theo `groupId`, giữ nguyên thứ tự xuất hiện đầu tiên.
 *
 * Giữ thứ tự là một yêu cầu thật: hàng chờ sắp theo giờ gửi giảm dần, và sắp
 * lại theo mã nhóm sẽ đẩy một yêu cầu cũ lên đầu chỉ vì nó có id nhỏ.
 */
export function groupCancellationEntries(entries: readonly CancellationQueueEntry[]): CancellationQueueItem[] {
  const items: CancellationQueueItem[] = []
  const byGroup = new Map<number, CancellationGroupItem>()

  for (const entry of entries) {
    if (entry.groupId === null) {
      items.push({ kind: "line", key: `line:${entry.cancellationId}`, entry })
      continue
    }
    const existing = byGroup.get(entry.groupId)
    if (existing) {
      existing.entries.push(entry)
      existing.totalQuantity += entry.quantity
      existing.amountVnd += entry.amountVnd
      if (entry.policy === "READY_WASTE") existing.wasteQuantity += entry.quantity
      existing.entryCount += 1
      continue
    }
    const group: CancellationGroupItem = {
      kind: "order",
      key: `group:${entry.groupId}`,
      groupId: entry.groupId,
      entries: [entry],
      orderId: entry.orderId,
      visitSequence: entry.visitSequence,
      tableCodes: entry.tableCodes,
      reason: entry.reason,
      requestedByDisplayName: entry.requestedByDisplayName,
      requestedAt: entry.requestedAt,
      totalQuantity: entry.quantity,
      amountVnd: entry.amountVnd,
      wasteQuantity: entry.policy === "READY_WASTE" ? entry.quantity : 0,
      entryCount: 1,
    }
    byGroup.set(entry.groupId, group)
    items.push(group)
  }

  return items
}

/**
 * Module Phục vụ 1 (v1.1) — giỏ "gọi thêm" của bảng thao tác bàn.
 *
 * Mỗi lần bấm "+" là thêm MỘT phần y như cũ: cùng biến thể, cùng ghi chú. Đây
 * là toàn bộ luật của tính năng, viết thành hàm thuần để test được mà không
 * cần DOM và không cần máy chủ.
 *
 * Giỏ này KHÔNG dùng lại `useWaiterCart`. Giỏ kia giữ nháp trong localStorage
 * để nhân viên bỏ máy xuống giữa chừng rồi quay lại — đúng cho màn Gọi món,
 * sai cho đây: "gọi thêm 2 ly như cũ" là một ý định sống vài giây, và một bản
 * nháp của nó còn sót lại sau nửa tiếng sẽ được bấm gửi bởi một người không
 * biết nó từ đâu ra.
 */
import type { WaiterVisitItem } from "@/features/waiter-menu/waiter-order-api"

/** Khoá gộp của một món đã gọi: biến thể + ghi chú + giá lúc gọi. */
export function reorderKey(item: WaiterVisitItem): string {
  return `${item.variantId}|${item.note ?? ""}|${item.unitPriceVnd}`
}

export interface ReorderLine {
  key: string
  item: WaiterVisitItem
  quantity: number
}

/** Giỏ gọi thêm: số phần theo khoá gộp. Rỗng nghĩa là chưa bấm "+" lần nào. */
export type ReorderDraft = Readonly<Record<string, number>>

export const MAX_REORDER_PER_ITEM = 20

/**
 * Lý do một món không gọi thêm được, hoặc `null` khi gọi thêm được.
 *
 * Nói ra TRƯỚC khi người dùng bấm. Để họ bấm rồi mới báo lỗi nghĩa là họ đã
 * nói với khách "có ngay" trước khi biết món đã hết.
 */
export function reorderBlockedReason(item: WaiterVisitItem): string | null {
  if (item.reorder === null) return "Món này không còn bán. Chọn món khác từ Gọi món."
  return null
}

/**
 * Giá đã đổi kể từ lúc khách gọi lần trước, hoặc `null`.
 *
 * Phải hiện ra: "thêm một ly như cũ" mà tính tiền khác là chuyện khách phát
 * hiện lúc xem bill, và lúc đó không ai giải thích được.
 */
export function reorderPriceChange(item: WaiterVisitItem): { from: number; to: number } | null {
  if (item.reorder === null) return null
  if (item.reorder.amountVnd === item.unitPriceVnd) return null
  return { from: item.unitPriceVnd, to: item.reorder.amountVnd }
}

/** Thêm một phần. Món không gọi thêm được thì giỏ không đổi. */
export function addReorder(draft: ReorderDraft, item: WaiterVisitItem): ReorderDraft {
  if (reorderBlockedReason(item) !== null) return draft
  const key = reorderKey(item)
  const next = Math.min((draft[key] ?? 0) + 1, MAX_REORDER_PER_ITEM)
  return { ...draft, [key]: next }
}

/** Bớt một phần; về 0 thì bỏ hẳn khoá để giỏ rỗng là một object rỗng. */
export function removeReorder(draft: ReorderDraft, item: WaiterVisitItem): ReorderDraft {
  const key = reorderKey(item)
  const current = draft[key] ?? 0
  if (current <= 1) {
    const { [key]: _removed, ...rest } = draft
    return rest
  }
  return { ...draft, [key]: current - 1 }
}

/** Các dòng đang có trong giỏ, theo đúng thứ tự món hiện trên màn. */
export function reorderLines(draft: ReorderDraft, items: readonly WaiterVisitItem[]): ReorderLine[] {
  const lines: ReorderLine[] = []
  for (const item of items) {
    const key = reorderKey(item)
    const quantity = draft[key] ?? 0
    if (quantity > 0) lines.push({ key, item, quantity })
  }
  return lines
}

export function reorderItemCount(lines: readonly ReorderLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0)
}

/**
 * Tổng tiền của giỏ gọi thêm, tính theo giá HIỆN TẠI.
 *
 * Giá hiện tại chứ không phải giá lúc gọi: đó là số tiền sẽ thật sự vào đơn,
 * và hiện số nào khác là hứa với khách một con số máy chủ sẽ không tính.
 */
export function reorderTotalVnd(lines: readonly ReorderLine[]): number {
  return lines.reduce((total, line) => total + (line.item.reorder?.amountVnd ?? 0) * line.quantity, 0)
}

/** Câu tóm tắt dưới popup: "2× VỎ ỐC THÌ THẦM (Ly · Ít đá) · 1× KHOAI TÂY CHIÊN". */
export function reorderSummary(lines: readonly ReorderLine[]): string {
  return lines
    .map((line) => {
      const detail = [line.item.variantDisplayName, line.item.note].filter(Boolean).join(" · ")
      return `${line.quantity}× ${line.item.itemName}${detail ? ` (${detail})` : ""}`
    })
    .join(" · ")
}

export interface ReorderPayloadLine {
  variantId: number
  priceId: number
  priceVersion: number
  quantity: number
  note?: string
}

/**
 * Payload gửi `POST /waiter/orders`.
 *
 * Dùng `reorder.priceId` / `reorder.priceVersion` — giá HIỆN TẠI trong danh
 * mục — chứ không phải `priceId` của dòng đơn cũ. Gửi lại mã giá cũ thì máy
 * chủ trả `MENU_PRICE_CHANGED` ngay khi quán vừa đổi giá trong ca, và nút "+"
 * hỏng đúng vào tối đó.
 */
export function reorderPayload(input: {
  visitId: number
  idempotencyKey: string
  lines: readonly ReorderLine[]
}): { visitId: number; idempotencyKey: string; lines: ReorderPayloadLine[] } {
  return {
    visitId: input.visitId,
    idempotencyKey: input.idempotencyKey,
    lines: input.lines.flatMap((line) =>
      line.item.reorder === null
        ? []
        : [
            {
              variantId: line.item.variantId,
              priceId: line.item.reorder.priceId,
              priceVersion: line.item.reorder.priceVersion,
              quantity: line.quantity,
              ...(line.item.note ? { note: line.item.note } : {}),
            },
          ],
    ),
  }
}

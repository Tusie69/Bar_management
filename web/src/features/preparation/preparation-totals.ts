import type { MenuUnitCode } from "../waiter-menu/menu-model"
import type { PreparationStation, PreparationTicket } from "./preparation-queue-data"

export interface PreparationAggregateItem {
  menuItemVariantId: number
  itemName: string
  variantDisplayName: string
  unitCode: MenuUnitCode
  quantity: number
  notedLineCount: number
  pendingCancellationQuantity: number
}

const INCLUDED_STATUSES = new Set<PreparationTicket["status"]>(["SUBMITTED", "ACCEPTED", "PREPARING"])

export function preparationTotalsTitle(station: PreparationStation): string {
  return station === "BAR" ? "Tổng món đang chờ pha" : "Tổng món đang chờ làm"
}

export function preparationTotalsEmptyText(station: PreparationStation): string {
  return station === "BAR" ? "Không còn món đang chờ pha." : "Không còn món đang chờ làm."
}

/**
 * Tổng phần quầy còn phải làm, giữ thứ tự variant xuất hiện đầu tiên trong
 * snapshot. Identity duy nhất là `menuItemVariantId`; tên, đơn vị và ghi chú
 * chỉ là metadata hiển thị và không được dùng làm group key.
 */
export function aggregatePreparationItems(tickets: readonly PreparationTicket[]): PreparationAggregateItem[] {
  const byVariant = new Map<number, PreparationAggregateItem>()

  for (const ticket of tickets) {
    if (!INCLUDED_STATUSES.has(ticket.status)) continue

    for (const line of ticket.lines) {
      if (line.quantity <= 0) continue

      const existing = byVariant.get(line.menuItemVariantId)
      const noted = line.note?.trim() ? 1 : 0
      const pendingCancellationQuantity = line.pendingCancellation?.quantity ?? 0

      if (existing) {
        existing.quantity += line.quantity
        existing.notedLineCount += noted
        existing.pendingCancellationQuantity += pendingCancellationQuantity
        continue
      }

      byVariant.set(line.menuItemVariantId, {
        menuItemVariantId: line.menuItemVariantId,
        itemName: line.itemName,
        variantDisplayName: line.variantDisplayName,
        unitCode: line.unitCode,
        quantity: line.quantity,
        notedLineCount: noted,
        pendingCancellationQuantity,
      })
    }
  }

  return [...byVariant.values()]
}

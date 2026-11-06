import type { TableAvailability, TableView } from "@/domain/models"

export function bookingTableCanSelect(table: TableView, availability?: TableAvailability, anchor?: TableView) {
  return table.status === "ACTIVE" && !table.isSpare
    && (availability?.status === "available" || availability?.status === "too_small")
    && (!anchor || (table.zoneId === anchor.zoneId && table.kind === anchor.kind))
}

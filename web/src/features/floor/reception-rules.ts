import type { FloorTableState, ReservationView, TableView, ZoneView } from "@/domain/models"

export function isReceptionBookableTable(table: TableView | undefined, zones: ZoneView[]) {
  return (
    !!table &&
    table.status === "ACTIVE" &&
    !table.isSpare &&
    zones.some((zone) => zone.id === table.zoneId && zone.isBookable && !zone.isWaitingArea)
  )
}

export function canStartTableBooking(
  table: TableView | undefined,
  state: FloorTableState | undefined,
  zones: ZoneView[],
) {
  return state?.state === "free" && isReceptionBookableTable(table, zones)
}

export function phoneMatches(rows: ReservationView[] | undefined, businessDate: string, suffix: string) {
  return /^\d{3}$/.test(suffix)
    ? (rows ?? []).filter((row) => row.businessDate === businessDate && row.phoneLast3 === suffix)
    : []
}

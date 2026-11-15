import type { FloorTableState, ReservationView, TableView, WaitlistEntryView, ZoneView } from "@/domain/models"

/** Counted on the Bàn chờ marker. An entry holding a real table (HOLD_ACTIVE) no longer waits for one. */
export const isWaitingForTable = (e: WaitlistEntryView) => ["WAITING", "CONTACTING", "OFFERED"].includes(e.status)

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

/** Sum nominal seats of selected tables/Bar seats (each Bar seat counts as at least 1 guest). */
export function selectedTablesCapacity(ids: readonly number[], byId: ReadonlyMap<number, TableView>): number {
  let total = 0
  for (const id of ids) {
    const t = byId.get(id)
    if (!t) continue
    total += t.kind === "BAR_SEAT" ? Math.max(1, t.capacity || 1) : Math.max(0, t.capacity)
  }
  return total
}

/**
 * Non-blocking capacity guideline warning (R4): shown whenever at least one table/seat
 * is selected and combined capacity < partySize. Returns null when sufficient or unknown.
 */
export function capacityWarningText(
  tableCount: number,
  capacity: number,
  partySize: number | null | undefined,
): string | null {
  if (tableCount <= 0 || !partySize || partySize <= 0) return null
  if (capacity >= partySize) return null
  return `Vượt sức chứa: ${capacity} chỗ cho ${partySize} khách`
}

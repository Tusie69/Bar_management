import type { BusinessDate } from "@/lib/time"

export type NotificationTarget =
  { kind: "table"; tableId: number } | { kind: "reservation"; reservationId: number; businessDate: BusinessDate } | null

/** Assigned bookings open their table sheet; unassigned bookings fall back to booking detail. */
export function notificationTarget(
  tableId: number | null | undefined,
  reservationId: number | null | undefined,
  businessDate: BusinessDate,
): NotificationTarget {
  if (tableId != null) return { kind: "table", tableId }
  if (reservationId != null) return { kind: "reservation", reservationId, businessDate }
  return null
}

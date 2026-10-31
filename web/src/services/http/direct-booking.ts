import type { BookingWriteFields, HttpBooking } from "./booking-adapter"
import type { HttpBookingApi } from "./booking-api"

export type DirectBookingResult =
  | { outcome: "assigned"; booking: HttpBooking }
  | { outcome: "created-unassigned"; booking: HttpBooking; assignmentError: unknown }

export async function createAndAssignDirectBooking(
  api: Pick<HttpBookingApi, "create" | "assign">,
  fields: BookingWriteFields,
  tableId: number | number[],
): Promise<DirectBookingResult> {
  const tableIds = Array.isArray(tableId) ? tableId : [tableId]
  const created = await api.create(fields)
  if (!tableIds.length) return { outcome: "assigned", booking: created }
  try {
    return { outcome: "assigned", booking: await api.assign(created, tableIds) }
  } catch (assignmentError) {
    return { outcome: "created-unassigned", booking: created, assignmentError }
  }
}

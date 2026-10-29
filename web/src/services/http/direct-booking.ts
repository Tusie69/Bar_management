import type { BookingWriteFields, HttpBooking } from "./booking-adapter"
import type { HttpBookingApi } from "./booking-api"

export type DirectBookingResult =
  | { outcome: "assigned"; booking: HttpBooking }
  | { outcome: "created-unassigned"; booking: HttpBooking; assignmentError: unknown }

export async function createAndAssignDirectBooking(
  api: Pick<HttpBookingApi, "create" | "assign">,
  fields: BookingWriteFields,
  tableId: number,
): Promise<DirectBookingResult> {
  const created = await api.create(fields)
  try {
    return { outcome: "assigned", booking: await api.assign(created, [tableId]) }
  } catch (assignmentError) {
    return { outcome: "created-unassigned", booking: created, assignmentError }
  }
}

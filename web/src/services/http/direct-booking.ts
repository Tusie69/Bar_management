import type { BookingWriteFields, HttpBooking } from "./booking-adapter"
import type { HttpBookingApi } from "./booking-api"

export async function createAndAssignDirectBooking(
  api: Pick<HttpBookingApi, "createAndAssign">,
  fields: BookingWriteFields,
  tableIds: number[],
): Promise<HttpBooking> {
  return api.createAndAssign(fields, tableIds)
}

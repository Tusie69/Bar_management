import type { BookingWriteFields, HttpBooking } from "./booking-adapter"
import type { HttpBookingApi } from "./booking-api"
import type { CapacityConfirmation } from "./visit-api"

export async function createAndAssignDirectBooking(
  api: Pick<HttpBookingApi, "createAndAssign">,
  fields: BookingWriteFields,
  tableIds: number[],
  idempotencyKey?: string,
  confirmations: CapacityConfirmation = {},
): Promise<HttpBooking> {
  return api.createAndAssign(fields, tableIds, idempotencyKey, confirmations)
}

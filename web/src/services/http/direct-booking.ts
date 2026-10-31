import type { BookingWriteFields, HttpBooking } from "./booking-adapter"
import type { AssignmentTable } from "./booking-adapter"
import type { HttpBookingApi } from "./booking-api"
import type { TableView } from "@/domain/models"

export function directBookingSelection(
  catalogTables: TableView[],
  states: AssignmentTable[],
  directTable: TableView,
  selectedIds: number[],
) {
  const stateById = new Map(states.map((table) => [table.id, table]))
  const compatibleTables = catalogTables.filter((table) =>
    table.zoneId === directTable.zoneId &&
    table.kind === directTable.kind &&
    table.status === "ACTIVE" &&
    !table.isSpare,
  )
  const selectedTables = compatibleTables.filter((table) => selectedIds.includes(table.id))
  return {
    stateById,
    compatibleTables,
    selectedTables,
    capacity: selectedTables.reduce((total, table) => total + table.capacity, 0),
    allAvailable: selectedIds.length > 0 && selectedIds.every((id) => stateById.get(id)?.state === "AVAILABLE"),
  }
}

export async function createAndAssignDirectBooking(
  api: Pick<HttpBookingApi, "createAndAssign">,
  fields: BookingWriteFields,
  tableIds: number[],
): Promise<HttpBooking> {
  return api.createAndAssign(fields, tableIds)
}

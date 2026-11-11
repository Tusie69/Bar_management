/**
 * Capacity (anh Luân, họp 08/11/2026 §3.1): a table's capacity is guidance, not a
 * limit. Six guests may sit at a four-seat table if the receptionist says so.
 *
 * What replaces the old hard 409 is NOT "no check at all": the backend still
 * computes the real capacity from the member tables' own data, still refuses the
 * write when nobody took responsibility, and only proceeds once the request
 * carries an explicit confirmation. The confirmation is therefore verified on the
 * server; a dialog in the browser is not evidence on its own.
 *
 * Every other rule is untouched: party size must still be a positive whole
 * number, a table still cannot be double-booked, and a spare table is still not
 * bookable directly.
 */
import { AppError } from '../../errors/app-error.js'

export interface CapacityTable {
  code: string
  capacity: number
}

export interface CapacityWarning {
  requestedGuests: number
  totalCapacity: number
  tableCodes: string[]
  /** True once the operator confirmed; the row is written over capacity on purpose. */
  acknowledged: true
}

function capacityMessage(tableCodes: string[], totalCapacity: number, partySize: number): string {
  const where = tableCodes.length === 1 ? `Bàn ${tableCodes[0]}` : `Các bàn ${tableCodes.join(', ')}`
  return `${where} có sức chứa đề xuất ${totalCapacity} người. Bạn đang đặt ${partySize} khách.`
    + ' Xác nhận để tiếp tục.'
}

/**
 * Returns the warning to echo back to the client, or null when the party fits.
 * Throws CAPACITY_OVERRIDE_REQUIRED when the party exceeds capacity and the
 * request did not confirm it.
 */
export function acknowledgeCapacity(input: {
  partySize: number
  tables: readonly CapacityTable[]
  confirmed: boolean | undefined
}): CapacityWarning | null {
  const totalCapacity = input.tables.reduce((total, table) => total + Number(table.capacity), 0)
  if (totalCapacity >= input.partySize) return null

  const tableCodes = input.tables.map((table) => table.code)
  if (!input.confirmed) {
    throw new AppError(
      409,
      'CAPACITY_OVERRIDE_REQUIRED',
      capacityMessage(tableCodes, totalCapacity, input.partySize),
      { requestedGuests: input.partySize, totalCapacity, tableCodes },
    )
  }
  return { requestedGuests: input.partySize, totalCapacity, tableCodes, acknowledged: true }
}

/** Reads the confirmation flag off a request body, rejecting any other value. */
export function parseCapacityOverride(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') {
    throw new AppError(
      400,
      'INVALID_CAPACITY_OVERRIDE',
      'capacityOverrideConfirmed phải là true hoặc false.',
    )
  }
  return value
}

/**
 * A table's capacity is guidance, not a limit. Staff may place any valid party at
 * the selected table without an extra confirmation step.
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
  /** Retained for compatibility with historical audit payloads. */
  acknowledged: true
}

/**
 * Capacity never blocks a write and no longer creates an override warning.
 * Keep the input shape temporarily so older clients that still send the
 * confirmation flag remain compatible.
 */
export function acknowledgeCapacity(input: {
  partySize: number
  tables: readonly CapacityTable[]
  confirmed: boolean | undefined
}): CapacityWarning | null {
  void input
  return null
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

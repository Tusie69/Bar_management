/**
 * "Đếm khách" card numbers, exactly the six rows the approved mockup draws.
 *
 * The mockup's own figures are the contract for how the rows relate:
 *
 *   Trước 21:30    12
 *   Sau 21:30       6
 *   ----------------------
 *   Tổng đã tới    18
 *   Tổng bàn đặt    9
 *   Tổng khách đặt 42
 *   Khách quen (O)  5
 *
 * 12 + 6 = 18, so the first two rows split the guests who have ALREADY
 * ARRIVED by when they arrived - they are not a split of the whole booking
 * list, which would have to sum to 42. The rule below follows that.
 *
 * The 21:30 boundary is the reporting split between the early crowd and the
 * late crowd, not the current time: with "now" as the boundary the second row
 * would always be zero. It is a constant here because the venue has no setting
 * for it yet; move it into venue settings when there is one.
 */

import type { ReservationView } from "@/domain/models"

/** Reporting boundary between the early and the late crowd, venue local time. */
export const GUEST_COUNT_SPLIT = { hour: 21, minute: 30 } as const

export interface GuestCount {
  /** Label for the two split rows, e.g. "21:30". */
  splitLabel: string
  /** Guests already seated who arrived before the boundary. */
  arrivedBefore: number
  /** Guests already seated who arrived at or after the boundary. */
  arrivedAfter: number
  /** Everyone already seated. Always arrivedBefore + arrivedAfter. */
  arrivedTotal: number
  /** Tables held by a booking that is still live tonight. */
  bookedTables: number
  /** Guests on every live booking tonight, arrived or not. */
  bookedGuests: number
  /**
   * Live bookings classified "Khách quen (O)". Counted from `classification`,
   * the field the booking form writes and the Zalo report reads - NOT from
   * `iconKeys`, which demo data and decoration also write to and which must
   * never move a business figure.
   */
  returningGuests: number
}

const DEAD: ReservationView["status"][] = ["CANCELLED", "NO_SHOW"]

const pad2 = (n: number) => String(n).padStart(2, "0")

/**
 * @param reservations Bookings of the business date being shown.
 * @param split Boundary for the two arrival rows.
 */
export function buildGuestCount(
  reservations: readonly ReservationView[] | undefined,
  split: { hour: number; minute: number } = GUEST_COUNT_SPLIT,
): GuestCount {
  const splitLabel = `${pad2(split.hour)}:${pad2(split.minute)}`
  const empty: GuestCount = {
    splitLabel,
    arrivedBefore: 0,
    arrivedAfter: 0,
    arrivedTotal: 0,
    bookedTables: 0,
    bookedGuests: 0,
    returningGuests: 0,
  }
  if (!reservations?.length) return empty

  const live = reservations.filter((r) => !DEAD.includes(r.status))
  const tables = new Set<number>()
  let bookedGuests = 0
  let returning = 0
  let before = 0
  let after = 0

  for (const r of live) {
    bookedGuests += r.partySize
    if (r.classification === "RETURNING") returning += 1
    for (const id of r.tableIds) tables.add(id)

    // Seated guests only. A booking with no check-in time but already seated
    // (recovered session, manual seat) counts against its booked time, which
    // is the only time the row has.
    const seated = r.status === "CHECKED_IN"
    if (!seated) continue
    const at = r.checkedInAt ?? r.expectedAt
    const minutes = at.getHours() * 60 + at.getMinutes()
    // The service night runs past midnight, so anything in the small hours
    // belongs to the late side of the boundary, never the early side.
    const isEarly = minutes >= 12 * 60 && minutes < split.hour * 60 + split.minute
    if (isEarly) before += r.partySize
    else after += r.partySize
  }

  return {
    splitLabel,
    arrivedBefore: before,
    arrivedAfter: after,
    arrivedTotal: before + after,
    bookedTables: tables.size,
    bookedGuests,
    returningGuests: returning,
  }
}

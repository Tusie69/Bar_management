import type { RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { normalizeSearchText } from '../../lib/search-text.js'

export interface ReceptionSearchCriteria {
  last3?: string
  name?: string
}

export interface ReceptionBookingMatch {
  id: number
  displayName: string
  phoneLast3: string | null
  tableIds: number[]
}

export interface ReceptionWaitlistMatch {
  id: number
  reservationId: number | null
  displayName: string
  phoneLast3: string | null
  tableIds: number[]
  status: string
}

export interface ReceptionSearchResult {
  bookings: ReceptionBookingMatch[]
  waitlist: ReceptionWaitlistMatch[]
  summary: { bookingCount: number; waitlistCount: number; totalCount: number }
}

interface MatchRow extends RowDataPacket {
  id: number
  reservation_id?: number | null
  display_name: string
  phone_last3: string | null
  table_ids: string | null
  status?: string
}

const tableIds = (value: string | null): number[] => value ? value.split(',').map(Number) : []

export async function searchReception(
  actor: AuthenticatedActor,
  businessDate: string,
  criteria: ReceptionSearchCriteria,
): Promise<ReceptionSearchResult> {
  const last3 = criteria.last3 ?? null
  const name = criteria.name ? `%${normalizeSearchText(criteria.name)}%` : null
  const params = [actor.organizationId, actor.venueId, businessDate, last3, last3, name, name]
  const [bookingRows] = await databasePool.execute<MatchRow[]>(
    `SELECT r.id, COALESCE(c.display_name, r.contact_name, 'Khách') AS display_name,
       COALESCE(r.phone_last3, c.phone_last3) AS phone_last3,
       GROUP_CONCAT(DISTINCT a.table_id ORDER BY a.table_id SEPARATOR ',') AS table_ids
     FROM reservations AS r
     LEFT JOIN customers AS c ON c.organization_id = r.organization_id AND c.id = r.customer_id
     LEFT JOIN table_holds AS h ON h.venue_id = r.venue_id AND h.reservation_id = r.id
     LEFT JOIN table_allocations AS a ON a.venue_id = r.venue_id AND a.released_at IS NULL
       AND (a.hold_id = h.id OR (r.visit_id IS NOT NULL AND a.visit_id = r.visit_id))
     WHERE r.organization_id = ? AND r.venue_id = ? AND r.business_date = ?
       AND ((? IS NOT NULL AND COALESCE(r.phone_last3, c.phone_last3) = ?)
         OR (? IS NOT NULL AND COALESCE(REPLACE(c.name_search, 'đ', 'd'), REPLACE(r.contact_name_search, 'đ', 'd'), '') LIKE ?))
     GROUP BY r.id, c.display_name, r.contact_name, r.phone_last3, c.phone_last3
     ORDER BY r.expected_at, r.id LIMIT 100`,
    params,
  )

  const [waitlistRows] = await databasePool.execute<MatchRow[]>(
    `SELECT w.id, w.reservation_id,
       COALESCE(c.display_name, r.contact_name, w.contact_name, 'Khách chờ') AS display_name,
       COALESCE(c.phone_last3, r.phone_last3) AS phone_last3,
       GROUP_CONCAT(DISTINCT a.table_id ORDER BY a.table_id SEPARATOR ',') AS table_ids,
       w.status
     FROM waitlist_entries AS w
     LEFT JOIN reservations AS r ON r.organization_id = w.organization_id AND r.venue_id = w.venue_id AND r.id = w.reservation_id
     LEFT JOIN customers AS c ON c.organization_id = w.organization_id AND c.id = COALESCE(r.customer_id, w.customer_id)
     LEFT JOIN table_holds AS h ON h.venue_id = w.venue_id
       AND (h.waitlist_entry_id = w.id OR (w.reservation_id IS NOT NULL AND h.reservation_id = w.reservation_id))
     LEFT JOIN table_allocations AS a ON a.venue_id = w.venue_id AND a.hold_id = h.id AND a.released_at IS NULL
     WHERE w.organization_id = ? AND w.venue_id = ? AND w.business_date = ?
       AND w.status IN ('WAITING','CONTACTING','OFFERED','HOLD_ACTIVE')
       AND ((? IS NOT NULL AND COALESCE(c.phone_last3, r.phone_last3) = ?)
         OR (? IS NOT NULL AND COALESCE(REPLACE(c.name_search, 'đ', 'd'), REPLACE(r.contact_name_search, 'đ', 'd'), REPLACE(LOWER(w.contact_name), 'đ', 'd'), '') LIKE ?))
     GROUP BY w.id, w.reservation_id, c.display_name, r.contact_name, w.contact_name, c.phone_last3, r.phone_last3, w.status
     ORDER BY w.priority_class, w.queued_at, w.id LIMIT 100`,
    params,
  )

  const bookings = bookingRows.map((row) => ({
    id: Number(row.id), displayName: row.display_name, phoneLast3: row.phone_last3, tableIds: tableIds(row.table_ids),
  }))
  const waitlist = waitlistRows.map((row) => ({
    id: Number(row.id), reservationId: row.reservation_id == null ? null : Number(row.reservation_id),
    displayName: row.display_name, phoneLast3: row.phone_last3, tableIds: tableIds(row.table_ids), status: row.status!,
  }))
  const bookingIds = new Set(bookings.map((row) => row.id))
  const linkedDuplicates = waitlist.filter((row) => row.reservationId !== null && bookingIds.has(row.reservationId)).length
  return {
    bookings,
    waitlist,
    summary: { bookingCount: bookings.length, waitlistCount: waitlist.length, totalCount: bookings.length + waitlist.length - linkedDuplicates },
  }
}

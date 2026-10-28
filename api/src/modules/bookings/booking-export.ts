import type { RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import type { BookingStatus } from './booking.repository.js'

interface ExportRow extends RowDataPacket {
  id: number
  guest_name: string
  party_size: number
  expected_at: Date
  status: BookingStatus
  note: string | null
  table_code: string | null
  zone_code: string | null
  zone_name: string | null
}

export interface BookingExportItem {
  id: number
  guestName: string
  partySize: number
  expectedAt: Date
  status: BookingStatus
  note: string | null
  tables: Array<{ code: string; zoneCode: string; zoneName: string }>
}

const statusLabels: Record<BookingStatus, string> = {
  BOOKED: 'Đang đặt',
  CHECKED_IN: 'Đã tới',
  CANCELLED: 'Đã hủy',
  NO_SHOW: 'Không đến',
}

const preferredZoneOrder = ['A', 'B', 'C', 'BAR']

function cleanText(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function zoneKey(item: BookingExportItem): string {
  const zones = [...new Set(item.tables.map((table) => table.zoneCode))]
  if (!zones.length) return 'UNASSIGNED'
  if (zones.length > 1) return 'MULTI_ZONE'
  return zones[0] ?? 'UNASSIGNED'
}

function zoneLabel(key: string, items: BookingExportItem[]): string {
  if (key === 'UNASSIGNED') return 'CHƯA GÁN BÀN'
  if (key === 'MULTI_ZONE') return 'LIÊN KHU'
  const table = items.flatMap((item) => item.tables).find((candidate) => candidate.zoneCode === key)
  return table?.zoneName?.toUpperCase() || `KHU ${key}`
}

function bookingTime(value: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)
}

export async function listBookingExportItems(
  actor: AuthenticatedActor,
  businessDate: string,
): Promise<BookingExportItem[]> {
  const [rows] = await databasePool.execute<ExportRow[]>(
    `SELECT r.id, COALESCE(c.display_name, r.contact_name, 'Khách') AS guest_name,
       r.party_size, r.expected_at, r.status, r.note,
       dt.code AS table_code, z.code AS zone_code, z.name AS zone_name
     FROM reservations AS r
     LEFT JOIN customers AS c ON c.organization_id = r.organization_id AND c.id = r.customer_id
     LEFT JOIN table_holds AS h ON h.organization_id = r.organization_id
       AND h.venue_id = r.venue_id AND h.reservation_id = r.id
     LEFT JOIN table_allocations AS a ON a.organization_id = r.organization_id
       AND a.venue_id = r.venue_id AND a.released_at IS NULL
       AND (a.hold_id = h.id OR (r.visit_id IS NOT NULL AND a.visit_id = r.visit_id))
     LEFT JOIN dining_tables AS dt ON dt.organization_id = r.organization_id
       AND dt.venue_id = r.venue_id AND dt.id = a.table_id
     LEFT JOIN zones AS z ON z.organization_id = r.organization_id
       AND z.venue_id = r.venue_id AND z.id = dt.zone_id
     WHERE r.organization_id = ? AND r.venue_id = ? AND r.business_date = ?
     ORDER BY r.expected_at, r.id, dt.id`,
    [actor.organizationId, actor.venueId, businessDate],
  )
  const items = new Map<number, BookingExportItem>()
  for (const row of rows) {
    const id = Number(row.id)
    let item = items.get(id)
    if (!item) {
      item = {
        id,
        guestName: row.guest_name,
        partySize: Number(row.party_size),
        expectedAt: row.expected_at,
        status: row.status,
        note: row.note,
        tables: [],
      }
      items.set(id, item)
    }
    if (row.table_code && row.zone_code && row.zone_name) {
      if (!item.tables.some((table) => table.code === row.table_code)) {
        item.tables.push({ code: row.table_code, zoneCode: row.zone_code, zoneName: row.zone_name })
      }
    }
  }
  return [...items.values()]
}

export function formatBookingExport(businessDate: string, items: BookingExportItem[]): string {
  const grouped = new Map<string, BookingExportItem[]>()
  for (const item of items) {
    const key = zoneKey(item)
    const entries = grouped.get(key) ?? []
    entries.push(item)
    grouped.set(key, entries)
  }
  const orderedKeys = [...grouped.keys()].sort((left, right) => {
    const leftIndex = preferredZoneOrder.indexOf(left)
    const rightIndex = preferredZoneOrder.indexOf(right)
    const normalizedLeft = leftIndex < 0 ? preferredZoneOrder.length : leftIndex
    const normalizedRight = rightIndex < 0 ? preferredZoneOrder.length : rightIndex
    return normalizedLeft - normalizedRight || left.localeCompare(right)
  })
  const lines = [`DANH SÁCH ĐẶT BÀN 21GAM — ${businessDate}`, '']
  for (const key of orderedKeys) {
    const entries = grouped.get(key) ?? []
    lines.push(zoneLabel(key, entries))
    for (const item of entries) {
      const tables = item.tables.map((table) => table.code).join(' + ') || 'Chưa gán'
      const note = item.note ? ` | Ghi chú: ${cleanText(item.note)}` : ''
      lines.push(`- ${tables} | ${bookingTime(item.expectedAt)} | ${cleanText(item.guestName)} | ${item.partySize} khách | ${statusLabels[item.status]}${note}`)
    }
    lines.push('')
  }
  const uniqueTables = new Set(items.flatMap((item) => item.tables.map((table) => table.code)))
  const totalGuests = items.reduce((total, item) => total + item.partySize, 0)
  lines.push(`TỔNG HỢP: ${items.length} booking | ${uniqueTables.size} bàn đã gán | ${totalGuests} khách`)
  lines.push('Lưu ý: Bản xuất không bao gồm số điện thoại hoặc dữ liệu liên hệ nhạy cảm.')
  return `${lines.join('\n')}\n`
}

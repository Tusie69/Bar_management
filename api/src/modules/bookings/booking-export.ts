import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import type { BookingClassification, BookingStatus } from './booking.repository.js'

interface ExportRow extends RowDataPacket {
  id: number
  guest_name: string
  party_size: number
  expected_at: Date
  checked_in_at: Date | null
  status: BookingStatus
  customer_classification: BookingClassification | null
  is_birthday: number
  is_boss_table: number
  is_designated: number
  social_platform: string | null
  honorific: string | null
  source_code: string
  allocation_id: number | null
  table_code: string | null
  zone_code: string | null
  zone_name: string | null
}

interface WaitlistCountRow extends RowDataPacket {
  waiting_count: number
}

interface OutTableRow extends RowDataPacket {
  code: string
  zone_code: string
  zone_name: string
}

export interface BookingExportMetadata {
  bossTable: boolean
  returningCustomer: boolean | null
  designated: boolean
  birthday: boolean
  round: 1 | 2 | null
}

export interface DailyBookingTextItem {
  id: number
  guestName: string
  partySize: number
  expectedAt: Date
  checkedInAt: Date | null
  status: BookingStatus
  sourceCode: string
  socialPlatform: string | null
  honorific: 'MR' | 'MS' | null
  tables: Array<{ code: string; zoneCode: string; zoneName: string }>
  metadata: BookingExportMetadata
}

export interface DailyBookingTextInput {
  businessDate: string
  bookings: DailyBookingTextItem[]
  waitlistCount: number
  outTables: Array<{ code: string; zoneCode: string; zoneName: string }>
  arrivalCutoff: {
    hour: 21
    minute: 30
    basis: 'EXPECTED_AT'
    atCutoff: 'BEFORE'
  }
}

const ZONE_ORDER = ['A', 'B', 'C', 'BAR'] as const
const FIXED_TABLE_ORDER: Record<(typeof ZONE_ORDER)[number], string[]> = {
  A: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A0', 'A10'],
  B: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'],
  C: ['C1', 'C2', 'C4', 'C5'],
  BAR: ['1+2', '3+4', '5+6', '7+8', '9+10', '11+12', '13+14', '15+16', '17+18', '19', '20+21'],
}
const ZONE_LABEL: Record<(typeof ZONE_ORDER)[number], string> = {
  A: 'KHU A',
  B: 'KHU B',
  C: 'KHU C',
  BAR: 'QUẦY BAR',
}
const PHONE_LIKE = /(?:\+?84|0)(?:[\s().-]*\d){8,10}/g

function safeText(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(PHONE_LIKE, '[đã ẩn SĐT]').replace(/\s{2,}/g, ' ').trim()
}

function dateTitle(businessDate: string): string {
  const parts = businessDate.split('-')
  const year = Number(parts[0] ?? Number.NaN)
  const month = Number(parts[1] ?? Number.NaN)
  const day = Number(parts[2] ?? Number.NaN)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error('Invalid business date')
  }
  const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][
    new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
  ]
  return `Danh sách bàn đặt 21Gam ${weekday}, ${day}/${month}`
}

function venueTime(value: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(value).replace(':', 'h')
}

function barSeatNumber(code: string): number | null {
  const match = /^BAR0?([1-9]|1\d|2[01])$/.exec(code.toUpperCase())
  return match ? Number(match[1]) : null
}

function barLabel(codes: string[]): string {
  const seats = codes.map(barSeatNumber).filter((seat): seat is number => seat !== null).sort((a, b) => a - b)
  if (seats.length === codes.length && seats.length > 0) return seats.join('+')
  return codes.join('+')
}

function tableLabel(item: DailyBookingTextItem): string {
  const codes = item.tables.map((table) => table.code.toUpperCase())
  const set = new Set(codes)
  if (set.size === 2 && set.has('B11') && set.has('B12')) return 'B1'
  if (set.size === 2 && set.has('B21') && set.has('B22')) return 'B2'
  if (item.tables.length && item.tables.every((table) => table.zoneCode === 'BAR')) return barLabel(codes)
  return codes.join('+') || 'Chưa gán'
}

function zoneKey(item: DailyBookingTextItem): string {
  const zones = [...new Set(item.tables.map((table) => table.zoneCode.toUpperCase()))]
  if (!zones.length) return 'UNASSIGNED'
  return zones.length === 1 ? zones[0]! : 'MULTI_ZONE'
}

function tableRank(zone: string, label: string): number {
  if (!ZONE_ORDER.includes(zone as (typeof ZONE_ORDER)[number])) return Number.MAX_SAFE_INTEGER
  const order = FIXED_TABLE_ORDER[zone as (typeof ZONE_ORDER)[number]]
  const exact = order.indexOf(label)
  if (exact >= 0) return exact
  if (zone === 'BAR') {
    const firstSeat = Number(label.split('+')[0])
    const containing = order.findIndex((slot) => slot.split('+').map(Number).includes(firstSeat))
    if (containing >= 0) return containing
  }
  const firstCode = label.split('+')[0] ?? label
  const prefix = order.findIndex((slot) => firstCode.startsWith(slot))
  return prefix >= 0 ? prefix : order.length
}

function icons(item: DailyBookingTextItem): string {
  const values = [
    item.metadata.bossTable ? '⭐️' : '',
    item.metadata.returningCustomer === true ? '🔥' : '',
    item.metadata.designated ? '📌' : '',
    item.metadata.birthday ? '🎂' : '',
    item.status === 'CHECKED_IN' ? '✅' : '',
    item.metadata.round === 1 ? '1️⃣' : '',
    item.metadata.round === 2 ? '2️⃣' : '',
  ].filter(Boolean)
  return values.length ? ` ${values.join(' ')}` : ''
}

function sourceLabel(item: DailyBookingTextItem): string {
  if (item.sourceCode === 'SOCIAL') return safeText(item.socialPlatform ?? 'Social')
  return ({ HOTLINE: 'hotline', FANPAGE: 'FB', ZALO: 'Zalo', SHAREHOLDER: 'CĐ', STAFF: 'NV', OTHER: 'khác' } as Record<string, string>)[item.sourceCode]
    ?? safeText(item.sourceCode)
}

function bookingDetails(item: DailyBookingTextItem): string {
  const honorific = item.honorific === 'MR' ? 'Mr ' : item.honorific === 'MS' ? 'Ms ' : ''
  return `${honorific}${safeText(item.guestName)} ${item.partySize}p ${venueTime(item.expectedAt)} (${sourceLabel(item)})${icons(item)}`
}

function slotLabel(zone: (typeof ZONE_ORDER)[number], slot: string): string {
  return zone === 'A' && /^A[1-6]$/.test(slot) || zone === 'B' && /^(B1|B2)$/.test(slot)
    ? `${slot} (sofa)`
    : slot
}

function outputSlot(item: DailyBookingTextItem, zone: (typeof ZONE_ORDER)[number]): string {
  const label = tableLabel(item)
  if (zone !== 'BAR') return label
  const seats = item.tables.map((table) => barSeatNumber(table.code)).filter((seat): seat is number => seat !== null)
  return FIXED_TABLE_ORDER.BAR.find((slot) => {
    const slotSeats = slot.split('+').map(Number)
    return seats.length > 0 && seats.every((seat) => slotSeats.includes(seat))
  }) ?? label
}

function ordered(items: DailyBookingTextItem[], zone: string): DailyBookingTextItem[] {
  return [...items].sort((left, right) => {
    const leftLabel = tableLabel(left)
    const rightLabel = tableLabel(right)
    const leftZone = zone || zoneKey(left)
    const rightZone = zone || zoneKey(right)
    const leftZoneRank = ZONE_ORDER.indexOf(leftZone as (typeof ZONE_ORDER)[number])
    const rightZoneRank = ZONE_ORDER.indexOf(rightZone as (typeof ZONE_ORDER)[number])
    return (leftZoneRank < 0 ? ZONE_ORDER.length : leftZoneRank)
      - (rightZoneRank < 0 ? ZONE_ORDER.length : rightZoneRank)
      || tableRank(leftZone, leftLabel) - tableRank(rightZone, rightLabel)
      || leftLabel.localeCompare(rightLabel, 'vi', { numeric: true })
      || left.expectedAt.getTime() - right.expectedAt.getTime()
      || left.id - right.id
  })
}

function arrivalCounts(input: DailyBookingTextInput, active: DailyBookingTextItem[]): { before: string; after: string } {
  const hour = String(input.arrivalCutoff.hour).padStart(2, '0')
  const minute = String(input.arrivalCutoff.minute).padStart(2, '0')
  const cutoff = new Date(`${input.businessDate}T${hour}:${minute}:00+07:00`).getTime()
  let before = 0
  let after = 0
  for (const item of active) {
    // S2 #3: exactly 21:30 belongs with before, so the bound is inclusive.
    if (item.expectedAt.getTime() <= cutoff) before += item.partySize
    else after += item.partySize
  }
  return { before: String(before), after: String(after) }
}

/** Pure, deterministic and privacy-allowlisted formatter for US-07. */
export function formatDailyBookingText(input: DailyBookingTextInput): string {
  const active = input.bookings.filter((item) => item.status === 'BOOKED' || item.status === 'CHECKED_IN')
  const cancelled = input.bookings.filter((item) => item.status === 'CANCELLED')
  const title = dateTitle(input.businessDate)
  const sections: string[] = [title]

  for (const zone of ZONE_ORDER) {
    const zoneItems = active.filter((item) => zoneKey(item) === zone)
    const used = new Set<number>()
    const rows: string[] = []
    if (zone === 'A') rows.push(`-BC (Bàn Chờ +${input.waitlistCount}):`)
    for (const slot of FIXED_TABLE_ORDER[zone]) {
      const matches = ordered(zoneItems, zone).filter((item) => outputSlot(item, zone) === slot)
      matches.forEach((item) => used.add(item.id))
      const details = matches.map(bookingDetails).join(' / ')
      rows.push(`-${slotLabel(zone, slot)}:${details ? ` ${details}` : ''}`)
    }
    for (const item of ordered(zoneItems.filter((candidate) => !used.has(candidate.id)), zone)) {
      rows.push(`-${tableLabel(item)}: ${bookingDetails(item)}`)
    }
    sections.push([ZONE_LABEL[zone], ...rows].join('\n\n'))
  }

  const additionalZones = [...new Set(active.map(zoneKey))]
    .filter((zone) => !ZONE_ORDER.includes(zone as (typeof ZONE_ORDER)[number])
      && zone !== 'UNASSIGNED' && zone !== 'MULTI_ZONE')
    .sort((left, right) => left.localeCompare(right, 'vi', { numeric: true }))
  for (const zone of additionalZones) {
    const zoneName = active.flatMap((item) => item.tables).find((table) => table.zoneCode === zone)?.zoneName
    const rows = ordered(active.filter((item) => zoneKey(item) === zone), zone)
      .map((item) => `-${tableLabel(item)}: ${bookingDetails(item)}`)
    sections.push([`KHU ${safeText(zoneName ?? zone)}`, ...rows].join('\n\n'))
  }

  const unassigned = active.filter((item) => zoneKey(item) === 'UNASSIGNED')
  const multiZone = active.filter((item) => zoneKey(item) === 'MULTI_ZONE')
  if (unassigned.length) sections.push(['CHƯA GÁN BÀN', ...ordered(unassigned, 'UNASSIGNED').map((item) => `-${tableLabel(item)}: ${bookingDetails(item)}`)].join('\n\n'))
  if (multiZone.length) sections.push(['LIÊN KHU', ...ordered(multiZone, 'MULTI_ZONE').map((item) => `-${tableLabel(item)}: ${bookingDetails(item)}`)].join('\n\n'))

  const arrivals = arrivalCounts(input, active)
  const returning = active.filter((item) => item.metadata.returningCustomer === true).length
  const newCustomers = active.filter((item) => item.metadata.returningCustomer === false).length
  const statistics = [
    `Lượng khách vào trước/sau 9h30: ${arrivals.before}/${arrivals.after}`,
    `Tổng bàn đặt/ Tổng khách đặt: ${active.length}/${active.reduce((total, item) => total + item.partySize, 0)}`,
    `Bàn khách quen O: ${returning}`,
    `Bàn khách mới N: ${newCustomers}`,
    `Tổng khách đã đến: ${active.filter((item) => item.status === 'CHECKED_IN').reduce((total, item) => total + item.partySize, 0)}`,
  ].join('\n')
  const legend = ['⭐️Bàn sếp', '🔥Khách quen', '📌Chỉ định', '🎂Sinh nhật', '✅bàn đã tới', '1️⃣ bàn đặt lượt 1', '2️⃣ bàn đặt lượt 2'].join('\n')
  sections.push(`_____\nBàn Out: ${input.outTables.length}\n\nBàn Huỷ: ${cancelled.length}`, title, statistics, legend)
  return `${sections.join('\n\n')}\n`
}

async function loadBookingRows(connection: PoolConnection, actor: AuthenticatedActor, businessDate: string) {
  const [rows] = await connection.execute<ExportRow[]>(
    `SELECT r.id, COALESCE(r.contact_name, c.display_name, 'Khách') AS guest_name,
       r.party_size, r.expected_at, r.checked_in_at, r.status, r.customer_classification, r.is_birthday,
       r.is_boss_table, r.is_designated, r.social_platform, r.honorific, bs.code AS source_code,
       a.id AS allocation_id, dt.code AS table_code, z.code AS zone_code, z.name AS zone_name
     FROM reservations AS r
     LEFT JOIN customers AS c ON c.organization_id = r.organization_id AND c.id = r.customer_id
     JOIN booking_sources AS bs ON bs.organization_id = r.organization_id AND bs.id = r.source_id
     LEFT JOIN table_holds AS h ON h.organization_id = r.organization_id
       AND h.venue_id = r.venue_id AND h.reservation_id = r.id
     LEFT JOIN table_allocations AS a ON a.organization_id = r.organization_id AND a.venue_id = r.venue_id
       AND (a.hold_id = h.id OR (r.visit_id IS NOT NULL AND a.visit_id = r.visit_id))
       AND (a.released_at IS NULL OR
         (r.status = 'CANCELLED' AND a.release_reason = 'RESERVATION_CANCELLED') OR
         (r.status = 'NO_SHOW' AND a.release_reason = 'NO_SHOW'))
     LEFT JOIN dining_tables AS dt ON dt.organization_id = r.organization_id
       AND dt.venue_id = r.venue_id AND dt.id = a.table_id
     LEFT JOIN zones AS z ON z.organization_id = r.organization_id
       AND z.venue_id = r.venue_id AND z.id = dt.zone_id
     WHERE r.organization_id = ? AND r.venue_id = ? AND r.business_date = ?
     ORDER BY r.expected_at, r.id, a.id`,
    [actor.organizationId, actor.venueId, businessDate],
  )
  return rows
}

function normalizeBookings(rows: ExportRow[]): DailyBookingTextItem[] {
  const items = new Map<number, DailyBookingTextItem>()
  for (const row of rows) {
    let item = items.get(Number(row.id))
    if (!item) {
      item = {
        id: Number(row.id), guestName: row.guest_name, partySize: Number(row.party_size),
        expectedAt: row.expected_at, checkedInAt: row.checked_in_at, status: row.status,
        sourceCode: row.source_code, socialPlatform: row.social_platform,
        honorific: row.honorific === 'MR' || row.honorific === 'MS' ? row.honorific : null, tables: [],
        metadata: {
          bossTable: Number(row.is_boss_table) !== 0,
          returningCustomer: row.customer_classification === 'RETURNING'
            ? true
            : row.customer_classification === 'NEW' ? false : null,
          designated: Number(row.is_designated) !== 0,
          birthday: Number(row.is_birthday) !== 0,
          round: null,
        },
      }
      items.set(item.id, item)
    }
    if (row.allocation_id !== null && row.table_code && row.zone_code && row.zone_name
      && !item.tables.some((table) => table.code === row.table_code)) {
      item.tables.push({ code: row.table_code, zoneCode: row.zone_code, zoneName: row.zone_name })
    }
  }
  return [...items.values()]
}

/** One consistent MySQL snapshot; deliberately excludes every phone/customer identifier field. */
export async function getDailyBookingTextInput(
  actor: AuthenticatedActor,
  businessDate: string,
): Promise<DailyBookingTextInput> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const rows = await loadBookingRows(connection, actor, businessDate)
    const [waitlistRows] = await connection.execute<WaitlistCountRow[]>(
      `SELECT COUNT(*) AS waiting_count FROM waitlist_entries
       WHERE organization_id = ? AND venue_id = ? AND business_date = ?
         AND status IN ('WAITING','CONTACTING','OFFERED')`,
      [actor.organizationId, actor.venueId, businessDate],
    )
    const [outRows] = await connection.execute<OutTableRow[]>(
      `SELECT dt.code, z.code AS zone_code, z.name AS zone_name
       FROM dining_tables AS dt
       JOIN zones AS z ON z.organization_id = dt.organization_id AND z.venue_id = dt.venue_id AND z.id = dt.zone_id
       WHERE dt.organization_id = ? AND dt.venue_id = ? AND dt.status = 'OUT_OF_SERVICE'`,
      [actor.organizationId, actor.venueId],
    )
    await connection.commit()
    return {
      businessDate,
      bookings: normalizeBookings(rows),
      waitlistCount: Number(waitlistRows[0]?.waiting_count ?? 0),
      outTables: outRows.map((row) => ({ code: row.code, zoneCode: row.zone_code, zoneName: row.zone_name })),
      arrivalCutoff: { hour: 21, minute: 30, basis: 'EXPECTED_AT', atCutoff: 'BEFORE' },
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

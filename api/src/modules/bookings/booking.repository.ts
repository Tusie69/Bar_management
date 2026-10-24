import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

export type BookingStatus = 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW'

export interface BookingView {
  id: number
  guestName: string
  phoneLast3: string | null
  partySize: number
  expectedAt: string
  businessDate: string
  status: BookingStatus
  source: string
  tableCodes: string[]
  note: string | null
  version: number
}

interface BookingRow extends RowDataPacket {
  id: number
  guest_name: string
  phone_last3: string | null
  party_size: number
  expected_at: Date | string
  business_date: Date | string
  status: BookingStatus
  source_name: string
  table_codes: string | null
  note: string | null
  version: number
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function toBooking(row: BookingRow): BookingView {
  return {
    id: row.id,
    guestName: row.guest_name,
    phoneLast3: row.phone_last3,
    partySize: row.party_size,
    expectedAt: isoDateTime(row.expected_at),
    businessDate: dateOnly(row.business_date),
    status: row.status,
    source: row.source_name,
    tableCodes: row.table_codes ? row.table_codes.split(',') : [],
    note: row.note,
    version: row.version,
  }
}

const bookingSelect = `SELECT
  r.id, COALESCE(c.display_name, r.contact_name, 'Khách') AS guest_name,
  c.phone_last3, r.party_size, r.expected_at, r.business_date, r.status,
  bs.name AS source_name, r.note, r.version,
  GROUP_CONCAT(DISTINCT dt.code ORDER BY dt.id SEPARATOR ',') AS table_codes
FROM reservations AS r
LEFT JOIN customers AS c ON c.organization_id = r.organization_id AND c.id = r.customer_id
JOIN booking_sources AS bs ON bs.organization_id = r.organization_id AND bs.id = r.source_id
LEFT JOIN table_holds AS h ON h.venue_id = r.venue_id AND h.reservation_id = r.id
LEFT JOIN table_allocations AS a ON a.venue_id = r.venue_id AND a.released_at IS NULL
  AND (a.hold_id = h.id OR (r.visit_id IS NOT NULL AND a.visit_id = r.visit_id))
LEFT JOIN dining_tables AS dt ON dt.venue_id = r.venue_id AND dt.id = a.table_id`

export async function listBookings(businessDate: string): Promise<BookingView[]> {
  const [rows] = await databasePool.execute<BookingRow[]>(
    `${bookingSelect}
     WHERE r.venue_id = ? AND r.business_date = ?
     GROUP BY r.id, c.display_name, r.contact_name, c.phone_last3, r.party_size, r.expected_at,
       r.business_date, r.status, bs.name, r.note, r.version
     ORDER BY r.expected_at, r.id`,
    [env.venueId, businessDate],
  )
  return rows.map(toBooking)
}

async function getBookingById(id: number, connection: PoolConnection | typeof databasePool = databasePool): Promise<BookingView> {
  const [rows] = await connection.execute<BookingRow[]>(
    `${bookingSelect}
     WHERE r.venue_id = ? AND r.id = ?
     GROUP BY r.id, c.display_name, r.contact_name, c.phone_last3, r.party_size, r.expected_at,
       r.business_date, r.status, bs.name, r.note, r.version`,
    [env.venueId, id],
  )
  const row = rows[0]
  if (!row) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đặt bàn.')
  return toBooking(row)
}

export interface CreateBookingInput {
  guestName: string
  partySize: number
  expectedAt: string
  businessDate: string
  sourceCode: string
  note?: string
}

export async function createBooking(input: CreateBookingInput): Promise<BookingView> {
  const [sourceRows] = await databasePool.execute<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM booking_sources WHERE organization_id = ? AND code = ? AND is_active = 1',
    [env.organizationId, input.sourceCode],
  )
  const source = sourceRows[0]
  if (!source) throw new AppError(400, 'BOOKING_SOURCE_NOT_FOUND', 'Nguồn đặt bàn không hợp lệ.')
  const expectedAt = new Date(input.expectedAt)
  if (Number.isNaN(expectedAt.getTime())) throw new AppError(400, 'INVALID_EXPECTED_AT', 'Giờ đến không hợp lệ.')
  const mysqlExpectedAt = expectedAt.toISOString().slice(0, 23).replace('T', ' ')
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO reservations
      (organization_id, venue_id, contact_name, contact_name_search, source_id, party_size,
       expected_at, business_date, note, created_by_user_id)
     VALUES (?, ?, ?, LOWER(?), ?, ?, ?, ?, ?, ?)`,
    [env.organizationId, env.venueId, input.guestName, input.guestName, source.id, input.partySize,
      mysqlExpectedAt, input.businessDate, input.note ?? null, env.actorUserId],
  )
  return getBookingById(result.insertId)
}

interface LockedReservation extends RowDataPacket {
  id: number
  status: BookingStatus
  version: number
  expected_at: Date
  business_date: Date | string
  customer_id: number | null
  contact_name: string | null
  party_size: number
}

async function lockReservation(connection: PoolConnection, id: number, expectedVersion: number): Promise<LockedReservation> {
  const [rows] = await connection.execute<LockedReservation[]>(
    'SELECT id, status, version, expected_at, business_date, customer_id, contact_name, party_size FROM reservations WHERE venue_id = ? AND id = ? FOR UPDATE',
    [env.venueId, id],
  )
  const reservation = rows[0]
  if (!reservation) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đặt bàn.')
  if (reservation.version !== expectedVersion) throw new AppError(409, 'VERSION_CONFLICT', 'Đặt bàn vừa được thay đổi. Vui lòng tải lại.')
  return reservation
}

async function releaseActiveHold(connection: PoolConnection, reservationId: number, reason: string): Promise<void> {
  const holdReasonCode = reason === 'NO_SHOW'
    ? 'CUSTOMER_NO_SHOW'
    : reason === 'RESERVATION_CANCELLED'
      ? 'RESERVATION_CANCELLED'
      : 'STAFF_REASSIGNED'
  await connection.execute(
    `UPDATE table_allocations AS a
     JOIN table_holds AS h ON h.venue_id = a.venue_id AND h.id = a.hold_id
     SET a.released_at = UTC_TIMESTAMP(3), a.released_by_user_id = ?, a.release_reason = ?
     WHERE h.venue_id = ? AND h.reservation_id = ? AND a.released_at IS NULL`,
    [env.actorUserId, reason, env.venueId, reservationId],
  )
  await connection.execute(
    `UPDATE table_holds SET status = 'RELEASED', released_at = UTC_TIMESTAMP(3),
       released_by_user_id = ?, release_reason_code = ?
     WHERE venue_id = ? AND reservation_id = ? AND status = 'ACTIVE'`,
    [env.actorUserId, holdReasonCode, env.venueId, reservationId],
  )
}

export async function assignBookingTables(id: number, expectedVersion: number, tableIds: number[]): Promise<BookingView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, id, expectedVersion)
    if (reservation.status !== 'BOOKED') throw new AppError(409, 'BOOKING_NOT_ASSIGNABLE', 'Chỉ đặt bàn đang chờ mới được gán bàn.')
    const uniqueTableIds = [...new Set(tableIds)]
    if (!uniqueTableIds.length) throw new AppError(400, 'TABLE_REQUIRED', 'Cần chọn ít nhất một bàn.')
    const placeholders = uniqueTableIds.map(() => '?').join(',')
    const [tableRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM dining_tables WHERE venue_id = ? AND status = 'ACTIVE' AND id IN (${placeholders}) FOR UPDATE`,
      [env.venueId, ...uniqueTableIds],
    )
    if (tableRows.length !== uniqueTableIds.length) throw new AppError(400, 'TABLE_NOT_FOUND', 'Có bàn không tồn tại hoặc ngừng hoạt động.')
    await releaseActiveHold(connection, id, 'HOLD_RELEASED')
    const [conflicts] = await connection.execute<RowDataPacket[]>(
      `SELECT table_id FROM table_allocations
       WHERE venue_id = ? AND business_date = ? AND released_at IS NULL AND table_id IN (${placeholders})
       FOR UPDATE`,
      [env.venueId, dateOnly(reservation.business_date), ...uniqueTableIds],
    )
    if (conflicts.length) throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc đang sử dụng.')
    const [holdResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO table_holds
        (organization_id, venue_id, hold_kind, reservation_id, starts_at, created_by_user_id)
       VALUES (?, ?, 'RESERVATION', ?, ?, ?)`,
      [env.organizationId, env.venueId, id, reservation.expected_at, env.actorUserId],
    )
    for (const tableId of uniqueTableIds) {
      await connection.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, hold_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'HOLD', ?, ?, ?, ?)`,
        [env.organizationId, env.venueId, tableId, holdResult.insertId, reservation.expected_at,
          dateOnly(reservation.business_date), env.actorUserId],
      )
    }
    await connection.execute(
      'UPDATE reservations SET version = version + 1, updated_by_user_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
      [env.actorUserId, id],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return getBookingById(id)
}

export async function closeBooking(id: number, expectedVersion: number, status: 'CANCELLED' | 'NO_SHOW'): Promise<BookingView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, id, expectedVersion)
    if (reservation.status !== 'BOOKED') throw new AppError(409, 'BOOKING_NOT_CLOSABLE', 'Đặt bàn này không còn ở trạng thái chờ.')
    await releaseActiveHold(connection, id, status === 'NO_SHOW' ? 'NO_SHOW' : 'RESERVATION_CANCELLED')
    await connection.execute(
      `UPDATE reservations SET status = ?, closed_at = UTC_TIMESTAMP(3), closed_by_user_id = ?,
       close_reason_code = ?, updated_by_user_id = ?, version = version + 1 WHERE id = ?`,
      [status, env.actorUserId, status === 'NO_SHOW' ? 'NO_SHOW_CONFIRMED' : 'CUSTOMER_REQUEST', env.actorUserId, id],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return getBookingById(id)
}

export async function checkInBooking(id: number, expectedVersion: number): Promise<BookingView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, id, expectedVersion)
    if (reservation.status !== 'BOOKED') throw new AppError(409, 'BOOKING_NOT_CHECKIN', 'Chỉ đặt bàn đang chờ mới được check-in.')
    const [allocationRows] = await connection.execute<(RowDataPacket & { table_id: number; hold_id: number })[]>(
      `SELECT a.table_id, a.hold_id FROM table_allocations AS a
       JOIN table_holds AS h ON h.venue_id = a.venue_id AND h.id = a.hold_id
       WHERE h.venue_id = ? AND h.reservation_id = ? AND h.status = 'ACTIVE' AND a.released_at IS NULL FOR UPDATE`,
      [env.venueId, id],
    )
    if (!allocationRows.length) throw new AppError(409, 'BOOKING_TABLE_REQUIRED', 'Cần gán bàn trước khi check-in.')
    const firstAllocation = allocationRows[0]
    if (!firstAllocation) throw new AppError(409, 'BOOKING_TABLE_REQUIRED', 'Cần gán bàn trước khi check-in.')
    const [visitResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO visits
        (organization_id, venue_id, origin, customer_id, contact_name, guest_count, started_at,
         business_date, created_by_user_id)
       VALUES (?, ?, 'RESERVATION', ?, ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [env.organizationId, env.venueId, reservation.customer_id, reservation.contact_name,
        reservation.party_size, dateOnly(reservation.business_date), env.actorUserId],
    )
    const holdId = firstAllocation.hold_id
    await connection.execute(
      `UPDATE table_allocations SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?,
       release_reason = 'CONVERTED_TO_USAGE' WHERE venue_id = ? AND hold_id = ? AND released_at IS NULL`,
      [env.actorUserId, env.venueId, holdId],
    )
    await connection.execute(
      `UPDATE table_holds SET status = 'CONVERTED', converted_at = UTC_TIMESTAMP(3), converted_visit_id = ?
       WHERE venue_id = ? AND id = ?`,
      [visitResult.insertId, env.venueId, holdId],
    )
    for (const allocation of allocationRows) {
      await connection.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, UTC_TIMESTAMP(3), ?, ?)`,
        [env.organizationId, env.venueId, allocation.table_id, visitResult.insertId,
          dateOnly(reservation.business_date), env.actorUserId],
      )
    }
    await connection.execute(
      `UPDATE reservations SET status = 'CHECKED_IN', visit_id = ?, checked_in_at = UTC_TIMESTAMP(3),
       checked_in_by_user_id = ?, updated_by_user_id = ?, version = version + 1 WHERE id = ?`,
      [visitResult.insertId, env.actorUserId, env.actorUserId, id],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return getBookingById(id)
}

export interface CreateWalkInInput {
  guestName?: string
  partySize: number
  businessDate: string
  tableIds: number[]
}

export async function createWalkIn(input: CreateWalkInInput): Promise<{ visitId: number }> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const uniqueTableIds = [...new Set(input.tableIds)]
    if (!uniqueTableIds.length) throw new AppError(400, 'TABLE_REQUIRED', 'Cần chọn ít nhất một bàn cho khách walk-in.')
    const placeholders = uniqueTableIds.map(() => '?').join(',')
    const [tableRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM dining_tables WHERE venue_id = ? AND status = 'ACTIVE' AND id IN (${placeholders}) FOR UPDATE`,
      [env.venueId, ...uniqueTableIds],
    )
    if (tableRows.length !== uniqueTableIds.length) throw new AppError(400, 'TABLE_NOT_FOUND', 'Có bàn không tồn tại hoặc ngừng hoạt động.')
    const [conflicts] = await connection.execute<RowDataPacket[]>(
      `SELECT table_id FROM table_allocations
       WHERE venue_id = ? AND business_date = ? AND released_at IS NULL AND table_id IN (${placeholders})
       FOR UPDATE`,
      [env.venueId, input.businessDate, ...uniqueTableIds],
    )
    if (conflicts.length) throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc đang sử dụng.')
    const [visitResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO visits
        (organization_id, venue_id, origin, contact_name, guest_count, started_at, business_date, created_by_user_id)
       VALUES (?, ?, 'WALK_IN', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [env.organizationId, env.venueId, input.guestName ?? null, input.partySize, input.businessDate, env.actorUserId],
    )
    for (const tableId of uniqueTableIds) {
      await connection.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, UTC_TIMESTAMP(3), ?, ?)`,
        [env.organizationId, env.venueId, tableId, visitResult.insertId, input.businessDate, env.actorUserId],
      )
    }
    await connection.commit()
    return { visitId: visitResult.insertId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

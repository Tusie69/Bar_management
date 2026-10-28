import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { validateBookingSchedule } from './business-date.js'
import { deriveBookingTiming, type BookingDisplayStatus } from './booking-timing.js'

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
  sourceCode: string
  tableCodes: string[]
  note: string | null
  version: number
  displayStatus: BookingDisplayStatus
  minutesLate: number
  autoNoShowDue: boolean
}

export interface BookingSourceView {
  code: string
  name: string
}

interface BookingSourceRow extends RowDataPacket {
  code: string
  name: string
}

export async function listBookingSources(actor: AuthenticatedActor): Promise<BookingSourceView[]> {
  const [rows] = await databasePool.execute<BookingSourceRow[]>(
    `SELECT code, name FROM booking_sources
     WHERE organization_id = ? AND is_active = 1
     ORDER BY sort_order, id`,
    [actor.organizationId],
  )
  return rows.map((source) => ({ code: source.code, name: source.name }))
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
  source_code: string
  table_codes: string | null
  note: string | null
  version: number
  late_warning_minutes: number
  no_show_warning_minutes: number
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function toBooking(row: BookingRow, now = new Date()): BookingView {
  const timing = deriveBookingTiming(
    row.status,
    isoDateTime(row.expected_at),
    now,
    Number(row.late_warning_minutes),
    Number(row.no_show_warning_minutes),
  )
  return {
    id: Number(row.id),
    guestName: row.guest_name,
    phoneLast3: row.phone_last3,
    partySize: row.party_size,
    expectedAt: isoDateTime(row.expected_at),
    businessDate: dateOnly(row.business_date),
    status: row.status,
    source: row.source_name,
    sourceCode: row.source_code,
    tableCodes: row.table_codes ? row.table_codes.split(',') : [],
    note: row.note,
    version: row.version,
    ...timing,
  }
}

const bookingSelect = `SELECT
  r.id, COALESCE(c.display_name, r.contact_name, 'Khách') AS guest_name,
  c.phone_last3, r.party_size, r.expected_at, r.business_date, r.status,
  bs.name AS source_name, bs.code AS source_code, r.note, r.version,
  v.late_warning_minutes, v.no_show_warning_minutes,
  GROUP_CONCAT(DISTINCT dt.code ORDER BY dt.id SEPARATOR ',') AS table_codes
FROM reservations AS r
JOIN venues AS v ON v.organization_id = r.organization_id AND v.id = r.venue_id
LEFT JOIN customers AS c ON c.organization_id = r.organization_id AND c.id = r.customer_id
JOIN booking_sources AS bs ON bs.organization_id = r.organization_id AND bs.id = r.source_id
LEFT JOIN table_holds AS h ON h.venue_id = r.venue_id AND h.reservation_id = r.id
LEFT JOIN table_allocations AS a ON a.venue_id = r.venue_id AND a.released_at IS NULL
  AND (a.hold_id = h.id OR (r.visit_id IS NOT NULL AND a.visit_id = r.visit_id))
LEFT JOIN dining_tables AS dt ON dt.venue_id = r.venue_id AND dt.id = a.table_id`

export async function listBookings(actor: AuthenticatedActor, businessDate: string): Promise<BookingView[]> {
  const [rows] = await databasePool.execute<BookingRow[]>(
    `${bookingSelect}
     WHERE r.venue_id = ? AND r.business_date = ?
     GROUP BY r.id, c.display_name, r.contact_name, c.phone_last3, r.party_size, r.expected_at,
       r.business_date, r.status, bs.name, bs.code, r.note, r.version,
       v.late_warning_minutes, v.no_show_warning_minutes
     ORDER BY r.expected_at, r.id`,
    [actor.venueId, businessDate],
  )
  return rows.map((row) => toBooking(row))
}

export async function searchBookings(
  actor: AuthenticatedActor,
  businessDate: string,
  query: string,
): Promise<BookingView[]> {
  const normalizedQuery = query.trim().toLowerCase()
  const phoneLast3 = /^\d{3}$/.test(normalizedQuery) ? normalizedQuery : null
  const [rows] = await databasePool.execute<BookingRow[]>(
    `${bookingSelect}
     WHERE r.organization_id = ? AND r.venue_id = ? AND r.business_date = ?
       AND (
         LOCATE(?, LOWER(COALESCE(c.display_name, r.contact_name, ''))) > 0
         OR (? IS NOT NULL AND c.phone_last3 = ?)
       )
     GROUP BY r.id, c.display_name, r.contact_name, c.phone_last3, r.party_size, r.expected_at,
       r.business_date, r.status, bs.name, bs.code, r.note, r.version,
       v.late_warning_minutes, v.no_show_warning_minutes
     ORDER BY r.expected_at, r.id
     LIMIT 100`,
    [actor.organizationId, actor.venueId, businessDate, normalizedQuery, phoneLast3, phoneLast3],
  )
  return rows.map((row) => toBooking(row))
}

export async function getBookingById(
  actor: AuthenticatedActor,
  id: number,
  connection: PoolConnection | typeof databasePool = databasePool,
): Promise<BookingView> {
  const [rows] = await connection.execute<BookingRow[]>(
    `${bookingSelect}
     WHERE r.venue_id = ? AND r.id = ?
     GROUP BY r.id, c.display_name, r.contact_name, c.phone_last3, r.party_size, r.expected_at,
       r.business_date, r.status, bs.name, bs.code, r.note, r.version,
       v.late_warning_minutes, v.no_show_warning_minutes`,
    [actor.venueId, id],
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

export async function createBooking(actor: AuthenticatedActor, input: CreateBookingInput): Promise<BookingView> {
  const schedule = validateBookingSchedule(input.expectedAt, input.businessDate)
  const [sourceRows] = await databasePool.execute<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM booking_sources WHERE organization_id = ? AND code = ? AND is_active = 1',
    [actor.organizationId, input.sourceCode],
  )
  const source = sourceRows[0]
  if (!source) throw new AppError(400, 'BOOKING_SOURCE_NOT_FOUND', 'Nguồn đặt bàn không hợp lệ.')
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO reservations
      (organization_id, venue_id, contact_name, contact_name_search, source_id, party_size,
       expected_at, business_date, note, created_by_user_id)
     VALUES (?, ?, ?, LOWER(?), ?, ?, ?, ?, ?, ?)`,
    [
      actor.organizationId,
      actor.venueId,
      input.guestName,
      input.guestName,
      source.id,
      input.partySize,
      schedule.mysqlExpectedAt,
      schedule.businessDate,
      input.note ?? null,
      actor.userId,
    ],
  )
  return getBookingById(actor, result.insertId)
}

interface LockedReservation extends RowDataPacket {
  id: number
  organization_id: number
  venue_id: number
  status: BookingStatus
  version: number
  expected_at: Date
  business_date: Date | string
  customer_id: number | null
  contact_name: string | null
  party_size: number
  source_id: number
  note: string | null
}

async function lockReservation(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  id: number,
  expectedVersion: number,
): Promise<LockedReservation> {
  const [rows] = await connection.execute<LockedReservation[]>(
    `SELECT id, organization_id, venue_id, status, version, expected_at, business_date,
       customer_id, contact_name, party_size, source_id, note
     FROM reservations
     WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, id],
  )
  const reservation = rows[0]
  if (!reservation) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đặt bàn.')
  if (reservation.version !== expectedVersion)
    throw new AppError(409, 'VERSION_CONFLICT', 'Đặt bàn vừa được thay đổi. Vui lòng tải lại.')
  return reservation
}

interface ActiveHoldAllocationRow extends RowDataPacket {
  hold_id: number
  hold_starts_at: Date
  hold_version: number
  allocation_id: number | null
  table_id: number | null
  allocation_starts_at: Date | null
  allocation_business_date: Date | string | null
  planned_until: Date | null
}

export interface UpdateBookingInput extends CreateBookingInput {
  expectedVersion: number
}

async function nextVenueChangeSequence(connection: PoolConnection, actor: AuthenticatedActor): Promise<string> {
  const [rows] = await connection.execute<(RowDataPacket & { change_seq: string })[]>(
    `SELECT change_seq FROM venues
     WHERE organization_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId],
  )
  const venue = rows[0]
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  const nextSequence = (BigInt(venue.change_seq) + 1n).toString()
  await connection.execute(
    `UPDATE venues SET change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
     WHERE organization_id = ? AND id = ?`,
    [nextSequence, actor.organizationId, actor.venueId],
  )
  return nextSequence
}

function sameInstant(left: Date | string, right: Date): boolean {
  const leftDate = left instanceof Date ? left : new Date(`${left}Z`)
  return leftDate.getTime() === right.getTime()
}

export async function updateBooking(
  actor: AuthenticatedActor,
  id: number,
  input: UpdateBookingInput,
): Promise<BookingView> {
  const schedule = validateBookingSchedule(input.expectedAt, input.businessDate)
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, actor, id, input.expectedVersion)
    if (reservation.status !== 'BOOKED') {
      throw new AppError(409, 'BOOKING_NOT_EDITABLE', 'Chỉ booking đang ở trạng thái BOOKED mới được chỉnh sửa.')
    }

    const [sourceRows] = await connection.execute<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM booking_sources WHERE organization_id = ? AND code = ? AND is_active = 1',
      [actor.organizationId, input.sourceCode],
    )
    const source = sourceRows[0]
    if (!source) throw new AppError(400, 'BOOKING_SOURCE_NOT_FOUND', 'Nguồn đặt bàn không hợp lệ.')

    const [holdRows] = await connection.execute<ActiveHoldAllocationRow[]>(
      `SELECT h.id AS hold_id, h.starts_at AS hold_starts_at, h.version AS hold_version,
         a.id AS allocation_id, a.table_id, a.starts_at AS allocation_starts_at,
         a.business_date AS allocation_business_date, a.planned_until
       FROM table_holds AS h
       LEFT JOIN table_allocations AS a
         ON a.organization_id = h.organization_id AND a.venue_id = h.venue_id
         AND a.hold_id = h.id AND a.kind = 'HOLD' AND a.released_at IS NULL
       WHERE h.organization_id = ? AND h.venue_id = ? AND h.reservation_id = ? AND h.status = 'ACTIVE'
       ORDER BY a.table_id, a.id
       FOR UPDATE`,
      [actor.organizationId, actor.venueId, id],
    )
    if (holdRows.some((row) => row.allocation_id === null || row.table_id === null)) {
      throw new AppError(
        409,
        'BOOKING_HOLD_INCONSISTENT',
        'Booking có HOLD không còn allocation hợp lệ; không thể tự động sửa.',
      )
    }
    if (
      holdRows.some(
        (row) =>
          !sameInstant(row.hold_starts_at, reservation.expected_at) ||
          row.allocation_starts_at === null ||
          !sameInstant(row.allocation_starts_at, reservation.expected_at) ||
          row.allocation_business_date === null ||
          dateOnly(row.allocation_business_date) !== dateOnly(reservation.business_date),
      )
    ) {
      throw new AppError(
        409,
        'BOOKING_HOLD_SCHEDULE_MISMATCH',
        'Lịch booking và HOLD hiện tại không nhất quán; đã dừng để bảo toàn lịch sử.',
      )
    }

    const currentExpectedAt = reservation.expected_at
    const scheduleChanged =
      currentExpectedAt.getTime() !== schedule.expectedAtUtc.getTime() ||
      dateOnly(reservation.business_date) !== schedule.businessDate
    if (scheduleChanged && holdRows.some((row) => row.planned_until !== null)) {
      throw new AppError(
        409,
        'WINDOWED_HOLD_EDIT_UNSUPPORTED',
        'Chưa thể sửa lịch cho HOLD có thời hạn mà vẫn bảo toàn đúng lịch sử.',
      )
    }

    const changedFields: string[] = []
    if (reservation.contact_name !== input.guestName) changedFields.push('guestName')
    if (Number(reservation.party_size) !== input.partySize) changedFields.push('partySize')
    if (Number(reservation.source_id) !== Number(source.id)) changedFields.push('sourceCode')
    if ((reservation.note ?? '') !== (input.note ?? '')) changedFields.push('note')
    if (currentExpectedAt.getTime() !== schedule.expectedAtUtc.getTime()) changedFields.push('expectedAt')
    if (dateOnly(reservation.business_date) !== schedule.businessDate) changedFields.push('businessDate')
    if (!changedFields.length)
      throw new AppError(400, 'BOOKING_NOT_CHANGED', 'Booking không có thông tin nào thay đổi.')

    const allocationIds = holdRows.map((row) => Number(row.allocation_id))
    const tableIds = holdRows.map((row) => Number(row.table_id))
    if (scheduleChanged && allocationIds.length) {
      const tablePlaceholders = tableIds.map(() => '?').join(',')
      const allocationPlaceholders = allocationIds.map(() => '?').join(',')
      const [conflicts] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM table_allocations
         WHERE organization_id = ? AND venue_id = ? AND business_date = ?
           AND released_at IS NULL AND table_id IN (${tablePlaceholders})
           AND id NOT IN (${allocationPlaceholders})
         ORDER BY table_id, id FOR UPDATE`,
        [actor.organizationId, actor.venueId, schedule.businessDate, ...tableIds, ...allocationIds],
      )
      if (conflicts.length) {
        throw new AppError(
          409,
          'TABLE_ALREADY_OCCUPIED',
          'Bàn đang giữ đã có booking hoặc lượt sử dụng trong ngày làm việc mới.',
        )
      }
      const holdId = Number(holdRows[0]?.hold_id)
      const [holdUpdate] = await connection.execute<ResultSetHeader>(
        `UPDATE table_holds
         SET starts_at = ?, updated_at = UTC_TIMESTAMP(3), version = version + 1
         WHERE organization_id = ? AND venue_id = ? AND id = ? AND status = 'ACTIVE'`,
        [schedule.mysqlExpectedAt, actor.organizationId, actor.venueId, holdId],
      )
      if (holdUpdate.affectedRows !== 1) {
        throw new AppError(409, 'BOOKING_HOLD_CONFLICT', 'HOLD của booking vừa được thay đổi. Vui lòng tải lại.')
      }
      const [allocationUpdate] = await connection.execute<ResultSetHeader>(
        `UPDATE table_allocations
         SET starts_at = ?, business_date = ?
         WHERE organization_id = ? AND venue_id = ? AND kind = 'HOLD'
           AND released_at IS NULL AND id IN (${allocationPlaceholders})`,
        [schedule.mysqlExpectedAt, schedule.businessDate, actor.organizationId, actor.venueId, ...allocationIds],
      )
      if (allocationUpdate.affectedRows !== allocationIds.length) {
        throw new AppError(
          409,
          'BOOKING_ALLOCATION_CONFLICT',
          'Allocation của booking vừa được thay đổi. Vui lòng tải lại.',
        )
      }
    }

    const [updateResult] = await connection.execute<ResultSetHeader>(
      `UPDATE reservations
       SET contact_name = ?, contact_name_search = LOWER(?), party_size = ?, source_id = ?,
           expected_at = ?, business_date = ?, note = ?, updated_by_user_id = ?,
           updated_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND status = 'BOOKED' AND version = ?`,
      [
        input.guestName,
        input.guestName,
        input.partySize,
        source.id,
        schedule.mysqlExpectedAt,
        schedule.businessDate,
        input.note ?? null,
        actor.userId,
        actor.organizationId,
        actor.venueId,
        id,
        input.expectedVersion,
      ],
    )
    if (updateResult.affectedRows !== 1) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Booking vừa được thay đổi. Vui lòng tải lại.')
    }

    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'RESERVATION_UPDATED', 'reservation', ?, ?, ?, ?, 'MANUAL', 0)`,
      [
        actor.organizationId,
        actor.venueId,
        changeSequence,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        id,
        input.expectedVersion,
        input.expectedVersion + 1,
        JSON.stringify([
          {
            type: 'reservation',
            id,
            versionBefore: input.expectedVersion,
            versionAfter: input.expectedVersion + 1,
            changedFields,
          },
          ...(scheduleChanged && allocationIds.length
            ? [
                {
                  type: 'active_hold_schedule',
                  holdId: Number(holdRows[0]?.hold_id),
                  allocationIds,
                  tableIds,
                  before: {
                    expectedAt: currentExpectedAt.toISOString(),
                    businessDate: dateOnly(reservation.business_date),
                  },
                  after: {
                    expectedAt: schedule.expectedAtUtc.toISOString(),
                    businessDate: schedule.businessDate,
                  },
                },
              ]
            : []),
        ]),
      ],
    )

    const updated = await getBookingById(actor, id, connection)
    await connection.commit()
    return updated
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function releaseActiveHold(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  reservationId: number,
  reason: string,
): Promise<void> {
  const holdReasonCode =
    reason === 'NO_SHOW'
      ? 'CUSTOMER_NO_SHOW'
      : reason === 'RESERVATION_CANCELLED'
        ? 'RESERVATION_CANCELLED'
        : 'STAFF_REASSIGNED'
  await connection.execute(
    `UPDATE table_allocations AS a
     JOIN table_holds AS h ON h.venue_id = a.venue_id AND h.id = a.hold_id
     SET a.released_at = UTC_TIMESTAMP(3), a.released_by_user_id = ?, a.release_reason = ?
     WHERE h.venue_id = ? AND h.reservation_id = ? AND a.released_at IS NULL`,
    [actor.userId, reason, actor.venueId, reservationId],
  )
  await connection.execute(
    `UPDATE table_holds SET status = 'RELEASED', released_at = UTC_TIMESTAMP(3),
       released_by_user_id = ?, release_reason_code = ?
     WHERE venue_id = ? AND reservation_id = ? AND status = 'ACTIVE'`,
    [actor.userId, holdReasonCode, actor.venueId, reservationId],
  )
}

export async function assignBookingTables(
  actor: AuthenticatedActor,
  id: number,
  expectedVersion: number,
  tableIds: number[],
): Promise<BookingView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, actor, id, expectedVersion)
    if (reservation.status !== 'BOOKED')
      throw new AppError(409, 'BOOKING_NOT_ASSIGNABLE', 'Chỉ đặt bàn đang chờ mới được gán bàn.')
    const uniqueTableIds = [...new Set(tableIds)]
    if (!uniqueTableIds.length) throw new AppError(400, 'TABLE_REQUIRED', 'Cần chọn ít nhất một bàn.')
    const placeholders = uniqueTableIds.map(() => '?').join(',')
    const [tableRows] = await connection.execute<(RowDataPacket & { id: number; code: string; is_spare: number })[]>(
      `SELECT id, code, is_spare FROM dining_tables WHERE venue_id = ? AND status = 'ACTIVE' AND id IN (${placeholders})
       ORDER BY id FOR UPDATE`,
      [actor.venueId, ...uniqueTableIds],
    )
    if (tableRows.length !== uniqueTableIds.length)
      throw new AppError(400, 'TABLE_NOT_FOUND', 'Có bàn không tồn tại hoặc ngừng hoạt động.')
    const spareTable = tableRows.find((table) => Boolean(table.is_spare))
    if (spareTable)
      throw new AppError(
        409,
        'SPARE_TABLE_NOT_BOOKABLE',
        `Bàn ${spareTable.code} là bàn sơ cua và chưa được cấu hình để nhận booking.`,
      )
    const [previousAllocations] = await connection.execute<(RowDataPacket & { id: number; table_id: number })[]>(
      `SELECT a.id, a.table_id FROM table_allocations AS a
       JOIN table_holds AS h ON h.venue_id = a.venue_id AND h.id = a.hold_id
       WHERE h.organization_id = ? AND h.venue_id = ? AND h.reservation_id = ?
         AND h.status = 'ACTIVE' AND a.kind = 'HOLD' AND a.released_at IS NULL
       ORDER BY a.table_id, a.id FOR UPDATE`,
      [actor.organizationId, actor.venueId, id],
    )
    const previousTableIds = previousAllocations.map((allocation) => Number(allocation.table_id))
    const requestedTableIds = [...uniqueTableIds].sort((left, right) => left - right)
    if (
      previousTableIds.length === requestedTableIds.length &&
      previousTableIds.every((tableId, index) => tableId === requestedTableIds[index])
    ) {
      throw new AppError(409, 'TABLE_ASSIGNMENT_UNCHANGED', 'Booking đã được gán đúng các bàn đã chọn.')
    }
    await releaseActiveHold(connection, actor, id, previousAllocations.length ? 'MOVED' : 'HOLD_RELEASED')
    const [conflicts] = await connection.execute<RowDataPacket[]>(
      `SELECT table_id FROM table_allocations
       WHERE venue_id = ? AND business_date = ? AND released_at IS NULL AND table_id IN (${placeholders})
       FOR UPDATE`,
      [actor.venueId, dateOnly(reservation.business_date), ...uniqueTableIds],
    )
    if (conflicts.length)
      throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc đang sử dụng.')
    const [holdResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO table_holds
        (organization_id, venue_id, hold_kind, reservation_id, starts_at, created_by_user_id)
       VALUES (?, ?, 'RESERVATION', ?, ?, ?)`,
      [actor.organizationId, actor.venueId, id, reservation.expected_at, actor.userId],
    )
    const newAllocationIds: number[] = []
    for (const tableId of requestedTableIds) {
      const [allocationResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, hold_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'HOLD', ?, ?, ?, ?)`,
        [
          actor.organizationId,
          actor.venueId,
          tableId,
          holdResult.insertId,
          reservation.expected_at,
          dateOnly(reservation.business_date),
          actor.userId,
        ],
      )
      newAllocationIds.push(allocationResult.insertId)
    }
    const [reservationUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE reservations SET version = version + 1, updated_by_user_id = ?, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ? AND status = 'BOOKED'`,
      [actor.userId, actor.organizationId, actor.venueId, id, expectedVersion],
    )
    if (reservationUpdate.affectedRows !== 1)
      throw new AppError(409, 'VERSION_CONFLICT', 'Booking vừa được thay đổi. Vui lòng tải lại.')
    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, 'reservation', ?, ?, ?, ?, ?, 0)`,
      [
        actor.organizationId,
        actor.venueId,
        changeSequence,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        previousAllocations.length ? 'RESERVATION_TABLES_REASSIGNED' : 'RESERVATION_TABLES_ASSIGNED',
        id,
        expectedVersion,
        expectedVersion + 1,
        JSON.stringify([
          {
            type: 'reservation_table_assignment',
            previousAllocationIds: previousAllocations.map((allocation) => Number(allocation.id)),
            previousTableIds,
            holdId: holdResult.insertId,
            newAllocationIds,
            newTableIds: requestedTableIds,
          },
        ]),
        previousAllocations.length ? 'STAFF_REASSIGNED' : 'INITIAL_ASSIGNMENT',
      ],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return getBookingById(actor, id)
}

export async function closeBooking(
  actor: AuthenticatedActor,
  id: number,
  expectedVersion: number,
  status: 'CANCELLED' | 'NO_SHOW',
  closeReasonNote?: string,
): Promise<BookingView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, actor, id, expectedVersion)
    if (reservation.status !== 'BOOKED')
      throw new AppError(409, 'BOOKING_NOT_CLOSABLE', 'Đặt bàn này không còn ở trạng thái chờ.')
    const [activeAllocationRows] = await connection.execute<(RowDataPacket & { id: number; table_id: number })[]>(
      `SELECT a.id, a.table_id FROM table_allocations AS a
       JOIN table_holds AS h ON h.organization_id = a.organization_id AND h.venue_id = a.venue_id AND h.id = a.hold_id
       WHERE h.organization_id = ? AND h.venue_id = ? AND h.reservation_id = ?
         AND h.status = 'ACTIVE' AND a.released_at IS NULL
       ORDER BY a.id FOR UPDATE`,
      [actor.organizationId, actor.venueId, id],
    )
    await releaseActiveHold(connection, actor, id, status === 'NO_SHOW' ? 'NO_SHOW' : 'RESERVATION_CANCELLED')
    const [updateResult] = await connection.execute<ResultSetHeader>(
      `UPDATE reservations SET status = ?, closed_at = UTC_TIMESTAMP(3), closed_by_user_id = ?,
       close_reason_code = ?, close_reason_note = ?, updated_by_user_id = ?, updated_at = UTC_TIMESTAMP(3),
       version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND status = 'BOOKED' AND version = ?`,
      [
        status,
        actor.userId,
        status === 'NO_SHOW' ? 'NO_SHOW_CONFIRMED' : 'CUSTOMER_REQUEST',
        closeReasonNote ?? null,
        actor.userId,
        actor.organizationId,
        actor.venueId,
        id,
        expectedVersion,
      ],
    )
    if (updateResult.affectedRows !== 1)
      throw new AppError(409, 'VERSION_CONFLICT', 'Booking vừa được thay đổi. Vui lòng tải lại.')
    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, 'reservation', ?, ?, ?, ?, ?, 0)`,
      [
        actor.organizationId,
        actor.venueId,
        changeSequence,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        status === 'NO_SHOW' ? 'RESERVATION_NO_SHOW' : 'RESERVATION_CANCELLED',
        id,
        expectedVersion,
        expectedVersion + 1,
        JSON.stringify([
          {
            type: 'released_hold_allocations',
            allocations: activeAllocationRows.map((row) => ({
              id: Number(row.id),
              tableId: Number(row.table_id),
            })),
          },
        ]),
        status === 'NO_SHOW' ? 'NO_SHOW_CONFIRMED' : 'CUSTOMER_REQUEST',
      ],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return getBookingById(actor, id)
}

export async function checkInBooking(
  actor: AuthenticatedActor,
  id: number,
  expectedVersion: number,
): Promise<BookingView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, actor, id, expectedVersion)
    if (reservation.status !== 'BOOKED')
      throw new AppError(409, 'BOOKING_NOT_CHECKIN', 'Chỉ đặt bàn đang chờ mới được check-in.')
    const [allocationRows] = await connection.execute<(RowDataPacket & { table_id: number; hold_id: number })[]>(
      `SELECT a.table_id, a.hold_id FROM table_allocations AS a
       JOIN table_holds AS h ON h.venue_id = a.venue_id AND h.id = a.hold_id
       WHERE h.venue_id = ? AND h.reservation_id = ? AND h.status = 'ACTIVE' AND a.released_at IS NULL FOR UPDATE`,
      [actor.venueId, id],
    )
    if (!allocationRows.length) throw new AppError(409, 'BOOKING_TABLE_REQUIRED', 'Cần gán bàn trước khi check-in.')
    const firstAllocation = allocationRows[0]
    if (!firstAllocation) throw new AppError(409, 'BOOKING_TABLE_REQUIRED', 'Cần gán bàn trước khi check-in.')
    const tableIds = allocationRows.map((allocation) => allocation.table_id)
    const tablePlaceholders = tableIds.map(() => '?').join(',')
    const [usageConflicts] = await connection.execute<(RowDataPacket & { code: string })[]>(
      `SELECT dt.code
       FROM table_allocations AS a
       JOIN dining_tables AS dt ON dt.venue_id = a.venue_id AND dt.id = a.table_id
       WHERE a.venue_id = ? AND a.kind = 'USAGE' AND a.released_at IS NULL
         AND a.table_id IN (${tablePlaceholders})
       FOR UPDATE`,
      [actor.venueId, ...tableIds],
    )
    if (usageConflicts.length) {
      const codes = usageConflicts.map((row) => row.code.replace(/^BAR0?/, '')).join(', ')
      throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', `Không thể check-in: bàn ${codes} đang được sử dụng.`)
    }
    const [visitResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO visits
        (organization_id, venue_id, origin, customer_id, contact_name, guest_count, started_at,
         business_date, created_by_user_id)
       VALUES (?, ?, 'RESERVATION', ?, ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [
        actor.organizationId,
        actor.venueId,
        reservation.customer_id,
        reservation.contact_name,
        reservation.party_size,
        dateOnly(reservation.business_date),
        actor.userId,
      ],
    )
    const holdId = firstAllocation.hold_id
    await connection.execute(
      `UPDATE table_allocations SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?,
       release_reason = 'CONVERTED_TO_USAGE' WHERE venue_id = ? AND hold_id = ? AND released_at IS NULL`,
      [actor.userId, actor.venueId, holdId],
    )
    await connection.execute(
      `UPDATE table_holds SET status = 'CONVERTED', converted_at = UTC_TIMESTAMP(3), converted_visit_id = ?
       WHERE venue_id = ? AND id = ?`,
      [visitResult.insertId, actor.venueId, holdId],
    )
    for (const allocation of allocationRows) {
      await connection.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, UTC_TIMESTAMP(3), ?, ?)`,
        [
          actor.organizationId,
          actor.venueId,
          allocation.table_id,
          visitResult.insertId,
          dateOnly(reservation.business_date),
          actor.userId,
        ],
      )
    }
    await connection.execute(
      `UPDATE reservations SET status = 'CHECKED_IN', visit_id = ?, checked_in_at = UTC_TIMESTAMP(3),
       checked_in_by_user_id = ?, updated_by_user_id = ?, version = version + 1 WHERE id = ?`,
      [visitResult.insertId, actor.userId, actor.userId, id],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return getBookingById(actor, id)
}

export interface CreateWalkInInput {
  guestName?: string
  partySize: number
  businessDate: string
  tableIds: number[]
}

export async function createWalkIn(actor: AuthenticatedActor, input: CreateWalkInInput): Promise<{ visitId: number }> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const uniqueTableIds = [...new Set(input.tableIds)].sort((left, right) => left - right)
    if (!uniqueTableIds.length) throw new AppError(400, 'TABLE_REQUIRED', 'Cần chọn ít nhất một bàn cho khách walk-in.')
    const placeholders = uniqueTableIds.map(() => '?').join(',')
    const [tableRows] = await connection.execute<(RowDataPacket & { id: number; code: string; is_spare: number })[]>(
      `SELECT id, code, is_spare FROM dining_tables WHERE venue_id = ? AND status = 'ACTIVE' AND id IN (${placeholders}) FOR UPDATE`,
      [actor.venueId, ...uniqueTableIds],
    )
    if (tableRows.length !== uniqueTableIds.length)
      throw new AppError(400, 'TABLE_NOT_FOUND', 'Có bàn không tồn tại hoặc ngừng hoạt động.')
    const spareTable = tableRows.find((table) => Boolean(table.is_spare))
    if (spareTable)
      throw new AppError(
        409,
        'SPARE_TABLE_NOT_BOOKABLE',
        `Bàn ${spareTable.code} là bàn sơ cua và chưa được cấu hình để nhận khách.`,
      )
    const [conflicts] = await connection.execute<RowDataPacket[]>(
      `SELECT table_id FROM table_allocations
       WHERE venue_id = ? AND released_at IS NULL AND table_id IN (${placeholders})
       FOR UPDATE`,
      [actor.venueId, ...uniqueTableIds],
    )
    if (conflicts.length)
      throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc đang sử dụng.')
    const [visitResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO visits
        (organization_id, venue_id, origin, contact_name, guest_count, started_at, business_date, created_by_user_id)
       VALUES (?, ?, 'WALK_IN', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, actor.venueId, input.guestName ?? null, input.partySize, input.businessDate, actor.userId],
    )
    for (const tableId of uniqueTableIds) {
      await connection.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, UTC_TIMESTAMP(3), ?, ?)`,
        [actor.organizationId, actor.venueId, tableId, visitResult.insertId, input.businessDate, actor.userId],
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

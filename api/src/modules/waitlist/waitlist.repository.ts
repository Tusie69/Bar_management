import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { hasPermission } from '../../auth/auth.service.js'
import { assignBookingTablesInTransaction, checkInBookingInTransaction } from '../bookings/booking.repository.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { dissolveUnusedGroups } from '../tables/table-group.repository.js'

export type WaitlistStatus = 'WAITING' | 'CONTACTING' | 'OFFERED' | 'HOLD_ACTIVE' | 'SEATED' | 'DECLINED' | 'CANCELLED'
export type ContactChannel = 'IN_PERSON' | 'PHONE_CALLBACK' | 'ZALO_THREAD' | 'FANPAGE_THREAD' | 'OTHER'
export const waitlistCancelReasons = ['CUSTOMER_DECLINED', 'CUSTOMER_WITHDREW', 'NO_SHOW_AFTER_ACCEPT',
  'RESERVATION_CANCELLED', 'SEATED_OTHERWISE', 'DUPLICATE', 'ENTRY_ERROR', 'OTHER'] as const
export const attemptChannels = ['IN_PERSON', 'PHONE_BY_AUTHORIZED', 'ZALO_THREAD', 'FANPAGE_THREAD', 'OTHER'] as const
export const contactOutcomes = ['NO_ANSWER', 'CALLBACK_REQUESTED', 'OFFER_PENDING', 'ACCEPTED',
  'DECLINED_OFFER', 'KEEP_WAITING', 'WITHDREW', 'WRONG_CONTACT'] as const

export interface CancelWaitlistInput {
  entryId: number
  expectedVersion: number
  reasonCode: typeof waitlistCancelReasons[number]
  note?: string
}

export interface RecordContactInput {
  entryId: number
  expectedVersion: number
  channel: typeof attemptChannels[number]
  outcome: typeof contactOutcomes[number]
  note?: string
}

export interface WaitlistEntryView {
  id: number
  kind: 'ADVANCE_RESERVATION' | 'WALK_IN'
  guestName: string
  partySize: number
  businessDate: string
  queuedAt: string
  status: WaitlistStatus
  contactChannel: ContactChannel
  reservationId: number | null
  reservationExpectedAt: string | null
  visitId: number | null
  note: string | null
  version: number
}

interface WaitlistRow extends RowDataPacket {
  id: number
  kind: 'ADVANCE_RESERVATION' | 'WALK_IN'
  guest_name: string
  resolved_party_size: number
  business_date: Date | string
  queued_at: Date | string
  status: WaitlistStatus
  contact_channel: ContactChannel
  reservation_id: number | null
  reservation_expected_at: Date | string | null
  visit_id: number | null
  note: string | null
  version: number
}

interface LockedWaitlistRow extends RowDataPacket {
  id: number
  kind: 'ADVANCE_RESERVATION' | 'WALK_IN'
  reservation_id: number | null
  contact_name: string | null
  party_size: number | null
  business_date: Date | string
  status: WaitlistStatus
  version: number
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

function toView(row: WaitlistRow): WaitlistEntryView {
  return {
    id: Number(row.id),
    kind: row.kind,
    guestName: row.guest_name,
    partySize: Number(row.resolved_party_size),
    businessDate: dateOnly(row.business_date),
    queuedAt: isoDateTime(row.queued_at),
    status: row.status,
    contactChannel: row.contact_channel,
    reservationId: row.reservation_id === null ? null : Number(row.reservation_id),
    reservationExpectedAt: row.reservation_expected_at === null ? null : isoDateTime(row.reservation_expected_at),
    visitId: row.visit_id === null ? null : Number(row.visit_id),
    note: row.note,
    version: row.version,
  }
}

const waitlistSelect = `SELECT w.id, w.kind,
  COALESCE(c.display_name, r.contact_name, w.contact_name, 'Khách chờ') AS guest_name,
  COALESCE(r.party_size, w.party_size) AS resolved_party_size,
  w.business_date, w.queued_at, w.status, w.contact_channel,
  w.reservation_id, r.expected_at AS reservation_expected_at, w.visit_id, w.note, w.version
FROM waitlist_entries AS w
LEFT JOIN reservations AS r ON r.venue_id = w.venue_id AND r.id = w.reservation_id
LEFT JOIN customers AS c ON c.organization_id = w.organization_id
  AND c.id = COALESCE(r.customer_id, w.customer_id)`

export async function listWaitlist(actor: AuthenticatedActor, businessDate: string): Promise<WaitlistEntryView[]> {
  const [rows] = await databasePool.execute<WaitlistRow[]>(
    `${waitlistSelect}
     WHERE w.organization_id = ? AND w.venue_id = ? AND w.business_date = ?
     ORDER BY w.priority_class, w.queued_at, w.id`,
    [actor.organizationId, actor.venueId, businessDate],
  )
  return rows.map(toView)
}

export type CreateWaitlistInput = {
  businessDate: string
  contactChannel: ContactChannel
  note?: string
} & ({ kind?: 'WALK_IN'; guestName: string; partySize: number }
  | { kind: 'ADVANCE_RESERVATION'; reservationId: number })

export async function createWaitlistEntry(
  actor: AuthenticatedActor,
  input: CreateWaitlistInput,
): Promise<WaitlistEntryView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    if (input.kind === 'ADVANCE_RESERVATION') {
      const [reservations] = await connection.execute<(RowDataPacket & { status: string; business_date: Date | string })[]>(
        `SELECT status, business_date FROM reservations
         WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
        [actor.organizationId, actor.venueId, input.reservationId],
      )
      const reservation = reservations[0]
      if (!reservation) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Reservation not found.')
      if (reservation.status !== 'BOOKED') throw new AppError(409, 'BOOKING_NOT_WAITLISTABLE', 'Reservation must be BOOKED.')
      if (dateOnly(reservation.business_date) !== input.businessDate) {
        throw new AppError(409, 'BUSINESS_DATE_MISMATCH', 'Reservation belongs to another business date.')
      }
      const [holds] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM table_holds WHERE organization_id = ? AND venue_id = ?
         AND reservation_id = ? AND (status = 'ACTIVE' OR EXISTS (
           SELECT 1 FROM table_allocations a WHERE a.venue_id = table_holds.venue_id
             AND a.hold_id = table_holds.id AND a.released_at IS NULL)) FOR UPDATE`,
        [actor.organizationId, actor.venueId, input.reservationId],
      )
      if (holds.length) throw new AppError(409, 'BOOKING_ALREADY_ASSIGNED', 'Reservation already has an active table hold.')
      const [entries] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM waitlist_entries WHERE organization_id = ? AND venue_id = ?
         AND reservation_id = ? AND status NOT IN ('SEATED','DECLINED','CANCELLED') FOR UPDATE`,
        [actor.organizationId, actor.venueId, input.reservationId],
      )
      if (entries.length) throw new AppError(409, 'WAITLIST_ALREADY_EXISTS', 'Reservation already has an open waitlist entry.')
    }
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO waitlist_entries
        (organization_id, venue_id, kind, reservation_id, contact_name, party_size, preference_mode,
         contact_channel, business_date, queued_at, note, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'ANY', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, actor.venueId, input.kind ?? 'WALK_IN',
        input.kind === 'ADVANCE_RESERVATION' ? input.reservationId : null,
        input.kind === 'ADVANCE_RESERVATION' ? null : input.guestName,
        input.kind === 'ADVANCE_RESERVATION' ? null : input.partySize,
        input.contactChannel, input.businessDate, input.note ?? null, actor.userId],
    )
    const created = await readEntry(connection, actor, result.insertId)
    await connection.commit()
    return created
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function nextVenueChangeSequence(connection: PoolConnection, actor: AuthenticatedActor): Promise<string> {
  const [rows] = await connection.execute<(RowDataPacket & { change_seq: string })[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE',
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

export interface SeatWaitlistInput {
  entryId: number
  expectedVersion: number
  tableIds: number[]
}

async function lockOpenEntry(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  entryId: number,
  expectedVersion: number,
): Promise<LockedWaitlistRow> {
  const [rows] = await connection.execute<LockedWaitlistRow[]>(
    `SELECT id, kind, reservation_id, contact_name, party_size, business_date, status, version
     FROM waitlist_entries WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, entryId],
  )
  const entry = rows[0]
  if (!entry) throw new AppError(404, 'WAITLIST_NOT_FOUND', 'Không tìm thấy khách trong danh sách chờ.')
  if (entry.version !== expectedVersion) {
    throw new AppError(409, 'VERSION_CONFLICT', 'Khách chờ vừa được thay đổi. Vui lòng tải lại.')
  }
  if (['SEATED', 'DECLINED', 'CANCELLED'].includes(entry.status)) {
    throw new AppError(409, 'WAITLIST_TERMINAL', 'Khách chờ đã được xử lý xong.')
  }
  return entry
}

async function readEntry(connection: PoolConnection, actor: AuthenticatedActor, entryId: number): Promise<WaitlistEntryView> {
  const [rows] = await connection.execute<WaitlistRow[]>(
    `${waitlistSelect} WHERE w.organization_id = ? AND w.venue_id = ? AND w.id = ?`,
    [actor.organizationId, actor.venueId, entryId],
  )
  if (!rows[0]) throw new AppError(500, 'WAITLIST_READ_FAILED', 'Không đọc lại được khách chờ.')
  return toView(rows[0])
}

async function auditEntry(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  input: { entryId: number; expectedVersion: number; reasonCode?: string; note?: string },
  action: string,
  changes: Record<string, unknown>,
): Promise<void> {
  const sequence = await nextVenueChangeSequence(connection, actor)
  await connection.execute(
    `INSERT INTO operation_log
      (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
       auth_session_id, action, entity_type, entity_id, entity_version_before,
       entity_version_after, changes, reason_code, reason_note, is_undoable)
     VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, 'waitlist_entry', ?, ?, ?, ?, ?, ?, 0)`,
    [actor.organizationId, actor.venueId, sequence, actor.userId, actor.membershipId,
      actor.authSessionId ?? null, action, input.entryId, input.expectedVersion, input.expectedVersion + 1,
      JSON.stringify([changes]), input.reasonCode ?? 'STAFF_CONFIRMED', input.note ?? null],
  )
}

export async function cancelWaitlistEntry(actor: AuthenticatedActor, input: CancelWaitlistInput): Promise<WaitlistEntryView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const entry = await lockOpenEntry(connection, actor, input.entryId, input.expectedVersion)
    const [allocations] = await connection.execute<(RowDataPacket & { id: number; group_id: number | null })[]>(
      `SELECT a.id, a.group_id FROM table_allocations AS a
       JOIN table_holds AS h ON h.organization_id = a.organization_id AND h.venue_id = a.venue_id AND h.id = a.hold_id
       WHERE h.organization_id = ? AND h.venue_id = ? AND h.waitlist_entry_id = ?
         AND h.status = 'ACTIVE' AND a.released_at IS NULL ORDER BY a.id FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.entryId],
    )
    await connection.execute(
      `UPDATE table_allocations AS a
       JOIN table_holds AS h ON h.organization_id = a.organization_id AND h.venue_id = a.venue_id AND h.id = a.hold_id
       SET a.released_at = UTC_TIMESTAMP(3), a.released_by_user_id = ?, a.release_reason = 'HOLD_RELEASED'
       WHERE h.organization_id = ? AND h.venue_id = ? AND h.waitlist_entry_id = ?
         AND h.status = 'ACTIVE' AND a.released_at IS NULL`,
      [actor.userId, actor.organizationId, actor.venueId, input.entryId],
    )
    await connection.execute(
      `UPDATE table_holds SET status = 'RELEASED', released_at = UTC_TIMESTAMP(3),
         released_by_user_id = ?, release_reason_code = ?, release_reason_note = ?,
         updated_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND waitlist_entry_id = ? AND status = 'ACTIVE'`,
      [actor.userId, ({ CUSTOMER_DECLINED: 'CUSTOMER_CANCELLED', CUSTOMER_WITHDREW: 'CUSTOMER_CANCELLED',
        NO_SHOW_AFTER_ACCEPT: 'CUSTOMER_NO_SHOW', RESERVATION_CANCELLED: 'RESERVATION_CANCELLED',
        SEATED_OTHERWISE: 'OTHER', DUPLICATE: 'OTHER', ENTRY_ERROR: 'ENTRY_ERROR', OTHER: 'OTHER' })[input.reasonCode],
      input.note ?? null, actor.organizationId, actor.venueId, input.entryId],
    )
    await dissolveUnusedGroups(connection, actor, allocations.map((allocation) => allocation.group_id))
    const [updatedEntry] = await connection.execute<ResultSetHeader>(
      `UPDATE waitlist_entries SET status = 'CANCELLED', closed_at = UTC_TIMESTAMP(3),
         closed_by_user_id = ?, close_reason_code = ?, close_reason_note = ?,
         claimed_by_user_id = NULL, claimed_at = NULL, claim_expires_at = NULL,
         updated_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
      [actor.userId, input.reasonCode, input.note ?? null, actor.organizationId, actor.venueId, input.entryId, input.expectedVersion],
    )
    if (updatedEntry.affectedRows !== 1) throw new AppError(409, 'VERSION_CONFLICT', 'Khách chờ vừa được thay đổi. Vui lòng tải lại.')
    await auditEntry(connection, actor, input, 'WAITLIST_CANCELLED', {
      type: 'waitlist_cancelled', previousStatus: entry.status, status: 'CANCELLED',
      releasedAllocationIds: allocations.map((allocation) => Number(allocation.id)),
    })
    const updated = await readEntry(connection, actor, input.entryId)
    await connection.commit()
    return updated
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function recordWaitlistContact(actor: AuthenticatedActor, input: RecordContactInput): Promise<WaitlistEntryView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    await lockOpenEntry(connection, actor, input.entryId, input.expectedVersion)
    // The entry lock serializes numbering, including simultaneous contact records.
    const [attempts] = await connection.execute<(RowDataPacket & { next_attempt: number })[]>(
      `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next_attempt FROM waitlist_contact_attempts
       WHERE organization_id = ? AND venue_id = ? AND entry_id = ?`,
      [actor.organizationId, actor.venueId, input.entryId],
    )
    const attemptNo = Number(attempts[0]?.next_attempt)
    if (attemptNo > 65535) throw new AppError(409, 'CONTACT_ATTEMPT_LIMIT', 'Đã đạt giới hạn số lần liên hệ.')
    const [attempt] = await connection.execute<ResultSetHeader>(
      `INSERT INTO waitlist_contact_attempts
        (organization_id, venue_id, entry_id, attempt_no, attempted_by_user_id, channel, started_at, ended_at, outcome, note)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, actor.venueId, input.entryId, attemptNo, actor.userId, input.channel, input.outcome, input.note ?? null],
    )
    const [updatedEntry] = await connection.execute<ResultSetHeader>(
      `UPDATE waitlist_entries SET version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
      [actor.organizationId, actor.venueId, input.entryId, input.expectedVersion],
    )
    if (updatedEntry.affectedRows !== 1) throw new AppError(409, 'VERSION_CONFLICT', 'Khách chờ vừa được thay đổi. Vui lòng tải lại.')
    await auditEntry(connection, actor, input, 'WAITLIST_CONTACT_RECORDED', {
      type: 'waitlist_contact', attemptId: attempt.insertId, attemptNo, channel: input.channel, outcome: input.outcome,
    })
    const updated = await readEntry(connection, actor, input.entryId)
    await connection.commit()
    return updated
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function seatWaitlistEntry(
  actor: AuthenticatedActor,
  input: SeatWaitlistInput,
): Promise<{ entry: WaitlistEntryView; visitId: number }> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    // Match reservation cancellation/creation lock order: reservation before entry.
    const [linked] = await connection.execute<(RowDataPacket & { reservation_id: number | null })[]>(
      `SELECT reservation_id FROM waitlist_entries WHERE organization_id = ? AND venue_id = ? AND id = ?`,
      [actor.organizationId, actor.venueId, input.entryId],
    )
    if (linked[0]?.reservation_id) {
      await connection.execute(
        'SELECT id FROM reservations WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE',
        [actor.organizationId, actor.venueId, linked[0].reservation_id],
      )
    }
    const [entryRows] = await connection.execute<LockedWaitlistRow[]>(
      `SELECT id, kind, reservation_id, contact_name, party_size, business_date, status, version
       FROM waitlist_entries WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.entryId],
    )
    const entry = entryRows[0]
    if (!entry) throw new AppError(404, 'WAITLIST_NOT_FOUND', 'Không tìm thấy khách trong danh sách chờ.')
    if (entry.version !== input.expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Khách chờ vừa được thay đổi. Vui lòng tải lại.')
    }
    if (entry.kind === 'ADVANCE_RESERVATION') {
      for (const permission of ['table.assign', 'visit.checkin']) {
        if (!await hasPermission(actor, permission)) throw new AppError(403, 'PERMISSION_DENIED', 'Permission required for reservation seating.')
      }
      if (!entry.reservation_id) throw new AppError(409, 'WAITLIST_DATA_INCOMPLETE', 'Missing reservation.')
      if (!['WAITING', 'CONTACTING', 'OFFERED'].includes(entry.status)) {
        throw new AppError(409, 'WAITLIST_NOT_SEATABLE', 'Entry cannot be seated directly.')
      }
      const [reservations] = await connection.execute<(RowDataPacket & { version: number; business_date: Date | string })[]>(
        'SELECT version, business_date FROM reservations WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE',
        [actor.organizationId, actor.venueId, entry.reservation_id],
      )
      const reservation = reservations[0]
      if (!reservation) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Reservation not found.')
      if (dateOnly(reservation.business_date) !== dateOnly(entry.business_date)) {
        throw new AppError(409, 'BUSINESS_DATE_MISMATCH', 'Reservation date changed. Recreate the waitlist entry for the new date.')
      }
      await assignBookingTablesInTransaction(connection, actor, Number(entry.reservation_id), reservation.version, input.tableIds)
      const visitId = await checkInBookingInTransaction(connection, actor, Number(entry.reservation_id), reservation.version + 1)
      await connection.execute(
        `UPDATE waitlist_entries SET status = 'SEATED', visit_id = ?, closed_at = UTC_TIMESTAMP(3),
           closed_by_user_id = ?, claimed_by_user_id = NULL, claimed_at = NULL, claim_expires_at = NULL,
           updated_at = UTC_TIMESTAMP(3), version = version + 1
         WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
        [visitId, actor.userId, actor.organizationId, actor.venueId, input.entryId, input.expectedVersion],
      )
      await auditEntry(connection, actor, input, 'WAITLIST_SEATED', {
        type: 'waitlist_seated', reservationId: Number(entry.reservation_id), visitId, tableIds: input.tableIds,
      })
      const updated = await readEntry(connection, actor, input.entryId)
      await connection.commit()
      return { entry: updated, visitId }
    }
    if (entry.status !== 'WAITING') {
      throw new AppError(409, 'WAITLIST_NOT_SEATABLE', 'Chỉ khách đang chờ mới có thể được gán bàn trực tiếp.')
    }
    if (!entry.contact_name || entry.party_size === null) {
      throw new AppError(409, 'WAITLIST_DATA_INCOMPLETE', 'Thông tin khách chờ không đầy đủ.')
    }

    const tableIds = [...new Set(input.tableIds)].sort((left, right) => left - right)
    if (!tableIds.length) throw new AppError(400, 'TABLE_REQUIRED', 'Cần chọn ít nhất một bàn.')
    const placeholders = tableIds.map(() => '?').join(',')
    const [tables] = await connection.execute<(RowDataPacket & { id: number; code: string; is_spare: number })[]>(
      `SELECT id, code, is_spare FROM dining_tables
       WHERE organization_id = ? AND venue_id = ? AND status = 'ACTIVE' AND id IN (${placeholders})
       ORDER BY id FOR UPDATE`,
      [actor.organizationId, actor.venueId, ...tableIds],
    )
    if (tables.length !== tableIds.length) throw new AppError(400, 'TABLE_NOT_FOUND', 'Có bàn không tồn tại hoặc ngừng hoạt động.')
    const spareTable = tables.find((table) => Boolean(table.is_spare))
    if (spareTable) throw new AppError(409, 'SPARE_TABLE_NOT_BOOKABLE', `Bàn ${spareTable.code} là bàn sơ cua và chưa được cấu hình để nhận khách.`)
    const businessDate = dateOnly(entry.business_date)
    const [conflicts] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM table_allocations
       WHERE organization_id = ? AND venue_id = ? AND business_date = ?
         AND released_at IS NULL AND table_id IN (${placeholders})
       ORDER BY table_id, id FOR UPDATE`,
      [actor.organizationId, actor.venueId, businessDate, ...tableIds],
    )
    if (conflicts.length) throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc sử dụng.')

    const [visitResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO visits
        (organization_id, venue_id, origin, contact_name, guest_count, started_at,
         business_date, created_by_user_id)
       VALUES (?, ?, 'WALK_IN', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, actor.venueId, entry.contact_name, entry.party_size, businessDate, actor.userId],
    )
    const allocationIds: number[] = []
    for (const tableId of tableIds) {
      const [allocation] = await connection.execute<ResultSetHeader>(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, UTC_TIMESTAMP(3), ?, ?)`,
        [actor.organizationId, actor.venueId, tableId, visitResult.insertId, businessDate, actor.userId],
      )
      allocationIds.push(allocation.insertId)
    }
    const [entryUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE waitlist_entries
       SET status = 'SEATED', visit_id = ?, closed_at = UTC_TIMESTAMP(3), closed_by_user_id = ?,
           updated_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND status = 'WAITING' AND version = ?`,
      [visitResult.insertId, actor.userId, actor.organizationId, actor.venueId, input.entryId, input.expectedVersion],
    )
    if (entryUpdate.affectedRows !== 1) throw new AppError(409, 'VERSION_CONFLICT', 'Khách chờ vừa được thay đổi. Vui lòng tải lại.')

    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'WAITLIST_SEATED', 'waitlist_entry', ?, ?, ?, ?, 'STAFF_CONFIRMED', 0)`,
      [
        actor.organizationId, actor.venueId, changeSequence, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, input.entryId, input.expectedVersion, input.expectedVersion + 1,
        JSON.stringify([{ type: 'waitlist_seated', visitId: visitResult.insertId, allocationIds, tableIds }]),
      ],
    )

    const [updatedRows] = await connection.execute<WaitlistRow[]>(
      `${waitlistSelect} WHERE w.organization_id = ? AND w.venue_id = ? AND w.id = ?`,
      [actor.organizationId, actor.venueId, input.entryId],
    )
    const updated = updatedRows[0]
    if (!updated) throw new AppError(500, 'WAITLIST_READ_FAILED', 'Không đọc lại được khách vừa gán bàn.')
    await connection.commit()
    return { entry: toView(updated), visitId: visitResult.insertId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

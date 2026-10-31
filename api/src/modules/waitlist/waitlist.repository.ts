import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { protectPhoneNumber, type PhoneKeyRing, type ProtectedPhone } from '../bookings/phone-security.js'
import { createTableGroup, dissolveUnusedGroups, lockAndValidateWaitlistTables } from '../tables/table-group.repository.js'

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
  phoneLast3: string | null
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
  phone_last3: string | null
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
  customer_id: number | null
  party_size: number | null
  note: string | null
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
    phoneLast3: row.phone_last3,
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
  COALESCE(c.phone_last3, r.phone_last3) AS phone_last3,
  COALESCE(r.party_size, w.party_size) AS resolved_party_size,
  w.business_date, w.queued_at, w.status, w.contact_channel,
  w.reservation_id, r.expected_at AS reservation_expected_at, w.visit_id, w.note, w.version
FROM waitlist_entries AS w
LEFT JOIN reservations AS r ON r.organization_id = w.organization_id AND r.venue_id = w.venue_id AND r.id = w.reservation_id
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
} & ({ kind?: 'WALK_IN'; guestName: string; partySize: number; phoneNumber?: string }
  | { kind: 'ADVANCE_RESERVATION'; reservationId: number })

function phoneKeyRing(): PhoneKeyRing {
  const encryptionKeyId = env.phone.activeEncryptionKeyId
  const hmacKeyId = env.phone.activeHmacKeyId
  if (encryptionKeyId === undefined || hmacKeyId === undefined) {
    throw new AppError(503, 'PHONE_KEYS_UNAVAILABLE', 'Chức năng số điện thoại chưa được cấu hình.')
  }
  return {
    activeEncryptionKeyId: encryptionKeyId,
    encryptionKeys: env.phone.encryptionKeys,
    activeHmacKeyId: hmacKeyId,
    hmacKeys: env.phone.hmacKeys,
  }
}

function protectedPhoneValues(phone: ProtectedPhone): [Buffer, number, Buffer, number, string] {
  return [phone.ciphertext, phone.encryptionKeyId, phone.hmac, phone.hmacKeyId, phone.last3]
}

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
    let customerId: number | null = null
    if (input.kind !== 'ADVANCE_RESERVATION' && input.phoneNumber) {
      const phone = protectPhoneNumber(input.phoneNumber, phoneKeyRing())
      const [customers] = await connection.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM customers WHERE organization_id = ? AND phone_hmac = ? AND status = 'ACTIVE' FOR UPDATE`,
        [actor.organizationId, phone.hmac],
      )
      customerId = customers[0] ? Number(customers[0].id) : null
      if (customerId === null) {
        const [customer] = await connection.execute<ResultSetHeader>(
          `INSERT INTO customers
            (organization_id, display_name, name_search, phone_ciphertext, phone_key_id,
             phone_hmac, phone_hmac_key_id, phone_last3, created_by_user_id)
           VALUES (?, ?, LOWER(?), ?, ?, ?, ?, ?, ?)`,
          [actor.organizationId, input.guestName, input.guestName, ...protectedPhoneValues(phone), actor.userId],
        )
        customerId = customer.insertId
      }
      const [duplicates] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM waitlist_entries
         WHERE organization_id = ? AND venue_id = ? AND business_date = ? AND customer_id = ?
           AND status IN ('WAITING','CONTACTING','OFFERED','HOLD_ACTIVE')
         LIMIT 1 FOR UPDATE`,
        [actor.organizationId, actor.venueId, input.businessDate, customerId],
      )
      if (duplicates.length) {
        throw new AppError(409, 'WAITLIST_DUPLICATE', 'Số điện thoại này đã có trong danh sách chờ hiện tại.')
      }
    }
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO waitlist_entries
        (organization_id, venue_id, kind, reservation_id, customer_id, contact_name, party_size, preference_mode,
         contact_channel, business_date, queued_at, note, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ANY', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, actor.venueId, input.kind ?? 'WALK_IN',
        input.kind === 'ADVANCE_RESERVATION' ? input.reservationId : null, customerId,
        input.kind === 'ADVANCE_RESERVATION' || customerId !== null ? null : input.guestName,
        input.kind === 'ADVANCE_RESERVATION' ? null : input.partySize, input.contactChannel, input.businessDate, input.note ?? null, actor.userId],
    )
    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'WAITLIST_ADDED', 'waitlist_entry', ?, 1, ?, ?, 0)`,
      [actor.organizationId, actor.venueId, changeSequence, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, result.insertId,
        JSON.stringify([{ type: 'waitlist_added', kind: input.kind ?? 'WALK_IN',
          partySize: input.kind === 'ADVANCE_RESERVATION' ? null : input.partySize,
          ...(input.kind === 'ADVANCE_RESERVATION' ? { reservationId: input.reservationId } : {}) }]),
        `${input.kind ?? 'WALK_IN'}_WAITING`],
    )
    const [rows] = await connection.execute<WaitlistRow[]>(
      `${waitlistSelect} WHERE w.organization_id = ? AND w.venue_id = ? AND w.id = ?`,
      [actor.organizationId, actor.venueId, result.insertId],
    )
    const created = rows[0]
    if (!created) throw new AppError(500, 'WAITLIST_READ_FAILED', 'Không đọc lại được khách vừa thêm vào danh sách chờ.')
    await connection.commit()
    return toView(created)
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
): Promise<{ entry: WaitlistEntryView; reservationId: number; groupId: number | null }> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    // Match booking cancellation/check-in lock order: reservation before waitlist entry.
    const [linked] = await connection.execute<(RowDataPacket & { reservation_id: number | null })[]>(
      'SELECT reservation_id FROM waitlist_entries WHERE organization_id = ? AND venue_id = ? AND id = ?',
      [actor.organizationId, actor.venueId, input.entryId],
    )
    const [reservations] = linked[0]?.reservation_id
      ? await connection.execute<(RowDataPacket & { id: number; status: string; party_size: number; business_date: Date | string; version: number })[]>(
        'SELECT id, status, party_size, business_date, version FROM reservations WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE',
        [actor.organizationId, actor.venueId, linked[0].reservation_id],
      )
      : [[]]
    const linkedReservation = reservations[0]
    const [entryRows] = await connection.execute<LockedWaitlistRow[]>(
      `SELECT id, kind, reservation_id, customer_id, contact_name, party_size, note, business_date, status, version
       FROM waitlist_entries WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.entryId],
    )
    const entry = entryRows[0]
    if (!entry) throw new AppError(404, 'WAITLIST_NOT_FOUND', 'Không tìm thấy khách trong danh sách chờ.')
    if (entry.version !== input.expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Khách chờ vừa được thay đổi. Vui lòng tải lại.')
    }
    if (entry.kind === 'ADVANCE_RESERVATION') {
      if (!linkedReservation || Number(linkedReservation.id) !== Number(entry.reservation_id)) {
        throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy booking của khách chờ.')
      }
      if (linkedReservation.status !== 'BOOKED') throw new AppError(409, 'BOOKING_NOT_ASSIGNABLE', 'Booking không còn ở trạng thái chờ.')
      if (dateOnly(linkedReservation.business_date) !== dateOnly(entry.business_date)) {
        throw new AppError(409, 'BUSINESS_DATE_MISMATCH', 'Ngày booking đã đổi. Vui lòng tạo lại khách chờ.')
      }
      const [holds] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM table_holds WHERE organization_id = ? AND venue_id = ? AND reservation_id = ?
         AND (status = 'ACTIVE' OR EXISTS (SELECT 1 FROM table_allocations a
           WHERE a.organization_id = table_holds.organization_id AND a.venue_id = table_holds.venue_id
             AND a.hold_id = table_holds.id AND a.released_at IS NULL)) FOR UPDATE`,
        [actor.organizationId, actor.venueId, entry.reservation_id],
      )
      if (holds.length) throw new AppError(409, 'BOOKING_ALREADY_ASSIGNED', 'Booking đã được giữ bàn.')
      entry.party_size = linkedReservation.party_size
    }
    if (entry.kind === 'WALK_IN' ? entry.status !== 'WAITING' : !['WAITING', 'CONTACTING', 'OFFERED'].includes(entry.status)) {
      throw new AppError(409, 'WAITLIST_NOT_SEATABLE', 'Khách chờ không thể được gán bàn trực tiếp.')
    }
    if ((entry.kind === 'WALK_IN' && !entry.contact_name && entry.customer_id === null) || entry.party_size === null) {
      throw new AppError(409, 'WAITLIST_DATA_INCOMPLETE', 'Thông tin khách chờ không đầy đủ.')
    }

    const tableIds = [...new Set(input.tableIds)].sort((left, right) => left - right)
    if (!tableIds.length) throw new AppError(400, 'TABLE_REQUIRED', 'Cần chọn ít nhất một bàn.')
    const placeholders = tableIds.map(() => '?').join(',')
    const tables = await lockAndValidateWaitlistTables(connection, actor, tableIds)
    const capacity = tables.reduce((total, table) => total + Number(table.capacity), 0)
    if (capacity < Number(entry.party_size)) {
      throw new AppError(409, 'INSUFFICIENT_TABLE_CAPACITY', `Bàn đã chọn chỉ có ${capacity} chỗ cho ${entry.party_size} khách.`)
    }
    const businessDate = dateOnly(entry.business_date)
    const [conflicts] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM table_allocations
       WHERE organization_id = ? AND venue_id = ? AND business_date = ?
         AND released_at IS NULL AND table_id IN (${placeholders})
       ORDER BY table_id, id FOR UPDATE`,
      [actor.organizationId, actor.venueId, businessDate, ...tableIds],
    )
    if (conflicts.length) throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc sử dụng.')

    let reservationId = Number(entry.reservation_id)
    if (entry.kind === 'WALK_IN') {
      const [sourceRows] = await connection.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM booking_sources WHERE organization_id = ? AND code = 'OTHER' AND is_active = 1 LIMIT 1`,
        [actor.organizationId],
      )
      const source = sourceRows[0]
      if (!source) throw new AppError(409, 'WAITLIST_BOOKING_SOURCE_MISSING', 'Cần cấu hình nguồn booking OTHER trước khi gán khách chờ.')
      const [createdReservation] = await connection.execute<ResultSetHeader>(
        `INSERT INTO reservations
          (organization_id, venue_id, customer_id, contact_name, contact_name_search, source_id,
           party_size, expected_at, business_date, customer_classification, status, note, created_by_user_id)
         VALUES (?, ?, ?, ?, LOWER(?), ?, ?, UTC_TIMESTAMP(3), ?, 'UNCLASSIFIED', 'BOOKED', ?, ?)`,
        [actor.organizationId, actor.venueId, entry.customer_id,
          entry.customer_id === null ? entry.contact_name : null,
          entry.customer_id === null ? entry.contact_name : null,
          source.id, entry.party_size, businessDate, entry.note, actor.userId],
      )
      reservationId = createdReservation.insertId
    } else {
      await connection.execute(
        `UPDATE reservations SET version = version + 1, updated_by_user_id = ?, updated_at = UTC_TIMESTAMP(3)
         WHERE organization_id = ? AND venue_id = ? AND id = ? AND status = 'BOOKED' AND version = ?`,
        [actor.userId, actor.organizationId, actor.venueId, reservationId, linkedReservation!.version],
      )
    }
    const [hold] = await connection.execute<ResultSetHeader>(
      `INSERT INTO table_holds
        (organization_id, venue_id, hold_kind, reservation_id, starts_at, created_by_user_id)
       VALUES (?, ?, 'RESERVATION', ?, UTC_TIMESTAMP(3), ?)`,
      [actor.organizationId, actor.venueId, reservationId, actor.userId],
    )
    const group = tableIds.length > 1
      ? await createTableGroup(connection, actor, businessDate)
      : null
    const allocationIds: number[] = []
    for (const tableId of tableIds) {
      const [allocation] = await connection.execute<ResultSetHeader>(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, hold_id, group_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'HOLD', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
        [actor.organizationId, actor.venueId, tableId, hold.insertId, group?.id ?? null, businessDate, actor.userId],
      )
      allocationIds.push(allocation.insertId)
    }
    const [entryUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE waitlist_entries
       SET kind = 'ADVANCE_RESERVATION', reservation_id = ?, customer_id = NULL,
           contact_name = NULL, party_size = NULL, status = 'HOLD_ACTIVE',
           claimed_by_user_id = NULL, claimed_at = NULL, claim_expires_at = NULL,
           updated_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
      [reservationId, actor.organizationId, actor.venueId, input.entryId, input.expectedVersion],
    )
    if (entryUpdate.affectedRows !== 1) throw new AppError(409, 'VERSION_CONFLICT', 'Khách chờ vừa được thay đổi. Vui lòng tải lại.')

    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'WAITLIST_ASSIGNED_TO_RESERVATION', 'waitlist_entry', ?, ?, ?, ?, 'STAFF_CONFIRMED', 0)`,
      [
        actor.organizationId, actor.venueId, changeSequence, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, input.entryId, input.expectedVersion, input.expectedVersion + 1,
        JSON.stringify([{ type: 'waitlist_assigned', reservationId, holdId: hold.insertId,
          groupId: group?.id ?? null, allocationIds, tableIds }]),
      ],
    )

    const [updatedRows] = await connection.execute<WaitlistRow[]>(
      `${waitlistSelect} WHERE w.organization_id = ? AND w.venue_id = ? AND w.id = ?`,
      [actor.organizationId, actor.venueId, input.entryId],
    )
    const updated = updatedRows[0]
    if (!updated) throw new AppError(500, 'WAITLIST_READ_FAILED', 'Không đọc lại được khách vừa gán bàn.')
    await connection.commit()
    return { entry: toView(updated), reservationId, groupId: group?.id ?? null }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

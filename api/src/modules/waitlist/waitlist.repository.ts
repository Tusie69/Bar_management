import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

export type WaitlistStatus = 'WAITING' | 'CONTACTING' | 'OFFERED' | 'HOLD_ACTIVE' | 'SEATED' | 'DECLINED' | 'CANCELLED'
export type ContactChannel = 'IN_PERSON' | 'PHONE_CALLBACK' | 'ZALO_THREAD' | 'FANPAGE_THREAD' | 'OTHER'

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
  visit_id: number | null
  note: string | null
  version: number
}

interface LockedWaitlistRow extends RowDataPacket {
  id: number
  kind: 'ADVANCE_RESERVATION' | 'WALK_IN'
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
    visitId: row.visit_id === null ? null : Number(row.visit_id),
    note: row.note,
    version: row.version,
  }
}

const waitlistSelect = `SELECT w.id, w.kind,
  COALESCE(c.display_name, r.contact_name, w.contact_name, 'Khách chờ') AS guest_name,
  COALESCE(r.party_size, w.party_size) AS resolved_party_size,
  w.business_date, w.queued_at, w.status, w.contact_channel,
  w.reservation_id, w.visit_id, w.note, w.version
FROM waitlist_entries AS w
LEFT JOIN reservations AS r ON r.venue_id = w.venue_id AND r.id = w.reservation_id
LEFT JOIN customers AS c ON c.organization_id = w.organization_id
  AND c.id = COALESCE(r.customer_id, w.customer_id)`

export async function listWaitlist(actor: AuthenticatedActor, businessDate: string): Promise<WaitlistEntryView[]> {
  const [rows] = await databasePool.execute<WaitlistRow[]>(
    `${waitlistSelect}
     WHERE w.organization_id = ? AND w.venue_id = ? AND w.business_date = ?
     ORDER BY FIELD(w.status, 'WAITING','CONTACTING','OFFERED','HOLD_ACTIVE','SEATED','DECLINED','CANCELLED'),
       w.priority_class, w.queued_at, w.id`,
    [actor.organizationId, actor.venueId, businessDate],
  )
  return rows.map(toView)
}

export interface CreateWaitlistInput {
  guestName: string
  partySize: number
  businessDate: string
  contactChannel: ContactChannel
  note?: string
}

export async function createWaitlistEntry(
  actor: AuthenticatedActor,
  input: CreateWaitlistInput,
): Promise<WaitlistEntryView> {
  const [result] = await databasePool.execute<ResultSetHeader>(
    `INSERT INTO waitlist_entries
      (organization_id, venue_id, kind, contact_name, party_size, preference_mode,
       contact_channel, business_date, queued_at, note, created_by_user_id)
     VALUES (?, ?, 'WALK_IN', ?, ?, 'ANY', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
    [actor.organizationId, actor.venueId, input.guestName, input.partySize, input.contactChannel,
      input.businessDate, input.note ?? null, actor.userId],
  )
  const [rows] = await databasePool.execute<WaitlistRow[]>(
    `${waitlistSelect} WHERE w.organization_id = ? AND w.venue_id = ? AND w.id = ?`,
    [actor.organizationId, actor.venueId, result.insertId],
  )
  const created = rows[0]
  if (!created) throw new AppError(500, 'WAITLIST_READ_FAILED', 'Không đọc lại được khách vừa thêm vào danh sách chờ.')
  return toView(created)
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

export async function seatWaitlistEntry(
  actor: AuthenticatedActor,
  input: SeatWaitlistInput,
): Promise<{ entry: WaitlistEntryView; visitId: number }> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [entryRows] = await connection.execute<LockedWaitlistRow[]>(
      `SELECT id, kind, contact_name, party_size, business_date, status, version
       FROM waitlist_entries WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.entryId],
    )
    const entry = entryRows[0]
    if (!entry) throw new AppError(404, 'WAITLIST_NOT_FOUND', 'Không tìm thấy khách trong danh sách chờ.')
    if (entry.version !== input.expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Khách chờ vừa được thay đổi. Vui lòng tải lại.')
    }
    if (entry.kind !== 'WALK_IN') {
      throw new AppError(409, 'WAITLIST_KIND_UNSUPPORTED', 'Khách chờ gắn booking phải được xử lý từ booking để tránh tạo trùng.')
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

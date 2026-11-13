/**
 * Gọi khách chờ và khách đang ngồi, kể cả khi chưa có booking.
 *
 * Booking đã có đường gọi riêng trong booking.repository.ts vì kết quả
 * "Tới muộn" còn chuyển trạng thái đặt bàn. Đơn chờ và lượt ghé thì không có
 * gì để chuyển, nên chúng dùng chung một đường ngắn ở đây: mở trình gọi, ghi
 * log, ghi kết quả Đã liên hệ / Không nghe máy.
 *
 * Số điện thoại luôn nằm ở customers; đơn chờ và lượt ghé chỉ giữ customer_id.
 * Một đơn chờ loại ADVANCE_RESERVATION hoặc một lượt ghé check-in từ booking
 * còn có thể lấy số từ chính booking đó, nên truy vấn COALESCE cả hai nguồn
 * theo đúng thứ tự booking trước, khách hàng sau - giống hệt đường booking.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { applicationNow } from '../../time/application-clock.js'
import { revealPhoneNumber, type PhoneKeyRing } from '../bookings/phone-security.js'

/** Kết quả mà một cuộc gọi không gắn booking có thể nhận. */
export type ContactCallOutcome = 'CONTACTED' | 'NO_ANSWER'

export type ContactCallTargetKind = 'WAITLIST_ENTRY' | 'VISIT'

export interface ContactCallTarget {
  kind: ContactCallTargetKind
  id: number
}

export interface ContactCallStartResult {
  callId: number
  targetKind: ContactCallTargetKind
  targetId: number
  initiatedAt: string
  telUri: string
}

export interface ContactCallHistoryEntry {
  callId: number
  initiatedAt: string
  initiatedBy: string
  outcome: ContactCallOutcome | null
  outcomeAt: string | null
  outcomeBy: string | null
}

export interface ContactCallOutcomeResult {
  callId: number
  targetKind: ContactCallTargetKind
  targetId: number
  outcome: ContactCallOutcome
  outcomeAt: string
}

interface PhoneRow extends RowDataPacket {
  phone_ciphertext: Buffer | null
  phone_key_id: number | null
}

interface HistoryRow extends RowDataPacket {
  id: number
  initiated_at: Date | string
  initiated_by: string | null
  outcome: string | null
  outcome_at: Date | string | null
  outcome_by: string | null
}

interface StoredCallRow extends RowDataPacket {
  id: number
  outcome: ContactCallOutcome | null
  outcome_at: Date | string | null
}

function isoDateTime(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(`${String(value).replace(' ', 'T')}Z`).toISOString()
}

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

/** Cột khóa ngoại tương ứng, dùng cho cả ghi lẫn đọc lịch sử. */
function columnOf(kind: ContactCallTargetKind): 'waitlist_entry_id' | 'visit_id' {
  return kind === 'WAITLIST_ENTRY' ? 'waitlist_entry_id' : 'visit_id'
}

function notFound(kind: ContactCallTargetKind): AppError {
  return kind === 'WAITLIST_ENTRY'
    ? new AppError(404, 'WAITLIST_ENTRY_NOT_FOUND', 'Không tìm thấy mục chờ.')
    : new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách.')
}

const WAITLIST_PHONE_SQL = `SELECT
     COALESCE(r.phone_ciphertext, rc.phone_ciphertext, c.phone_ciphertext) AS phone_ciphertext,
     COALESCE(r.phone_key_id, rc.phone_key_id, c.phone_key_id) AS phone_key_id
   FROM waitlist_entries w
   LEFT JOIN reservations r ON r.venue_id = w.venue_id AND r.id = w.reservation_id
   LEFT JOIN customers rc ON rc.organization_id = r.organization_id AND rc.id = r.customer_id
   LEFT JOIN customers c ON c.organization_id = w.organization_id AND c.id = w.customer_id
   WHERE w.organization_id = ? AND w.venue_id = ? AND w.id = ?`

const VISIT_PHONE_SQL = `SELECT
     COALESCE(r.phone_ciphertext, rc.phone_ciphertext, c.phone_ciphertext) AS phone_ciphertext,
     COALESCE(r.phone_key_id, rc.phone_key_id, c.phone_key_id) AS phone_key_id
   FROM visits v
   LEFT JOIN reservations r ON r.venue_id = v.venue_id AND r.visit_id = v.id
   LEFT JOIN customers rc ON rc.organization_id = r.organization_id AND rc.id = r.customer_id
   LEFT JOIN customers c ON c.organization_id = v.organization_id AND c.id = v.customer_id
   WHERE v.organization_id = ? AND v.venue_id = ? AND v.id = ?`

/**
 * Mở trình gọi cho một đơn chờ hoặc một lượt ghé.
 *
 * Không chặn theo trạng thái: một đơn đã đóng vẫn có thể cần gọi lại để xin
 * lỗi, và một lượt ghé đã kết thúc vẫn là người bỏ quên đồ trên bàn. Điều
 * kiện duy nhất là có số gọi được, đúng như đường booking.
 */
export async function initiateContactCall(
  actor: AuthenticatedActor,
  target: ContactCallTarget,
  now = applicationNow(),
): Promise<ContactCallStartResult> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<PhoneRow[]>(
      target.kind === 'WAITLIST_ENTRY' ? WAITLIST_PHONE_SQL : VISIT_PHONE_SQL,
      [actor.organizationId, actor.venueId, target.id],
    )
    const found = rows[0]
    if (!found) throw notFound(target.kind)
    if (!found.phone_ciphertext || found.phone_key_id === null) {
      throw new AppError(422, 'CONTACT_PHONE_UNAVAILABLE', 'Khách này chưa có số điện thoại hợp lệ.')
    }
    const phone = revealPhoneNumber(found.phone_ciphertext, Number(found.phone_key_id), phoneKeyRing())
    const initiatedAt = now.toISOString()
    const mysqlNow = initiatedAt.slice(0, 23).replace('T', ' ')
    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO booking_call_logs
       (organization_id, venue_id, ${columnOf(target.kind)}, initiated_by_user_id, initiated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, target.id, actor.userId, mysqlNow],
    )
    await connection.execute(
      `INSERT INTO operation_log
       (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
        action, entity_type, entity_id, changes, reason_code, is_undoable)
       VALUES (?, ?, 'USER', ?, ?, ?, 'CONTACT_CALL_INITIATED', ?, ?, ?, 'CALL_CUSTOMER', 0)`,
      [actor.organizationId, actor.venueId, actor.userId, actor.membershipId, actor.authSessionId ?? null,
        target.kind === 'WAITLIST_ENTRY' ? 'waitlist_entry' : 'visit', target.id,
        JSON.stringify([{ type: 'contact_call', callId: insert.insertId }])],
    )
    await connection.commit()
    return {
      callId: insert.insertId,
      targetKind: target.kind,
      targetId: target.id,
      initiatedAt,
      telUri: `tel:${phone}`,
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

/** Các lần đã gọi đối tượng này, mới nhất trước. Không trả về số nào. */
export async function listContactCalls(
  actor: AuthenticatedActor,
  target: ContactCallTarget,
): Promise<ContactCallHistoryEntry[]> {
  const [rows] = await databasePool.execute<HistoryRow[]>(
    `SELECT l.id, l.initiated_at, iu.display_name AS initiated_by,
            l.outcome, l.outcome_at, ou.display_name AS outcome_by
       FROM booking_call_logs l
       JOIN users iu ON iu.id = l.initiated_by_user_id
       LEFT JOIN users ou ON ou.id = l.outcome_by_user_id
      WHERE l.organization_id = ? AND l.venue_id = ? AND l.${columnOf(target.kind)} = ?
      ORDER BY l.initiated_at DESC, l.id DESC
      LIMIT 50`,
    [actor.organizationId, actor.venueId, target.id],
  )
  return rows.map((row) => ({
    callId: Number(row.id),
    initiatedAt: isoDateTime(row.initiated_at),
    initiatedBy: row.initiated_by ?? 'Không rõ',
    outcome: (row.outcome as ContactCallOutcome | null) ?? null,
    outcomeAt: row.outcome_at === null ? null : isoDateTime(row.outcome_at),
    outcomeBy: row.outcome_by ?? null,
  }))
}

/**
 * Ghi kết quả một lần gọi. Lặp lại cùng kết quả thì trả về kết quả đã lưu,
 * giống đường booking: mạng chập chờn không được tạo ra dòng thứ hai.
 */
export async function recordContactCallOutcome(
  actor: AuthenticatedActor,
  target: ContactCallTarget,
  callId: number,
  outcome: ContactCallOutcome,
  now = applicationNow(),
): Promise<ContactCallOutcomeResult> {
  const connection = await databasePool.getConnection()
  const column = columnOf(target.kind)
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<StoredCallRow[]>(
      `SELECT id, outcome, outcome_at FROM booking_call_logs
       WHERE organization_id = ? AND venue_id = ? AND ${column} = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, target.id, callId],
    )
    const existing = rows[0]
    if (!existing) throw new AppError(404, 'BOOKING_CALL_NOT_FOUND', 'Không tìm thấy lần gọi khách.')
    if (existing.outcome !== null) {
      if (existing.outcome !== outcome) {
        throw new AppError(409, 'BOOKING_CALL_OUTCOME_CONFLICT', 'Lần gọi này đã có kết quả khác.')
      }
      await connection.commit()
      return {
        callId,
        targetKind: target.kind,
        targetId: target.id,
        outcome,
        outcomeAt: isoDateTime(existing.outcome_at!),
      }
    }
    const outcomeAt = now.toISOString()
    const mysqlNow = outcomeAt.slice(0, 23).replace('T', ' ')
    await connection.execute(
      `UPDATE booking_call_logs SET outcome = ?, outcome_by_user_id = ?, outcome_at = ?
       WHERE organization_id = ? AND venue_id = ? AND ${column} = ? AND id = ?`,
      [outcome, actor.userId, mysqlNow, actor.organizationId, actor.venueId, target.id, callId],
    )
    await connection.commit()
    return { callId, targetKind: target.kind, targetId: target.id, outcome, outcomeAt }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

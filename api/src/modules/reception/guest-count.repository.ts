import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'

export interface GuestCountValues {
  arrivedBefore: number
  arrivedAfter: number
  arrivedTotal: number
  bookedTables: number
  bookedGuests: number
  returningGuests: number
}

export interface GuestCountRecord extends GuestCountValues {
  businessDate: string
  version: number
  updatedAt: string | null
}

export interface GuestCountUpdate extends GuestCountValues {
  businessDate: string
  expectedVersion: number
}

interface GuestCountRow extends RowDataPacket {
  id: number
  business_date: Date | string
  arrived_before: number
  arrived_after: number
  arrived_total: number
  booked_tables: number
  booked_guests: number
  returning_guests: number
  updated_at: Date | string
  version: number
}

const EMPTY_VALUES: GuestCountValues = {
  arrivedBefore: 0,
  arrivedAfter: 0,
  arrivedTotal: 0,
  bookedTables: 0,
  bookedGuests: 0,
  returningGuests: 0,
}

function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

function isoDateTime(value: Date | string): string {
  return (typeof value === 'string' ? new Date(`${value.replace(' ', 'T')}Z`) : value).toISOString()
}

function publicRecord(row: GuestCountRow): GuestCountRecord {
  return {
    businessDate: dateOnly(row.business_date),
    arrivedBefore: Number(row.arrived_before),
    arrivedAfter: Number(row.arrived_after),
    arrivedTotal: Number(row.arrived_total),
    bookedTables: Number(row.booked_tables),
    bookedGuests: Number(row.booked_guests),
    returningGuests: Number(row.returning_guests),
    version: Number(row.version),
    updatedAt: isoDateTime(row.updated_at),
  }
}

export async function getReceptionGuestCount(
  actor: Pick<AuthenticatedActor, 'organizationId' | 'venueId'>,
  businessDate: string,
): Promise<GuestCountRecord> {
  const [rows] = await databasePool.execute<GuestCountRow[]>(
    `SELECT id, business_date, arrived_before, arrived_after, arrived_total,
       booked_tables, booked_guests, returning_guests, updated_at, version
     FROM reception_guest_counts
     WHERE organization_id = ? AND venue_id = ? AND business_date = ?`,
    [actor.organizationId, actor.venueId, businessDate],
  )
  return rows[0]
    ? publicRecord(rows[0])
    : { businessDate, ...EMPTY_VALUES, version: 0, updatedAt: null }
}

export async function updateReceptionGuestCount(
  actor: AuthenticatedActor,
  input: GuestCountUpdate,
): Promise<{ guestCount: GuestCountRecord; changeSeq: string }> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [venueRows] = await connection.execute<(RowDataPacket & { change_seq: string })[]>(
      `SELECT change_seq FROM venues
       WHERE organization_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
      [actor.organizationId, actor.venueId],
    )
    const venue = venueRows[0]
    if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')

    const [rows] = await connection.execute<GuestCountRow[]>(
      `SELECT id, business_date, arrived_before, arrived_after, arrived_total,
         booked_tables, booked_guests, returning_guests, updated_at, version
       FROM reception_guest_counts
       WHERE organization_id = ? AND venue_id = ? AND business_date = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.businessDate],
    )
    const current = rows[0]
    const currentVersion = Number(current?.version ?? 0)
    if (input.expectedVersion !== currentVersion) {
      throw new AppError(
        409,
        'GUEST_COUNT_VERSION_CONFLICT',
        'Bộ đếm khách vừa được cập nhật trên máy khác. Vui lòng tải dữ liệu mới.',
        { currentVersion },
      )
    }

    let entityId: number
    const nextVersion = currentVersion + 1
    if (current) {
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE reception_guest_counts
         SET arrived_before = ?, arrived_after = ?, arrived_total = ?, booked_tables = ?,
           booked_guests = ?, returning_guests = ?, updated_by_user_id = ?,
           updated_at = UTC_TIMESTAMP(3), version = version + 1
         WHERE organization_id = ? AND venue_id = ? AND business_date = ? AND version = ?`,
        [
          input.arrivedBefore,
          input.arrivedAfter,
          input.arrivedTotal,
          input.bookedTables,
          input.bookedGuests,
          input.returningGuests,
          actor.userId,
          actor.organizationId,
          actor.venueId,
          input.businessDate,
          currentVersion,
        ],
      )
      if (updated.affectedRows !== 1) {
        throw new AppError(409, 'GUEST_COUNT_VERSION_CONFLICT', 'Bộ đếm khách vừa được cập nhật trên máy khác.')
      }
      entityId = Number(current.id)
    } else {
      const [inserted] = await connection.execute<ResultSetHeader>(
        `INSERT INTO reception_guest_counts
          (organization_id, venue_id, business_date, arrived_before, arrived_after,
           arrived_total, booked_tables, booked_guests, returning_guests,
           created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          actor.organizationId,
          actor.venueId,
          input.businessDate,
          input.arrivedBefore,
          input.arrivedAfter,
          input.arrivedTotal,
          input.bookedTables,
          input.bookedGuests,
          input.returningGuests,
          actor.userId,
          actor.userId,
        ],
      )
      entityId = inserted.insertId
    }

    const changeSeq = (BigInt(venue.change_seq) + 1n).toString()
    await connection.execute<ResultSetHeader>(
      `UPDATE venues SET change_seq = ?, updated_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE organization_id = ? AND id = ?`,
      [changeSeq, actor.organizationId, actor.venueId],
    )
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'RECEPTION_GUEST_COUNT_UPDATED',
         'guest_count', ?, ?, ?, ?, 'MANUAL', 0)`,
      [
        actor.organizationId,
        actor.venueId,
        changeSeq,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        entityId,
        currentVersion || null,
        nextVersion,
        JSON.stringify([
          {
            type: 'guest_count_values',
            before: current ? publicRecord(current) : EMPTY_VALUES,
            after: {
              arrivedBefore: input.arrivedBefore,
              arrivedAfter: input.arrivedAfter,
              arrivedTotal: input.arrivedTotal,
              bookedTables: input.bookedTables,
              bookedGuests: input.bookedGuests,
              returningGuests: input.returningGuests,
            },
          },
        ]),
      ],
    )

    const [savedRows] = await connection.execute<GuestCountRow[]>(
      `SELECT id, business_date, arrived_before, arrived_after, arrived_total,
         booked_tables, booked_guests, returning_guests, updated_at, version
       FROM reception_guest_counts WHERE id = ?`,
      [entityId],
    )
    const saved = savedRows[0]
    if (!saved) throw new AppError(500, 'GUEST_COUNT_SAVE_FAILED', 'Không đọc lại được bộ đếm vừa lưu.')
    await connection.commit()
    return { guestCount: publicRecord(saved), changeSeq }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

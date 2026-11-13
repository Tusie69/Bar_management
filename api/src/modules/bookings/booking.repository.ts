import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { assertNoteHasNoPhoneNumber, redactPhoneNumbersInNote } from '../../security/note-privacy.js'
import { applicationNow } from '../../time/application-clock.js'
import { normalizeSearchText } from '../../lib/search-text.js'
import { assertCheckInBusinessDate, currentBusinessDate, validateBookingSchedule } from './business-date.js'
import { deriveBookingTiming, type BookingDisplayStatus } from './booking-timing.js'
import { canCallBooking } from './booking-call.js'
import {
  resolveBookingMetadata,
  type BookingClassification,
  type GuestType,
} from './booking-metadata.js'
import {
  honorificFrom,
  iconKeysFrom,
  resolveSocialPlatform,
  socialPlatformFrom,
  type BookingIconFlags,
  type BookingIconKey,
  type Honorific,
  type SocialPlatform,
} from './booking-flags.js'
import { protectPhoneNumber, revealPhoneNumber, type PhoneKeyRing, type ProtectedPhone } from './phone-security.js'
import { lockOccupancyConflicts } from '../tables/table-occupancy.js'
import { acknowledgeCapacity } from '../tables/table-capacity.js'
import { resolveLayoutExpansion } from '../tables/table-layout-group.repository.js'
import {
  createTableGroup,
  dissolveUnusedGroups,
  lockAndValidateAssignableTables,
  lockAndValidateSameKindTables,
  lockAndValidateSameZoneTables,
} from '../tables/table-group.repository.js'

export type BookingStatus = 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW'
export type { BookingClassification } from './booking-metadata.js'

export interface BookingView {
  id: number
  guestName: string
  hasGuestName: boolean
  phoneLast3: string | null
  partySize: number
  expectedAt: string
  businessDate: string
  classification: BookingClassification
  guestType: GuestType | null
  isBirthday: boolean
  /** 0016's is_boss_table/is_designated, as the icon keys the clients speak. */
  iconKeys: BookingIconKey[]
  honorific: Honorific | null
  /** Always null unless the source is SOCIAL. */
  socialPlatform: SocialPlatform | null
  status: BookingStatus
  source: string
  sourceCode: string
  tableCodes: string[]
  note: string | null
  version: number
  displayStatus: BookingDisplayStatus
  minutesLate: number
  autoNoShowDue: boolean
  lateConfirmedAt: string | null
  canCall: boolean
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
  has_guest_name: number
  phone_last3: string | null
  party_size: number
  expected_at: Date | string
  business_date: Date | string
  customer_classification: BookingClassification | null
  guest_type: GuestType | null
  is_birthday: number
  is_boss_table: number
  is_designated: number
  social_platform: string | null
  honorific: string | null
  status: BookingStatus
  source_name: string
  source_code: string
  table_codes: string | null
  note: string | null
  version: number
  upcoming_warning_minutes: number
  late_warning_minutes: number
  no_show_warning_minutes: number
  late_confirmed_at: Date | string | null
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function toBooking(row: BookingRow, now = applicationNow()): BookingView {
  const timing = deriveBookingTiming(
    row.status,
    isoDateTime(row.expected_at),
    now,
    {
      upcomingMinutes: Number(row.upcoming_warning_minutes),
      lateAfterMinutes: Number(row.late_warning_minutes),
      noShowAfterMinutes: Number(row.no_show_warning_minutes),
    },
  )
  const businessDate = dateOnly(row.business_date)
  return {
    id: Number(row.id),
    guestName: row.guest_name,
    hasGuestName: Number(row.has_guest_name) !== 0,
    phoneLast3: row.phone_last3,
    partySize: row.party_size,
    expectedAt: isoDateTime(row.expected_at),
    businessDate,
    classification: row.customer_classification ?? 'UNCLASSIFIED',
    guestType: row.guest_type,
    isBirthday: Boolean(row.is_birthday),
    iconKeys: iconKeysFrom(row.is_boss_table, row.is_designated),
    honorific: honorificFrom(row.honorific),
    socialPlatform: socialPlatformFrom(row.social_platform),
    status: row.status,
    source: row.source_name,
    sourceCode: row.source_code,
    tableCodes: row.table_codes ? row.table_codes.split(',') : [],
    note: redactPhoneNumbersInNote(row.note),
    version: row.version,
    lateConfirmedAt: row.late_confirmed_at === null ? null : isoDateTime(row.late_confirmed_at),
    canCall: canCallBooking({
      status: row.status,
      expectedAt: isoDateTime(row.expected_at),
      businessDate,
      lateConfirmedAt: row.late_confirmed_at,
      hasPhone: row.phone_last3 !== null,
      now,
      thresholds: {
        upcomingMinutes: Number(row.upcoming_warning_minutes),
        lateAfterMinutes: Number(row.late_warning_minutes),
        noShowAfterMinutes: Number(row.no_show_warning_minutes),
      },
    }),
    ...timing,
  }
}

const bookingSelect = `SELECT
  r.id, COALESCE(r.contact_name, c.display_name, 'Khách') AS guest_name,
  (c.display_name IS NOT NULL OR r.contact_name IS NOT NULL) AS has_guest_name,
  COALESCE(r.phone_last3, c.phone_last3) AS phone_last3, r.party_size, r.expected_at, r.business_date,
  r.customer_classification, r.guest_type, r.is_birthday, r.status,
  r.is_boss_table, r.is_designated, r.social_platform, r.honorific,
  bs.name AS source_name, bs.code AS source_code, r.note, r.version, r.late_confirmed_at,
  v.upcoming_warning_minutes, v.late_warning_minutes, v.no_show_warning_minutes,
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
     WHERE r.organization_id = ? AND r.venue_id = ? AND r.business_date = ?
     GROUP BY r.id, c.display_name, r.contact_name, r.phone_last3, c.phone_last3, r.party_size, r.expected_at,
       r.business_date, r.customer_classification, r.guest_type, r.is_birthday,
       r.is_boss_table, r.is_designated, r.social_platform, r.honorific, r.status, bs.name, bs.code, r.note, r.version,
       v.upcoming_warning_minutes, v.late_warning_minutes, v.no_show_warning_minutes
     ORDER BY r.expected_at, r.id`,
    [actor.organizationId, actor.venueId, businessDate],
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
         LOCATE(?, LOWER(COALESCE(r.contact_name, c.display_name, ''))) > 0
         OR (? IS NOT NULL AND COALESCE(r.phone_last3, c.phone_last3) = ?)
       )
     GROUP BY r.id, c.display_name, r.contact_name, r.phone_last3, c.phone_last3, r.party_size, r.expected_at,
       r.business_date, r.customer_classification, r.guest_type, r.is_birthday,
       r.is_boss_table, r.is_designated, r.social_platform, r.honorific, r.status, bs.name, bs.code, r.note, r.version,
       v.upcoming_warning_minutes, v.late_warning_minutes, v.no_show_warning_minutes
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
     WHERE r.organization_id = ? AND r.venue_id = ? AND r.id = ?
     GROUP BY r.id, c.display_name, r.contact_name, r.phone_last3, c.phone_last3, r.party_size, r.expected_at,
       r.business_date, r.customer_classification, r.guest_type, r.is_birthday,
       r.is_boss_table, r.is_designated, r.social_platform, r.honorific, r.status, bs.name, bs.code, r.note, r.version,
       v.upcoming_warning_minutes, v.late_warning_minutes, v.no_show_warning_minutes`,
    [actor.organizationId, actor.venueId, id],
  )
  const row = rows[0]
  if (!row) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đặt bàn.')
  return toBooking(row)
}

export interface CreateBookingInput {
  guestName?: string
  partySize: number
  expectedAt: string
  businessDate: string
  sourceCode: string
  note?: string | null
  phoneNumber?: string | null
  classification?: BookingClassification
  guestType?: GuestType | null
  isBirthday?: boolean
  /** Absent means "no icon"; the icon keys arrive parsed into their columns. */
  iconFlags?: BookingIconFlags
  honorific?: Honorific | null
  /** Ignored unless sourceCode is SOCIAL. */
  socialPlatform?: SocialPlatform | null
}

export interface CreateAndAssignBookingInput extends CreateBookingInput {
  tableIds: number[]
  /** §3.1: the receptionist's explicit go-ahead to seat more guests than capacity. */
  capacityOverrideConfirmed?: boolean
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

function protectedPhoneValues(phone: ProtectedPhone | null): [Buffer | null, number | null, Buffer | null, number | null, string | null] {
  return phone
    ? [phone.ciphertext, phone.encryptionKeyId, phone.hmac, phone.hmacKeyId, phone.last3]
    : [null, null, null, null, null]
}

interface CustomerIdentityRow extends RowDataPacket {
  id: number
  status: 'ACTIVE' | 'MERGED' | 'ANONYMIZED'
}

/**
 * BF-01: rebuilds the protected phone already stored on a reservation so the
 * Customer identity behind it can be resolved. The ciphertext is passed through
 * untouched; nothing is decrypted and nothing is logged, and the client is never
 * asked to resend the full number.
 */
async function storedReservationPhone(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  reservationId: number,
): Promise<ProtectedPhone | null> {
  const [rows] = await connection.execute<(RowDataPacket & {
    phone_ciphertext: Buffer | null
    phone_key_id: number | null
    phone_hmac: Buffer | null
    phone_hmac_key_id: number | null
    phone_last3: string | null
  })[]>(
    `SELECT phone_ciphertext, phone_key_id, phone_hmac, phone_hmac_key_id, phone_last3
     FROM reservations
     WHERE organization_id = ? AND venue_id = ? AND id = ?`,
    [actor.organizationId, actor.venueId, reservationId],
  )
  const row = rows[0]
  if (!row || !row.phone_ciphertext || row.phone_key_id === null
    || !row.phone_hmac || row.phone_hmac_key_id === null || !row.phone_last3) {
    return null
  }
  return {
    ciphertext: row.phone_ciphertext,
    encryptionKeyId: Number(row.phone_key_id),
    hmac: row.phone_hmac,
    hmacKeyId: Number(row.phone_hmac_key_id),
    last3: row.phone_last3,
  }
}

async function resolveBookingCustomer(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  phone: ProtectedPhone | null,
): Promise<number | null> {
  if (!phone) return null
  const [upsert] = await connection.execute<ResultSetHeader>(
    `INSERT INTO customers
      (organization_id, display_name, name_search, phone_ciphertext, phone_key_id,
       phone_hmac, phone_hmac_key_id, phone_last3, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      actor.organizationId,
      null,
      null,
      ...protectedPhoneValues(phone),
      actor.userId,
    ],
  )
  const customerId = Number(upsert.insertId)
  const [rows] = await connection.execute<CustomerIdentityRow[]>(
    `SELECT id, status FROM customers
     WHERE organization_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, customerId],
  )
  const customer = rows[0]
  if (!customer || customer.status !== 'ACTIVE') {
    throw new AppError(409, 'CUSTOMER_IDENTITY_UNAVAILABLE', 'Danh tính khách theo số điện thoại không còn hoạt động.')
  }
  return customerId
}

export async function createBooking(
  actor: AuthenticatedActor,
  input: CreateBookingInput,
  now = new Date(),
  transaction?: PoolConnection,
): Promise<BookingView> {
  assertNoteHasNoPhoneNumber(input.note)
  const metadata = resolveBookingMetadata(input)
  const schedule = validateBookingSchedule(input.expectedAt, input.businessDate, now)
  const phone = typeof input.phoneNumber === 'string' ? protectPhoneNumber(input.phoneNumber, phoneKeyRing()) : null
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()
    const [sourceRows] = await connection.execute<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM booking_sources WHERE organization_id = ? AND code = ? AND is_active = 1',
      [actor.organizationId, input.sourceCode],
    )
    const source = sourceRows[0]
    if (!source) throw new AppError(400, 'BOOKING_SOURCE_NOT_FOUND', 'Nguồn đặt bàn không hợp lệ.')
    const customerId = input.guestName
      ? null
      : await resolveBookingCustomer(connection, actor, phone)
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO reservations
        (organization_id, venue_id, customer_id, contact_name, contact_name_search,
         phone_ciphertext, phone_key_id, phone_hmac, phone_hmac_key_id, phone_last3,
         source_id, party_size, expected_at, business_date, customer_classification,
         guest_type, is_birthday, is_boss_table, is_designated, social_platform, honorific,
         note, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.organizationId,
        actor.venueId,
        customerId,
        customerId === null ? input.guestName ?? null : null,
        customerId === null && input.guestName ? normalizeSearchText(input.guestName) : null,
        ...protectedPhoneValues(phone),
        source.id,
        input.partySize,
        schedule.mysqlExpectedAt,
        schedule.businessDate,
        metadata.classification,
        metadata.guestType,
        input.isBirthday ?? false,
        input.iconFlags?.isBossTable ?? false,
        input.iconFlags?.isDesignated ?? false,
        resolveSocialPlatform(input.sourceCode, input.socialPlatform),
        input.honorific ?? null,
        input.note ?? null,
        actor.userId,
      ],
    )
    const booking = await getBookingById(actor, result.insertId, connection)
    if (ownsTransaction) await connection.commit()
    return booking
  } catch (error) {
    if (ownsTransaction) await connection.rollback()
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

export async function createAndAssignBooking(
  actor: AuthenticatedActor,
  input: CreateAndAssignBookingInput,
  now = new Date(),
  transaction?: PoolConnection,
): Promise<BookingView> {
  assertNoteHasNoPhoneNumber(input.note)
  const metadata = resolveBookingMetadata(input)
  const schedule = validateBookingSchedule(input.expectedAt, input.businessDate, now)
  const phone = typeof input.phoneNumber === 'string' ? protectPhoneNumber(input.phoneNumber, phoneKeyRing()) : null
  const requestedTableIds = [...new Set(input.tableIds)].sort((left, right) => left - right)
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()
    // C1: booking one table of an active layout cluster books the whole cluster,
    // so the cluster is never half-booked and the client never has to know its
    // membership. The cluster also supplies the group identity for these rows.
    const { tableIds, layoutGroupId } = await resolveLayoutExpansion(connection, actor, requestedTableIds)
    const [sourceRows] = await connection.execute<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM booking_sources WHERE organization_id = ? AND code = ? AND is_active = 1',
      [actor.organizationId, input.sourceCode],
    )
    const source = sourceRows[0]
    if (!source) throw new AppError(400, 'BOOKING_SOURCE_NOT_FOUND', 'Nguồn đặt bàn không hợp lệ.')

    const tables = await lockAndValidateAssignableTables(connection, actor, tableIds)
    const capacityOverride = acknowledgeCapacity({
      partySize: input.partySize,
      tables: tables.map((table) => ({ code: table.code, capacity: Number(table.capacity) })),
      confirmed: input.capacityOverrideConfirmed,
    })
    const conflicts = await lockOccupancyConflicts(
      connection, actor, 'HOLD', tableIds, schedule.businessDate, [], now,
    )
    if (conflicts.length) {
      throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc đang sử dụng.')
    }

    const customerId = input.guestName
      ? null
      : await resolveBookingCustomer(connection, actor, phone)
    const [reservation] = await connection.execute<ResultSetHeader>(
      `INSERT INTO reservations
        (organization_id, venue_id, customer_id, contact_name, contact_name_search,
         phone_ciphertext, phone_key_id, phone_hmac, phone_hmac_key_id, phone_last3,
         source_id, party_size, expected_at, business_date, customer_classification,
         guest_type, is_birthday, is_boss_table, is_designated, social_platform, honorific,
         note, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.organizationId,
        actor.venueId,
        customerId,
        customerId === null ? input.guestName ?? null : null,
        customerId === null && input.guestName ? normalizeSearchText(input.guestName) : null,
        ...protectedPhoneValues(phone),
        source.id,
        input.partySize,
        schedule.mysqlExpectedAt,
        schedule.businessDate,
        metadata.classification,
        metadata.guestType,
        input.isBirthday ?? false,
        input.iconFlags?.isBossTable ?? false,
        input.iconFlags?.isDesignated ?? false,
        resolveSocialPlatform(input.sourceCode, input.socialPlatform),
        input.honorific ?? null,
        input.note ?? null,
        actor.userId,
      ],
    )
    const [hold] = await connection.execute<ResultSetHeader>(
      `INSERT INTO table_holds
        (organization_id, venue_id, hold_kind, reservation_id, starts_at, created_by_user_id)
       VALUES (?, ?, 'RESERVATION', ?, ?, ?)`,
      [actor.organizationId, actor.venueId, reservation.insertId, schedule.mysqlExpectedAt, actor.userId],
    )
    const group = layoutGroupId !== null
      ? { id: layoutGroupId }
      : tableIds.length > 1
        ? await createTableGroup(connection, actor, { businessDate: schedule.businessDate })
        : null
    const allocationIds: number[] = []
    for (const tableId of tableIds) {
      const [allocation] = await connection.execute<ResultSetHeader>(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, hold_id, group_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'HOLD', ?, ?, ?, ?, ?)`,
        [
          actor.organizationId,
          actor.venueId,
          tableId,
          hold.insertId,
          group?.id ?? null,
          schedule.mysqlExpectedAt,
          schedule.businessDate,
          actor.userId,
        ],
      )
      allocationIds.push(allocation.insertId)
    }
    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'RESERVATION_CREATED_AND_ASSIGNED', 'reservation', ?, NULL, 1, ?, 'DIRECT_TABLE_BOOKING', 0)`,
      [
        actor.organizationId,
        actor.venueId,
        changeSequence,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        reservation.insertId,
        JSON.stringify([{ type: 'reservation_created_and_assigned', holdId: hold.insertId,
          ...(capacityOverride ? { capacityOverride } : {}),
          groupId: group?.id ?? null, allocationIds, tableIds }]),
      ],
    )
    const booking = await getBookingById(actor, reservation.insertId, connection)
    if (ownsTransaction) await connection.commit()
    return booking
  } catch (error) {
    if (ownsTransaction) await connection.rollback()
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

interface LockedReservation extends RowDataPacket {
  id: number
  organization_id: number
  venue_id: number
  status: BookingStatus
  version: number
  expected_at: Date
  business_date: Date | string
  customer_classification: BookingClassification | null
  guest_type: GuestType | null
  is_birthday: number
  is_boss_table: number
  is_designated: number
  social_platform: string | null
  honorific: string | null
  customer_id: number | null
  contact_name: string | null
  party_size: number
  source_id: number
  note: string | null
  phone_hmac: Buffer | null
}

async function lockReservation(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  id: number,
  expectedVersion: number,
): Promise<LockedReservation> {
  const [rows] = await connection.execute<LockedReservation[]>(
    `SELECT id, organization_id, venue_id, status, version, expected_at, business_date,
       customer_classification, guest_type, is_birthday, is_boss_table, is_designated,
       social_platform, honorific, customer_id, contact_name, party_size, source_id, note, phone_hmac
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

export interface UpdateBookingInput extends Omit<CreateBookingInput, 'note'> {
  note?: string | null
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
  now = new Date(),
): Promise<BookingView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, actor, id, input.expectedVersion)
    if (reservation.status !== 'BOOKED') {
      throw new AppError(409, 'BOOKING_NOT_EDITABLE', 'Chỉ booking đang ở trạng thái BOOKED mới được chỉnh sửa.')
    }
    const guestName = input.guestName?.trim() || undefined
    const retainsPhone = input.phoneNumber === undefined && reservation.phone_hmac !== null
    if (!guestName && !retainsPhone && !input.phoneNumber) {
      throw new AppError(400, 'BOOKING_CONTACT_REQUIRED', 'Cần ít nhất tên khách hoặc số điện thoại.')
    }

    const currentExpectedAt = reservation.expected_at
    const currentBusinessDate = dateOnly(reservation.business_date)
    const requestedExpectedAt = new Date(input.expectedAt)
    const scheduleUnchanged = !Number.isNaN(requestedExpectedAt.getTime())
      && requestedExpectedAt.getTime() === currentExpectedAt.getTime()
      && input.businessDate === currentBusinessDate
    const schedule = scheduleUnchanged
      ? {
          expectedAtUtc: currentExpectedAt,
          mysqlExpectedAt: currentExpectedAt.toISOString().slice(0, 23).replace('T', ' '),
          businessDate: currentBusinessDate,
        }
      : validateBookingSchedule(input.expectedAt, input.businessDate, now)
    if (input.note !== undefined) assertNoteHasNoPhoneNumber(input.note)
    const resolvedNote = input.note === undefined ? reservation.note : input.note

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
    if (reservation.contact_name !== (guestName ?? null)) changedFields.push('guestName')
    if (Number(reservation.party_size) !== input.partySize) changedFields.push('partySize')
    if (Number(reservation.source_id) !== Number(source.id)) changedFields.push('sourceCode')
    if ((reservation.note ?? '') !== (resolvedNote ?? '')) changedFields.push('note')
    const metadata = resolveBookingMetadata(input, reservation.customer_classification ?? 'UNCLASSIFIED')
    if ((reservation.customer_classification ?? 'UNCLASSIFIED') !== metadata.classification) changedFields.push('classification')
    const isBirthday = input.isBirthday ?? Boolean(reservation.is_birthday)
    if (isBirthday !== Boolean(reservation.is_birthday)) changedFields.push('isBirthday')
    // Icons, honorific and the Social platform (0016). An absent field keeps
    // what is stored; the platform is re-resolved against the target source, so
    // moving a booking off SOCIAL clears it even when the client sent nothing.
    const iconFlags = input.iconFlags ?? {
      isBossTable: Boolean(reservation.is_boss_table),
      isDesignated: Boolean(reservation.is_designated),
    }
    if (iconFlags.isBossTable !== Boolean(reservation.is_boss_table)
      || iconFlags.isDesignated !== Boolean(reservation.is_designated)) changedFields.push('iconKeys')
    const honorific = input.honorific === undefined ? honorificFrom(reservation.honorific) : input.honorific
    if (honorific !== honorificFrom(reservation.honorific)) changedFields.push('honorific')
    const socialPlatform = resolveSocialPlatform(
      input.sourceCode,
      input.socialPlatform === undefined ? socialPlatformFrom(reservation.social_platform) : input.socialPlatform,
    )
    if (socialPlatform !== socialPlatformFrom(reservation.social_platform)) changedFields.push('socialPlatform')
    const phone = input.phoneNumber === undefined
      ? undefined
      : typeof input.phoneNumber === 'string'
        ? protectPhoneNumber(input.phoneNumber, phoneKeyRing())
        : null
    const phoneChanged = phone !== undefined && (
      (phone === null && reservation.phone_hmac !== null)
      || (phone !== null && (reservation.phone_hmac === null || !reservation.phone_hmac.equals(phone.hmac)))
    )
    if (phoneChanged) changedFields.push('phoneNumber')
    if (currentExpectedAt.getTime() !== schedule.expectedAtUtc.getTime()) changedFields.push('expectedAt')
    if (dateOnly(reservation.business_date) !== schedule.businessDate) changedFields.push('businessDate')
    if (!changedFields.length)
      throw new AppError(400, 'BOOKING_NOT_CHANGED', 'Booking không có thông tin nào thay đổi.')

    const allocationIds = holdRows.map((row) => Number(row.allocation_id))
    const tableIds = holdRows.map((row) => Number(row.table_id))
    if (scheduleChanged && allocationIds.length) {
      const allocationPlaceholders = allocationIds.map(() => '?').join(',')
      const conflicts = await lockOccupancyConflicts(
        connection, actor, 'HOLD', tableIds, schedule.businessDate, allocationIds, now,
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

    const phoneSql = phoneChanged
      ? ', phone_ciphertext = ?, phone_key_id = ?, phone_hmac = ?, phone_hmac_key_id = ?, phone_last3 = ?'
      : ''
    const phoneValues = phoneChanged ? protectedPhoneValues(phone ?? null) : []
    // BF-01: clearing the name on a booking that keeps its phone turns it into a
    // phone-only booking, so the contact has to become the Customer identity for
    // the phone already stored. A named booking with a phone holds
    // customer_id = NULL, so without this the row would have neither a contact
    // name nor a customer and would violate ck_reservations_contact.
    let customerId: number | null
    if (phone === undefined) {
      customerId = reservation.customer_id
      if (!guestName && customerId === null) {
        const stored = await storedReservationPhone(connection, actor, id)
        if (!stored) {
          throw new AppError(400, 'BOOKING_CONTACT_REQUIRED', 'Cần ít nhất tên khách hoặc số điện thoại.')
        }
        customerId = await resolveBookingCustomer(connection, actor, stored)
      }
    } else {
      customerId = phone === null || guestName
        ? null
        : await resolveBookingCustomer(connection, actor, phone)
    }
    const [updateResult] = await connection.execute<ResultSetHeader>(
      `UPDATE reservations
       SET customer_id = ?, contact_name = ?, contact_name_search = ?, party_size = ?, source_id = ?,
           expected_at = ?, business_date = ?, customer_classification = ?, guest_type = ?, is_birthday = ?,
           is_boss_table = ?, is_designated = ?, social_platform = ?, honorific = ?, note = ?, updated_by_user_id = ?,
           updated_at = UTC_TIMESTAMP(3), version = version + 1${phoneSql}
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND status = 'BOOKED' AND version = ?`,
      [
        customerId,
        guestName ?? null,
        guestName ? normalizeSearchText(guestName) : null,
        input.partySize,
        source.id,
        schedule.mysqlExpectedAt,
        schedule.businessDate,
        metadata.classification,
        metadata.guestType,
        isBirthday,
        iconFlags.isBossTable,
        iconFlags.isDesignated,
        socialPlatform,
        honorific,
        resolvedNote ?? null,
        actor.userId,
        ...phoneValues,
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

interface RevealPhoneRow extends RowDataPacket {
  customer_id: number | null
  phone_ciphertext: Buffer | null
  phone_key_id: number | null
}

export type BookingCallOutcome = 'CONTACTED' | 'NO_ANSWER' | 'LATE_CONFIRMED'

interface BookingCallRow extends RowDataPacket {
  id: number
  status: BookingStatus
  version: number
  expected_at: Date | string
  business_date: Date | string
  late_confirmed_at: Date | string | null
  phone_ciphertext: Buffer | null
  phone_key_id: number | null
  upcoming_warning_minutes: number
  late_warning_minutes: number
  no_show_warning_minutes: number
}

interface StoredCallRow extends RowDataPacket {
  id: number
  reservation_id: number
  outcome: BookingCallOutcome | null
  outcome_at: Date | string | null
}

export interface BookingCallHistoryEntry {
  callId: number
  initiatedAt: string
  initiatedBy: string
  outcome: BookingCallOutcome | null
  outcomeAt: string | null
  outcomeBy: string | null
}

export interface BookingCallStartResult {
  callId: number
  bookingId: number
  initiatedAt: string
  telUri: string
}

export interface BookingCallOutcomeResult {
  callId: number
  bookingId: number
  outcome: BookingCallOutcome
  outcomeAt: string
  lateConfirmation: LateConfirmationResult | null
}

export async function initiateBookingCall(
  actor: AuthenticatedActor,
  id: number,
  now = applicationNow(),
): Promise<BookingCallStartResult> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<BookingCallRow[]>(
      `SELECT r.id, r.status, r.version, r.expected_at, r.business_date, r.late_confirmed_at,
         COALESCE(r.phone_ciphertext, c.phone_ciphertext) AS phone_ciphertext,
         COALESCE(r.phone_key_id, c.phone_key_id) AS phone_key_id,
         v.upcoming_warning_minutes, v.late_warning_minutes, v.no_show_warning_minutes
       FROM reservations r
       JOIN venues v ON v.organization_id = r.organization_id AND v.id = r.venue_id
       LEFT JOIN customers c ON c.organization_id = r.organization_id AND c.id = r.customer_id
       WHERE r.organization_id = ? AND r.venue_id = ? AND r.id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, id],
    )
    const booking = rows[0]
    if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đặt bàn.')
    if (dateOnly(booking.business_date) !== currentBusinessDate(now)) {
      throw new AppError(409, 'BOOKING_BUSINESS_DATE_NOT_CURRENT', 'Chỉ gọi booking thuộc ngày nghiệp vụ hiện tại.')
    }
    if (!booking.phone_ciphertext || booking.phone_key_id === null) {
      throw new AppError(422, 'BOOKING_PHONE_UNAVAILABLE', 'Booking không có số điện thoại hợp lệ.')
    }
    const eligible = canCallBooking({
      status: booking.status,
      expectedAt: isoDateTime(booking.expected_at),
      businessDate: dateOnly(booking.business_date),
      lateConfirmedAt: booking.late_confirmed_at,
      hasPhone: booking.phone_ciphertext !== null && booking.phone_key_id !== null,
      now,
      thresholds: {
        upcomingMinutes: Number(booking.upcoming_warning_minutes),
        lateAfterMinutes: Number(booking.late_warning_minutes),
        noShowAfterMinutes: Number(booking.no_show_warning_minutes),
      },
    })
    if (!eligible) throw new AppError(409, 'BOOKING_CALL_NOT_ALLOWED', 'Booking chưa đủ điều kiện gọi khách.')
    const phone = revealPhoneNumber(booking.phone_ciphertext, Number(booking.phone_key_id), phoneKeyRing())
    const initiatedAt = now.toISOString()
    const mysqlNow = initiatedAt.slice(0, 23).replace('T', ' ')
    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO booking_call_logs
       (organization_id, venue_id, reservation_id, initiated_by_user_id, initiated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, id, actor.userId, mysqlNow],
    )
    await connection.execute(
      `INSERT INTO operation_log
       (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
        action, entity_type, entity_id, changes, reason_code, is_undoable)
       VALUES (?, ?, 'USER', ?, ?, ?, 'BOOKING_CALL_INITIATED', 'reservation', ?, ?, 'CALL_CUSTOMER', 0)`,
      [actor.organizationId, actor.venueId, actor.userId, actor.membershipId, actor.authSessionId ?? null,
        id, JSON.stringify([{ type: 'booking_call', callId: insert.insertId }])],
    )
    await connection.commit()
    return { callId: insert.insertId, bookingId: id, initiatedAt, telUri: `tel:${phone}` }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

interface CallHistoryRow extends RowDataPacket {
  id: number
  initiated_at: Date
  initiated_by: string | null
  outcome: string | null
  outcome_at: Date | null
  outcome_by: string | null
}

/**
 * Every call placed on a booking, newest first.
 *
 * booking_call_logs was written and never read back: nobody in the app could
 * see that a colleague had already rung this guest twice, nor that a call was
 * left without an outcome. The rows existed only for an audit nobody could
 * reach from a screen.
 *
 * No phone number is returned - the history says who rang and how it went,
 * which needs no number, so this stays readable by anyone who may call.
 */
export async function listBookingCalls(
  actor: AuthenticatedActor,
  bookingId: number,
): Promise<BookingCallHistoryEntry[]> {
  const [rows] = await databasePool.execute<CallHistoryRow[]>(
    `SELECT l.id, l.initiated_at, iu.display_name AS initiated_by,
            l.outcome, l.outcome_at, ou.display_name AS outcome_by
       FROM booking_call_logs l
       JOIN users iu ON iu.id = l.initiated_by_user_id
       LEFT JOIN users ou ON ou.id = l.outcome_by_user_id
      WHERE l.organization_id = ? AND l.venue_id = ? AND l.reservation_id = ?
      ORDER BY l.initiated_at DESC, l.id DESC
      LIMIT 50`,
    [actor.organizationId, actor.venueId, bookingId],
  )
  return rows.map((row) => ({
    callId: Number(row.id),
    initiatedAt: isoDateTime(row.initiated_at),
    initiatedBy: row.initiated_by ?? 'Không rõ',
    outcome: (row.outcome as BookingCallOutcome | null) ?? null,
    outcomeAt: row.outcome_at === null ? null : isoDateTime(row.outcome_at),
    outcomeBy: row.outcome_by ?? null,
  }))
}

export async function recordBookingCallOutcome(
  actor: AuthenticatedActor,
  bookingId: number,
  callId: number,
  outcome: BookingCallOutcome,
  expectedBookingVersion: number | undefined,
  now = applicationNow(),
): Promise<BookingCallOutcomeResult> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<StoredCallRow[]>(
      `SELECT id, reservation_id, outcome, outcome_at FROM booking_call_logs
       WHERE organization_id = ? AND venue_id = ? AND reservation_id = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, bookingId, callId],
    )
    const existing = rows[0]
    if (!existing) throw new AppError(404, 'BOOKING_CALL_NOT_FOUND', 'Không tìm thấy lần gọi khách.')
    if (existing.outcome !== null) {
      if (existing.outcome !== outcome) {
        throw new AppError(409, 'BOOKING_CALL_OUTCOME_CONFLICT', 'Lần gọi này đã có kết quả khác.')
      }
      await connection.commit()
      return {
        callId, bookingId, outcome,
        outcomeAt: isoDateTime(existing.outcome_at!),
        lateConfirmation: null,
      }
    }

    let lateConfirmation: LateConfirmationResult | null = null
    if (outcome === 'LATE_CONFIRMED') {
      if (!expectedBookingVersion) {
        throw new AppError(400, 'INVALID_VERSION', 'Phiên bản booking không hợp lệ.')
      }
      // Use the outcome transaction for TU-12 so the reservation transition and
      // call result commit atomically without consuming a nested pool connection.
      lateConfirmation = await confirmBookingLateInTransaction(
        connection,
        actor,
        bookingId,
        expectedBookingVersion,
        now,
        { allowCurrentVersionReplay: true },
      )
    }

    const outcomeAt = now.toISOString()
    const mysqlNow = outcomeAt.slice(0, 23).replace('T', ' ')
    await connection.execute(
      `UPDATE booking_call_logs SET outcome = ?, outcome_by_user_id = ?, outcome_at = ?
       WHERE organization_id = ? AND venue_id = ? AND reservation_id = ? AND id = ?`,
      [outcome, actor.userId, mysqlNow, actor.organizationId, actor.venueId, bookingId, callId],
    )
    await connection.commit()
    return { callId, bookingId, outcome, outcomeAt, lateConfirmation }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function revealBookingPhone(actor: AuthenticatedActor, id: number): Promise<string> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<RevealPhoneRow[]>(
      `SELECT r.customer_id,
         COALESCE(r.phone_ciphertext, c.phone_ciphertext) AS phone_ciphertext,
         COALESCE(r.phone_key_id, c.phone_key_id) AS phone_key_id
       FROM reservations AS r
       LEFT JOIN customers AS c ON c.organization_id = r.organization_id AND c.id = r.customer_id
       WHERE r.organization_id = ? AND r.venue_id = ? AND r.id = ?
       FOR UPDATE`,
      [actor.organizationId, actor.venueId, id],
    )
    const row = rows[0]
    if (!row) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đặt bàn.')
    if (!row.phone_ciphertext || row.phone_key_id === null) {
      throw new AppError(422, 'BOOKING_PHONE_UNAVAILABLE', 'Booking không có số điện thoại hợp lệ.')
    }
    const phoneNumber = revealPhoneNumber(row.phone_ciphertext, Number(row.phone_key_id), phoneKeyRing())
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         action, entity_type, entity_id, changes, reason_code, is_undoable)
       VALUES (?, ?, 'USER', ?, ?, ?, 'CUSTOMER_PHONE_REVEAL', 'reservation', ?, ?, 'CALL_CUSTOMER', 0)`,
      [
        actor.organizationId,
        actor.venueId,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        id,
        JSON.stringify([{ type: 'phone_access', bookingId: id, customerId: row.customer_id }]),
      ],
    )
    await connection.commit()
    return phoneNumber
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
  capacityOverrideConfirmed?: boolean,
): Promise<BookingView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, actor, id, expectedVersion)
    if (reservation.status !== 'BOOKED')
      throw new AppError(409, 'BOOKING_NOT_ASSIGNABLE', 'Chỉ đặt bàn đang chờ mới được gán bàn.')
    const { tableIds: uniqueTableIds, layoutGroupId } = await resolveLayoutExpansion(
      connection, actor, tableIds,
    )
    const tableRows = uniqueTableIds.length > 1
      ? await lockAndValidateSameKindTables(connection, actor, uniqueTableIds)
      : await lockAndValidateAssignableTables(connection, actor, uniqueTableIds)
    const capacityOverride = acknowledgeCapacity({
      partySize: Number(reservation.party_size),
      tables: tableRows.map((table) => ({ code: table.code, capacity: Number(table.capacity) })),
      confirmed: capacityOverrideConfirmed,
    })
    const [previousAllocations] = await connection.execute<(RowDataPacket & { id: number; table_id: number; group_id: number | null })[]>(
      `SELECT a.id, a.table_id, a.group_id FROM table_allocations AS a
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
    await dissolveUnusedGroups(connection, actor, previousAllocations.map((allocation) => allocation.group_id))
    const conflicts = await lockOccupancyConflicts(
      connection, actor, 'HOLD', uniqueTableIds, dateOnly(reservation.business_date),
    )
    if (conflicts.length)
      throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc đang sử dụng.')
    const [holdResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO table_holds
        (organization_id, venue_id, hold_kind, reservation_id, starts_at, created_by_user_id)
       VALUES (?, ?, 'RESERVATION', ?, ?, ?)`,
      [actor.organizationId, actor.venueId, id, reservation.expected_at, actor.userId],
    )
    const group = requestedTableIds.length > 1
      ? layoutGroupId !== null
        ? { id: layoutGroupId, symbolNo: 0 }
        : await createTableGroup(connection, actor, { businessDate: dateOnly(reservation.business_date) })
      : null
    const newAllocationIds: number[] = []
    for (const tableId of requestedTableIds) {
      const [allocationResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, hold_id, group_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'HOLD', ?, ?, ?, ?, ?)`,
        [
          actor.organizationId,
          actor.venueId,
          tableId,
          holdResult.insertId,
          group?.id ?? null,
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
        VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, 'reservation', ?, ?, ?, ?, ?, ?)`,
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
            ...(capacityOverride ? { capacityOverride } : {}),
            previousAllocationIds: previousAllocations.map((allocation) => Number(allocation.id)),
            previousTableIds,
            holdId: holdResult.insertId,
            groupId: group?.id ?? null,
            newAllocationIds,
            newTableIds: requestedTableIds,
          },
        ]),
        previousAllocations.length ? 'STAFF_REASSIGNED' : 'INITIAL_ASSIGNMENT',
        previousAllocations.length > 0 && actor.authSessionId ? 1 : 0,
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

export async function mergeBookingTables(
  actor: AuthenticatedActor,
  id: number,
  expectedVersion: number,
  tableIds: number[],
  capacityOverrideConfirmed?: boolean,
): Promise<{ booking: BookingView; group: { id: number; symbolNo: number; tableIds: number[] } }> {
  const connection = await databasePool.getConnection()
  let group!: { id: number; symbolNo: number }
  const requested = [...new Set(tableIds)].sort((a, b) => a - b)
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, actor, id, expectedVersion)
    if (reservation.status !== 'BOOKED') throw new AppError(409, 'BOOKING_NOT_ASSIGNABLE', 'Booking không còn có thể ghép bàn.')
    const tables = await lockAndValidateSameZoneTables(connection, actor, requested)
    const [allocations] = await connection.execute<(RowDataPacket & { id: number; table_id: number; hold_id: number; group_id: number | null })[]>(
      `SELECT a.id, a.table_id, a.hold_id, a.group_id FROM table_allocations a
       JOIN table_holds h ON h.venue_id = a.venue_id AND h.id = a.hold_id
       WHERE h.organization_id = ? AND h.venue_id = ? AND h.reservation_id = ?
         AND h.status = 'ACTIVE' AND a.kind = 'HOLD' AND a.released_at IS NULL
       ORDER BY a.table_id FOR UPDATE`,
      [actor.organizationId, actor.venueId, id],
    )
    if (!allocations.length) throw new AppError(409, 'BOOKING_HAS_NO_ACTIVE_TABLES', 'Booking chưa có bàn nguồn để ghép.')
    const currentIds = allocations.map((row) => Number(row.table_id))
    if (currentIds.some((tableId) => !requested.includes(tableId))) {
      throw new AppError(409, 'MERGE_CANNOT_REMOVE_TABLES', 'Ghép bàn không được loại bỏ bàn đang thuộc booking.')
    }
    const additions = requested.filter((tableId) => !currentIds.includes(tableId))
    if (!additions.length) throw new AppError(409, 'TABLE_ASSIGNMENT_UNCHANGED', 'Nhóm bàn không thay đổi.')
    const capacityOverride = acknowledgeCapacity({
      partySize: Number(reservation.party_size),
      tables: tables.map((table) => ({ code: table.code, capacity: Number(table.capacity) })),
      confirmed: capacityOverrideConfirmed,
    })
    const conflicts = await lockOccupancyConflicts(
      connection, actor, 'HOLD', additions, dateOnly(reservation.business_date),
    )
    if (conflicts.length) throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một bàn được chọn đang thuộc nhóm khách khác.')
    const groupIds = [...new Set(allocations.map((row) => row.group_id).filter((value): value is number => value !== null))]
    if (groupIds.length > 1) throw new AppError(409, 'GROUP_STATE_INCONSISTENT', 'Booking đang có nhiều group identity.')
    if (groupIds[0]) {
      const [rows] = await connection.execute<(RowDataPacket & { symbol_no: number })[]>(
        'SELECT symbol_no FROM table_groups WHERE venue_id = ? AND id = ? AND dissolved_at IS NULL FOR UPDATE',
        [actor.venueId, groupIds[0]],
      )
      if (!rows[0]) throw new AppError(409, 'GROUP_STATE_INCONSISTENT', 'Group của booking không còn hoạt động.')
      group = { id: groupIds[0], symbolNo: Number(rows[0].symbol_no) }
    } else {
      group = await createTableGroup(connection, actor, { businessDate: dateOnly(reservation.business_date) })
      await connection.execute(
        `UPDATE table_allocations SET group_id = ? WHERE venue_id = ? AND id IN (${allocations.map(() => '?').join(',')})`,
        [group.id, actor.venueId, ...allocations.map((row) => Number(row.id))],
      )
    }
    for (const tableId of additions) {
      await connection.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, hold_id, group_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'HOLD', ?, ?, ?, ?, ?)`,
        [actor.organizationId, actor.venueId, tableId, allocations[0]!.hold_id, group.id,
          reservation.expected_at, dateOnly(reservation.business_date), actor.userId],
      )
    }
    await connection.execute(
      `UPDATE reservations SET version = version + 1, updated_by_user_id = ?, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
      [actor.userId, actor.organizationId, actor.venueId, id, expectedVersion],
    )
    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         action, entity_type, entity_id, entity_version_before, entity_version_after, changes, reason_code, is_undoable)
        VALUES (?, ?, ?, 'USER', ?, ?, ?, 'RESERVATION_TABLES_MERGED', 'reservation', ?, ?, ?, ?, 'MANUAL', ?)`,
      [actor.organizationId, actor.venueId, changeSequence, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, id, expectedVersion, expectedVersion + 1,
        JSON.stringify([{ type: 'table_group', groupId: group.id, previousTableIds: currentIds, tableIds: requested,
          ...(capacityOverride ? { capacityOverride } : {}) }]),
        actor.authSessionId ? 1 : 0],
    )
    const booking = await getBookingById(actor, id, connection)
    await connection.commit()
    return { booking, group: { ...group, tableIds: requested } }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally { connection.release() }
}

export async function closeBooking(
  actor: AuthenticatedActor,
  id: number,
  expectedVersion: number,
  status: 'CANCELLED' | 'NO_SHOW',
  closeReasonNote?: string,
): Promise<BookingView> {
  assertNoteHasNoPhoneNumber(closeReasonNote)
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, actor, id, expectedVersion)
    if (reservation.status !== 'BOOKED')
      throw new AppError(409, 'BOOKING_NOT_CLOSABLE', 'Đặt bàn này không còn ở trạng thái chờ.')
    const [activeAllocationRows] = await connection.execute<(RowDataPacket & { id: number; table_id: number; group_id: number | null })[]>(
      `SELECT a.id, a.table_id, a.group_id FROM table_allocations AS a
       JOIN table_holds AS h ON h.organization_id = a.organization_id AND h.venue_id = a.venue_id AND h.id = a.hold_id
       WHERE h.organization_id = ? AND h.venue_id = ? AND h.reservation_id = ?
         AND h.status = 'ACTIVE' AND a.released_at IS NULL
       ORDER BY a.id FOR UPDATE`,
      [actor.organizationId, actor.venueId, id],
    )
    await releaseActiveHold(connection, actor, id, status === 'NO_SHOW' ? 'NO_SHOW' : 'RESERVATION_CANCELLED')
    const [entries] = await connection.execute<(RowDataPacket & { id: number; status: string; version: number })[]>(
      `SELECT id, status, version FROM waitlist_entries WHERE organization_id = ? AND venue_id = ?
       AND reservation_id = ? AND status NOT IN ('SEATED', 'DECLINED', 'CANCELLED') ORDER BY id FOR UPDATE`,
      [actor.organizationId, actor.venueId, id],
    )
    await connection.execute(
      `UPDATE waitlist_entries SET status = 'CANCELLED', closed_at = UTC_TIMESTAMP(3),
         closed_by_user_id = ?, close_reason_code = 'RESERVATION_CANCELLED',
         claimed_by_user_id = NULL, claimed_at = NULL, claim_expires_at = NULL,
         updated_at = UTC_TIMESTAMP(3), version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND reservation_id = ?
         AND status NOT IN ('SEATED', 'DECLINED', 'CANCELLED')`,
      [actor.userId, actor.organizationId, actor.venueId, id],
    )
    await dissolveUnusedGroups(connection, actor, activeAllocationRows.map((allocation) => allocation.group_id))
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
    for (const entry of entries) {
      const sequence = await nextVenueChangeSequence(connection, actor)
      await connection.execute(
        `INSERT INTO operation_log
         (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
          auth_session_id, action, entity_type, entity_id, entity_version_before,
          entity_version_after, changes, reason_code, is_undoable)
         VALUES (?, ?, ?, 'USER', ?, ?, ?, 'WAITLIST_CANCELLED', 'waitlist_entry', ?, ?, ?, ?, 'RESERVATION_CANCELLED', 0)`,
        [actor.organizationId, actor.venueId, sequence, actor.userId, actor.membershipId,
          actor.authSessionId ?? null, entry.id, entry.version, entry.version + 1,
          JSON.stringify([{ type: 'waitlist_cancelled', reservationId: id,
            before: { status: entry.status, version: entry.version },
            after: { status: 'CANCELLED', version: entry.version + 1 } }])],
      )
    }
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
  now = new Date(),
): Promise<BookingView> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const reservation = await lockReservation(connection, actor, id, expectedVersion)
    if (reservation.status !== 'BOOKED')
      throw new AppError(409, 'BOOKING_NOT_CHECKIN', 'Chỉ đặt bàn đang chờ mới được check-in.')
    assertCheckInBusinessDate(dateOnly(reservation.business_date), now)
    const [allocationRows] = await connection.execute<(RowDataPacket & { table_id: number; hold_id: number; group_id: number | null })[]>(
      `SELECT a.table_id, a.hold_id, a.group_id FROM table_allocations AS a
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
          (organization_id, venue_id, table_id, kind, visit_id, group_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
        [
          actor.organizationId,
          actor.venueId,
          allocation.table_id,
          visitResult.insertId,
          allocation.group_id,
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
    const [entries] = await connection.execute<(RowDataPacket & { id: number; version: number })[]>(
      `SELECT id, version FROM waitlist_entries WHERE organization_id = ? AND venue_id = ?
       AND reservation_id = ? AND status NOT IN ('SEATED', 'DECLINED', 'CANCELLED') FOR UPDATE`,
      [actor.organizationId, actor.venueId, id],
    )
    for (const entry of entries) {
      await connection.execute(
        `UPDATE waitlist_entries SET status = 'SEATED', visit_id = ?, closed_at = UTC_TIMESTAMP(3),
         closed_by_user_id = ?, close_reason_code = 'SEATED_OTHERWISE',
         claimed_by_user_id = NULL, claimed_at = NULL, claim_expires_at = NULL,
         updated_at = UTC_TIMESTAMP(3), version = version + 1 WHERE id = ? AND venue_id = ?`,
        [visitResult.insertId, actor.userId, entry.id, actor.venueId],
      )
      const sequence = await nextVenueChangeSequence(connection, actor)
      await connection.execute(
        `INSERT INTO operation_log
         (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
          auth_session_id, action, entity_type, entity_id, entity_version_before,
          entity_version_after, changes, reason_code, is_undoable)
         VALUES (?, ?, ?, 'USER', ?, ?, ?, 'WAITLIST_SEATED', 'waitlist_entry', ?, ?, ?, ?, 'SEATED_OTHERWISE', 0)`,
        [actor.organizationId, actor.venueId, sequence, actor.userId, actor.membershipId,
          actor.authSessionId ?? null, entry.id, entry.version, entry.version + 1,
          JSON.stringify([{ type: 'waitlist_seated', reservationId: id, visitId: visitResult.insertId }])],
      )
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  return getBookingById(actor, id)
}

interface LateConfirmReservationRow extends RowDataPacket {
  id: number
  status: BookingStatus
  version: number
  expected_at: Date | string
  business_date: Date | string
  visit_id: number | null
  late_confirmed_at: Date | string | null
  late_confirmed_by_user_id: number | null
  no_show_warning_minutes: number
}

export interface LateConfirmationResult {
  bookingId: number
  lateConfirmed: true
  lateConfirmedAt: string
  version: number
  changeSeq: string
}

interface LateConfirmationOptions {
  allowCurrentVersionReplay?: boolean
}

async function confirmBookingLateInTransaction(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  id: number,
  expectedVersion: number,
  now: Date,
  options: LateConfirmationOptions = {},
): Promise<LateConfirmationResult> {
  const [rows] = await connection.execute<LateConfirmReservationRow[]>(
    `SELECT r.id, r.status, r.version, r.expected_at, r.business_date, r.visit_id,
       r.late_confirmed_at, r.late_confirmed_by_user_id, v.no_show_warning_minutes
     FROM reservations AS r
     JOIN venues AS v ON v.organization_id = r.organization_id AND v.id = r.venue_id
     WHERE r.organization_id = ? AND r.venue_id = ? AND r.id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, id],
  )
  const reservation = rows[0]
  if (!reservation) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đặt bàn.')
  if (reservation.status !== 'BOOKED' || reservation.visit_id !== null) {
    throw new AppError(409, 'BOOKING_NOT_LATE_CONFIRMABLE', 'Booking không còn ở trạng thái chờ khách.')
  }

  let activeBusinessDate: string
  try {
    activeBusinessDate = currentBusinessDate(now)
  } catch {
    throw new AppError(409, 'LATE_CONFIRM_OUTSIDE_BUSINESS_HOURS', 'Không có ca đang hoạt động để xác nhận tới muộn.')
  }
  if (dateOnly(reservation.business_date) !== activeBusinessDate) {
    throw new AppError(409, 'BOOKING_BUSINESS_DATE_NOT_CURRENT', 'Chỉ xác nhận booking thuộc ngày nghiệp vụ hiện tại.')
  }

  const [claims] = await connection.execute<(RowDataPacket & { hold_id: number })[]>(
    `SELECT h.id AS hold_id
     FROM table_holds AS h
     JOIN table_allocations AS a ON a.organization_id = h.organization_id AND a.venue_id = h.venue_id
       AND a.hold_id = h.id AND a.kind = 'HOLD' AND a.released_at IS NULL
       AND a.business_date = ?
     WHERE h.organization_id = ? AND h.venue_id = ? AND h.reservation_id = ?
       AND h.status = 'ACTIVE'
     LIMIT 1 FOR UPDATE`,
    [activeBusinessDate, actor.organizationId, actor.venueId, id],
  )
  if (!claims[0]) {
    throw new AppError(409, 'BOOKING_ACTIVE_CLAIM_REQUIRED', 'Booking không còn giữ bàn hợp lệ.')
  }

  if (reservation.late_confirmed_at !== null) {
    const [auditRows] = await connection.execute<(RowDataPacket & {
      id: number
      change_seq: string
      entity_version_before: number
      entity_version_after: number
    })[]>(
      `SELECT id, change_seq, entity_version_before, entity_version_after FROM operation_log
       WHERE organization_id = ? AND venue_id = ? AND action = 'RESERVATION_LATE_CONFIRMED'
         AND entity_type = 'reservation' AND entity_id = ?
         AND entity_version_after = ?
       ORDER BY id DESC LIMIT 1`,
      [actor.organizationId, actor.venueId, id, reservation.version],
    )
    const audit = auditRows[0]
    const versionMatches = options.allowCurrentVersionReplay
      ? expectedVersion === reservation.version
      : Number(audit?.entity_version_before) === expectedVersion
    if (!audit || !versionMatches) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Đặt bàn vừa được thay đổi. Vui lòng tải lại.')
    }
    return {
      bookingId: id,
      lateConfirmed: true,
      lateConfirmedAt: isoDateTime(reservation.late_confirmed_at),
      version: reservation.version,
      changeSeq: String(audit.change_seq),
    }
  }

  if (reservation.version !== expectedVersion) {
    throw new AppError(409, 'VERSION_CONFLICT', 'Đặt bàn vừa được thay đổi. Vui lòng tải lại.')
  }
  const expectedAt = reservation.expected_at instanceof Date
    ? reservation.expected_at
    : new Date(`${reservation.expected_at}Z`)
  const elapsedMs = now.getTime() - expectedAt.getTime()
  if (Number.isNaN(expectedAt.getTime()) || elapsedMs < 0) {
    throw new AppError(409, 'BOOKING_NOT_LATE', 'Chỉ xác nhận tới muộn sau giờ hẹn.')
  }
  if (elapsedMs >= Number(reservation.no_show_warning_minutes) * 60_000) {
    throw new AppError(
      409,
      'LATE_CONFIRM_NO_SHOW_THRESHOLD_REACHED',
      'Không thể xác nhận tới muộn khi booking đã đạt ngưỡng Không tới.',
    )
  }

  const confirmedAt = now.toISOString().slice(0, 23).replace('T', ' ')
  const [update] = await connection.execute<ResultSetHeader>(
    `UPDATE reservations
     SET late_confirmed_at = ?, late_confirmed_by_user_id = ?, updated_by_user_id = ?,
       updated_at = ?, version = version + 1
     WHERE organization_id = ? AND venue_id = ? AND id = ? AND status = 'BOOKED'
       AND visit_id IS NULL AND version = ? AND late_confirmed_at IS NULL`,
    [confirmedAt, actor.userId, actor.userId, confirmedAt, actor.organizationId, actor.venueId, id, expectedVersion],
  )
  if (update.affectedRows !== 1) {
    throw new AppError(409, 'VERSION_CONFLICT', 'Đặt bàn vừa được thay đổi. Vui lòng tải lại.')
  }
  const sequence = await nextVenueChangeSequence(connection, actor)
  await connection.execute(
    `INSERT INTO operation_log
     (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
      auth_session_id, action, entity_type, entity_id, entity_version_before,
      entity_version_after, changes, reason_code, is_undoable)
     VALUES (?, ?, ?, 'USER', ?, ?, ?, 'RESERVATION_LATE_CONFIRMED', 'reservation', ?, ?, ?, ?,
      'CUSTOMER_CONFIRMED_LATE', 0)`,
    [actor.organizationId, actor.venueId, sequence, actor.userId, actor.membershipId,
      actor.authSessionId ?? null, id, expectedVersion, expectedVersion + 1,
      JSON.stringify([{ type: 'late_confirmed', confirmedAt: now.toISOString() }])],
  )
  return {
    bookingId: id,
    lateConfirmed: true,
    lateConfirmedAt: now.toISOString(),
    version: expectedVersion + 1,
    changeSeq: sequence,
  }
}

/**
 * Records a customer's late-arrival confirmation without releasing their hold.
 * The reservation row and active claim are locked so the mutation, audit row and
 * venue sequence are one atomic change. An exact replay of the successful input
 * version is returned without creating another change.
 */
export async function confirmBookingLate(
  actor: AuthenticatedActor,
  id: number,
  expectedVersion: number,
  now = applicationNow(),
): Promise<LateConfirmationResult> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await confirmBookingLateInTransaction(connection, actor, id, expectedVersion, now)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export interface CreateWalkInInput {
  guestName?: string
  phoneNumber?: string
  partySize: number
  businessDate: string
  tableIds: number[]
  /** §3.1: the receptionist's explicit go-ahead to seat more guests than capacity. */
  capacityOverrideConfirmed?: boolean
}

export async function createWalkIn(
  actor: AuthenticatedActor,
  input: CreateWalkInInput,
  transaction?: PoolConnection,
): Promise<{ visitId: number }> {
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()
    const { tableIds: uniqueTableIds, layoutGroupId } = await resolveLayoutExpansion(
      connection, actor, input.tableIds,
    )
    if (!uniqueTableIds.length) throw new AppError(400, 'TABLE_REQUIRED', 'Cần chọn ít nhất một bàn cho khách walk-in.')
    const guestName = input.guestName?.trim() || 'Khách Walk-in'
    const tables = await lockAndValidateAssignableTables(connection, actor, uniqueTableIds)
    const capacityOverride = acknowledgeCapacity({
      partySize: input.partySize,
      tables: tables.map((table) => ({ code: table.code, capacity: Number(table.capacity) })),
      confirmed: input.capacityOverrideConfirmed,
    })
    const conflicts = await lockOccupancyConflicts(connection, actor, 'USAGE', uniqueTableIds, input.businessDate)
    if (conflicts.length)
      throw new AppError(409, 'TABLE_ALREADY_OCCUPIED', 'Một hoặc nhiều bàn đã được giữ hoặc đang sử dụng.')

    let customerId: number | null = null
    if (input.phoneNumber) {
      const phone = protectPhoneNumber(input.phoneNumber, phoneKeyRing())
      const [customers] = await connection.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM customers
         WHERE organization_id = ? AND phone_hmac = ? AND status = 'ACTIVE' FOR UPDATE`,
        [actor.organizationId, phone.hmac],
      )
      customerId = customers[0] ? Number(customers[0].id) : null
      if (customerId === null) {
        const [customer] = await connection.execute<ResultSetHeader>(
          `INSERT INTO customers
            (organization_id, display_name, name_search, phone_ciphertext, phone_key_id,
             phone_hmac, phone_hmac_key_id, phone_last3, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [actor.organizationId, guestName, normalizeSearchText(guestName), ...protectedPhoneValues(phone), actor.userId],
        )
        customerId = customer.insertId
      }
    }

    const group = layoutGroupId !== null
      ? { id: layoutGroupId }
      : uniqueTableIds.length > 1
        ? await createTableGroup(connection, actor, { businessDate: input.businessDate })
        : null
    const [visitResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO visits
        (organization_id, venue_id, origin, customer_id, contact_name, guest_count,
         started_at, business_date, created_by_user_id)
       VALUES (?, ?, 'WALK_IN', ?, ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [actor.organizationId, actor.venueId, customerId, customerId === null ? guestName : null,
        input.partySize, input.businessDate, actor.userId],
    )
    const allocationIds: number[] = []
    for (const tableId of uniqueTableIds) {
      const [allocation] = await connection.execute<ResultSetHeader>(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, visit_id, group_id, starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, 'USAGE', ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
        [actor.organizationId, actor.venueId, tableId, visitResult.insertId, group?.id ?? null,
          input.businessDate, actor.userId],
      )
      allocationIds.push(allocation.insertId)
    }
    const changeSequence = await nextVenueChangeSequence(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'WALK_IN_CREATED', 'visit', ?, 1, ?, 'DIRECT_WALK_IN', 0)`,
      [actor.organizationId, actor.venueId, changeSequence, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, visitResult.insertId,
        JSON.stringify([{ type: 'walk_in_created', groupId: group?.id ?? null, allocationIds,
          ...(capacityOverride ? { capacityOverride } : {}),
          tableIds: uniqueTableIds, partySize: input.partySize }])],
    )
    if (ownsTransaction) await connection.commit()
    return { visitId: visitResult.insertId }
  } catch (error) {
    if (ownsTransaction) await connection.rollback()
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

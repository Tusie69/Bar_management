import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { normalizeSearchText } from '../../lib/search-text.js'
import { assertNoteHasNoPhoneNumber, redactPhoneNumbersInNote } from '../../security/note-privacy.js'
import { protectPhoneNumber } from '../bookings/phone-security.js'
import { turnProjection } from './table-turn.repository.js'

export interface HistoryRange { from: string; to: string; page: number; pageSize: number }
export interface AssignmentInput { visitId: number; version: number; phone: string; displayName?: string }
export interface DuplicateInput { sourceCustomerId: number; targetCustomerId: number; sourceVersion: number; targetVersion: number }
interface CustomerRow extends RowDataPacket {
  id: number; display_name: string | null; name_search: string | null; phone_hmac: Buffer | null
  phone_last3: string | null; status: string; version: number; visit_count?: number; booking_count?: number
}
interface VisitRow extends RowDataPacket { id: number; customer_id: number | null; version: number }
interface PairRow extends RowDataPacket {
  source_id: number; source_name: string | null; source_version: number
  target_id: number; target_name: string | null; target_version: number; phone_last3: string
  source_visits: number; source_bookings: number; target_visits: number; target_bookings: number
}

// Recheck membership in the transaction, including internal repository callers.
async function access(connection: PoolConnection, actor: AuthenticatedActor, write = false, orgWide = false) {
  if (actor.portal !== 'admin') throw new AppError(403, 'PERMISSION_DENIED', 'Chỉ quản trị viên được xử lý lịch sử khách.')
  const [rows] = await connection.execute<(RowDataPacket & { global_read: number; can_write: number; global_write: number })[]>(
    `SELECT MAX(r.code = 'OWNER' OR mr.venue_id IS NULL) AS global_read,
       MAX(r.code = 'OWNER' OR mr.access_level = 'WRITE') AS can_write,
       MAX(r.code = 'OWNER' OR (mr.venue_id IS NULL AND mr.access_level = 'WRITE')) AS global_write
     FROM memberships m JOIN users u ON u.id = m.user_id
     JOIN membership_roles mr ON mr.organization_id = m.organization_id AND mr.membership_id = m.id
     JOIN roles r ON r.id = mr.role_id
     WHERE m.organization_id = ? AND m.id = ? AND m.user_id = ?
       AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND mr.revoked_at IS NULL
       AND (mr.venue_id IS NULL OR mr.venue_id = ?) AND r.code IN ('OWNER', 'ADMIN')`,
    [actor.organizationId, actor.membershipId, actor.userId, actor.venueId],
  )
  const row = rows[0]
  if (row?.global_read == null || (write && !Number(row.can_write))) {
    throw new AppError(403, 'PERMISSION_DENIED', 'Tài khoản không có quyền thực hiện thao tác này.')
  }
  if (orgWide && !Number(row.global_write)) {
    throw new AppError(403, 'CUSTOMER_ORG_WRITE_REQUIRED', 'Cần quyền OWNER hoặc ADMIN WRITE toàn tổ chức để gộp hoặc bỏ qua hồ sơ.')
  }
  return { orgWide: Boolean(Number(row.global_read)), canMerge: Boolean(Number(row.global_write)) }
}

async function transaction<T>(run: (connection: PoolConnection) => Promise<T>, existing?: PoolConnection): Promise<T> {
  const connection = existing ?? await databasePool.getConnection()
  try {
    if (!existing) await connection.beginTransaction()
    const result = await run(connection)
    if (!existing) await connection.commit()
    return result
  } catch (error) {
    if (!existing) await connection.rollback()
    const code = (error as { code?: string }).code
    if (code === 'ER_DUP_ENTRY' || code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT') {
      throw new AppError(409, 'VERSION_CONFLICT', 'Dữ liệu vừa thay đổi. Vui lòng tải lại.')
    }
    throw error
  } finally { if (!existing) connection.release() }
}

async function audit(connection: PoolConnection, actor: AuthenticatedActor, action: string, entityType: string,
  entityId: number, beforeVersion: number, afterVersion: number, before: Record<string, unknown>,
  after: Record<string, unknown>, compensates: number | null = null) {
  // Streams are venue-scoped; org-wide suggestion readers may be watching any venue.
  const [venues] = await connection.execute<(RowDataPacket & { id: number; change_seq: string })[]>(
    'SELECT id, change_seq FROM venues WHERE organization_id = ? ORDER BY id FOR UPDATE', [actor.organizationId])
  const venue = venues.find((row) => Number(row.id) === actor.venueId)
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  const changeSequence = (BigInt(venue.change_seq) + 1n).toString()
  await connection.execute(
    `UPDATE venues SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
     WHERE organization_id = ?`, [actor.organizationId])
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO operation_log (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
       auth_session_id, action, entity_type, entity_id, entity_version_before, entity_version_after, changes,
       is_undoable, compensates_operation_id)
     VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 0, ?)`,
    [actor.organizationId, actor.venueId, changeSequence, actor.userId, actor.membershipId, actor.authSessionId ?? null,
      action, entityType, entityId, beforeVersion, afterVersion,
      JSON.stringify([{ type: entityType, id: entityId, before, after }]), compensates],
  )
  return result.insertId
}

function customerView(row: Pick<CustomerRow, 'id' | 'display_name' | 'phone_last3' | 'version' | 'visit_count' | 'booking_count'>) {
  return { id: Number(row.id), displayName: redactPhoneNumbersInNote(row.display_name ?? 'Khách'),
    maskedPhone: row.phone_last3 ? `••• ${row.phone_last3}` : null, version: Number(row.version),
    visitCount: Number(row.visit_count ?? 0), bookingCount: Number(row.booking_count ?? 0) }
}

export async function listAnonymousVisits(actor: AuthenticatedActor, range: HistoryRange) {
  return transaction(async (connection) => {
    await access(connection, actor)
    const [rows] = await connection.query<(VisitRow & {
      table_codes_snapshot: string[] | string; group_code_snapshot: string | null; guest_count: number
      seated_at: Date; business_date: Date | string
    })[]>(`${turnProjection}
      SELECT v.id, v.version, t.table_codes_snapshot, t.group_code_snapshot, t.guest_count, t.seated_at, t.business_date
      FROM turns t JOIN visits v ON v.organization_id = t.organization_id AND v.venue_id = t.venue_id AND v.id = t.visit_id
      WHERE t.counted = 1 AND v.customer_id IS NULL
      ORDER BY t.seated_at DESC, v.id DESC LIMIT ? OFFSET ?`,
    [actor.organizationId, actor.venueId, range.from, range.to, range.pageSize + 1, (range.page - 1) * range.pageSize])
    return { page: range.page, pageSize: range.pageSize, hasMore: rows.length > range.pageSize,
      visits: rows.slice(0, range.pageSize).map((row) => {
        const codes = typeof row.table_codes_snapshot === 'string'
          ? JSON.parse(row.table_codes_snapshot) as string[] : row.table_codes_snapshot
        return { visitId: Number(row.id), displayCode: `L-${row.id}`, tableLabel: row.group_code_snapshot || codes.join(' + '),
          guestCount: Number(row.guest_count), seatedAt: new Date(row.seated_at).toISOString(),
          businessDate: row.business_date instanceof Date ? row.business_date.toISOString().slice(0, 10) : String(row.business_date).slice(0, 10),
          version: Number(row.version) }
      }) }
  })
}

async function lockVisit(connection: PoolConnection, actor: AuthenticatedActor, id: number, version: number) {
  const [rows] = await connection.execute<VisitRow[]>(
    'SELECT id, customer_id, version FROM visits WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE',
    [actor.organizationId, actor.venueId, id])
  const row = rows[0]
  if (!row) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách.')
  if (Number(row.version) !== version) throw new AppError(409, 'VERSION_CONFLICT', 'Lượt khách vừa thay đổi. Vui lòng tải lại.')
  return row
}

export async function assignAnonymousVisit(actor: AuthenticatedActor, input: AssignmentInput, existing?: PoolConnection) {
  return transaction(async (connection) => {
    await access(connection, actor, true)
    const visit = await lockVisit(connection, actor, input.visitId, input.version)
    if (visit.customer_id !== null) throw new AppError(409, 'VISIT_ALREADY_ASSIGNED', 'Lượt đã được gán vào khách.')
    const [eligible] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM visits v WHERE v.id = ? AND (
        EXISTS (SELECT 1 FROM table_turns t WHERE t.visit_id = v.id AND t.completed_at IS NOT NULL)
        OR (v.ended_at IS NULL AND EXISTS (SELECT 1 FROM table_allocations a
          WHERE a.visit_id = v.id AND a.kind = 'USAGE' AND a.released_at IS NULL)))`, [input.visitId])
    if (!eligible.length) throw new AppError(409, 'VISIT_NOT_COUNTED', 'Lượt không thuộc sổ lượt được tính.')
    const encryptionId = env.phone.activeEncryptionKeyId
    const hmacId = env.phone.activeHmacKeyId
    if (encryptionId === undefined || hmacId === undefined) throw new AppError(503, 'PHONE_KEYS_UNAVAILABLE', 'Chưa cấu hình bảo vệ số điện thoại.')
    const phone = protectPhoneNumber(input.phone, { activeEncryptionKeyId: encryptionId, activeHmacKeyId: hmacId,
      encryptionKeys: env.phone.encryptionKeys, hmacKeys: env.phone.hmacKeys })
    const [customers] = await connection.execute<CustomerRow[]>(
      'SELECT id, display_name, phone_last3, status, version FROM customers WHERE organization_id = ? AND phone_hmac = ? FOR UPDATE',
      [actor.organizationId, phone.hmac])
    let customer = customers[0]
    let customerCreated = false
    if (customer && customer.status !== 'ACTIVE') throw new AppError(409, 'CUSTOMER_INACTIVE', 'Hồ sơ khách không còn hoạt động.')
    if (!customer) {
      const name = input.displayName?.trim()
      if (!name || name.length > 120) throw new AppError(422, 'CUSTOMER_NAME_REQUIRED', 'Nhập tên khách (1-120 ký tự) để tạo hồ sơ mới.')
      assertNoteHasNoPhoneNumber(name)
      const [created] = await connection.execute<ResultSetHeader>(
        `INSERT INTO customers (organization_id, display_name, name_search, phone_ciphertext, phone_key_id,
          phone_hmac, phone_hmac_key_id, phone_last3, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [actor.organizationId, name, normalizeSearchText(name), phone.ciphertext, phone.encryptionKeyId,
          phone.hmac, phone.hmacKeyId, phone.last3, actor.userId])
      customer = { id: created.insertId, display_name: name, phone_last3: phone.last3, status: 'ACTIVE', version: 1 } as CustomerRow
      customerCreated = true
    }
    await connection.execute('UPDATE visits SET customer_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [customer.id, visit.id])
    const operationId = await audit(connection, actor, 'VISIT_CUSTOMER_ASSIGNED', 'visit', visit.id, input.version, input.version + 1,
      { customerId: null }, { customerId: Number(customer.id), customerCreated })
    const [counts] = await connection.execute<(RowDataPacket & { visit_count: number; booking_count: number })[]>(
      `SELECT (SELECT COUNT(*) FROM visits WHERE organization_id = ? AND venue_id = ? AND customer_id = ?) AS visit_count,
        (SELECT COUNT(*) FROM reservations WHERE organization_id = ? AND venue_id = ? AND customer_id = ?) AS booking_count`,
      [actor.organizationId, actor.venueId, customer.id, actor.organizationId, actor.venueId, customer.id])
    customer.visit_count = counts[0]?.visit_count ?? 0
    customer.booking_count = counts[0]?.booking_count ?? 0
    return { visitId: Number(visit.id), version: input.version + 1, customer: customerView(customer), customerCreated,
      undo: { operationId, visitId: Number(visit.id), version: input.version + 1, previousCustomerId: null } }
  }, existing)
}

export async function undoAnonymousAssignment(actor: AuthenticatedActor,
  input: { visitId: number; version: number; operationId: number }, existing?: PoolConnection) {
  return transaction(async (connection) => {
    await access(connection, actor, true)
    const visit = await lockVisit(connection, actor, input.visitId, input.version)
    const [operations] = await connection.execute<(RowDataPacket & { changes: unknown; entity_version_after: number })[]>(
      `SELECT changes, entity_version_after FROM operation_log WHERE organization_id = ? AND venue_id = ? AND id = ?
       AND entity_type = 'visit' AND entity_id = ? AND action = 'VISIT_CUSTOMER_ASSIGNED' FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.operationId, input.visitId])
    const operation = operations[0]
    if (!operation) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy thao tác gán lượt.')
    const changes = (typeof operation.changes === 'string' ? JSON.parse(operation.changes) : operation.changes) as Array<{ after: { customerId: number } }>
    const [compensated] = await connection.execute<RowDataPacket[]>('SELECT id FROM operation_log WHERE compensates_operation_id = ?', [input.operationId])
    if (Number(operation.entity_version_after) !== input.version || Number(visit.customer_id) !== changes[0]?.after.customerId || compensated.length) {
      throw new AppError(409, 'UNDO_CONFLICT_MODIFIED', 'Lượt đã thay đổi sau khi gán, không thể hoàn tác.')
    }
    await connection.execute('UPDATE visits SET customer_id = NULL, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [visit.id])
    const operationId = await audit(connection, actor, 'UNDO_VISIT_CUSTOMER_ASSIGNED', 'visit', visit.id, input.version, input.version + 1,
      { customerId: visit.customer_id }, { customerId: null }, input.operationId)
    return { visitId: Number(visit.id), customerId: null, version: input.version + 1, operationId }
  }, existing)
}

export async function listDuplicateCustomers(actor: AuthenticatedActor, page = 1, pageSize = 20) {
  return transaction(async (connection) => {
    const scope = await access(connection, actor)
    const activity = scope.orgWide ? '' : `AND (
      EXISTS (SELECT 1 FROM visits WHERE organization_id = s.organization_id AND venue_id = ? AND customer_id IN (s.id, t.id))
      OR EXISTS (SELECT 1 FROM reservations WHERE organization_id = s.organization_id AND venue_id = ? AND customer_id IN (s.id, t.id))
      OR EXISTS (SELECT 1 FROM waitlist_entries WHERE organization_id = s.organization_id AND venue_id = ? AND customer_id IN (s.id, t.id)))`
    const pairSql = `FROM customers s JOIN customers t ON t.organization_id = s.organization_id
      AND BINARY t.name_search = BINARY s.name_search AND t.status = 'ACTIVE' AND t.phone_hmac IS NOT NULL
      LEFT JOIN customer_duplicate_dismissals d ON d.organization_id = s.organization_id
        AND d.source_customer_id = s.id AND d.target_customer_id = t.id
      WHERE s.organization_id = ? AND s.status = 'ACTIVE' AND s.phone_hmac IS NULL
        AND s.name_search IS NOT NULL AND s.name_search <> '' AND d.source_customer_id IS NULL ${activity}`
    const values = [actor.organizationId, ...(scope.orgWide ? [] : [actor.venueId, actor.venueId, actor.venueId])]
    const [totals] = await connection.execute<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) AS total ${pairSql}`, values)
    const countSql = (table: string, side: string) => `(SELECT COUNT(*) FROM ${table} c
      WHERE c.organization_id = ${side}.organization_id AND c.customer_id = ${side}.id ${scope.orgWide ? '' : 'AND c.venue_id = ?'})`
    const [rows] = await connection.query<PairRow[]>(
      `SELECT s.id AS source_id, s.display_name AS source_name, s.version AS source_version,
        t.id AS target_id, t.display_name AS target_name, t.version AS target_version, t.phone_last3,
        ${countSql('visits', 's')} AS source_visits, ${countSql('reservations', 's')} AS source_bookings,
        ${countSql('visits', 't')} AS target_visits, ${countSql('reservations', 't')} AS target_bookings
       ${pairSql} ORDER BY s.id, t.id LIMIT ? OFFSET ?`,
      [...(scope.orgWide ? [] : [actor.venueId, actor.venueId, actor.venueId, actor.venueId]), ...values, pageSize, (page - 1) * pageSize])
    return { pairs: rows.map((row) => ({
      source: customerView({ id: row.source_id, display_name: row.source_name, version: row.source_version,
        phone_last3: null, visit_count: row.source_visits, booking_count: row.source_bookings }),
      target: customerView({ id: row.target_id, display_name: row.target_name, version: row.target_version,
        phone_last3: row.phone_last3, visit_count: row.target_visits, booking_count: row.target_bookings }),
    })), page, pageSize, total: Number(totals[0]?.total ?? 0), canMerge: scope.canMerge, canDismiss: scope.canMerge }
  })
}

async function lockPair(connection: PoolConnection, actor: AuthenticatedActor, input: DuplicateInput) {
  const [rows] = await connection.execute<CustomerRow[]>(
    `SELECT id, display_name, name_search, phone_hmac, phone_last3, status, version FROM customers
     WHERE organization_id = ? AND id IN (?, ?) ORDER BY id FOR UPDATE`, [actor.organizationId, input.sourceCustomerId, input.targetCustomerId])
  const source = rows.find((row) => Number(row.id) === input.sourceCustomerId)
  const target = rows.find((row) => Number(row.id) === input.targetCustomerId)
  if (!source || !target) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy hồ sơ khách.')
  if (Number(source.version) !== input.sourceVersion || Number(target.version) !== input.targetVersion) throw new AppError(409, 'VERSION_CONFLICT', 'Hồ sơ vừa thay đổi. Vui lòng tải lại.')
  if (source.id === target.id || source.status !== 'ACTIVE' || target.status !== 'ACTIVE' || source.phone_hmac !== null
    || target.phone_hmac === null || !source.name_search || source.name_search !== target.name_search) {
    throw new AppError(409, 'DUPLICATE_PAIR_CHANGED', 'Hai hồ sơ không còn thuộc quy tắc gợi ý trùng.')
  }
  const [dismissed] = await connection.execute<RowDataPacket[]>(
    'SELECT source_customer_id FROM customer_duplicate_dismissals WHERE organization_id = ? AND source_customer_id = ? AND target_customer_id = ?',
    [actor.organizationId, source.id, target.id])
  if (dismissed.length) throw new AppError(409, 'DUPLICATE_PAIR_DISMISSED', 'Cặp hồ sơ đã được đánh dấu khác nhau.')
  return { source, target }
}

export async function mergeDuplicateCustomers(actor: AuthenticatedActor, input: DuplicateInput, existing?: PoolConnection) {
  return transaction(async (connection) => {
    await access(connection, actor, true, true)
    const { source, target } = await lockPair(connection, actor, input)
    const moved: Record<string, number> = {}
    // These are all mutable customer foreign keys; call logs/contacts follow their parent records.
    for (const table of ['visits', 'reservations', 'waitlist_entries', 'customers'] as const) {
      const column = table === 'customers' ? 'merged_into_customer_id' : 'customer_id'
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE ${table} SET ${column} = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE organization_id = ? AND ${column} = ?`, [target.id, actor.organizationId, source.id])
      moved[table] = result.affectedRows
    }
    await connection.execute("UPDATE customers SET status = 'MERGED', merged_into_customer_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [target.id, source.id])
    await connection.execute('UPDATE customers SET version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [target.id])
    const operationId = await audit(connection, actor, 'CUSTOMERS_MERGED', 'customer', source.id, input.sourceVersion, input.sourceVersion + 1,
      { sourceCustomerId: Number(source.id), targetCustomerId: Number(target.id), sourceVersion: input.sourceVersion, targetVersion: input.targetVersion },
      { sourceCustomerId: Number(source.id), targetCustomerId: Number(target.id), sourceVersion: input.sourceVersion + 1, targetVersion: input.targetVersion + 1, moved })
    return { sourceCustomerId: Number(source.id), targetCustomerId: Number(target.id), sourceVersion: input.sourceVersion + 1,
      targetVersion: input.targetVersion + 1, moved, operationId }
  }, existing)
}

export async function dismissDuplicateCustomers(actor: AuthenticatedActor, input: DuplicateInput, existing?: PoolConnection) {
  return transaction(async (connection) => {
    await access(connection, actor, true, true)
    const { source, target } = await lockPair(connection, actor, input)
    await connection.execute('INSERT INTO customer_duplicate_dismissals (organization_id, source_customer_id, target_customer_id, dismissed_by_user_id) VALUES (?, ?, ?, ?)',
      [actor.organizationId, source.id, target.id, actor.userId])
    const operationId = await audit(connection, actor, 'CUSTOMER_DUPLICATE_DISMISSED', 'customer', source.id, input.sourceVersion, input.sourceVersion,
      { sourceCustomerId: Number(source.id), targetCustomerId: Number(target.id), dismissed: false },
      { sourceCustomerId: Number(source.id), targetCustomerId: Number(target.id), dismissed: true })
    return { sourceCustomerId: Number(source.id), targetCustomerId: Number(target.id), operationId }
  }, existing)
}

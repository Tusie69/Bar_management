/**
 * C1 — Table Group as an independent layout entity (anh Luân, họp 08/11/2026).
 *
 * A cluster of merged tables is part of the floor layout, not part of a booking.
 * A receptionist merges two or more tables before anyone has booked or arrived,
 * and the cluster lives until a receptionist splits it: paying, Close Visit, a
 * cancelled booking, a No-show, the end of a shift, the business-day rollover and
 * a server restart all leave it alone. One cluster can therefore serve several
 * parties one after another.
 *
 * Three states stay separate, and nothing here conflates them:
 *   layout     — is this table on its own, or a member of a cluster (this file),
 *   operation  — empty / booked / in use (table_allocations, unchanged),
 *   history    — the bookings and visits that happened (append-only, never rewritten).
 *
 * Membership lives in table_group_members because ck_alloc_owner forces every
 * table_allocations row to belong to a hold or a visit, so allocations cannot
 * express a cluster with no guest. uq_group_member_active is what guarantees a
 * physical table belongs to at most one active cluster — in the database, so two
 * devices merging the same table concurrently cannot both succeed.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { groupDisplayCode } from './floor-projection.repository.js'
import { createTableGroup, type GroupTableRow } from './table-group.repository.js'

export type LayoutGroupStatus = 'ACTIVE' | 'DISSOLVED'

export interface LayoutGroupTable {
  id: number
  code: string
  capacity: number
}

export interface LayoutGroupView {
  groupId: number
  groupCode: string
  symbolNo: number
  displayCode: string
  name: string
  status: LayoutGroupStatus
  version: number
  zoneId: number
  tableIds: number[]
  tableCodes: string[]
  tables: LayoutGroupTable[]
  totalCapacity: number
  formedAt: string
  dissolvedAt: string | null
  /** The booking or visit currently using the cluster, if any. */
  inUseBy: { kind: 'HOLD' | 'USAGE'; holdId: number | null; visitId: number | null } | null
}

export interface MutateLayoutGroupResult {
  operationId: number
  changeSeq: number
  summary: string
  undoable: false
  group: LayoutGroupView
}

export interface DissolveLayoutGroupResult {
  operationId: number
  changeSeq: number
  summary: string
  undoable: false
  groupId: number
  groupCode: string
  status: 'DISSOLVED'
  releasedTableIds: number[]
  releasedTables: string[]
}

export interface CreateLayoutGroupInput {
  /** Either tableIds or tableCodes; the route accepts both spellings. */
  tableIds?: number[]
  tableCodes?: string[]
  name?: string
  /** Explicit go-ahead to pull a spare table into the cluster. */
  spareOverrideConfirmed?: boolean
}

export interface AddLayoutGroupMembersInput {
  groupId: number
  version: number
  tableIds?: number[]
  tableCodes?: string[]
  /** Explicit go-ahead to pull a spare table into the cluster. */
  spareOverrideConfirmed?: boolean
}

export interface DissolveLayoutGroupInput {
  groupId: number
  /** Optional: when sent, the cluster must still be at this version. */
  version?: number
}

interface LayoutGroupRow extends RowDataPacket {
  id: number
  origin: 'CLAIM' | 'LAYOUT'
  symbol_no: number
  name: string | null
  version: number
  business_date: Date | string
  formed_at: Date
  dissolved_at: Date | null
}

interface MemberRow extends RowDataPacket {
  id: number
  table_id: number
  table_code: string
  table_capacity: number
  zone_id: number
}

interface ClaimRow extends RowDataPacket {
  table_id: number
  kind: 'HOLD' | 'USAGE'
  hold_id: number | null
  visit_id: number | null
}

function isoDateTime(value: Date | string): string {
  return (value instanceof Date ? value : new Date(`${value}Z`)).toISOString()
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

export function layoutGroupCode(groupId: number): string {
  return `TG-${groupId}`
}

async function nextVenueChangeSequence(connection: PoolConnection, actor: AuthenticatedActor): Promise<string> {
  const [rows] = await connection.execute<(RowDataPacket & { change_seq: string })[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE',
    [actor.organizationId, actor.venueId],
  )
  if (!rows[0]) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  const next = (BigInt(rows[0].change_seq) + 1n).toString()
  await connection.execute(
    `UPDATE venues SET change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
     WHERE organization_id = ? AND id = ?`,
    [next, actor.organizationId, actor.venueId],
  )
  return next
}

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

/**
 * Resolves the requested tables to ids. Codes are resolved against
 * dining_tables; nothing is inferred from the shape of a code.
 */
async function resolveTableIds(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  input: { tableIds?: number[]; tableCodes?: string[] },
): Promise<number[]> {
  const hasIds = Array.isArray(input.tableIds)
  const hasCodes = Array.isArray(input.tableCodes)
  if (!hasIds && !hasCodes) {
    throw new AppError(400, 'INVALID_TABLE_CODES', 'Cần gửi danh sách bàn dưới dạng tableIds hoặc tableCodes.')
  }
  if (hasIds && hasCodes) {
    throw new AppError(400, 'INVALID_TABLE_CODES', 'Chỉ gửi một trong hai: tableIds hoặc tableCodes.')
  }

  if (hasIds) {
    const ids = input.tableIds!
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new AppError(400, 'INVALID_TABLE_CODES', 'Mã bàn không hợp lệ.')
    }
    if (new Set(ids).size !== ids.length) {
      throw new AppError(400, 'DUPLICATE_TABLE_CODE', 'Danh sách bàn có mã trùng lặp.')
    }
    return [...ids].sort((left, right) => left - right)
  }

  const codes = input.tableCodes!
  if (!codes.length || codes.some((code) => typeof code !== 'string' || !code.trim())) {
    throw new AppError(400, 'INVALID_TABLE_CODES', 'Mã bàn không hợp lệ.')
  }
  const normalized = codes.map((code) => code.trim())
  if (new Set(normalized.map((code) => code.toUpperCase())).size !== normalized.length) {
    throw new AppError(400, 'DUPLICATE_TABLE_CODE', 'Danh sách bàn có mã trùng lặp.')
  }
  const placeholders = normalized.map(() => '?').join(',')
  const [rows] = await connection.execute<(RowDataPacket & { id: number; code: string })[]>(
    `SELECT id, code FROM dining_tables
     WHERE organization_id = ? AND venue_id = ? AND code IN (${placeholders})`,
    [actor.organizationId, actor.venueId, ...normalized],
  )
  const byCode = new Map(rows.map((row) => [row.code.toUpperCase(), Number(row.id)]))
  const missing = normalized.filter((code) => !byCode.has(code.toUpperCase()))
  if (missing.length) {
    throw new AppError(400, 'TABLE_NOT_FOUND', `Không tìm thấy bàn: ${missing.join(', ')}.`)
  }
  return normalized
    .map((code) => byCode.get(code.toUpperCase())!)
    .sort((left, right) => left - right)
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

async function lockLayoutTables(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
  spareOverrideConfirmed: boolean | undefined,
): Promise<GroupTableRow[]> {
  const placeholders = tableIds.map(() => '?').join(',')
  const [tables] = await connection.execute<GroupTableRow[]>(
    `SELECT dt.id, dt.code, dt.kind, dt.capacity, dt.is_spare, dt.status, dt.zone_id, z.is_bookable
     FROM dining_tables AS dt
     JOIN zones AS z ON z.organization_id = dt.organization_id
       AND z.venue_id = dt.venue_id AND z.id = dt.zone_id
     WHERE dt.organization_id = ? AND dt.venue_id = ? AND dt.id IN (${placeholders})
     ORDER BY dt.id FOR UPDATE`,
    [actor.organizationId, actor.venueId, ...tableIds],
  )
  if (tables.length !== tableIds.length) {
    throw new AppError(400, 'TABLE_NOT_FOUND', 'Có bàn không tồn tại.')
  }
  const inactive = tables.find((table) => table.status !== 'ACTIVE')
  if (inactive) {
    throw new AppError(400, 'TABLE_NOT_FOUND', `Bàn ${inactive.code} đang ngừng hoạt động.`)
  }
  // A spare table may join a cluster (anh Luân, 10/11/2026), but never silently:
  // the operator has to see the warning and confirm it, and the confirmation is
  // checked here rather than trusted from the browser.
  const spareTables = tables.filter((table) => Boolean(table.is_spare))
  if (spareTables.length && !spareOverrideConfirmed) {
    throw new AppError(
      409,
      'SPARE_TABLE_OVERRIDE_REQUIRED',
      `Bàn ${spareTables.map((table) => table.code).join(', ')} là bàn sơ cua.`
      + ' Xác nhận để ghép bàn sơ cua vào cụm.',
      { spareTableIds: spareTables.map((table) => Number(table.id)), spareTableCodes: spareTables.map((table) => table.code) },
    )
  }
  const nonBookable = tables.find((table) => !table.is_bookable)
  if (nonBookable) {
    throw new AppError(409, 'ZONE_NOT_BOOKABLE', `Khu của bàn ${nonBookable.code} không nhận khách.`)
  }
  if (new Set(tables.map((table) => table.kind)).size !== 1) {
    throw new AppError(409, 'TABLE_KIND_MISMATCH', 'Không thể ghép bàn thường với ghế Bar.')
  }
  return tables
}

/**
 * Cross-zone merging is gated by ALLOW_CROSS_ZONE_TABLE_MERGE, which is OFF by
 * default. Turning it on only skips this check; every other rule still applies.
 */
function assertZonePolicy(tables: GroupTableRow[]): void {
  if (new Set(tables.map((table) => Number(table.zone_id))).size === 1) return
  if (!env.tableGroups.allowCrossZoneMerge) {
    throw new AppError(
      409,
      'CROSS_ZONE_MERGE_DISABLED',
      'Ghép bàn khác khu đang tắt. Bật ALLOW_CROSS_ZONE_TABLE_MERGE để cho phép.',
    )
  }
}

/**
 * Adjacency comes from the venue's configured table_adjacencies edges, never from
 * the shape of a table code. 0003 ships that table empty on purpose, so a venue
 * with no configured edges has nothing to check against and the rule is skipped
 * rather than silently blocking every merge.
 */
async function assertAdjacency(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
): Promise<void> {
  const [configured] = await connection.execute<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM table_adjacencies WHERE organization_id = ? AND venue_id = ?',
    [actor.organizationId, actor.venueId],
  )
  if (!Number(configured[0]?.total ?? 0)) return

  const placeholders = tableIds.map(() => '?').join(',')
  const [edges] = await connection.execute<(RowDataPacket & { low_table_id: number; high_table_id: number })[]>(
    `SELECT low_table_id, high_table_id FROM table_adjacencies
     WHERE organization_id = ? AND venue_id = ?
       AND low_table_id IN (${placeholders}) AND high_table_id IN (${placeholders})`,
    [actor.organizationId, actor.venueId, ...tableIds, ...tableIds],
  )
  const graph = new Map(tableIds.map((id) => [id, new Set<number>()]))
  for (const edge of edges) {
    graph.get(Number(edge.low_table_id))?.add(Number(edge.high_table_id))
    graph.get(Number(edge.high_table_id))?.add(Number(edge.low_table_id))
  }
  const visited = new Set<number>([tableIds[0]!])
  const queue = [tableIds[0]!]
  while (queue.length) {
    for (const neighbour of graph.get(queue.shift()!) ?? []) {
      if (visited.has(neighbour)) continue
      visited.add(neighbour)
      queue.push(neighbour)
    }
  }
  if (visited.size !== tableIds.length) {
    throw new AppError(409, 'TABLE_NOT_ADJACENT', 'Các bàn đã chọn không tạo thành một cụm liền nhau.')
  }
}

/** Tables already held by another active cluster. Locks the member rows. */
async function assertNotGroupedElsewhere(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
  allowedGroupId: number | null,
): Promise<void> {
  const placeholders = tableIds.map(() => '?').join(',')
  const [rows] = await connection.execute<(RowDataPacket & { table_id: number; group_id: number; table_code: string })[]>(
    `SELECT m.table_id, m.group_id, dt.code AS table_code
     FROM table_group_members AS m
     JOIN dining_tables AS dt ON dt.venue_id = m.venue_id AND dt.id = m.table_id
     WHERE m.organization_id = ? AND m.venue_id = ? AND m.left_at IS NULL
       AND m.table_id IN (${placeholders})
     ORDER BY m.table_id FOR UPDATE`,
    [actor.organizationId, actor.venueId, ...tableIds],
  )
  const conflicts = rows.filter((row) => Number(row.group_id) !== allowedGroupId)
  if (conflicts.length) {
    throw new AppError(
      409,
      'TABLE_ALREADY_GROUPED',
      `Bàn ${conflicts.map((row) => row.table_code).join(', ')} đang thuộc một cụm khác.`,
      { conflictingTableIds: conflicts.map((row) => Number(row.table_id)) },
    )
  }
}

/**
 * B1.6: within one cluster every member must share one claim, or all be empty.
 * Two tables carrying two different bookings would make the cluster's identity
 * ambiguous and could lose a bill, so it is refused rather than guessed.
 */
async function assertSingleClaim(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
): Promise<ClaimRow | null> {
  const placeholders = tableIds.map(() => '?').join(',')
  const [rows] = await connection.execute<ClaimRow[]>(
    `SELECT a.table_id, a.kind, a.hold_id, a.visit_id
     FROM table_allocations AS a
     WHERE a.organization_id = ? AND a.venue_id = ? AND a.released_at IS NULL
       AND a.table_id IN (${placeholders})
     ORDER BY a.table_id, a.id FOR UPDATE`,
    [actor.organizationId, actor.venueId, ...tableIds],
  )
  if (!rows.length) return null

  const claimKey = (row: ClaimRow): string => `${row.kind}:${row.visit_id ?? row.hold_id}`
  const keys = new Set(rows.map(claimKey))
  if (keys.size > 1) {
    throw new AppError(
      409,
      'TABLE_GROUP_MULTIPLE_CLAIMS',
      'Các bàn đang thuộc những booking hoặc lượt khách khác nhau.',
      { conflictingTableIds: [...new Set(rows.map((row) => Number(row.table_id)))] },
    )
  }
  const claimed = new Set(rows.map((row) => Number(row.table_id)))
  const empty = tableIds.filter((id) => !claimed.has(id))
  if (empty.length) {
    throw new AppError(
      409,
      'TABLE_GROUP_MIXED_STATE',
      'Không thể ghép bàn trống với bàn đang có khách hoặc đang được giữ.',
      { conflictingTableIds: empty },
    )
  }
  return rows[0]!
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

async function activeMembers(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  groupId: number,
  lock: boolean,
): Promise<MemberRow[]> {
  const [rows] = await connection.execute<MemberRow[]>(
    `SELECT m.id, m.table_id, dt.code AS table_code, dt.capacity AS table_capacity, dt.zone_id
     FROM table_group_members AS m
     JOIN dining_tables AS dt ON dt.venue_id = m.venue_id AND dt.id = m.table_id
     WHERE m.organization_id = ? AND m.venue_id = ? AND m.group_id = ? AND m.left_at IS NULL
     ORDER BY m.table_id${lock ? ' FOR UPDATE' : ''}`,
    [actor.organizationId, actor.venueId, groupId],
  )
  return rows
}

async function currentClaim(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
): Promise<ClaimRow | null> {
  if (!tableIds.length) return null
  const placeholders = tableIds.map(() => '?').join(',')
  const [rows] = await connection.execute<ClaimRow[]>(
    `SELECT table_id, kind, hold_id, visit_id FROM table_allocations
     WHERE organization_id = ? AND venue_id = ? AND released_at IS NULL
       AND table_id IN (${placeholders})
     ORDER BY CASE WHEN kind = 'USAGE' THEN 0 ELSE 1 END, id DESC
     LIMIT 1`,
    [actor.organizationId, actor.venueId, ...tableIds],
  )
  return rows[0] ?? null
}

async function buildView(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  group: LayoutGroupRow,
  members: MemberRow[],
): Promise<LayoutGroupView> {
  const tables = members.map((row) => ({
    id: Number(row.table_id),
    code: row.table_code,
    capacity: Number(row.table_capacity),
  }))
  const claim = group.dissolved_at === null
    ? await currentClaim(connection, actor, tables.map((table) => table.id))
    : null
  const symbolNo = Number(group.symbol_no)
  return {
    groupId: Number(group.id),
    groupCode: layoutGroupCode(Number(group.id)),
    symbolNo,
    displayCode: groupDisplayCode(symbolNo),
    name: group.name ?? groupDisplayCode(symbolNo),
    status: group.dissolved_at === null ? 'ACTIVE' : 'DISSOLVED',
    version: Number(group.version),
    zoneId: Number(members[0]?.zone_id ?? 0),
    tableIds: tables.map((table) => table.id),
    tableCodes: tables.map((table) => table.code),
    tables,
    // Capacity always comes from the member tables' real data, never a constant.
    totalCapacity: tables.reduce((total, table) => total + table.capacity, 0),
    formedAt: isoDateTime(group.formed_at),
    dissolvedAt: group.dissolved_at === null ? null : isoDateTime(group.dissolved_at),
    inUseBy: claim === null
      ? null
      : {
          kind: claim.kind,
          holdId: claim.hold_id === null ? null : Number(claim.hold_id),
          visitId: claim.visit_id === null ? null : Number(claim.visit_id),
        },
  }
}

async function loadGroup(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  groupId: number,
  lock: boolean,
): Promise<LayoutGroupRow> {
  const [rows] = await connection.execute<LayoutGroupRow[]>(
    `SELECT id, origin, symbol_no, name, version, business_date, formed_at, dissolved_at
     FROM table_groups
     WHERE organization_id = ? AND venue_id = ? AND id = ?${lock ? ' FOR UPDATE' : ''}`,
    [actor.organizationId, actor.venueId, groupId],
  )
  const group = rows[0]
  if (!group || group.origin !== 'LAYOUT') {
    throw new AppError(404, 'TABLE_GROUP_NOT_FOUND', 'Không tìm thấy cụm bàn.')
  }
  return group
}

export async function listLayoutGroups(
  actor: AuthenticatedActor,
  options: { includeDissolved?: boolean; limit?: number } = {},
): Promise<{ groups: LayoutGroupView[] }> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200)
  const connection = await databasePool.getConnection()
  try {
    const [rows] = await connection.execute<LayoutGroupRow[]>(
      `SELECT id, origin, symbol_no, name, version, business_date, formed_at, dissolved_at
       FROM table_groups
       WHERE organization_id = ? AND venue_id = ? AND origin = 'LAYOUT'
         ${options.includeDissolved ? '' : 'AND dissolved_at IS NULL'}
       ORDER BY id DESC
       LIMIT ${limit}`,
      [actor.organizationId, actor.venueId],
    )
    const groups: LayoutGroupView[] = []
    for (const row of rows) {
      // A dissolved cluster has no active members; its history is read from the
      // audit log, so the view reports the cluster without resurrecting members.
      groups.push(await buildView(connection, actor, row, await activeMembers(connection, actor, Number(row.id), false)))
    }
    return { groups }
  } finally {
    connection.release()
  }
}

export async function getLayoutGroup(
  actor: AuthenticatedActor,
  groupId: number,
): Promise<{ group: LayoutGroupView }> {
  const connection = await databasePool.getConnection()
  try {
    const group = await loadGroup(connection, actor, groupId, false)
    return { group: await buildView(connection, actor, group, await activeMembers(connection, actor, groupId, false)) }
  } finally {
    connection.release()
  }
}

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

function assertName(name: unknown): string | null {
  if (name === undefined || name === null) return null
  if (typeof name !== 'string') throw new AppError(400, 'INVALID_GROUP_NAME', 'Tên cụm bàn không hợp lệ.')
  const trimmed = name.trim()
  if (!trimmed) return null
  if (trimmed.length > 60) throw new AppError(400, 'INVALID_GROUP_NAME', 'Tên cụm bàn không được vượt quá 60 ký tự.')
  return trimmed
}

/**
 * A unique-key collision here means another device committed a conflicting merge
 * between our locks and our insert. It is a concurrency outcome, not a bug, so it
 * surfaces as a conflict the client can resolve by reloading.
 */
function translateConstraintError(error: unknown): never {
  const code = (error as { code?: string } | null)?.code
  const message = (error as { sqlMessage?: string } | null)?.sqlMessage ?? ''
  if (code === 'ER_DUP_ENTRY' && message.includes('uq_group_member_active')) {
    throw new AppError(409, 'TABLE_ALREADY_GROUPED', 'Một bàn vừa được ghép vào cụm khác. Hãy tải lại sơ đồ.')
  }
  if (code === 'ER_DUP_ENTRY') {
    throw new AppError(409, 'TABLE_GROUP_CONFLICT', 'Cụm bàn vừa được thay đổi trên máy khác. Hãy tải lại sơ đồ.')
  }
  throw error
}

export async function createLayoutGroup(
  actor: AuthenticatedActor,
  input: CreateLayoutGroupInput,
  transaction?: PoolConnection,
): Promise<MutateLayoutGroupResult> {
  const name = assertName(input.name)
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()
    const tableIds = await resolveTableIds(connection, actor, input)
    // A cluster is at least two physical tables; one table is not a cluster.
    if (tableIds.length < 2) {
      throw new AppError(400, 'MERGE_REQUIRES_MULTIPLE_TABLES', 'Cần chọn ít nhất hai bàn để ghép.')
    }

    const tables = await lockLayoutTables(connection, actor, tableIds, input.spareOverrideConfirmed)
    assertZonePolicy(tables)
    await assertAdjacency(connection, actor, tableIds)
    await assertNotGroupedElsewhere(connection, actor, tableIds, null)
    await assertSingleClaim(connection, actor, tableIds)

    // createTableGroup takes the venue row FOR UPDATE to allocate a symbol, which
    // serialises every cluster creation in this venue: two devices merging at the
    // same moment queue instead of racing.
    const created = await createTableGroup(connection, actor, { origin: 'LAYOUT', ...(name ? { name } : {}) })
    for (const tableId of tableIds) {
      await connection.execute(
        `INSERT INTO table_group_members
          (organization_id, venue_id, group_id, table_id, joined_at, joined_by_user_id)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), ?)`,
        [actor.organizationId, actor.venueId, created.id, tableId, actor.userId],
      ).catch(translateConstraintError)
    }

    const group = await loadGroup(connection, actor, created.id, false)
    const members = await activeMembers(connection, actor, created.id, false)
    const view = await buildView(connection, actor, group, members)
    const changeSeq = await nextVenueChangeSequence(connection, actor)
    const [logged] = await connection.execute<ResultSetHeader>(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         action, entity_type, entity_id, entity_version_before, entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'TABLE_GROUP_FORMED', 'table_group', ?, NULL, ?, CAST(? AS JSON), 'MANUAL', 0)`,
      [actor.organizationId, actor.venueId, changeSeq, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, created.id, view.version,
        JSON.stringify([{
          type: 'table_group_formed',
          origin: 'LAYOUT',
          groupId: created.id,
          groupCode: view.groupCode,
          symbolNo: view.symbolNo,
          memberTableIds: view.tableIds,
          memberTableCodes: view.tableCodes,
          totalCapacity: view.totalCapacity,
          // Audited: which spare tables were pulled in, and that someone confirmed it.
          spareTableCodes: tables.filter((table) => Boolean(table.is_spare)).map((table) => table.code),
          spareOverrideConfirmed: Boolean(input.spareOverrideConfirmed),
        }])],
    )

    if (ownsTransaction) await connection.commit()
    return {
      operationId: logged.insertId,
      changeSeq: Number(changeSeq),
      summary: `Đã ghép ${view.tableCodes.join(' + ')} thành cụm ${view.displayCode} (${view.totalCapacity} chỗ).`,
      undoable: false,
      group: view,
    }
  } catch (error) {
    if (ownsTransaction) await connection.rollback()
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

export async function addLayoutGroupMembers(
  actor: AuthenticatedActor,
  input: AddLayoutGroupMembersInput,
  transaction?: PoolConnection,
): Promise<MutateLayoutGroupResult> {
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()
    const requested = await resolveTableIds(connection, actor, input)
    if (!requested.length) {
      throw new AppError(400, 'INVALID_TABLE_CODES', 'Cần chọn ít nhất một bàn để thêm vào cụm.')
    }

    const group = await loadGroup(connection, actor, input.groupId, true)
    if (group.dissolved_at !== null) {
      throw new AppError(409, 'TABLE_GROUP_ALREADY_DISSOLVED', 'Cụm bàn đã được tách trước đó.')
    }
    if (Number(group.version) !== input.version) {
      throw new AppError(409, 'TABLE_GROUP_VERSION_CONFLICT', 'Cụm bàn vừa được thay đổi trên máy khác.', {
        currentVersion: Number(group.version),
      })
    }

    const existing = await activeMembers(connection, actor, input.groupId, true)
    const existingIds = existing.map((row) => Number(row.table_id))
    const additions = requested.filter((id) => !existingIds.includes(id))
    if (!additions.length) {
      throw new AppError(409, 'TABLE_ASSIGNMENT_UNCHANGED', 'Các bàn đã chọn đều đã thuộc cụm này.')
    }

    const combined = [...new Set([...existingIds, ...additions])].sort((left, right) => left - right)
    const tables = await lockLayoutTables(connection, actor, combined, input.spareOverrideConfirmed)
    assertZonePolicy(tables)
    await assertAdjacency(connection, actor, combined)
    await assertNotGroupedElsewhere(connection, actor, additions, null)
    await assertSingleClaim(connection, actor, combined)

    for (const tableId of additions) {
      await connection.execute(
        `INSERT INTO table_group_members
          (organization_id, venue_id, group_id, table_id, joined_at, joined_by_user_id)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), ?)`,
        [actor.organizationId, actor.venueId, input.groupId, tableId, actor.userId],
      ).catch(translateConstraintError)
    }
    const [bumped] = await connection.execute<ResultSetHeader>(
      `UPDATE table_groups SET version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ? AND dissolved_at IS NULL`,
      [actor.organizationId, actor.venueId, input.groupId, input.version],
    )
    if (bumped.affectedRows !== 1) {
      throw new AppError(409, 'TABLE_GROUP_VERSION_CONFLICT', 'Cụm bàn vừa được thay đổi trên máy khác.')
    }

    const updated = await loadGroup(connection, actor, input.groupId, false)
    const view = await buildView(connection, actor, updated, await activeMembers(connection, actor, input.groupId, false))
    const changeSeq = await nextVenueChangeSequence(connection, actor)
    const [logged] = await connection.execute<ResultSetHeader>(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         action, entity_type, entity_id, entity_version_before, entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'TABLE_GROUP_MEMBERS_ADDED', 'table_group', ?, ?, ?, CAST(? AS JSON), 'MANUAL', 0)`,
      [actor.organizationId, actor.venueId, changeSeq, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, input.groupId, input.version, view.version,
        JSON.stringify([{
          type: 'table_group_members_added',
          groupId: input.groupId,
          groupCode: view.groupCode,
          addedTableIds: additions,
          previousTableIds: existingIds,
          memberTableIds: view.tableIds,
          totalCapacity: view.totalCapacity,
          spareTableCodes: tables.filter((table) => Boolean(table.is_spare)).map((table) => table.code),
          spareOverrideConfirmed: Boolean(input.spareOverrideConfirmed),
        }])],
    )

    if (ownsTransaction) await connection.commit()
    return {
      operationId: logged.insertId,
      changeSeq: Number(changeSeq),
      summary: `Đã thêm bàn vào cụm ${view.displayCode}; cụm nay có ${view.totalCapacity} chỗ.`,
      undoable: false,
      group: view,
    }
  } catch (error) {
    if (ownsTransaction) await connection.rollback()
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

/**
 * Tách bàn. The only way a layout cluster ever ends.
 *
 * Member rows and allocation rows are append-only, so no booking or visit history
 * is touched: the cluster's members get left_at, the cluster gets dissolved_at,
 * and every past booking keeps pointing at the tables it actually used.
 */
export async function dissolveLayoutGroup(
  actor: AuthenticatedActor,
  input: DissolveLayoutGroupInput,
  transaction?: PoolConnection,
): Promise<DissolveLayoutGroupResult> {
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()
    const group = await loadGroup(connection, actor, input.groupId, true)
    if (group.dissolved_at !== null) {
      throw new AppError(409, 'TABLE_GROUP_ALREADY_DISSOLVED', 'Cụm bàn đã được tách trước đó.')
    }
    if (input.version !== undefined && Number(group.version) !== input.version) {
      throw new AppError(409, 'TABLE_GROUP_VERSION_CONFLICT', 'Cụm bàn vừa được thay đổi trên máy khác.', {
        currentVersion: Number(group.version),
      })
    }

    const members = await activeMembers(connection, actor, input.groupId, true)
    if (!members.length) {
      throw new AppError(409, 'TABLE_GROUP_ALREADY_DISSOLVED', 'Cụm bàn không còn bàn thành viên.')
    }
    const tableIds = members.map((row) => Number(row.table_id))

    // Splitting a cluster that a party is sitting on, or that a booking is holding,
    // would break that claim apart. The receptionist closes or moves the party
    // first; nothing here closes a visit on its own.
    const claim = await currentClaim(connection, actor, tableIds)
    if (claim) {
      throw new AppError(
        409,
        'TABLE_GROUP_IN_USE',
        'Cụm bàn đang có khách hoặc đang được giữ cho một booking. Nhả bàn hoặc đổi bàn trước khi tách.',
        {
          holdId: claim.hold_id === null ? null : Number(claim.hold_id),
          visitId: claim.visit_id === null ? null : Number(claim.visit_id),
        },
      )
    }

    await connection.execute(
      `UPDATE table_group_members
       SET left_at = UTC_TIMESTAMP(3), left_by_user_id = ?, left_reason = 'GROUP_DISSOLVED'
       WHERE organization_id = ? AND venue_id = ? AND group_id = ? AND left_at IS NULL`,
      [actor.userId, actor.organizationId, actor.venueId, input.groupId],
    )
    const [dissolved] = await connection.execute<ResultSetHeader>(
      `UPDATE table_groups
       SET dissolved_at = UTC_TIMESTAMP(3), dissolved_by_user_id = ?, version = version + 1
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND dissolved_at IS NULL AND version = ?`,
      [actor.userId, actor.organizationId, actor.venueId, input.groupId, Number(group.version)],
    )
    if (dissolved.affectedRows !== 1) {
      throw new AppError(409, 'TABLE_GROUP_CONFLICT', 'Cụm bàn vừa được thay đổi trên máy khác.')
    }

    const changeSeq = await nextVenueChangeSequence(connection, actor)
    const releasedCodes = members.map((row) => row.table_code)
    const [logged] = await connection.execute<ResultSetHeader>(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         action, entity_type, entity_id, entity_version_before, entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'TABLE_GROUP_DISSOLVED', 'table_group', ?, ?, ?, CAST(? AS JSON), 'MANUAL', 0)`,
      [actor.organizationId, actor.venueId, changeSeq, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, input.groupId, Number(group.version), Number(group.version) + 1,
        JSON.stringify([{
          type: 'table_group_dissolved',
          groupId: input.groupId,
          groupCode: layoutGroupCode(input.groupId),
          symbolNo: Number(group.symbol_no),
          formedOnBusinessDate: dateOnly(group.business_date),
          releasedTableIds: tableIds,
          releasedTableCodes: releasedCodes,
        }])],
    )

    if (ownsTransaction) await connection.commit()
    return {
      operationId: logged.insertId,
      changeSeq: Number(changeSeq),
      summary: `Đã tách cụm ${groupDisplayCode(Number(group.symbol_no))}, trả lại ${releasedCodes.join(', ')}.`,
      undoable: false,
      groupId: input.groupId,
      groupCode: layoutGroupCode(input.groupId),
      status: 'DISSOLVED',
      releasedTableIds: tableIds,
      releasedTables: releasedCodes,
    }
  } catch (error) {
    if (ownsTransaction) await connection.rollback()
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

/**
 * Expands a requested set of tables to every member of any active layout cluster
 * it touches, so a booking, check-in, walk-in or move on one table of a cluster
 * covers the whole cluster. Chosen over making the client send the cluster id and
 * version: the client never has to know the membership, and there is no window
 * between reading it and acting on it.
 */
export interface LayoutExpansion {
  /** The requested tables plus every other member of the clusters they touch. */
  tableIds: number[]
  /**
   * The cluster to record on the allocations, when the expanded set is exactly one
   * active cluster. The booking then reuses the layout cluster's identity instead
   * of creating a second, implicit CLAIM cluster over the same tables.
   */
  layoutGroupId: number | null
}

export async function resolveLayoutExpansion(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableIds: number[],
): Promise<LayoutExpansion> {
  const requested = [...new Set(tableIds)].sort((left, right) => left - right)
  if (!requested.length) return { tableIds: [], layoutGroupId: null }

  const placeholders = requested.map(() => '?').join(',')
  const [groups] = await connection.execute<(RowDataPacket & { group_id: number })[]>(
    `SELECT DISTINCT group_id FROM table_group_members
     WHERE organization_id = ? AND venue_id = ? AND left_at IS NULL AND table_id IN (${placeholders})`,
    [actor.organizationId, actor.venueId, ...requested],
  )
  if (!groups.length) return { tableIds: requested, layoutGroupId: null }

  const groupIds = groups.map((row) => Number(row.group_id))
  const groupPlaceholders = groupIds.map(() => '?').join(',')
  const [members] = await connection.execute<(RowDataPacket & { table_id: number })[]>(
    `SELECT table_id FROM table_group_members
     WHERE organization_id = ? AND venue_id = ? AND left_at IS NULL AND group_id IN (${groupPlaceholders})`,
    [actor.organizationId, actor.venueId, ...groupIds],
  )
  const expanded = [...new Set([...requested, ...members.map((row) => Number(row.table_id))])]
    .sort((left, right) => left - right)

  // Exactly one cluster, and nothing outside it: the cluster owns this claim.
  // Several clusters, or a cluster plus a loose table, keep the existing CLAIM
  // grouping so the layout identity is never silently reshaped by a booking.
  const singleGroup = groupIds.length === 1 && expanded.length === members.length
  return { tableIds: expanded, layoutGroupId: singleGroup ? groupIds[0]! : null }
}

/** The active layout cluster a table belongs to, or null. */
export async function activeLayoutGroupIdForTable(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  tableId: number,
): Promise<number | null> {
  const [rows] = await connection.execute<(RowDataPacket & { group_id: number })[]>(
    `SELECT group_id FROM table_group_members
     WHERE organization_id = ? AND venue_id = ? AND left_at IS NULL AND table_id = ? LIMIT 1`,
    [actor.organizationId, actor.venueId, tableId],
  )
  return rows[0] ? Number(rows[0].group_id) : null
}

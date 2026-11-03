import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import type { TableState } from './table-state.js'

export interface TableView {
  id: number
  code: string
  displayName: string
  type: 'TABLE' | 'BAR_SEAT' | 'WAITING'
  capacity: number | null
  area: { code: string; name: string; floor: number }
  position: { x: number; y: number }
  state: TableState | 'OUT_OF_SERVICE'
  isBackup: boolean
  version: number
  activeVisit: {
    id: number
    version: number
    tableCodes: string[]
    displayName: string
    phoneLast3: string | null
    guestCount: number
    startedAt: string
    origin: 'RESERVATION' | 'WALK_IN' | 'WAITLIST'
    paid: boolean
    note: string | null
  } | null
}

interface TableRow extends RowDataPacket {
  id: number
  code: string
  display_name: string
  table_type: 'TABLE' | 'BAR_SEAT'
  capacity: number | null
  area_code: string
  area_name: string
  position_x: string
  position_y: string
  state: TableState | 'OUT_OF_SERVICE'
  is_spare: number
  version: number
  active_visit_id: number | null
  active_visit_version: number | null
  active_visit_table_codes: string | null
  active_visit_display_name: string | null
  active_visit_phone_last3: string | null
  active_visit_guest_count: number | null
  active_visit_started_at: Date | string | null
  active_visit_origin: 'RESERVATION' | 'WALK_IN' | 'WAITLIST' | null
  active_visit_paid: number | null
  active_visit_note: string | null
}

function isoDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(`${value}Z`)
  return date.toISOString()
}

function toTableView(row: TableRow): TableView {
  return {
    id: Number(row.id),
    code: row.code,
    displayName: row.display_name,
    type: row.table_type,
    capacity: row.capacity,
    area: { code: row.area_code, name: row.area_name, floor: 1 },
    position: { x: Number(row.position_x), y: Number(row.position_y) },
    state: row.state,
    isBackup: Boolean(row.is_spare),
    version: row.version,
    activeVisit:
      row.active_visit_id === null || row.active_visit_version === null
        ? null
        : {
            id: Number(row.active_visit_id),
            version: row.active_visit_version,
            tableCodes: row.active_visit_table_codes ? row.active_visit_table_codes.split(',') : [],
            displayName: row.active_visit_display_name ?? 'Khách',
            phoneLast3: row.active_visit_phone_last3,
            guestCount: Number(row.active_visit_guest_count),
            startedAt: isoDateTime(row.active_visit_started_at!),
            origin: row.active_visit_origin!,
            paid: Boolean(row.active_visit_paid),
            note: row.active_visit_note,
          },
  }
}

export interface TableCatalogView {
  venue: {
    id: number
    version: number
    name: string
    timezone: string
    businessDayStartLocal: string
    businessDayCutoffLocal: string
    lateWarningMinutes: number
    noShowWarningMinutes: number
    waitlistHoldDefaultMinutes: number
    waitlistClaimLeaseSeconds: number
    reservationHoldPolicy: 'SEQUENTIAL' | 'WINDOWED'
    reservationWindowMinutes: number | null
    groupSymbolCount: number
    changeSeq: number
  }
  zones: Array<{
    id: number
    version: number
    code: string
    name: string
    isBookable: boolean
    isWaitingArea: boolean
  }>
  tables: Array<{
    id: number
    version: number
    code: string
    displayName: string
    zoneId: number
    zoneCode: string
    kind: 'TABLE' | 'BAR_SEAT'
    capacity: number
    seqNo: number | null
    isSpare: boolean
    status: 'ACTIVE' | 'OUT_OF_SERVICE'
    x: number | null
    y: number | null
    width: number | null
    height: number | null
  }>
  combinations: Array<{
    id: number
    code: string
    displayName: string
    memberIds: number[]
    capacity: number
  }>
}

export interface FloorGroupView {
  id: number
  symbolNo: number
  tableIds: number[]
}

interface VenueCatalogRow extends RowDataPacket {
  id: number
  version: number
  name: string
  timezone: string
  business_day_start_local: string
  business_day_cutoff_local: string
  late_warning_minutes: number
  no_show_warning_minutes: number
  waitlist_hold_default_minutes: number
  waitlist_claim_lease_seconds: number
  reservation_hold_policy: 'SEQUENTIAL' | 'WINDOWED'
  reservation_window_minutes: number | null
  group_symbol_count: number
  change_seq: string
}

interface ZoneCatalogRow extends RowDataPacket {
  id: number
  version: number
  code: string
  name: string
  is_bookable: number
  is_waiting_area: number
}

interface TableCatalogRow extends RowDataPacket {
  id: number
  version: number
  code: string
  display_name: string
  zone_id: number
  zone_code: string
  kind: 'TABLE' | 'BAR_SEAT'
  capacity: number
  seq_no: number | null
  is_spare: number
  status: 'ACTIVE' | 'OUT_OF_SERVICE'
  pos_x: number | null
  pos_y: number | null
  width: number | null
  height: number | null
}

interface CombinationCatalogRow extends RowDataPacket {
  id: number
  code: string
  display_name: string
  member_ids: string | null
  capacity: number
}

interface FloorGroupRow extends RowDataPacket {
  id: number
  symbol_no: number
  table_ids: string
}

export async function getTableCatalog(actor: AuthenticatedActor): Promise<TableCatalogView> {
  const [venueRows] = await databasePool.execute<VenueCatalogRow[]>(
    `SELECT id, version, name, timezone,
       TIME_FORMAT(business_day_start_local, '%H:%i:%s') AS business_day_start_local,
       TIME_FORMAT(business_day_cutoff_local, '%H:%i:%s') AS business_day_cutoff_local,
       late_warning_minutes, no_show_warning_minutes, waitlist_hold_default_minutes,
       waitlist_claim_lease_seconds, reservation_hold_policy, reservation_window_minutes,
       group_symbol_count, change_seq
     FROM venues
     WHERE organization_id = ? AND id = ? AND status = 'ACTIVE'`,
    [actor.organizationId, actor.venueId],
  )
  const venue = venueRows[0]
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')

  const [zoneRows] = await databasePool.execute<ZoneCatalogRow[]>(
    `SELECT id, version, code, name, is_bookable, is_waiting_area
     FROM zones
     WHERE organization_id = ? AND venue_id = ? AND is_active = 1
     ORDER BY sort_order, id`,
    [actor.organizationId, actor.venueId],
  )
  const [tableRows] = await databasePool.execute<TableCatalogRow[]>(
    `SELECT dt.id, dt.version, dt.code, dt.display_name, dt.zone_id, z.code AS zone_code,
       dt.kind, dt.capacity, dt.seq_no, dt.is_spare, dt.status,
       dt.pos_x, dt.pos_y, dt.width, dt.height
     FROM dining_tables AS dt
     JOIN zones AS z ON z.venue_id = dt.venue_id AND z.id = dt.zone_id
     WHERE dt.organization_id = ? AND dt.venue_id = ? AND dt.status <> 'RETIRED'
     ORDER BY z.sort_order, dt.id`,
    [actor.organizationId, actor.venueId],
  )
  const [combinationRows] = await databasePool.execute<CombinationCatalogRow[]>(
    `SELECT tc.id, tc.code, tc.display_name,
       GROUP_CONCAT(tcm.table_id ORDER BY tcm.table_id SEPARATOR ',') AS member_ids,
       COALESCE(SUM(dt.capacity), 0) AS capacity
     FROM table_combinations AS tc
     LEFT JOIN table_combination_members AS tcm
       ON tcm.venue_id = tc.venue_id AND tcm.combination_id = tc.id
     LEFT JOIN dining_tables AS dt
       ON dt.venue_id = tcm.venue_id AND dt.id = tcm.table_id
     WHERE tc.organization_id = ? AND tc.venue_id = ? AND tc.is_active = 1
     GROUP BY tc.id, tc.code, tc.display_name
     ORDER BY tc.id`,
    [actor.organizationId, actor.venueId],
  )

  return {
    venue: {
      id: Number(venue.id),
      version: venue.version,
      name: venue.name,
      timezone: venue.timezone,
      businessDayStartLocal: venue.business_day_start_local,
      businessDayCutoffLocal: venue.business_day_cutoff_local,
      lateWarningMinutes: venue.late_warning_minutes,
      noShowWarningMinutes: venue.no_show_warning_minutes,
      waitlistHoldDefaultMinutes: venue.waitlist_hold_default_minutes,
      waitlistClaimLeaseSeconds: venue.waitlist_claim_lease_seconds,
      reservationHoldPolicy: venue.reservation_hold_policy,
      reservationWindowMinutes: venue.reservation_window_minutes,
      groupSymbolCount: venue.group_symbol_count,
      changeSeq: Number(venue.change_seq),
    },
    zones: zoneRows.map((zone) => ({
      id: Number(zone.id),
      version: zone.version,
      code: zone.code,
      name: zone.name,
      isBookable: Boolean(zone.is_bookable),
      isWaitingArea: Boolean(zone.is_waiting_area),
    })),
    tables: tableRows.map((table) => ({
      id: Number(table.id),
      version: table.version,
      code: table.code,
      displayName: table.display_name,
      zoneId: Number(table.zone_id),
      zoneCode: table.zone_code,
      kind: table.kind,
      capacity: table.capacity,
      seqNo: table.seq_no,
      isSpare: Boolean(table.is_spare),
      status: table.status,
      x: table.pos_x === null ? null : Number(table.pos_x),
      y: table.pos_y === null ? null : Number(table.pos_y),
      width: table.width === null ? null : Number(table.width),
      height: table.height === null ? null : Number(table.height),
    })),
    combinations: combinationRows.map((combination) => ({
      id: Number(combination.id),
      code: combination.code,
      displayName: combination.display_name,
      memberIds: combination.member_ids ? combination.member_ids.split(',').map(Number) : [],
      capacity: Number(combination.capacity),
    })),
  }
}

export async function listActiveTableGroups(
  actor: AuthenticatedActor,
  businessDate: string,
): Promise<FloorGroupView[]> {
  const [rows] = await databasePool.execute<FloorGroupRow[]>(
    `SELECT g.id, g.symbol_no,
       GROUP_CONCAT(a.table_id ORDER BY a.table_id SEPARATOR ',') AS table_ids
     FROM table_groups AS g
     JOIN table_allocations AS a
       ON a.venue_id = g.venue_id AND a.group_id = g.id AND a.released_at IS NULL
     WHERE g.organization_id = ? AND g.venue_id = ? AND g.business_date = ?
       AND g.dissolved_at IS NULL
     GROUP BY g.id, g.symbol_no
     HAVING COUNT(*) >= 2
     ORDER BY g.id`,
    [actor.organizationId, actor.venueId, businessDate],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    symbolNo: Number(row.symbol_no),
    tableIds: row.table_ids.split(',').map(Number),
  }))
}

export async function listTables(actor: AuthenticatedActor, businessDate: string): Promise<TableView[]> {
  const [rows] = await databasePool.execute<TableRow[]>(
    `SELECT
       dt.id, dt.code, dt.display_name, dt.kind AS table_type, dt.capacity,
       z.code AS area_code, z.name AS area_name,
       ROUND(dt.pos_x / 5.6, 3) AS position_x,
       ROUND(dt.pos_y / 7.6, 3) AS position_y,
       CASE
         WHEN dt.status = 'OUT_OF_SERVICE' THEN 'OUT_OF_SERVICE'
         WHEN COALESCE(a.has_usage, 0) = 1 THEN 'IN_USE'
         WHEN COALESCE(a.has_hold, 0) = 1 THEN 'RESERVED'
         ELSE 'AVAILABLE'
       END AS state,
       dt.is_spare, dt.version,
       a.active_visit_id, v.version AS active_visit_version,
       COALESCE(c.display_name, v.contact_name, 'Khách') AS active_visit_display_name,
       c.phone_last3 AS active_visit_phone_last3,
       v.guest_count AS active_visit_guest_count,
       v.started_at AS active_visit_started_at,
       v.origin AS active_visit_origin,
       (v.paid_marked_at IS NOT NULL) AS active_visit_paid,
       v.note AS active_visit_note,
       CASE WHEN a.active_visit_id IS NULL THEN NULL ELSE (
         SELECT GROUP_CONCAT(DISTINCT dt2.code ORDER BY dt2.id SEPARATOR ',')
         FROM table_allocations AS a2
         JOIN dining_tables AS dt2 ON dt2.venue_id = a2.venue_id AND dt2.id = a2.table_id
         WHERE a2.venue_id = dt.venue_id AND a2.visit_id = a.active_visit_id
           AND a2.kind = 'USAGE' AND a2.released_at IS NULL
       ) END AS active_visit_table_codes
     FROM dining_tables AS dt
     JOIN zones AS z ON z.id = dt.zone_id AND z.venue_id = dt.venue_id
     LEFT JOIN (
       SELECT table_id,
         MAX(kind = 'USAGE') AS has_usage,
         MAX(kind = 'HOLD') AS has_hold,
         MAX(CASE WHEN kind = 'USAGE' THEN visit_id END) AS active_visit_id
       FROM table_allocations
       WHERE venue_id = ? AND released_at IS NULL
         AND (kind = 'USAGE' OR business_date = ?)
       GROUP BY table_id
     ) AS a ON a.table_id = dt.id
     LEFT JOIN visits AS v ON v.venue_id = dt.venue_id AND v.id = a.active_visit_id AND v.ended_at IS NULL
     LEFT JOIN customers AS c ON c.organization_id = v.organization_id AND c.id = v.customer_id
     WHERE dt.organization_id = ? AND dt.venue_id = ? AND dt.status <> 'RETIRED'
     ORDER BY z.sort_order, dt.id`,
    [actor.venueId, businessDate, actor.organizationId, actor.venueId],
  )
  return rows.map(toTableView)
}

export interface UpdateTableStateInput {
  tableId: number
  businessDate: string
  state?: TableState
  expectedVersion?: number
  reason?: string
}

export function updateTableState(input: UpdateTableStateInput): Promise<TableView> {
  void input
  return Promise.reject(
    new AppError(
      409,
      'TABLE_STATE_DERIVED',
      'Trạng thái bàn được cập nhật qua gán bàn, check-in và kết thúc lượt khách.',
    ),
  )
}

export interface ConfigureTableInput {
  tableId: number
  isSpare: boolean
  expectedVersion: number
  reason: string
}

export async function configureTable(
  actor: AuthenticatedActor,
  input: ConfigureTableInput,
): Promise<{
  id: number
  code: string
  isBackup: boolean
  version: number
}> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute<
      (RowDataPacket & {
        id: number
        code: string
        is_spare: number
        status: string
        version: number
      })[]
    >(
      `SELECT id, code, is_spare, status, version
       FROM dining_tables
       WHERE organization_id = ? AND venue_id = ? AND id = ?
       FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.tableId],
    )
    const table = rows[0]
    if (!table) throw new AppError(404, 'TABLE_NOT_FOUND', 'Không tìm thấy bàn trong địa điểm hiện tại.')
    if (table.status !== 'ACTIVE')
      throw new AppError(409, 'TABLE_NOT_ACTIVE', 'Chỉ có thể cấu hình bàn đang hoạt động.')
    if (Number(table.version) !== input.expectedVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Bàn vừa được thay đổi. Vui lòng tải lại.')
    }
    const [allocations] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM table_allocations
       WHERE organization_id = ? AND venue_id = ? AND table_id = ? AND released_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.tableId],
    )
    if (allocations.length) {
      throw new AppError(
        409,
        'TABLE_HAS_OPEN_ALLOCATION',
        'Không thể đổi cấu hình khi bàn còn HOLD hoặc đang được sử dụng.',
      )
    }
    if (Boolean(table.is_spare) === input.isSpare) {
      throw new AppError(409, 'TABLE_CONFIGURATION_UNCHANGED', 'Cấu hình bàn không thay đổi.')
    }
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE dining_tables
       SET is_spare = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ? AND status = 'ACTIVE'`,
      [input.isSpare ? 1 : 0, actor.organizationId, actor.venueId, input.tableId, input.expectedVersion],
    )
    if (updated.affectedRows !== 1)
      throw new AppError(409, 'VERSION_CONFLICT', 'Bàn vừa được thay đổi. Vui lòng tải lại.')
    const [venueRows] = await connection.execute<(RowDataPacket & { change_seq: string })[]>(
      'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE',
      [actor.organizationId, actor.venueId],
    )
    const venue = venueRows[0]
    if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
    const changeSequence = (BigInt(venue.change_seq) + 1n).toString()
    await connection.execute(
      `UPDATE venues SET change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE organization_id = ? AND id = ?`,
      [changeSequence, actor.organizationId, actor.venueId],
    )
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, entity_version_before,
         entity_version_after, changes, reason_code, reason_note, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'TABLE_CONFIGURATION_UPDATED', 'dining_table', ?, ?, ?, ?, 'MANUAL', ?, 0)`,
      [
        actor.organizationId,
        actor.venueId,
        changeSequence,
        actor.userId,
        actor.membershipId,
        actor.authSessionId ?? null,
        input.tableId,
        input.expectedVersion,
        input.expectedVersion + 1,
        JSON.stringify([
          {
            type: 'table_spare_configuration',
            previousIsSpare: Boolean(table.is_spare),
            isSpare: input.isSpare,
          },
        ]),
        input.reason,
      ],
    )
    await connection.commit()
    return {
      id: input.tableId,
      code: table.code,
      isBackup: input.isSpare,
      version: input.expectedVersion + 1,
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

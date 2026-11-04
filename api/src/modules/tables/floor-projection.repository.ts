import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { applicationNow } from '../../time/application-clock.js'
import {
  deriveTableDisplayState,
  type ArrivalPhase,
  type TableDisplayState,
} from './table-display-state.js'

export type FloorClaimKind = 'RESERVATION' | 'VISIT' | 'WAITLIST_HOLD'
export type FloorCustomerFlag = 'BIRTHDAY' | 'NEW' | 'RETURNING'

export interface FloorClaimProjection {
  kind: FloorClaimKind
  reservationId: number | null
  visitId: number | null
  waitlistEntryId: number | null
  holdId: number | null
  guestName: string
  phoneLast3: string | null
  partySize: number
  turnNo: null
  flags: FloorCustomerFlag[]
  groupId: number | null
  groupDisplayCode: string | null
  groupMemberTableIds: number[]
  startsAt: string
  deadlineAt: string | null
  holdOverdue: boolean
  paid: boolean
  origin: 'RESERVATION' | 'WALK_IN' | 'WAITLIST' | null
  sourceCode: string | null
  version: number
  lateConfirmedAt: string | null
  canCall: boolean
}

export interface FloorTableProjection {
  // Legacy additive fields retained while HTTP clients migrate to the projection fields below.
  id: number
  code: string
  displayName: string
  type: 'TABLE' | 'BAR_SEAT'
  capacity: number
  area: { code: string; name: string; floor: number }
  position: { x: number; y: number }
  state: 'AVAILABLE' | 'RESERVED' | 'IN_USE' | 'OUT_OF_SERVICE'
  isBackup: boolean
  version: number
  staleFromPreviousDay: boolean
  allocationBusinessDate: string | null
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
    note: null
  } | null

  tableId: number
  tableCode: string
  catalogStatus: 'ACTIVE' | 'OUT_OF_SERVICE'
  isSpare: boolean
  displayState: TableDisplayState
  arrivalPhase: ArrivalPhase
  arrivalTime: string | null
  minutesLate: number
  claim: FloorClaimProjection | null
  groupId: number | null
  groupDisplayCode: string | null
  groupMemberTableIds: number[]
}

export interface FloorGroupProjection {
  id: number
  symbolNo: number
  displayCode: string
  tableIds: number[]
}

export interface FloorProjection {
  businessDate: string
  serverNow: string
  changeSeq: string
  tables: FloorTableProjection[]
  groups: FloorGroupProjection[]
}

interface VenueProjectionRow extends RowDataPacket {
  change_seq: string
  upcoming_warning_minutes: number
  late_warning_minutes: number
  no_show_warning_minutes: number
}

interface ProjectionRow extends RowDataPacket {
  table_id: number
  table_code: string
  table_display_name: string
  table_kind: 'TABLE' | 'BAR_SEAT'
  table_capacity: number
  table_status: 'ACTIVE' | 'OUT_OF_SERVICE'
  is_spare: number
  table_version: number
  pos_x: string | number | null
  pos_y: string | number | null
  zone_code: string
  zone_name: string
  allocation_id: number | null
  allocation_kind: 'HOLD' | 'USAGE' | null
  allocation_business_date: Date | string | null
  hold_id: number | null
  visit_id: number | null
  group_id: number | null
  group_symbol_no: number | null
  group_dissolved_at: Date | null
  hold_kind: 'RESERVATION' | 'WAITLIST_OFFER' | null
  hold_status: 'ACTIVE' | 'CONVERTED' | 'RELEASED' | null
  hold_version: number | null
  hold_starts_at: Date | string | null
  customer_confirmed_at: Date | string | null
  deadline_at: Date | string | null
  hold_reservation_id: number | null
  hold_waitlist_entry_id: number | null
  reservation_status: 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW' | null
  reservation_version: number | null
  reservation_expected_at: Date | string | null
  reservation_business_date: Date | string | null
  reservation_contact_name: string | null
  reservation_party_size: number | null
  reservation_phone_last3: string | null
  reservation_classification: 'NEW' | 'RETURNING' | 'UNCLASSIFIED' | null
  reservation_is_birthday: number | null
  reservation_source_code: string | null
  reservation_late_confirmed_at: Date | string | null
  linked_waitlist_entry_id: number | null
  linked_waitlist_status: string | null
  linked_waitlist_version: number | null
  offer_waitlist_entry_id: number | null
  offer_waitlist_status: string | null
  offer_waitlist_version: number | null
  offer_contact_name: string | null
  offer_party_size: number | null
  offer_phone_last3: string | null
  offer_reservation_id: number | null
  offer_reservation_contact_name: string | null
  offer_reservation_party_size: number | null
  offer_reservation_phone_last3: string | null
  offer_reservation_classification: 'NEW' | 'RETURNING' | 'UNCLASSIFIED' | null
  offer_reservation_is_birthday: number | null
  active_visit_id: number | null
  visit_version: number | null
  visit_contact_name: string | null
  visit_customer_name: string | null
  visit_phone_last3: string | null
  visit_guest_count: number | null
  visit_started_at: Date | string | null
  visit_business_date: Date | string | null
  visit_origin: 'RESERVATION' | 'WALK_IN' | 'WAITLIST' | null
  visit_paid: number | null
}

function dateOnly(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function isoDateTime(value: Date | string): string {
  return (value instanceof Date ? value : new Date(`${value}Z`)).toISOString()
}

export function groupDisplayCode(symbolNo: number): string {
  if (!Number.isSafeInteger(symbolNo) || symbolNo < 1) throw new Error('GROUP_SYMBOL_INVALID')
  let value = symbolNo
  let letters = ''
  while (value > 0) {
    value -= 1
    letters = String.fromCharCode(65 + (value % 26)) + letters
    value = Math.floor(value / 26)
  }
  return `◆${letters}`
}

function customerFlags(
  classification: 'NEW' | 'RETURNING' | 'UNCLASSIFIED' | null,
  isBirthday: number | null,
): FloorCustomerFlag[] {
  const flags: FloorCustomerFlag[] = []
  if (isBirthday) flags.push('BIRTHDAY')
  if (classification === 'NEW' || classification === 'RETURNING') flags.push(classification)
  return flags
}

function isActiveWaitlistStatus(status: string | null): boolean {
  return status === 'HOLD_ACTIVE' || status === 'OFFERED' || status === 'CONTACTING' || status === 'WAITING'
}

function claimKind(row: ProjectionRow): FloorClaimKind | null {
  if (row.allocation_kind === 'USAGE' && row.active_visit_id !== null) return 'VISIT'
  if (row.allocation_kind !== 'HOLD' || row.hold_status !== 'ACTIVE') return null
  if (row.hold_kind === 'WAITLIST_OFFER' && row.offer_waitlist_entry_id !== null
    && isActiveWaitlistStatus(row.offer_waitlist_status)) return 'WAITLIST_HOLD'
  if (row.hold_kind === 'RESERVATION' && row.linked_waitlist_entry_id !== null
    && row.linked_waitlist_status === 'HOLD_ACTIVE') return 'WAITLIST_HOLD'
  if (row.hold_kind === 'RESERVATION' && row.hold_reservation_id !== null
    && row.reservation_status === 'BOOKED') return 'RESERVATION'
  return null
}

function selectClaimRow(rows: ProjectionRow[]): ProjectionRow | null {
  return rows.find((row) => claimKind(row) !== null) ?? null
}

function buildClaim(
  row: ProjectionRow,
  kind: FloorClaimKind,
  now: Date,
  memberIds: number[],
): FloorClaimProjection {
  const groupId = row.group_id === null ? null : Number(row.group_id)
  const displayCode = row.group_symbol_no === null ? null : groupDisplayCode(Number(row.group_symbol_no))
  if (kind === 'VISIT') {
    return {
      kind,
      reservationId: null,
      visitId: Number(row.active_visit_id),
      waitlistEntryId: null,
      holdId: null,
      guestName: row.visit_customer_name ?? row.visit_contact_name ?? 'Khách',
      phoneLast3: row.visit_phone_last3,
      partySize: Number(row.visit_guest_count),
      turnNo: null,
      flags: [],
      groupId,
      groupDisplayCode: displayCode,
      groupMemberTableIds: memberIds,
      startsAt: isoDateTime(row.visit_started_at!),
      deadlineAt: null,
      holdOverdue: false,
      paid: Boolean(row.visit_paid),
      origin: row.visit_origin,
      sourceCode: null,
      version: Number(row.visit_version),
      lateConfirmedAt: null,
      canCall: false,
    }
  }

  const directOffer = row.hold_kind === 'WAITLIST_OFFER'
  const startsAt = directOffer
    ? row.customer_confirmed_at ?? row.hold_starts_at!
    : row.reservation_expected_at ?? row.hold_starts_at!
  const deadlineAt = row.deadline_at === null ? null : isoDateTime(row.deadline_at)
  if (kind === 'WAITLIST_HOLD') {
    const waitlistEntryId = directOffer ? row.offer_waitlist_entry_id : row.linked_waitlist_entry_id
    const reservationId = directOffer ? row.offer_reservation_id : row.hold_reservation_id
    return {
      kind,
      reservationId: reservationId === null ? null : Number(reservationId),
      visitId: null,
      waitlistEntryId: Number(waitlistEntryId),
      holdId: Number(row.hold_id),
      guestName: directOffer
        ? row.offer_reservation_contact_name ?? row.offer_contact_name ?? 'Khách chờ'
        : row.reservation_contact_name ?? 'Khách chờ',
      phoneLast3: directOffer ? row.offer_reservation_phone_last3 ?? row.offer_phone_last3 : row.reservation_phone_last3,
      partySize: Number(directOffer ? row.offer_reservation_party_size ?? row.offer_party_size : row.reservation_party_size),
      turnNo: null,
      flags: customerFlags(
        directOffer ? row.offer_reservation_classification : row.reservation_classification,
        directOffer ? row.offer_reservation_is_birthday : row.reservation_is_birthday,
      ),
      groupId,
      groupDisplayCode: displayCode,
      groupMemberTableIds: memberIds,
      startsAt: isoDateTime(startsAt),
      deadlineAt,
      holdOverdue: deadlineAt !== null && now.getTime() > new Date(deadlineAt).getTime(),
      paid: false,
      origin: null,
      sourceCode: directOffer ? null : row.reservation_source_code,
      version: Number(directOffer ? row.offer_waitlist_version : row.linked_waitlist_version),
      lateConfirmedAt: null,
      canCall: false,
    }
  }

  return {
    kind,
    reservationId: Number(row.hold_reservation_id),
    visitId: null,
    waitlistEntryId: null,
    holdId: Number(row.hold_id),
    guestName: row.reservation_contact_name ?? 'Khách đặt',
    phoneLast3: row.reservation_phone_last3,
    partySize: Number(row.reservation_party_size),
    turnNo: null,
    flags: customerFlags(row.reservation_classification, row.reservation_is_birthday),
    groupId,
    groupDisplayCode: displayCode,
    groupMemberTableIds: memberIds,
    startsAt: isoDateTime(row.reservation_expected_at!),
    deadlineAt: null,
    holdOverdue: false,
    paid: false,
    origin: null,
    sourceCode: row.reservation_source_code,
    version: Number(row.reservation_version),
    lateConfirmedAt: row.reservation_late_confirmed_at === null ? null : isoDateTime(row.reservation_late_confirmed_at),
    canCall: false,
  }
}

async function readProjection(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  businessDate: string,
  now: Date,
): Promise<FloorProjection> {
  const [venueRows] = await connection.execute<VenueProjectionRow[]>(
    `SELECT change_seq, upcoming_warning_minutes, late_warning_minutes, no_show_warning_minutes
     FROM venues WHERE organization_id = ? AND id = ? AND status = 'ACTIVE'`,
    [actor.organizationId, actor.venueId],
  )
  const venue = venueRows[0]
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')

  const [rows] = await connection.execute<ProjectionRow[]>(
    `SELECT
       dt.id AS table_id, dt.code AS table_code, dt.display_name AS table_display_name,
       dt.kind AS table_kind, dt.capacity AS table_capacity, dt.status AS table_status,
       dt.is_spare, dt.version AS table_version, dt.pos_x, dt.pos_y,
       z.code AS zone_code, z.name AS zone_name,
       a.id AS allocation_id, a.kind AS allocation_kind, a.business_date AS allocation_business_date,
       a.hold_id, a.visit_id, a.group_id,
       g.symbol_no AS group_symbol_no, g.dissolved_at AS group_dissolved_at,
       h.hold_kind, h.status AS hold_status, h.version AS hold_version, h.starts_at AS hold_starts_at,
       h.customer_confirmed_at, h.deadline_at,
       h.reservation_id AS hold_reservation_id, h.waitlist_entry_id AS hold_waitlist_entry_id,
       r.status AS reservation_status, r.version AS reservation_version,
       r.expected_at AS reservation_expected_at, r.business_date AS reservation_business_date,
       COALESCE(rc.display_name, r.contact_name) AS reservation_contact_name,
       r.party_size AS reservation_party_size, COALESCE(r.phone_last3, rc.phone_last3) AS reservation_phone_last3,
       r.customer_classification AS reservation_classification, r.is_birthday AS reservation_is_birthday,
       bs.code AS reservation_source_code,
       r.late_confirmed_at AS reservation_late_confirmed_at,
       lw.id AS linked_waitlist_entry_id, lw.status AS linked_waitlist_status, lw.version AS linked_waitlist_version,
       ow.id AS offer_waitlist_entry_id, ow.status AS offer_waitlist_status, ow.version AS offer_waitlist_version,
       COALESCE(owc.display_name, ow.contact_name) AS offer_contact_name, ow.party_size AS offer_party_size,
       owc.phone_last3 AS offer_phone_last3, ow.reservation_id AS offer_reservation_id,
       COALESCE(orc.display_name, orr.contact_name) AS offer_reservation_contact_name,
       orr.party_size AS offer_reservation_party_size,
       COALESCE(orr.phone_last3, orc.phone_last3) AS offer_reservation_phone_last3,
       orr.customer_classification AS offer_reservation_classification,
       orr.is_birthday AS offer_reservation_is_birthday,
       v.id AS active_visit_id, v.version AS visit_version, v.contact_name AS visit_contact_name,
       vc.display_name AS visit_customer_name, vc.phone_last3 AS visit_phone_last3,
       v.guest_count AS visit_guest_count, v.started_at AS visit_started_at,
       v.business_date AS visit_business_date, v.origin AS visit_origin,
       (v.paid_marked_at IS NOT NULL) AS visit_paid
     FROM dining_tables AS dt
     JOIN zones AS z ON z.organization_id = dt.organization_id AND z.venue_id = dt.venue_id AND z.id = dt.zone_id
     LEFT JOIN table_allocations AS a ON a.organization_id = dt.organization_id AND a.venue_id = dt.venue_id
       AND a.table_id = dt.id AND a.released_at IS NULL
       AND ((a.kind = 'USAGE' AND a.business_date <= ?) OR (a.kind = 'HOLD' AND a.business_date = ?))
     LEFT JOIN table_groups AS g ON g.organization_id = a.organization_id AND g.venue_id = a.venue_id
       AND g.id = a.group_id AND g.dissolved_at IS NULL
     LEFT JOIN visits AS v ON a.kind = 'USAGE' AND v.organization_id = a.organization_id
       AND v.venue_id = a.venue_id AND v.id = a.visit_id AND v.ended_at IS NULL
     LEFT JOIN customers AS vc ON vc.organization_id = v.organization_id AND vc.id = v.customer_id
     LEFT JOIN table_holds AS h ON a.kind = 'HOLD' AND h.organization_id = a.organization_id
       AND h.venue_id = a.venue_id AND h.id = a.hold_id
     LEFT JOIN reservations AS r ON r.organization_id = h.organization_id AND r.venue_id = h.venue_id
       AND r.id = h.reservation_id AND r.business_date = ?
     LEFT JOIN customers AS rc ON rc.organization_id = r.organization_id AND rc.id = r.customer_id
     LEFT JOIN booking_sources AS bs ON bs.organization_id = r.organization_id AND bs.id = r.source_id
     LEFT JOIN waitlist_entries AS lw ON lw.organization_id = r.organization_id AND lw.venue_id = r.venue_id
       AND lw.reservation_id = r.id AND lw.status = 'HOLD_ACTIVE'
     LEFT JOIN waitlist_entries AS ow ON ow.organization_id = h.organization_id AND ow.venue_id = h.venue_id
       AND ow.id = h.waitlist_entry_id AND ow.business_date = ?
     LEFT JOIN customers AS owc ON owc.organization_id = ow.organization_id AND owc.id = ow.customer_id
     LEFT JOIN reservations AS orr ON orr.organization_id = ow.organization_id AND orr.venue_id = ow.venue_id
       AND orr.id = ow.reservation_id AND orr.business_date = ?
     LEFT JOIN customers AS orc ON orc.organization_id = orr.organization_id AND orc.id = orr.customer_id
     WHERE dt.organization_id = ? AND dt.venue_id = ? AND dt.status <> 'RETIRED'
     ORDER BY dt.id, CASE WHEN a.kind = 'USAGE' THEN 0 ELSE 1 END,
       a.business_date DESC, a.id DESC`,
    [businessDate, businessDate, businessDate, businessDate, businessDate, actor.organizationId, actor.venueId],
  )

  const rowsByTable = new Map<number, ProjectionRow[]>()
  for (const row of rows) {
    const tableId = Number(row.table_id)
    const values = rowsByTable.get(tableId) ?? []
    values.push(row)
    rowsByTable.set(tableId, values)
  }
  const selectedByTable = new Map<number, ProjectionRow | null>()
  for (const [tableId, tableRows] of rowsByTable) selectedByTable.set(tableId, selectClaimRow(tableRows))

  const groupMembers = new Map<number, number[]>()
  for (const [tableId, row] of selectedByTable) {
    if (!row || row.group_id === null || row.group_symbol_no === null || row.group_dissolved_at !== null) continue
    const groupId = Number(row.group_id)
    const members = groupMembers.get(groupId) ?? []
    members.push(tableId)
    groupMembers.set(groupId, members)
  }
  for (const members of groupMembers.values()) members.sort((left, right) => left - right)

  const visitMembers = new Map<number, number[]>()
  for (const [tableId, row] of selectedByTable) {
    if (!row || row.active_visit_id === null) continue
    const visitId = Number(row.active_visit_id)
    const members = visitMembers.get(visitId) ?? []
    members.push(tableId)
    visitMembers.set(visitId, members)
  }

  const tables = [...rowsByTable.entries()].map(([tableId, tableRows]) => {
    const base = tableRows[0]!
    const selected = selectedByTable.get(tableId) ?? null
    const kind = selected ? claimKind(selected) : null
    const memberIds = selected?.group_id === null ? [] : groupMembers.get(Number(selected?.group_id)) ?? []
    const claim = selected && kind ? buildClaim(selected, kind, now, memberIds) : null
    const reservation = kind === 'RESERVATION' && selected?.reservation_expected_at
      ? {
          status: selected.reservation_status!,
          expectedAt: selected.reservation_expected_at,
          businessDate: dateOnly(selected.reservation_business_date)!,
          lateConfirmedAt: selected.reservation_late_confirmed_at,
        }
      : null
    const derived = deriveTableDisplayState({
      catalogState: base.table_status,
      isSpare: Boolean(base.is_spare),
      activeVisit: kind === 'VISIT' ? { active: true } : null,
      activeHold: kind === 'WAITLIST_HOLD' ? { active: true } : null,
      reservation,
      businessDate,
      now,
      thresholds: {
        upcomingMinutes: Number(venue.upcoming_warning_minutes),
        lateAfterMinutes: Number(venue.late_warning_minutes),
        noShowAfterMinutes: Number(venue.no_show_warning_minutes),
      },
    })
    if (claim?.kind === 'RESERVATION') {
      claim.canCall = claim.phoneLast3 !== null
        && (derived.displayState === 'UPCOMING'
          || derived.displayState === 'LATE'
          || derived.displayState === 'LATE_CONFIRMED')
    }
    const allocationDate = dateOnly(selected?.allocation_business_date ?? null)
    const groupId = claim?.groupId ?? null
    const groupCode = claim?.groupDisplayCode ?? null
    const visitTableIds = selected?.active_visit_id === null
      ? []
      : visitMembers.get(Number(selected?.active_visit_id)) ?? []
    const visitTableCodes = visitTableIds.map((id) => rowsByTable.get(id)?.[0]?.table_code).filter((code): code is string => Boolean(code))
    const legacyState = derived.displayState === 'OUT_OF_SERVICE'
      ? 'OUT_OF_SERVICE' as const
      : derived.displayState === 'IN_USE'
        ? 'IN_USE' as const
        : derived.displayState === 'EMPTY'
          ? 'AVAILABLE' as const
          : 'RESERVED' as const
    return {
      id: tableId,
      code: base.table_code,
      displayName: base.table_display_name,
      type: base.table_kind,
      capacity: Number(base.table_capacity),
      area: { code: base.zone_code, name: base.zone_name, floor: 1 },
      position: { x: Number(base.pos_x ?? 0) / 5.6, y: Number(base.pos_y ?? 0) / 7.6 },
      state: legacyState,
      isBackup: Boolean(base.is_spare),
      version: Number(base.table_version),
      staleFromPreviousDay: kind === 'VISIT' && allocationDate !== null && allocationDate < businessDate,
      allocationBusinessDate: allocationDate,
      activeVisit: kind === 'VISIT' && claim
        ? {
            id: claim.visitId!,
            version: claim.version,
            tableCodes: visitTableCodes,
            displayName: claim.guestName,
            phoneLast3: claim.phoneLast3,
            guestCount: claim.partySize,
            startedAt: claim.startsAt,
            origin: claim.origin!,
            paid: claim.paid,
            note: null,
          }
        : null,
      tableId,
      tableCode: base.table_code,
      catalogStatus: base.table_status,
      isSpare: Boolean(base.is_spare),
      displayState: derived.displayState,
      arrivalPhase: derived.arrivalPhase,
      arrivalTime: kind === 'RESERVATION' ? claim?.startsAt ?? null : null,
      minutesLate: derived.minutesLate,
      claim,
      groupId,
      groupDisplayCode: groupCode,
      groupMemberTableIds: claim?.groupMemberTableIds ?? [],
    } satisfies FloorTableProjection
  })

  const groups: FloorGroupProjection[] = []
  for (const [groupId, tableIds] of groupMembers) {
    if (tableIds.length < 2) continue
    const row = selectedByTable.get(tableIds[0]!)!
    const symbolNo = Number(row?.group_symbol_no)
    groups.push({ id: groupId, symbolNo, displayCode: groupDisplayCode(symbolNo), tableIds })
  }
  groups.sort((left, right) => left.id - right.id)

  return {
    businessDate,
    serverNow: now.toISOString(),
    changeSeq: String(venue.change_seq),
    tables,
    groups,
  }
}

export async function getFloorProjection(
  actor: AuthenticatedActor,
  businessDate: string,
  now = applicationNow(),
): Promise<FloorProjection> {
  const connection = await databasePool.getConnection()
  try {
    // Multiple fixed-count queries share one non-locking, repeatable-read snapshot.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await connection.query('START TRANSACTION READ ONLY')
    const projection = await readProjection(connection, actor, businessDate, now)
    await connection.commit()
    return projection
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

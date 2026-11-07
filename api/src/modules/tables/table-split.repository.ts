/**
 * BA-021 — Split (Tách bàn).
 *
 * US-04 (20/10) approves Split as an operation of its own with its own button,
 * and the client contract already in this repository defines its semantics:
 * keep the chosen tables with the party and release every other table of the
 * group with reason SPLIT. Splitting dissolves the group identity; the kept
 * tables are re-allocated, and if two or more are kept they form a new group
 * with a freshly assigned symbol.
 *
 * Allocation history is append-only: nothing is deleted, released rows stay.
 * Lock order matches the merge path (owner entity, then allocations, then the
 * group, then the venue) so Split and Merge cannot deadlock against each other.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { createTableGroup } from './table-group.repository.js'

export interface SplitTableGroupInput {
  groupId: number
  /** Tables that stay with the party. Every other table of the group is released. */
  keepTableIds: number[]
}

/** Mirrors the client MutationResult contract, plus the split-specific detail. */
export interface SplitTableGroupResult {
  operationId: number
  changeSeq: number
  summary: string
  undoable: false
  splitGroupId: number
  group: { id: number; symbolNo: number; tableIds: number[] } | null
  keptTableIds: number[]
  releasedTableIds: number[]
  owner: { kind: 'VISIT' | 'HOLD'; id: number; version: number }
}

interface GroupRow extends RowDataPacket {
  id: number
  business_date: Date | string
  symbol_no: number
  dissolved_at: Date | null
}

interface GroupAllocationRow extends RowDataPacket {
  id: number
  table_id: number
  table_code: string
  table_capacity: number
  kind: 'HOLD' | 'USAGE'
  hold_id: number | null
  visit_id: number | null
  business_date: Date | string
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
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

/** Active allocations of one group, optionally locked. */
async function groupAllocations(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  groupId: number,
  lock: boolean,
): Promise<GroupAllocationRow[]> {
  const [rows] = await connection.execute<GroupAllocationRow[]>(
    `SELECT a.id, a.table_id, dt.code AS table_code, dt.capacity AS table_capacity,
            a.kind, a.hold_id, a.visit_id, a.business_date
     FROM table_allocations AS a
     JOIN dining_tables AS dt ON dt.venue_id = a.venue_id AND dt.id = a.table_id
     WHERE a.organization_id = ? AND a.venue_id = ? AND a.group_id = ? AND a.released_at IS NULL
     ORDER BY a.table_id, a.id${lock ? ' FOR UPDATE' : ''}`,
    [actor.organizationId, actor.venueId, groupId],
  )
  return rows
}

interface SplitOwner {
  kind: 'VISIT' | 'HOLD'
  id: number
  version: number
  /** visits.guest_count, or the reservation party_size behind a hold. */
  guestCount: number
}

async function lockOwner(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  allocation: GroupAllocationRow,
): Promise<SplitOwner> {
  if (allocation.kind === 'USAGE') {
    const visitId = Number(allocation.visit_id)
    const [visits] = await connection.execute<(RowDataPacket & {
      version: number; ended_at: Date | null; guest_count: number
    })[]>(
      `SELECT version, ended_at, guest_count FROM visits
       WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, visitId],
    )
    const visit = visits[0]
    if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy lượt khách.')
    if (visit.ended_at) throw new AppError(409, 'VISIT_ALREADY_CLOSED', 'Lượt khách đã kết thúc.')
    return { kind: 'VISIT', id: visitId, version: Number(visit.version), guestCount: Number(visit.guest_count) }
  }
  const holdId = Number(allocation.hold_id)
  const [holds] = await connection.execute<(RowDataPacket & {
    version: number; status: string; party_size: number | null
  })[]>(
    `SELECT h.version, h.status, r.party_size FROM table_holds AS h
     LEFT JOIN reservations AS r ON r.organization_id = h.organization_id
       AND r.venue_id = h.venue_id AND r.id = h.reservation_id
     WHERE h.organization_id = ? AND h.venue_id = ? AND h.id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, holdId],
  )
  const hold = holds[0]
  if (!hold) throw new AppError(404, 'HOLD_NOT_FOUND', 'Không tìm thấy lượt giữ bàn.')
  if (hold.status !== 'ACTIVE') throw new AppError(409, 'HOLD_NOT_ACTIVE', 'Lượt giữ bàn không còn hiệu lực.')
  return { kind: 'HOLD', id: holdId, version: Number(hold.version), guestCount: Number(hold.party_size ?? 0) }
}

export async function splitTableGroup(
  actor: AuthenticatedActor,
  input: SplitTableGroupInput,
  transaction?: PoolConnection,
): Promise<SplitTableGroupResult> {
  const keep = [...new Set(input.keepTableIds)].sort((a, b) => a - b)
  if (!keep.length) {
    throw new AppError(400, 'SPLIT_REQUIRES_KEPT_TABLE',
      'Giữ lại ít nhất một bàn cho đoàn khách. Muốn trả hết bàn hãy dùng Nhả bàn.')
  }
  if (keep.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new AppError(400, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')
  }

  // SPL-03: when BA-002 supplies the idempotency transaction, the compensation
  // shares it so the committed response and this mutation land together.
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()

    // Discovery only: find the owning entity so the locks below are taken in the
    // same order the merge path uses. Everything is re-validated after locking.
    const probe = await groupAllocations(connection, actor, input.groupId, false)
    if (!probe.length) throw new AppError(404, 'GROUP_NOT_FOUND', 'Nhóm ghép không còn tồn tại.')
    const owners = new Set(probe.map((row) => `${row.kind}:${row.visit_id ?? row.hold_id}`))
    if (owners.size !== 1) {
      throw new AppError(409, 'GROUP_STATE_INCONSISTENT', 'Nhóm ghép đang thuộc nhiều chủ sở hữu.')
    }

    const owner = await lockOwner(connection, actor, probe[0]!)
    const allocations = await groupAllocations(connection, actor, input.groupId, true)
    const [groups] = await connection.execute<GroupRow[]>(
      `SELECT id, business_date, symbol_no, dissolved_at FROM table_groups
       WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.groupId],
    )
    const group = groups[0]
    if (!group || group.dissolved_at !== null || !allocations.length) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Nhóm ghép không còn tồn tại.')
    }

    // A concurrent split, move or release may have changed the group meanwhile.
    const groupTableIds = allocations.map((row) => Number(row.table_id))
    const probeTableIds = probe.map((row) => Number(row.table_id))
    if (groupTableIds.length !== probeTableIds.length
      || groupTableIds.some((id, index) => id !== probeTableIds[index])) {
      throw new AppError(409, 'GROUP_STATE_CHANGED', 'Nhóm ghép vừa được thay đổi, hãy tải lại sơ đồ.')
    }
    if (keep.some((id) => !groupTableIds.includes(id))) {
      throw new AppError(409, 'SPLIT_TABLE_NOT_IN_GROUP', 'Bàn giữ lại không thuộc nhóm ghép.')
    }

    const businessDate = dateOnly(group.business_date)
    const released = groupTableIds.filter((id) => !keep.includes(id))

    // SPL-02 (PO 07/11/2026): a Split must actually release a table. Keeping the
    // whole group is not a Split; it would only churn the group symbol.
    if (!released.length) {
      throw new AppError(409, 'SPLIT_RELEASES_NO_TABLE',
        'Tách bàn phải nhả ít nhất một bàn. Nhóm ghép giữ nguyên.')
    }
    // SPL-01 (PO 07/11/2026): the kept tables must still seat the party. Same
    // capacity rule as merge and assignment: sum of capacities vs guest count.
    const keptCapacity = keep.reduce((sum, id) => sum
      + Number(allocations.find((row) => Number(row.table_id) === id)?.table_capacity ?? 0), 0)
    if (keptCapacity < owner.guestCount) {
      throw new AppError(409, 'INSUFFICIENT_TABLE_CAPACITY',
        'Các bàn giữ lại không đủ sức chứa cho số khách hiện tại.')
    }

    // Release every allocation of the group, then re-allocate the kept tables.
    // Released rows are kept, so usage history survives the split.
    await connection.execute(
      `UPDATE table_allocations
       SET released_at = UTC_TIMESTAMP(3), released_by_user_id = ?, release_reason = 'SPLIT'
       WHERE organization_id = ? AND venue_id = ? AND released_at IS NULL
         AND id IN (${allocations.map(() => '?').join(',')})`,
      [actor.userId, actor.organizationId, actor.venueId, ...allocations.map((row) => Number(row.id))],
    )
    await connection.execute(
      `UPDATE table_groups SET dissolved_at = UTC_TIMESTAMP(3), dissolved_by_user_id = ?
       WHERE organization_id = ? AND venue_id = ? AND id = ? AND dissolved_at IS NULL`,
      [actor.userId, actor.organizationId, actor.venueId, input.groupId],
    )

    const newGroup = keep.length > 1 ? await createTableGroup(connection, actor, businessDate) : null
    for (const tableId of keep) {
      const source = allocations.find((row) => Number(row.table_id) === tableId)!
      await connection.execute(
        `INSERT INTO table_allocations
          (organization_id, venue_id, table_id, kind, hold_id, visit_id, group_id,
           starts_at, business_date, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
        [actor.organizationId, actor.venueId, tableId, source.kind,
          source.hold_id === null ? null : Number(source.hold_id),
          source.visit_id === null ? null : Number(source.visit_id),
          newGroup?.id ?? null, dateOnly(source.business_date), actor.userId],
      )
    }

    const nextVersion = owner.version + 1
    if (owner.kind === 'VISIT') {
      await connection.execute(
        `UPDATE visits SET version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
        [actor.organizationId, actor.venueId, owner.id, owner.version],
      )
    } else {
      await connection.execute(
        `UPDATE table_holds SET version = version + 1
         WHERE organization_id = ? AND venue_id = ? AND id = ? AND version = ?`,
        [actor.organizationId, actor.venueId, owner.id, owner.version],
      )
    }

    const changeSeq = await nextVenueChangeSequence(connection, actor)
    // is_undoable = 0: BA-020 cannot compensate a Split yet, so the audit row
    // must not claim that it can. Undo therefore fails closed with NOT_UNDOABLE.
    const [logged] = await connection.execute<ResultSetHeader>(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         action, entity_type, entity_id, entity_version_before, entity_version_after, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'TABLES_SPLIT', 'table_group', ?, ?, ?, CAST(? AS JSON), 'MANUAL', 0)`,
      [actor.organizationId, actor.venueId, changeSeq, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, input.groupId, owner.version, nextVersion,
        JSON.stringify([{
          type: 'table_group_split',
          groupId: input.groupId,
          symbolNo: Number(group.symbol_no),
          previousTableIds: groupTableIds,
          keptTableIds: keep,
          releasedTableIds: released,
          newGroupId: newGroup?.id ?? null,
          owner: { kind: owner.kind, id: owner.id },
        }])],
    )

    const codes = (ids: number[]): string => ids
      .map((id) => allocations.find((row) => Number(row.table_id) === id)?.table_code ?? String(id))
      .join(', ')
    const summary = released.length
      ? `Đã tách nhóm bàn, giữ ${codes(keep)} và nhả ${codes(released)}.`
      : `Đã bỏ ký hiệu ghép, giữ ${codes(keep)}.`

    if (ownsTransaction) await connection.commit()
    return {
      operationId: logged.insertId,
      changeSeq: Number(changeSeq),
      summary,
      undoable: false,
      splitGroupId: input.groupId,
      group: newGroup ? { ...newGroup, tableIds: keep } : null,
      keptTableIds: keep,
      releasedTableIds: released,
      owner: { ...owner, version: nextVersion },
    }
  } catch (error) {
    if (ownsTransaction) await connection.rollback()
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import type {
  PreparationLineView,
  PreparationQueueSnapshot,
  PreparationStation,
  PreparationStatus,
  PreparationTicketView,
} from './preparation.model.js'

interface TicketRow extends RowDataPacket {
  id: number
  order_id: number
  visit_id: number
  visit_sequence: number
  station: PreparationStation
  status: PreparationStatus
  version: number
  submitted_at: Date | string
  accepted_at: Date | string | null
  started_at: Date | string | null
  ready_at: Date | string | null
  collected_at: Date | string | null
  table_codes: string | null
  ordered_by_user_id: number
}

interface LineRow extends RowDataPacket {
  order_id: number
  preparation_station: PreparationStation
  line_no: number
  item_name: string
  variant_display_name: string
  quantity: number
  note: string | null
}

const nextStatus: Record<Exclude<PreparationStatus, 'COLLECTED'>, PreparationStatus> = {
  SUBMITTED: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COLLECTED',
}

export const PREPARATION_QUEUE_LIMIT = 200
export const PREPARATION_HISTORY_MAX_LIMIT = 100

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return (value instanceof Date ? value : new Date(`${value}Z`)).toISOString()
}

async function readCursor(connection: PoolConnection | typeof databasePool, actor: AuthenticatedActor): Promise<string> {
  const [rows] = await connection.execute<(RowDataPacket & { change_seq: string | number })[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ?',
    [actor.organizationId, actor.venueId],
  )
  return String(rows[0]?.change_seq ?? '0')
}

async function ticketLinesBatch(
  connection: PoolConnection | typeof databasePool,
  actor: AuthenticatedActor,
  tickets: TicketRow[],
): Promise<Map<string, PreparationLineView[]>> {
  const result = new Map<string, PreparationLineView[]>()
  if (tickets.length === 0) return result
  const orderIds = [...new Set(tickets.map((ticket) => Number(ticket.order_id)))]
  const [rows] = await connection.execute<LineRow[]>(
    `SELECT order_id, preparation_station, line_no, item_name, variant_display_name, quantity, note
       FROM sales_order_lines
      WHERE organization_id = ? AND venue_id = ? AND order_id IN (${orderIds.map(() => '?').join(',')})
      ORDER BY order_id, preparation_station, line_no`,
    [actor.organizationId, actor.venueId, ...orderIds],
  )
  for (const row of rows) {
    const key = `${Number(row.order_id)}:${row.preparation_station}`
    const lines = result.get(key) ?? []
    lines.push({ lineNo: Number(row.line_no), itemName: row.item_name,
      variantDisplayName: row.variant_display_name, quantity: Number(row.quantity), note: row.note })
    result.set(key, lines)
  }
  return result
}

function baseTicket(row: TicketRow, lines: PreparationLineView[]): PreparationTicketView {
  const submittedAt = iso(row.submitted_at)!
  return {
    ticketId: Number(row.id),
    orderId: Number(row.order_id),
    visitId: Number(row.visit_id),
    visitSequence: Number(row.visit_sequence),
    station: row.station,
    status: row.status,
    version: Number(row.version),
    submittedAt,
    acceptedAt: iso(row.accepted_at),
    startedAt: iso(row.started_at),
    readyAt: iso(row.ready_at),
    collectedAt: iso(row.collected_at),
    waitSeconds: Math.max(0, Math.floor((Date.now() - new Date(submittedAt).getTime()) / 1000)),
    tableCodes: row.table_codes ? row.table_codes.split(',') : [],
    lines,
  }
}

const selectTickets = `SELECT t.id, t.order_id, t.visit_id, o.visit_sequence, t.station, t.status, t.version,
       o.submitted_at, t.accepted_at, t.started_at, t.ready_at, t.collected_at, o.ordered_by_user_id,
       (SELECT GROUP_CONCAT(dt.code ORDER BY dt.code SEPARATOR ',')
          FROM table_allocations ta JOIN dining_tables dt ON dt.venue_id = ta.venue_id AND dt.id = ta.table_id
         WHERE ta.organization_id = t.organization_id AND ta.venue_id = t.venue_id
           AND ta.visit_id = t.visit_id AND ta.kind = 'USAGE' AND ta.released_at IS NULL) AS table_codes
  FROM preparation_tickets t
  JOIN sales_orders o ON o.venue_id = t.venue_id AND o.id = t.order_id`

export async function getPreparationQueue(
  actor: AuthenticatedActor,
  station: PreparationStation,
): Promise<PreparationQueueSnapshot> {
  const [rows] = await databasePool.execute<TicketRow[]>(
    `${selectTickets}
      WHERE t.organization_id = ? AND t.venue_id = ? AND t.station = ?
        AND t.status IN ('SUBMITTED','ACCEPTED','PREPARING','READY')
      ORDER BY FIELD(t.status, 'SUBMITTED','ACCEPTED','PREPARING','READY'), t.id
      LIMIT ${PREPARATION_QUEUE_LIMIT}`,
    [actor.organizationId, actor.venueId, station],
  )
  const lineMap = await ticketLinesBatch(databasePool, actor, rows)
  const tickets = rows.map((row) => baseTicket(row, lineMap.get(`${Number(row.order_id)}:${row.station}`) ?? []))
  const [capabilities] = await databasePool.execute<(RowDataPacket & { enabled: number })[]>(
    `SELECT EXISTS(SELECT 1 FROM preparation_print_capabilities
      WHERE organization_id = ? AND venue_id = ? AND station = ? AND is_enabled = 1
        AND adapter_name IS NOT NULL AND adapter_name <> ''
        AND worker_heartbeat_at >= UTC_TIMESTAMP(3) - INTERVAL 2 MINUTE) enabled`,
    [actor.organizationId, actor.venueId, station],
  )
  return { station, changeCursor: await readCursor(databasePool, actor), generatedAt: new Date().toISOString(),
    printing: { enabled: Number(capabilities[0]?.enabled ?? 0) === 1 }, limit: PREPARATION_QUEUE_LIMIT, tickets }
}

export async function getPreparationHistory(
  actor: AuthenticatedActor,
  station: PreparationStation,
  input: { beforeTicketId?: number; limit: number },
): Promise<{ tickets: PreparationTicketView[]; nextBeforeTicketId: number | null; limit: number }> {
  const limit = Math.min(PREPARATION_HISTORY_MAX_LIMIT, Math.max(1, input.limit))
  const params: Array<number | string> = [actor.organizationId, actor.venueId, station]
  const before = input.beforeTicketId === undefined ? '' : ' AND t.id < ?'
  if (input.beforeTicketId !== undefined) params.push(input.beforeTicketId)
  const [rows] = await databasePool.execute<TicketRow[]>(
    `${selectTickets} WHERE t.organization_id = ? AND t.venue_id = ? AND t.station = ?
      AND t.status = 'COLLECTED'${before} ORDER BY t.id DESC LIMIT ${limit + 1}`,
    params,
  )
  const page = rows.slice(0, limit)
  const lineMap = await ticketLinesBatch(databasePool, actor, page)
  return {
    tickets: page.map((row) => baseTicket(row, lineMap.get(`${Number(row.order_id)}:${row.station}`) ?? [])),
    nextBeforeTicketId: rows.length > limit ? Number(page.at(-1)!.id) : null,
    limit,
  }
}

async function bumpCursor(connection: PoolConnection, actor: AuthenticatedActor): Promise<number> {
  const [rows] = await connection.execute<(RowDataPacket & { change_seq: number | string })[]>(
    'SELECT change_seq FROM venues WHERE organization_id = ? AND id = ? FOR UPDATE',
    [actor.organizationId, actor.venueId],
  )
  if (!rows[0]) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm của phiên đăng nhập.')
  const changeSeq = Number(rows[0].change_seq) + 1
  await connection.execute(
    'UPDATE venues SET change_seq = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE organization_id = ? AND id = ?',
    [changeSeq, actor.organizationId, actor.venueId],
  )
  return changeSeq
}

export async function transitionPreparationTicket(
  actor: AuthenticatedActor,
  input: { ticketId: number; station: PreparationStation; toStatus: PreparationStatus; expectedVersion: number; idempotencyKey: string },
  transaction?: PoolConnection,
): Promise<{ ticket: PreparationTicketView; changeCursor: string }> {
  const connection = transaction ?? await databasePool.getConnection()
  const owns = transaction === undefined
  try {
    if (owns) await connection.beginTransaction()
    const [rows] = await connection.execute<TicketRow[]>(
      `${selectTickets}
        WHERE t.organization_id = ? AND t.venue_id = ? AND t.id = ? AND t.station = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.ticketId, input.station],
    )
    const current = rows[0]
    if (!current) throw new AppError(404, 'PREPARATION_TICKET_NOT_FOUND', 'Không tìm thấy phiếu trong quầy và địa điểm này.')
    if (Number(current.version) !== input.expectedVersion) {
      throw new AppError(409, 'PREPARATION_VERSION_CONFLICT', 'Phiếu đã được thiết bị khác cập nhật. Hãy tải lại hàng đợi.',
        { expectedVersion: input.expectedVersion, currentVersion: Number(current.version) })
    }
    if (current.status === 'COLLECTED') {
      throw new AppError(409, 'PREPARATION_TICKET_TERMINAL', 'Phiếu đã hoàn thành và không thể cập nhật thêm.')
    }
    const required = nextStatus[current.status]
    if (input.toStatus !== required) {
      throw new AppError(409, 'INVALID_PREPARATION_TRANSITION', `Chỉ được chuyển ${current.status} sang ${required}.`,
        { fromStatus: current.status, requiredStatus: required })
    }
    const milestone = input.toStatus === 'ACCEPTED'
      ? 'accepted_by_user_id = ?, accepted_at = UTC_TIMESTAMP(3)'
      : input.toStatus === 'PREPARING'
        ? 'started_by_user_id = ?, started_at = UTC_TIMESTAMP(3)'
        : input.toStatus === 'READY'
          ? 'ready_by_user_id = ?, ready_at = UTC_TIMESTAMP(3)'
          : 'collected_by_user_id = ?, collected_at = UTC_TIMESTAMP(3)'
    await connection.execute(
      `UPDATE preparation_tickets SET status = ?, ${milestone}, version = version + 1, updated_at = UTC_TIMESTAMP(3)
        WHERE organization_id = ? AND venue_id = ? AND id = ? AND station = ? AND version = ?`,
      [input.toStatus, actor.userId, actor.organizationId, actor.venueId, input.ticketId, input.station, input.expectedVersion],
    )
    const newVersion = input.expectedVersion + 1
    await connection.execute(
      `INSERT INTO preparation_ticket_events
        (organization_id, venue_id, ticket_id, station, from_status, to_status, ticket_version,
         actor_user_id, actor_membership_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, input.ticketId, input.station, current.status, input.toStatus,
        newVersion, actor.userId, actor.membershipId, input.idempotencyKey],
    )
    if (input.toStatus === 'READY') {
      await connection.execute(
        `INSERT INTO preparation_ready_notifications
          (organization_id, venue_id, ticket_id, visit_id, recipient_user_id)
         VALUES (?, ?, ?, ?, ?)`,
        [actor.organizationId, actor.venueId, input.ticketId, current.visit_id, current.ordered_by_user_id],
      )
      const [readyEvent] = await connection.execute<import('mysql2/promise').ResultSetHeader>(
        `INSERT INTO preparation_ready_events
          (organization_id, venue_id, ticket_id, visit_id, ordered_by_user_id)
         VALUES (?, ?, ?, ?, ?)`,
        [actor.organizationId, actor.venueId, input.ticketId, current.visit_id, current.ordered_by_user_id],
      )
      await connection.execute(
        `INSERT INTO preparation_ready_audiences (event_id, audience, target_user_id)
         VALUES (?, 'ORDERED_BY_USER', ?), (?, 'CASHIER_ROLE', NULL)`,
        [readyEvent.insertId, current.ordered_by_user_id, readyEvent.insertId],
      )
    }
    const changeSeq = await bumpCursor(connection, actor)
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, change_seq, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         idempotency_key, action, entity_type, entity_id, entity_version_before, entity_version_after,
         changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, 'PREPARATION_TICKET_TRANSITIONED', 'preparation_ticket', ?, ?, ?,
         CAST(? AS JSON), 'MANUAL', 0)`,
      [actor.organizationId, actor.venueId, changeSeq, actor.userId, actor.membershipId, actor.authSessionId ?? null,
        input.idempotencyKey, input.ticketId, input.expectedVersion, newVersion,
        JSON.stringify([{ type: 'preparation_ticket_transitioned', station: input.station,
          fromStatus: current.status, toStatus: input.toStatus, visitId: Number(current.visit_id) }])],
    )
    const [updatedRows] = await connection.execute<TicketRow[]>(
      `${selectTickets} WHERE t.organization_id = ? AND t.venue_id = ? AND t.id = ? AND t.station = ?`,
      [actor.organizationId, actor.venueId, input.ticketId, input.station],
    )
    const updated = updatedRows[0]!
    const updatedLines = await ticketLinesBatch(connection, actor, [updated])
    const result = { ticket: baseTicket(updated, updatedLines.get(`${Number(updated.order_id)}:${updated.station}`) ?? []), changeCursor: String(changeSeq) }
    if (owns) await connection.commit()
    return result
  } catch (error) {
    if (owns) await connection.rollback()
    throw error
  } finally {
    if (owns) connection.release()
  }
}

export async function retryPreparationPrint(
  actor: AuthenticatedActor,
  input: { ticketId: number; station: PreparationStation; idempotencyKey: string },
  transaction?: PoolConnection,
): Promise<{ outboxId: number; status: string; retryRequestCount: number }> {
  const connection = transaction ?? await databasePool.getConnection()
  const owns = transaction === undefined
  try {
    if (owns) await connection.beginTransaction()
    const [rows] = await connection.execute<(RowDataPacket & { id: number; status: string; retry_request_count: number; printing_enabled: number })[]>(
      `SELECT o.id, o.status, o.retry_request_count,
        (c.is_enabled = 1 AND c.adapter_name IS NOT NULL AND c.adapter_name <> ''
          AND c.worker_heartbeat_at >= UTC_TIMESTAMP(3) - INTERVAL 2 MINUTE) printing_enabled
       FROM preparation_print_outbox o
       JOIN preparation_tickets t ON t.venue_id = o.venue_id AND t.id = o.ticket_id
       LEFT JOIN preparation_print_capabilities c ON c.organization_id = o.organization_id
         AND c.venue_id = o.venue_id AND c.station = o.station
       WHERE o.organization_id = ? AND o.venue_id = ? AND o.ticket_id = ? AND o.station = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.ticketId, input.station],
    )
    const outbox = rows[0]
    if (!outbox) throw new AppError(404, 'PREPARATION_TICKET_NOT_FOUND', 'Không tìm thấy phiếu in trong quầy và địa điểm này.')
    if (Number(outbox.printing_enabled ?? 0) !== 1) {
      throw new AppError(503, 'PRINT_NOT_CONFIGURED', 'Chưa có print adapter/worker hoạt động cho quầy này.')
    }
    await connection.execute(
      `UPDATE preparation_print_outbox SET status = 'PENDING', retry_request_count = retry_request_count + 1,
       available_at = UTC_TIMESTAMP(3), claimed_at = NULL, delivered_at = NULL, last_error_code = NULL,
       updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [outbox.id],
    )
    await connection.execute(
      `INSERT INTO preparation_print_retry_events
        (organization_id, venue_id, outbox_id, actor_user_id, actor_membership_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actor.organizationId, actor.venueId, outbox.id, actor.userId, actor.membershipId, input.idempotencyKey],
    )
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         idempotency_key, action, entity_type, entity_id, entity_version_before, entity_version_after,
         changes, reason_code, is_undoable)
       VALUES (?, ?, 'USER', ?, ?, ?, ?, 'PREPARATION_PRINT_RETRY_REQUESTED',
         'preparation_print_outbox', ?, NULL, NULL, CAST(? AS JSON), 'MANUAL', 0)`,
      [actor.organizationId, actor.venueId, actor.userId, actor.membershipId, actor.authSessionId ?? null,
        input.idempotencyKey, outbox.id, JSON.stringify([{ type: 'preparation_print_retry_requested',
          ticketId: input.ticketId, station: input.station }])],
    )
    if (owns) await connection.commit()
    return { outboxId: Number(outbox.id), status: 'PENDING', retryRequestCount: Number(outbox.retry_request_count) + 1 }
  } catch (error) {
    if (owns) await connection.rollback()
    throw error
  } finally {
    if (owns) connection.release()
  }
}

interface ReadyNotificationRow extends RowDataPacket {
  event_id: number
  ticket_id: number
  visit_id: number
  ordered_by_user_id: number
  station: PreparationStation
  audience: 'ORDERED_BY_USER' | 'CASHIER_ROLE'
  created_at: Date | string
  acknowledged_at: Date | string | null
}

async function actorIsCashier(connection: PoolConnection | typeof databasePool, actor: AuthenticatedActor): Promise<boolean> {
  const [rows] = await connection.execute<(RowDataPacket & { allowed: number })[]>(
    `SELECT EXISTS(SELECT 1 FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
      WHERE mr.organization_id = ? AND mr.membership_id = ? AND mr.venue_id = ? AND r.code = 'CASHIER') allowed`,
    [actor.organizationId, actor.membershipId, actor.venueId],
  )
  return Number(rows[0]?.allowed ?? 0) === 1
}

export async function listReadyNotifications(actor: AuthenticatedActor): Promise<{ notifications: import('./preparation.model.js').ReadyNotificationView[] }> {
  const cashier = await actorIsCashier(databasePool, actor)
  const [rows] = await databasePool.execute<ReadyNotificationRow[]>(
    `SELECT e.id event_id, e.ticket_id, e.visit_id, e.ordered_by_user_id, t.station,
       a.audience, e.created_at, ack.acknowledged_at
     FROM preparation_ready_events e
     JOIN preparation_ready_audiences a ON a.event_id = e.id
     JOIN preparation_tickets t ON t.venue_id = e.venue_id AND t.id = e.ticket_id
     LEFT JOIN preparation_ready_acknowledgements ack ON ack.event_id = e.id AND ack.audience = a.audience
       AND ack.acknowledged_by_membership_id = ?
     WHERE e.organization_id = ? AND e.venue_id = ?
       AND ((a.audience = 'ORDERED_BY_USER' AND a.target_user_id = ?)
         OR (a.audience = 'CASHIER_ROLE' AND ? = 1))
     ORDER BY e.id DESC LIMIT 100`,
    [actor.membershipId, actor.organizationId, actor.venueId, actor.userId, cashier ? 1 : 0],
  )
  return { notifications: rows.map((row) => ({ eventId: Number(row.event_id), ticketId: Number(row.ticket_id),
    visitId: Number(row.visit_id), orderedByUserId: Number(row.ordered_by_user_id), station: row.station,
    audience: row.audience, createdAt: iso(row.created_at)!, acknowledgedAt: iso(row.acknowledged_at) })) }
}

export async function acknowledgeReadyNotification(
  actor: AuthenticatedActor,
  input: { eventId: number; audience: 'ORDERED_BY_USER' | 'CASHIER_ROLE'; idempotencyKey: string },
  transaction?: PoolConnection,
): Promise<{ eventId: number; audience: string; acknowledgedAt: string }> {
  const connection = transaction ?? await databasePool.getConnection()
  const owns = transaction === undefined
  try {
    if (owns) await connection.beginTransaction()
    const [rows] = await connection.execute<(RowDataPacket & { target_user_id: number | null })[]>(
      `SELECT a.target_user_id FROM preparation_ready_events e
       JOIN preparation_ready_audiences a ON a.event_id = e.id
       WHERE e.organization_id = ? AND e.venue_id = ? AND e.id = ? AND a.audience = ? FOR UPDATE`,
      [actor.organizationId, actor.venueId, input.eventId, input.audience],
    )
    const audience = rows[0]
    if (!audience) throw new AppError(404, 'READY_NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo READY trong địa điểm này.')
    const allowed = input.audience === 'ORDERED_BY_USER'
      ? Number(audience.target_user_id) === actor.userId
      : await actorIsCashier(connection, actor)
    if (!allowed) throw new AppError(403, 'PERMISSION_DENIED', 'Tài khoản không thuộc audience của thông báo này.')
    await connection.execute(
      `INSERT INTO preparation_ready_acknowledgements
        (event_id, audience, acknowledged_by_user_id, acknowledged_by_membership_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [input.eventId, input.audience, actor.userId, actor.membershipId, input.idempotencyKey],
    )
    const [ackRows] = await connection.execute<(RowDataPacket & { acknowledged_at: Date | string })[]>(
      `SELECT acknowledged_at FROM preparation_ready_acknowledgements
       WHERE event_id = ? AND audience = ? AND acknowledged_by_membership_id = ?`,
      [input.eventId, input.audience, actor.membershipId],
    )
    if (owns) await connection.commit()
    return { eventId: input.eventId, audience: input.audience, acknowledgedAt: iso(ackRows[0]!.acknowledged_at)! }
  } catch (error) {
    if (owns) await connection.rollback()
    throw error
  } finally {
    if (owns) connection.release()
  }
}

/**
 * TU-35 — Đọc nhật ký thao tác.
 *
 * Chỉ ĐỌC. Không có hàm nào trong file này sửa hoặc xoá `operation_log`: bảng
 * là append-only, mọi nơi ghi đều INSERT, và một dòng sửa được thì không truy
 * trách nhiệm được nữa.
 *
 * Quy tắc dữ liệu (biên bản 15/11): nhật ký ghi VIỆC đã xem số điện thoại,
 * không ghi số. Cột Đối tượng chỉ dựng từ tên khách, mã bàn và mã bản ghi —
 * không có số điện thoại, kể cả 3 số cuối. Trường `changes` được lọc qua một
 * danh sách khoá cho phép chứ không đổ nguyên JSON ra ngoài.
 */
import type { RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import {
  actionsForTypes,
  AUDIT_ACTIONS,
  AUDIT_EXPORT_SETTING_KEY,
  AUDIT_RETENTION_SETTING_KEY,
  parseExportLevels,
  parseRetentionDays,
} from './audit-actions.js'

export interface AuditQuery {
  /** Ngày kinh doanh dạng YYYY-MM-DD; để trống thì lấy theo retention. */
  from?: string
  to?: string
  types?: string[]
  limit: number
  /** Con trỏ: id của dòng cuối trang trước (đi lùi theo thời gian). */
  beforeId?: number
}

export interface AuditEntry {
  id: number
  occurredAt: string
  actor: string
  actorUsername: string | null
  action: string
  actionLabel: string
  actionType: string | null
  target: string
  device: string
  detail: string
}

export interface AuditPage {
  entries: AuditEntry[]
  hasMore: boolean
  nextCursor: number | null
  retentionDays: number
  /** Mốc sớm nhất còn đọc được, theo cấu hình lưu trữ. */
  windowStart: string
}

export interface AuditConfig {
  retentionDays: number
  exportLevels: string[]
}

interface AuditRow extends RowDataPacket {
  id: number
  occurred_at: Date
  action: string
  entity_type: string
  entity_id: number
  changes: unknown
  reason_code: string | null
  actor_name: string | null
  actor_username: string | null
  device_label: string | null
  reservation_name: string | null
  visit_name: string | null
  target_user_name: string | null
  table_code: string | null
}

const MAX_LIMIT = 200

/** Đọc cấu hình nhật ký từ venue_settings; thiếu thì dùng mặc định. */
export async function getAuditConfig(actor: AuthenticatedActor): Promise<AuditConfig> {
  const [rows] = await databasePool.execute<(RowDataPacket & { key: string; value: unknown })[]>(
    'SELECT `key`, `value` FROM venue_settings WHERE organization_id = ? AND venue_id = ? AND `key` IN (?, ?)',
    [actor.organizationId, actor.venueId, AUDIT_RETENTION_SETTING_KEY, AUDIT_EXPORT_SETTING_KEY],
  )
  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  return {
    retentionDays: parseRetentionDays(byKey.get(AUDIT_RETENTION_SETTING_KEY)),
    exportLevels: parseExportLevels(byKey.get(AUDIT_EXPORT_SETTING_KEY)),
  }
}

/**
 * Danh sách khoá được phép hiện ở cột chi tiết.
 *
 * Danh sách cho phép, không phải danh sách cấm: một khoá mới xuất hiện trong
 * `changes` sẽ bị bỏ qua cho tới khi ai đó cân nhắc, nên không thể vô tình rò
 * một trường nhạy cảm ra màn hình hay ra file xuất.
 */
const DETAIL_KEYS = new Set([
  'from', 'to', 'tableCodes', 'fromTableCodes', 'toTableCodes', 'roleCode', 'accessLevel',
  'portal', 'result', 'reason', 'revokedSessions', 'partySize', 'guestCount', 'groupId',
  // Module Phục vụ 3. `lines` cố ý KHÔNG có trong danh sách: mỗi dòng mang ghi
  // chú món do nhân viên gõ tay, và cột chi tiết của nhật ký không phải chỗ để
  // nó xuất hiện. Tổng tiền và số món đủ để đọc một dòng nhật ký gọi món.
  'visitSequence', 'lineCount', 'itemCount', 'totalAmountVnd', 'stations',
  // Module Phục vụ 5. `reason` và `note` cố ý KHÔNG có ở đây: lý do hủy và ghi
  // chú quyết định là ô gõ tự do, và nguyên văn của chúng nằm ở
  // `sales_order_cancellations` / `sales_order_line_changes` — truy được mà
  // không đổ vào cột chi tiết của màn nhật ký.
  'quantityBefore', 'quantityAfter', 'quantity', 'amountDeltaVnd', 'policy', 'ticketStatus', 'lineNo',
])

function summarizeChanges(changes: unknown): string {
  if (!Array.isArray(changes)) return ''
  const parts: string[] = []
  for (const change of changes) {
    if (!change || typeof change !== 'object') continue
    for (const [key, value] of Object.entries(change as Record<string, unknown>)) {
      if (!DETAIL_KEYS.has(key) || value === null || value === undefined) continue
      if (Array.isArray(value)) {
        parts.push(`${key}: ${value.filter((item) => typeof item === 'string' || typeof item === 'number').join(', ')}`)
      } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        parts.push(`${key}: ${value}`)
      }
    }
    // TU-34 ghi mảng permissions; tóm tắt bằng số lượng thay vì đổ cả mảng.
    const permissions = (change as { permissions?: unknown }).permissions
    if (Array.isArray(permissions)) parts.push(`quyền đổi: ${permissions.length}`)
  }
  return parts.slice(0, 6).join(' · ')
}

function describeTarget(row: AuditRow): string {
  const id = Number(row.entity_id)
  switch (row.entity_type) {
    case 'reservation':
      return row.reservation_name ? `Booking #${id} · ${row.reservation_name}` : `Booking #${id}`
    case 'visit':
      return row.visit_name ? `Lượt #${id} · ${row.visit_name}` : `Lượt #${id}`
    case 'user':
      return row.target_user_name ? `Tài khoản ${row.target_user_name}` : `Tài khoản #${id}`
    case 'auth_session':
      return row.target_user_name ? `Phiên của ${row.target_user_name}` : `Phiên #${id}`
    case 'dining_table':
    case 'table':
      return row.table_code ? `Bàn ${row.table_code}` : `Bàn #${id}`
    case 'table_group':
      return `Cụm bàn #${id}`
    case 'sales_order':
      return `Đơn gọi món #${id}`
    case 'sales_order_line':
      return `Dòng món #${id}`
    case 'sales_order_cancellation':
      return `Yêu cầu hủy món #${id}`
    case 'menu_item':
      return `Món #${id}`
    case 'venue':
      return 'Cấu hình quán'
    default:
      return `${row.entity_type} #${id}`
  }
}

function toEntry(row: AuditRow): AuditEntry {
  const info = AUDIT_ACTIONS[row.action]
  return {
    id: Number(row.id),
    occurredAt: new Date(row.occurred_at).toISOString(),
    actor: row.actor_name ?? 'Hệ thống',
    actorUsername: row.actor_username,
    action: row.action,
    actionLabel: info?.label ?? row.action,
    actionType: info?.type ?? null,
    target: describeTarget(row),
    // Thiết bị lấy từ phiên đăng nhập (TU-33). Không có phiên — ví dụ worker
    // chạy nền — thì nói thẳng là hệ thống, đừng để trống rồi đoán.
    device: row.device_label ?? (row.actor_name ? '—' : 'Hệ thống'),
    detail: summarizeChanges(row.changes),
  }
}

export async function listAuditEntries(actor: AuthenticatedActor, query: AuditQuery): Promise<AuditPage> {
  const config = await getAuditConfig(actor)
  const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT)
  const actions = actionsForTypes(query.types ?? [])
  const requestedTypes = (query.types ?? []).length > 0

  // Lọc theo nhóm mà nhóm đó chưa có hành động nào (ví dụ "Giảm giá / hủy
  // món") thì kết quả rỗng là câu trả lời đúng, không phải bỏ qua bộ lọc.
  if (requestedTypes && actions.length === 0) {
    return {
      entries: [], hasMore: false, nextCursor: null,
      retentionDays: config.retentionDays,
      windowStart: new Date(Date.now() - config.retentionDays * 86_400_000).toISOString(),
    }
  }

  const parameters: (string | number)[] = [actor.organizationId, actor.venueId, config.retentionDays]
  let sql = `
    SELECT o.id, o.occurred_at, o.action, o.entity_type, o.entity_id, o.changes, o.reason_code,
      actor.display_name AS actor_name, actor.username AS actor_username,
      s.device_label,
      COALESCE(r.contact_name, rc.display_name) AS reservation_name,
      COALESCE(v.contact_name, vc.display_name) AS visit_name,
      target_user.display_name AS target_user_name,
      t.code AS table_code
    FROM operation_log AS o
    LEFT JOIN users AS actor ON actor.id = o.actor_user_id
    LEFT JOIN auth_sessions AS s ON s.id = o.auth_session_id
    LEFT JOIN reservations AS r ON o.entity_type = 'reservation' AND r.id = o.entity_id
    LEFT JOIN customers AS rc ON rc.id = r.customer_id
    LEFT JOIN visits AS v ON o.entity_type = 'visit' AND v.id = o.entity_id
    LEFT JOIN customers AS vc ON vc.id = v.customer_id
    LEFT JOIN users AS target_user
      ON o.entity_type IN ('user', 'auth_session') AND target_user.id = o.entity_id
    LEFT JOIN dining_tables AS t ON o.entity_type IN ('table', 'dining_table') AND t.id = o.entity_id
    WHERE o.organization_id = ? AND o.venue_id = ?
      AND o.occurred_at >= UTC_TIMESTAMP(3) - INTERVAL ? DAY`

  if (query.from) {
    sql += ' AND o.occurred_at >= ?'
    parameters.push(`${query.from} 00:00:00`)
  }
  if (query.to) {
    // `to` là ngày bao gồm cả ngày đó: người dùng chọn 12/11 thì mong đợi thấy
    // cả dòng lúc 23:59 ngày 12/11.
    sql += ' AND o.occurred_at < ? + INTERVAL 1 DAY'
    parameters.push(`${query.to} 00:00:00`)
  }
  if (actions.length) {
    sql += ` AND o.action IN (${actions.map(() => '?').join(', ')})`
    parameters.push(...actions)
  }
  if (query.beforeId !== undefined) {
    sql += ' AND o.id < ?'
    parameters.push(query.beforeId)
  }
  // Phân trang theo con trỏ id: OFFSET lớn buộc MySQL đọc rồi bỏ đi hàng nghìn
  // dòng, còn id giảm dần đi thẳng theo khoá chính.
  sql += ' ORDER BY o.occurred_at DESC, o.id DESC LIMIT ?'
  parameters.push(limit + 1)

  const [rows] = await databasePool.execute<AuditRow[]>(sql, parameters)
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return {
    entries: page.map(toEntry),
    hasMore,
    nextCursor: hasMore ? Number(page[page.length - 1]!.id) : null,
    retentionDays: config.retentionDays,
    windowStart: new Date(Date.now() - config.retentionDays * 86_400_000).toISOString(),
  }
}

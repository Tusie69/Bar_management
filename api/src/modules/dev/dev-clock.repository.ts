/**
 * TU-42 — lưu và nạp độ lệch đồng hồ giả lập.
 *
 * Lưu vào `venue_settings` (khoá `dev_clock`), không thêm bảng: không cần
 * migration, và Production không có thêm gì trong schema. Lưu lại để một lần
 * tự triển khai (restart API mỗi khi develop có commit mới) không âm thầm kéo
 * buổi demo về giờ thật.
 */
import type { RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import {
  applicationNow,
  devClockEnabled,
  getDevClockOffsetMs,
  realNow,
  setDevClockOffsetMs,
} from '../../time/application-clock.js'

export const DEV_CLOCK_SETTING_KEY = 'dev_clock'

interface StoredDevClock {
  offsetMs: number
  setByUserId: number | null
  /** Giờ THẬT lúc đổi. */
  setAt: string | null
}

export interface DevClockState {
  appEnv: 'dev'
  simulated: boolean
  offsetMs: number
  /** Giờ nghiệp vụ (giả lập) tại lúc trả lời. */
  now: string
  realNow: string
  setBy: string | null
  setAt: string | null
  canEdit: boolean
}

let lastChange: { setBy: string | null; setAt: string | null } = { setBy: null, setAt: null }

/** Gọi một lần lúc khởi động API (chỉ bản Dev). Lỗi đọc → chạy giờ thật. */
export async function loadDevClock(): Promise<void> {
  if (!devClockEnabled()) return
  try {
    const [rows] = await databasePool.execute<(RowDataPacket & { value: StoredDevClock | string; display_name: string | null })[]>(
      `SELECT s.\`value\`, u.display_name
         FROM venue_settings AS s
         LEFT JOIN users AS u
           ON u.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(s.\`value\`, '$.setByUserId')) AS UNSIGNED)
        WHERE s.\`key\` = ?
        LIMIT 1`,
      [DEV_CLOCK_SETTING_KEY],
    )
    const row = rows[0]
    if (!row) return
    const stored = (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as StoredDevClock
    setDevClockOffsetMs(Number(stored.offsetMs) || 0)
    lastChange = { setBy: row.display_name, setAt: stored.setAt }
    if (stored.offsetMs) {
      console.log(`Đồng hồ giả lập (Dev): lệch ${Math.round(stored.offsetMs / 60_000)} phút, giờ nghiệp vụ ${applicationNow().toISOString()}`)
    }
  } catch (error) {
    console.error('Không nạp được đồng hồ giả lập; bản Dev chạy giờ thật.', error)
  }
}

export function readDevClock(canEdit: boolean): DevClockState {
  const offsetMs = getDevClockOffsetMs()
  return {
    appEnv: 'dev',
    simulated: offsetMs !== 0,
    offsetMs,
    now: applicationNow().toISOString(),
    realNow: realNow().toISOString(),
    setBy: lastChange.setBy,
    setAt: lastChange.setAt,
    canEdit,
  }
}

/**
 * Lưu độ lệch mới + ghi nhật ký thao tác trong cùng một transaction, rồi mới
 * áp vào bộ nhớ. Ghi DB lỗi thì đồng hồ không đổi.
 *
 * Dòng nhật ký mang `occurred_at` là GIỜ THẬT (ghi tường minh, không để mặc
 * định của bảng — mặc định đó đang chạy theo đồng hồ giả lập), và `changes`
 * mang cả giờ giả lập trước/sau, để trả lời được "ai đổi, lúc nào thật".
 */
export async function saveDevClock(
  actor: AuthenticatedActor,
  actorName: string,
  offsetMs: number,
  label: string,
): Promise<void> {
  const before = getDevClockOffsetMs()
  const real = realNow()
  const stored: StoredDevClock = { offsetMs, setByUserId: actor.userId, setAt: real.toISOString() }
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    await connection.execute(
      `INSERT INTO venue_settings (organization_id, venue_id, \`key\`, \`value\`)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
      [actor.organizationId, actor.venueId, DEV_CLOCK_SETTING_KEY, JSON.stringify(stored)],
    )
    await connection.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, occurred_at, actor_kind, actor_user_id, actor_membership_id,
         auth_session_id, action, entity_type, entity_id, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, 'DEV_CLOCK_CHANGED', 'venue', ?, CAST(? AS JSON), 'MANUAL', 0)`,
      [
        actor.organizationId, actor.venueId, real, actor.userId, actor.membershipId,
        actor.authSessionId ?? null, actor.venueId,
        JSON.stringify([{
          type: 'dev_clock_changed',
          label,
          offsetMsBefore: before,
          offsetMsAfter: offsetMs,
          simulatedBefore: new Date(real.getTime() + before).toISOString(),
          simulatedAfter: new Date(real.getTime() + offsetMs).toISOString(),
          realAt: real.toISOString(),
        }]),
      ],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    connection.release()
  }
  setDevClockOffsetMs(offsetMs)
  lastChange = { setBy: actorName, setAt: stored.setAt }
}

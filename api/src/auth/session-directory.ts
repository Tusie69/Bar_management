/**
 * TU-33 — danh sách phiên đang hoạt động và buộc đăng xuất từ xa.
 *
 * Tái sử dụng cơ chế thu hồi phiên đã có: cùng cách cập nhật `auth_sessions`,
 * cùng `notifySessionsRevoked` để đóng SSE ngay, cùng `operation_log` làm sổ
 * audit. Không có đường thu hồi phiên nào mới được tạo ra ở đây.
 *
 * Không bao giờ trả `token_hash`. Nó là digest của token thật, và một digest
 * lộ ra là một thứ để tấn công từ điển — danh sách phiên không cần nó để làm
 * việc của mình.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { env } from '../config/env.js'
import { databasePool } from '../database/pool.js'
import { AppError } from '../errors/app-error.js'
import { recordAuthAudit } from './auth-audit.js'
import type { AuthenticatedActor } from './authenticated-actor.js'
import { shortDeviceId } from './device-identity.js'
import { notifySessionsRevoked } from './session-lifecycle.js'
import { realNow } from '../time/application-clock.js'

/** Vai trò mà ADMIN được phép buộc đăng xuất. OWNER và ADMIN không nằm trong. */
const STAFF_ROLES = new Set(['RECEPTIONIST', 'CUSTOMER_CARE', 'CASHIER', 'WAITER'])

export interface ActiveSessionView {
  sessionId: number
  userId: number
  username: string
  displayName: string
  roles: string[]
  accessLevel: 'WRITE' | 'READ_ONLY' | null
  portal: string | null
  /** 8 ký tự đầu của mã thiết bị. Không phải bí mật, không dùng để xác thực. */
  deviceRef: string | null
  deviceLabel: string | null
  loggedInAt: string
  lastSeenAt: string | null
  expiresAt: string
  status: 'ACTIVE' | 'EXPIRED'
  /** Phiên mà người gọi đang dùng để xem danh sách này. */
  isCurrent: boolean
}

interface SessionRow extends RowDataPacket {
  session_id: number
  user_id: number
  username: string
  display_name: string
  roles: string | null
  access_level: 'WRITE' | 'READ_ONLY' | null
  portal: string | null
  device_id: string | null
  device_label: string | null
  created_at: Date
  last_seen_at: Date | null
  expires_at: Date
  expired: number
}

function toView(row: SessionRow, currentSessionId: number | null): ActiveSessionView {
  return {
    sessionId: Number(row.session_id),
    userId: Number(row.user_id),
    username: row.username,
    displayName: row.display_name,
    roles: row.roles ? row.roles.split(',') : [],
    accessLevel: row.access_level,
    portal: row.portal,
    deviceRef: shortDeviceId(row.device_id),
    deviceLabel: row.device_label,
    loggedInAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    expiresAt: row.expires_at.toISOString(),
    status: Number(row.expired) === 1 ? 'EXPIRED' : 'ACTIVE',
    isCurrent: currentSessionId !== null && Number(row.session_id) === currentSessionId,
  }
}

/**
 * Các phiên chưa bị thu hồi trong phạm vi organization của actor.
 *
 * Scope theo `env.organizationId` lấy từ session của actor, không theo bất kỳ
 * id nào client gửi lên — cùng quy tắc tenant với mọi query khác trong hệ thống.
 */
export async function listActiveSessions(actor: AuthenticatedActor): Promise<ActiveSessionView[]> {
  if (actor.organizationId !== env.organizationId) {
    throw new AppError(403, 'ORGANIZATION_MISMATCH', 'Không có quyền trên tổ chức này.')
  }
  const [rows] = await databasePool.execute<SessionRow[]>(
    `SELECT s.id AS session_id, s.user_id, u.username, u.display_name,
       (SELECT GROUP_CONCAT(r.code ORDER BY r.code)
          FROM membership_roles AS mr
          JOIN roles AS r ON r.id = mr.role_id
         WHERE mr.organization_id = s.organization_id AND mr.membership_id = s.membership_id
           AND mr.revoked_at IS NULL) AS roles,
       (SELECT mr.access_level
          FROM membership_roles AS mr
          JOIN roles AS r ON r.id = mr.role_id
         WHERE mr.organization_id = s.organization_id AND mr.membership_id = s.membership_id
           AND mr.revoked_at IS NULL AND r.code = 'ADMIN' LIMIT 1) AS access_level,
       s.portal, s.device_id, s.device_label, s.created_at, s.last_seen_at, s.expires_at,
       (s.expires_at <= ?) AS expired
     FROM auth_sessions AS s
     JOIN users AS u ON u.id = s.user_id
     WHERE s.organization_id = ? AND s.revoked_at IS NULL
     ORDER BY s.created_at DESC`,
    // TU-42: hạn phiên so với giờ THẬT, kể cả khi bản Dev đang giả lập giờ.
    [realNow(), actor.organizationId],
  )
  return rows.map((row) => toView(row, actor.authSessionId ?? null))
}

interface Authority {
  role: 'OWNER' | 'ADMIN'
  accessLevel: 'WRITE' | 'READ_ONLY' | null
}

/**
 * Vai trò quản trị của người gọi, đọc trong cùng transaction với thao tác thu
 * hồi để một lần đổi quyền song song không lọt qua giữa kiểm tra và thực thi.
 */
async function authority(connection: PoolConnection, actor: AuthenticatedActor): Promise<Authority> {
  const [rows] = await connection.execute<(RowDataPacket & {
    code: 'OWNER' | 'ADMIN'; access_level: 'WRITE' | 'READ_ONLY' | null
  })[]>(
    `SELECT r.code, mr.access_level
     FROM membership_roles AS mr
     JOIN roles AS r ON r.id = mr.role_id
     WHERE mr.organization_id = ? AND mr.membership_id = ? AND r.code IN ('OWNER', 'ADMIN')
       AND mr.revoked_at IS NULL AND (mr.venue_id IS NULL OR mr.venue_id = ?)
     ORDER BY FIELD(r.code, 'OWNER', 'ADMIN') LIMIT 1`,
    [actor.organizationId, actor.membershipId, actor.venueId],
  )
  const row = rows[0]
  if (!row) throw new AppError(403, 'SESSION_MANAGEMENT_DENIED', 'Không có quyền quản lý phiên đăng nhập.')
  return { role: row.code, accessLevel: row.access_level }
}

export interface ForceLogoutResult {
  revokedSessions: number
  targetUserId: number
}

/**
 * Buộc đăng xuất một phiên cụ thể.
 *
 * Thẩm quyền:
 *   - OWNER buộc đăng xuất được mọi tài khoản trừ chính mình;
 *   - ADMIN chỉ buộc đăng xuất được tài khoản nhân viên, không bao giờ OWNER
 *     hay một ADMIN khác;
 *   - ADMIN READ_ONLY không tới được đây vì `listPermissions` không cấp
 *     `session.revoke` cho READ_ONLY, nhưng vẫn kiểm lại ở đây: middleware là
 *     lớp thứ nhất, không phải lớp duy nhất.
 *
 * Tự đăng xuất chính mình bị từ chối: đã có `POST /auth/logout` cho việc đó,
 * và một thao tác "buộc đăng xuất" nhắm vào chính mình gần như luôn là bấm
 * nhầm dòng trong danh sách.
 */
export async function forceLogoutSession(
  actor: AuthenticatedActor,
  sessionId: number,
): Promise<ForceLogoutResult> {
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const acting = await authority(connection, actor)
    if (acting.role === 'ADMIN' && acting.accessLevel !== 'WRITE') {
      throw new AppError(403, 'READ_ONLY_ACCOUNT', 'Tài khoản chỉ có quyền xem, không thể buộc đăng xuất.')
    }

    // FOR UPDATE: hai quản trị viên bấm cùng một dòng thì người thứ hai thấy
    // phiên đã bị thu hồi chứ không ghi đè lý do thu hồi của người thứ nhất.
    const [rows] = await connection.execute<(RowDataPacket & {
      id: number; user_id: number; device_id: string | null; portal: string | null; revoked_at: Date | null
    })[]>(
      `SELECT id, user_id, device_id, portal, revoked_at FROM auth_sessions
       WHERE organization_id = ? AND id = ? FOR UPDATE`,
      [actor.organizationId, sessionId],
    )
    const session = rows[0]
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Không tìm thấy phiên đăng nhập.')
    if (session.revoked_at !== null) {
      throw new AppError(409, 'SESSION_ALREADY_REVOKED', 'Phiên này đã kết thúc.')
    }
    if (Number(session.user_id) === actor.userId) {
      throw new AppError(409, 'CANNOT_REVOKE_SELF', 'Dùng chức năng đăng xuất để kết thúc phiên của chính mình.')
    }

    const [targetRoleRows] = await connection.execute<(RowDataPacket & { code: string })[]>(
      `SELECT DISTINCT r.code
       FROM memberships AS m
       JOIN membership_roles AS mr
         ON mr.organization_id = m.organization_id AND mr.membership_id = m.id
       JOIN roles AS r ON r.id = mr.role_id
       WHERE m.organization_id = ? AND m.user_id = ? AND mr.revoked_at IS NULL`,
      [actor.organizationId, session.user_id],
    )
    const targetRoles = targetRoleRows.map((row) => row.code)
    if (targetRoles.includes('OWNER')) {
      throw new AppError(403, 'OWNER_PROTECTED', 'Không được buộc đăng xuất tài khoản SuperAdmin.')
    }
    if (acting.role === 'ADMIN' && !targetRoles.every((role) => STAFF_ROLES.has(role))) {
      throw new AppError(403, 'ADMIN_TARGET_DENIED', 'Admin chỉ được buộc đăng xuất tài khoản nhân viên.')
    }

    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE auth_sessions
       SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'FORCED_LOGOUT'
       WHERE organization_id = ? AND id = ? AND revoked_at IS NULL`,
      [actor.organizationId, sessionId],
    )
    if (result.affectedRows !== 1) {
      throw new AppError(409, 'SESSION_ALREADY_REVOKED', 'Phiên này đã kết thúc.')
    }

    // Audit ghi cả người thực hiện và người bị tác động, kèm mã thiết bị dạng
    // ngắn. Không ghi token, không ghi cookie, không ghi User-Agent gốc.
    await recordAuthAudit({
      action: 'AUTH_SESSION_FORCE_REVOKED',
      userId: Number(session.user_id),
      sessionId,
      ...(session.portal ? { portal: session.portal } : {}),
      reasonCode: 'FORCED_LOGOUT',
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      metadata: {
        actorRole: acting.role,
        targetUserId: Number(session.user_id),
        targetRoles,
        revokedSessionId: sessionId,
        revokedDeviceRef: shortDeviceId(session.device_id),
        result: 'REVOKED',
      },
    }, connection)

    await connection.commit()
    // Sau commit: đóng SSE của phiên vừa thu hồi. Đặt ngoài transaction để một
    // listener lỗi không làm rollback việc thu hồi — database vẫn là nguồn
    // trạng thái, thông báo này chỉ giúp đóng kết nối sớm hơn.
    notifySessionsRevoked({
      sessionIds: [sessionId],
      userId: Number(session.user_id),
      code: 'SESSION_REVOKED',
    })
    return { revokedSessions: 1, targetUserId: Number(session.user_id) }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

/**
 * Ghi mốc hoạt động cuối của một phiên.
 *
 * Có tiết lưu: chỉ ghi khi mốc cũ đã quá `thresholdMs`. Không có nó thì mỗi
 * request của mỗi máy lễ tân là một lần UPDATE vào bảng session, tức là thêm
 * một điểm ghi nóng trên đường đi của mọi request chỉ để hiển thị một cột.
 *
 * Lỗi ở đây được bỏ qua có chủ ý: "last activity" là thông tin phụ trợ, không
 * đáng để làm thất bại một request nghiệp vụ.
 */
export async function touchSessionActivity(sessionId: number, thresholdMs = 60_000): Promise<void> {
  try {
    await databasePool.execute(
      `UPDATE auth_sessions
       SET last_seen_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND revoked_at IS NULL
         AND (last_seen_at IS NULL OR last_seen_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MICROSECOND))`,
      [sessionId, thresholdMs * 1000],
    )
  } catch {
    // Không log token hay nội dung request. Mất một mốc last_seen_at không ảnh
    // hưởng tới xác thực, vì nguồn trạng thái vẫn là revoked_at/expires_at.
  }
}

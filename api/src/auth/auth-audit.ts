import type { PoolConnection } from 'mysql2/promise'

import { env } from '../config/env.js'
import { databasePool } from '../database/pool.js'

export interface AuthAuditEvent {
  action: 'AUTH_LOGIN_SUCCEEDED' | 'AUTH_LOGIN_FAILED' | 'AUTH_LOGOUT' | 'AUTH_SESSION_REVOKED'
    | 'AUTH_SESSION_FORCE_REVOKED'
  /** Tài khoản mà sự kiện NHẮM TỚI. Với force logout đây là người bị đăng xuất. */
  userId?: number
  membershipId?: number
  sessionId?: number
  portal?: string
  reasonCode: string
  metadata?: Record<string, unknown>
  /**
   * TU-33: người THỰC HIỆN, khi khác người bị tác động.
   *
   * Không có cặp này thì `actor_user_id` được suy ra từ `userId`, và một bản
   * ghi "buộc đăng xuất" sẽ ghi chính người bị đăng xuất vào vai người thực
   * hiện — tức là audit chỉ sai ở đúng những dòng cần nó nhất.
   */
  actorUserId?: number
  actorMembershipId?: number
}

type AuditExecutor = Pick<PoolConnection, 'execute'>

/**
 * Authentication must not become unavailable because the secondary audit sink
 * failed. The event contains no username, password, token, cookie, IP or PII.
 */
export async function recordAuthAudit(event: AuthAuditEvent, executor: AuditExecutor = databasePool): Promise<void> {
  try {
    // Một sự kiện có người thực hiện tường minh luôn được ghi là USER, kể cả
    // khi người bị tác động là người khác.
    const actorKind = event.actorUserId !== undefined
      || event.action === 'AUTH_LOGIN_SUCCEEDED'
      || event.action === 'AUTH_LOGOUT'
      ? 'USER'
      : 'SYSTEM'
    const actorUserId = actorKind === 'USER'
      ? event.actorUserId ?? event.userId ?? null
      : null
    const changes = [{
      type: 'authentication',
      result: event.action === 'AUTH_LOGIN_FAILED' ? 'FAILURE' : 'SUCCESS',
      ...(event.portal ? { portal: event.portal } : {}),
      ...(event.metadata ?? {}),
    }]
    await executor.execute(
      `INSERT INTO operation_log
        (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
         action, entity_type, entity_id, changes, reason_code, is_undoable)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'auth_session', ?, CAST(? AS JSON), ?, 0)`,
      [
        env.organizationId,
        env.venueId,
        actorKind,
        actorUserId,
        actorKind === 'USER' ? event.actorMembershipId ?? event.membershipId ?? null : null,
        event.sessionId ?? null,
        event.action,
        event.userId ?? 0,
        JSON.stringify(changes),
        event.reasonCode.slice(0, 30),
      ],
    )
  } catch (error) {
    console.error('Không thể ghi audit xác thực; luồng session vẫn tiếp tục.', error)
  }
}

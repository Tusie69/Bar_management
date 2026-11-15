import type { PoolConnection } from 'mysql2/promise'

import { env } from '../config/env.js'
import { databasePool } from '../database/pool.js'

export interface AuthAuditEvent {
  action: 'AUTH_LOGIN_SUCCEEDED' | 'AUTH_LOGIN_FAILED' | 'AUTH_LOGOUT' | 'AUTH_SESSION_REVOKED'
  userId?: number
  membershipId?: number
  sessionId?: number
  portal?: string
  reasonCode: string
  metadata?: Record<string, unknown>
}

type AuditExecutor = Pick<PoolConnection, 'execute'>

/**
 * Authentication must not become unavailable because the secondary audit sink
 * failed. The event contains no username, password, token, cookie, IP or PII.
 */
export async function recordAuthAudit(event: AuthAuditEvent, executor: AuditExecutor = databasePool): Promise<void> {
  try {
    const actorKind = event.action === 'AUTH_LOGIN_SUCCEEDED' || event.action === 'AUTH_LOGOUT'
      ? 'USER'
      : 'SYSTEM'
    const actorUserId = actorKind === 'USER' ? event.userId ?? null : null
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
        actorKind === 'USER' ? event.membershipId ?? null : null,
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

export type SessionEndCode =
  | 'SESSION_REPLACED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'ACCOUNT_LOCKED'
  | 'SESSION_INVALID'

export interface SessionRevocationNotice {
  sessionIds: readonly number[]
  userId: number
  code: SessionEndCode
}

type SessionRevocationListener = (notice: SessionRevocationNotice) => void

const listeners = new Set<SessionRevocationListener>()

/**
 * In-process fast path for long-lived transports. Database validation remains
 * authoritative; this notification only closes matching connections sooner.
 */
export function notifySessionsRevoked(notice: SessionRevocationNotice): void {
  for (const listener of listeners) {
    try {
      listener(notice)
    } catch (error) {
      console.error('Không thể phát tín hiệu thu hồi session nội bộ.', error)
    }
  }
}

export function subscribeToSessionRevocations(listener: SessionRevocationListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

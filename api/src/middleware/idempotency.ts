import { createHash } from 'node:crypto'

import type { RequestHandler, Response } from 'express'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import { requireAuthenticatedActor } from '../auth/authenticated-actor.js'
import { databasePool } from '../database/pool.js'
import { AppError } from '../errors/app-error.js'

/**
 * FX-04 — chống tạo trùng bằng header `Idempotency-Key` (tuỳ chọn; không gửi thì xử lý như cũ).
 * Dùng bảng idempotency_keys đã có sẵn trong schema gốc (0001): khóa chính (tổ chức, mã), lưu user,
 * endpoint, hash nội dung (SHA-256 nhị phân) và kết quả — không cần migration mới.
 *
 * Cơ chế: mở 1 transaction riêng, chèn dòng (tổ chức, mã) vào idempotency_keys rồi giữ transaction
 * trong lúc route xử lý. Request trùng mã gửi đồng thời sẽ chờ ở lệnh INSERT (khóa trùng khóa duy nhất)
 * cho tới khi request đầu xong:
 * - request đầu thành công (2xx) → lưu status + body, COMMIT → request sau nhận lỗi trùng, đọc và trả lại
 *   đúng kết quả cũ (header `Idempotent-Replayed: true`);
 * - request đầu lỗi → ROLLBACK, không lưu gì → request sau (hoặc lần bấm Lưu lại) được xử lý như mới.
 * Cùng mã nhưng khác người dùng, đường dẫn hoặc nội dung sau khi đã thành công → 422 IDEMPOTENCY_KEY_REUSED
 * (không bao giờ trả kết quả của người khác). Hạn 24 giờ.
 */
const keyPattern = /^[A-Za-z0-9_-]{8,64}$/
const ttlHours = 24

interface StoredResponseRow extends RowDataPacket {
  user_id: number | string
  endpoint: string
  request_hash: Buffer
  response_status: number | null
  response_body: unknown
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
}

export function requestHash(scope: string, body: unknown): Buffer {
  return createHash('sha256').update(`${scope}\n${JSON.stringify(body ?? null)}`).digest()
}

export function idempotent(scope: string): RequestHandler {
  return async (request, response, next) => {
    const key = request.get('Idempotency-Key')
    if (key === undefined) {
      next()
      return
    }
    if (!keyPattern.test(key)) {
      throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Mã chống trùng không hợp lệ.')
    }
    const actor = requireAuthenticatedActor(request)
    const hash = requestHash(scope, request.body)
    const owner = [actor.organizationId, key] as const

    // Dọn mã hết hạn ngoài transaction (autocommit, không giữ khóa chéo với request đồng thời):
    // đúng mã này nếu đã hết hạn, và một ít mã hết hạn khác để bảng không phình ra.
    await databasePool.execute(
      `DELETE FROM idempotency_keys
       WHERE organization_id = ? AND idem_key = ? AND expires_at <= UTC_TIMESTAMP(3)`,
      [...owner],
    )
    await databasePool.execute(
      `DELETE FROM idempotency_keys WHERE expires_at <= UTC_TIMESTAMP(3) ORDER BY expires_at LIMIT 200`,
    )
    const connection: PoolConnection = await databasePool.getConnection()
    let settled = false
    const settle = async (commit: boolean): Promise<void> => {
      if (settled) return
      settled = true
      try {
        if (commit) await connection.commit()
        else await connection.rollback()
      } finally {
        connection.release()
      }
    }

    try {
      await connection.beginTransaction()
      await connection.execute(
        `INSERT INTO idempotency_keys
          (organization_id, idem_key, user_id, endpoint, request_hash, expires_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL ${ttlHours} HOUR)`,
        [...owner, actor.userId, scope, hash],
      )
    } catch (error) {
      await settle(false).catch(() => undefined)
      if (!isDuplicateKey(error)) throw error
      const [rows] = await databasePool.execute<StoredResponseRow[]>(
        `SELECT user_id, endpoint, request_hash, response_status, response_body FROM idempotency_keys
         WHERE organization_id = ? AND idem_key = ?`,
        [...owner],
      )
      const stored = rows[0]
      if (stored && Number(stored.user_id) !== actor.userId) {
        throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Mã chống trùng đã được dùng cho một yêu cầu khác.')
      }
      if (!stored || stored.response_status === null) {
        throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Yêu cầu trước vẫn đang được xử lý. Vui lòng thử lại.')
      }
      if (stored.endpoint !== scope || !Buffer.from(stored.request_hash).equals(hash)) {
        throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Mã chống trùng đã được dùng cho một yêu cầu khác.')
      }
      response.set('Idempotent-Replayed', 'true').status(stored.response_status).json(stored.response_body)
      return
    }

    const sendJson = response.json.bind(response)
    response.json = ((body: unknown) => {
      if (settled) return sendJson(body)
      const status = response.statusCode
      void (async () => {
        if (status >= 200 && status < 300) {
          try {
            await connection.execute(
              `UPDATE idempotency_keys SET response_status = ?, response_body = CAST(? AS JSON)
               WHERE organization_id = ? AND idem_key = ?`,
              [status, JSON.stringify(body ?? null), ...owner],
            )
            await settle(true)
          } catch {
            await settle(false).catch(() => undefined)
          }
        } else {
          await settle(false).catch(() => undefined)
        }
        sendJson(body)
      })()
      return response
    }) as Response['json']
    // Lưới an toàn: phản hồi kết thúc mà không qua res.json (vd res.send) → không lưu, trả kết nối.
    response.on('finish', () => {
      void settle(false).catch(() => undefined)
    })
    next()
  }
}

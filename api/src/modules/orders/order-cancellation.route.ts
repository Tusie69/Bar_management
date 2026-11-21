import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import { idempotencyTransaction, idempotent, requireBodyIdempotencyKey } from '../../middleware/idempotency.js'
import type { CancellationStatus } from './order.model.js'
import {
  MAX_DECISION_NOTE_LENGTH,
  decideOrderCancellationGroup,
  decideOrderLineCancellation,
  listCancellations,
} from './order-adjustment.repository.js'

/**
 * Module Phục vụ 5 — hàng chờ phê duyệt hủy món.
 *
 * Tách khỏi `/api/v1/waiter` một cách có chủ ý: đây không phải màn của Phục vụ.
 * Người đọc và quyết định ở đây là người có `order.cancel.approve`, và Phục vụ
 * KHÔNG có quyền đó — nếu có thì "cần phê duyệt" chỉ là một cú bấm thêm cho
 * chính người vừa gọi món.
 *
 * Route chỉ nhắc permission, không nhắc tên vai trò. Thêm một cấp quản lý mới
 * sau này là một dòng INSERT vào `role_permissions`, không phải một lần sửa
 * code ở đây.
 */
export const orderCancellationRouter: Router = Router()

const statuses = new Set<CancellationStatus>(['PENDING', 'APPROVED', 'REJECTED'])
const MAX_QUEUE_LIMIT = 100

function positiveInteger(value: unknown, code: string, message: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) throw new AppError(400, code, message)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, code, message)
  return parsed
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Nội dung yêu cầu không hợp lệ.')
  }
  return value as Record<string, unknown>
}

function decisionNote(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_DECISION_NOTE', 'Ghi chú quyết định không hợp lệ.')
  const text = value.trim().replace(/\s+/g, ' ')
  if (text.length > MAX_DECISION_NOTE_LENGTH) {
    throw new AppError(400, 'INVALID_DECISION_NOTE', `Ghi chú tối đa ${MAX_DECISION_NOTE_LENGTH} ký tự.`)
  }
  return text || undefined
}

orderCancellationRouter.get(
  '/cancellations',
  requireAuthentication,
  requirePermission('order.cancel.approve'),
  async (request, response) => {
    const rawStatus = request.query.status
    if (rawStatus !== undefined && typeof rawStatus !== 'string') {
      throw new AppError(400, 'INVALID_CANCELLATION_STATUS', 'Trạng thái yêu cầu hủy không hợp lệ.')
    }
    const status = rawStatus === undefined ? 'PENDING' : rawStatus.toUpperCase()
    if (!statuses.has(status as CancellationStatus)) {
      throw new AppError(400, 'INVALID_CANCELLATION_STATUS', 'Trạng thái yêu cầu hủy không hợp lệ.')
    }
    const limit = request.query.limit === undefined
      ? 50
      : Math.min(positiveInteger(request.query.limit, 'INVALID_LIMIT', 'Giới hạn không hợp lệ.'), MAX_QUEUE_LIMIT)
    response.setHeader('Cache-Control', 'private, no-store')
    response.json(await listCancellations(requireAuthenticatedActor(request), {
      status: status as CancellationStatus,
      limit,
    }))
  },
)

for (const [path, decision] of [['approve', 'APPROVED'], ['reject', 'REJECTED']] as const) {
  orderCancellationRouter.post(
    `/cancellations/:cancellationId/${path}`,
    requireAuthentication,
    requireCsrfProtection,
    requirePermission('order.cancel.approve'),
    requireBodyIdempotencyKey('idempotencyKey'),
    idempotent(`order.cancellation.${path}`),
    async (request, response) => {
      const raw = objectBody(request.body)
      const note = decisionNote(raw.note)
      response.json(await decideOrderLineCancellation(
        requireAuthenticatedActor(request),
        {
          cancellationId: positiveInteger(
            request.params.cancellationId,
            'INVALID_CANCELLATION_ID',
            'Mã yêu cầu hủy không hợp lệ.',
          ),
          decision,
          expectedVersion: positiveInteger(raw.expectedVersion, 'INVALID_VERSION', 'Phiên bản không hợp lệ.'),
          ...(note === undefined ? {} : { note }),
          idempotencyKey: String(raw.idempotencyKey),
        },
        idempotencyTransaction(response),
      ))
    },
  )
}

/**
 * Module Phục vụ (v1.1) — quyết định CẢ NHÓM "Hủy đơn?" bằng một lần bấm.
 *
 * Không có `expectedVersion` ở đây, và đó là chủ đích: một nhóm có nhiều dòng
 * con, mỗi dòng một `version`, nên bắt client gửi đủ là bắt nó giữ một bản sao
 * trạng thái mà nó không sở hữu. Thay vào đó, repository khóa mọi dòng con còn
 * PENDING rồi quyết định chúng trong CÙNG một transaction; dòng nào đã được
 * xử lý lẻ trước đó thì không còn PENDING và tự nằm ngoài.
 */
for (const [path, decision] of [['approve', 'APPROVED'], ['reject', 'REJECTED']] as const) {
  orderCancellationRouter.post(
    `/cancellations/groups/:groupId/${path}`,
    requireAuthentication,
    requireCsrfProtection,
    requirePermission('order.cancel.approve'),
    requireBodyIdempotencyKey('idempotencyKey'),
    idempotent(`order.cancellation.group.${path}`),
    async (request, response) => {
      const raw = objectBody(request.body)
      const note = decisionNote(raw.note)
      response.json(await decideOrderCancellationGroup(
        requireAuthenticatedActor(request),
        {
          groupId: positiveInteger(request.params.groupId, 'INVALID_CANCELLATION_ID', 'Mã yêu cầu hủy không hợp lệ.'),
          decision,
          ...(note === undefined ? {} : { note }),
          idempotencyKey: String(raw.idempotencyKey),
        },
        idempotencyTransaction(response),
      ))
    },
  )
}

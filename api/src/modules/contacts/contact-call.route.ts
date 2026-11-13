/**
 * Ba tuyến gọi khách dùng chung cho đơn chờ và lượt ghé.
 *
 * Hai router gắn cùng một bộ tuyến thay vì mỗi bên chép lại một bản: hình
 * dạng request, quyền, rate limit và header no-store phải giống hệt nhau,
 * và chính việc chép tay là thứ đã làm hai nguồn canCall lệch nhau trước đây.
 */
import type { Router } from 'express'

import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { AppError } from '../../errors/app-error.js'
import { applicationNow } from '../../time/application-clock.js'
import { assertPhoneDisclosureAllowed, phoneDisclosureLimiter } from '../bookings/phone-rate-limit.js'
import {
  initiateContactCall,
  listContactCalls,
  recordContactCallOutcome,
  type ContactCallTargetKind,
} from './contact-call.repository.js'

function positiveInteger(value: unknown, code: string, message: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, code, message)
  return parsed
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu gửi lên không hợp lệ.')
  }
  return value as Record<string, unknown>
}

export function mountContactCallRoutes(
  router: Router,
  kind: ContactCallTargetKind,
  idCode: string,
  idMessage: string,
): void {
  const targetOf = (raw: unknown) => ({ kind, id: positiveInteger(raw, idCode, idMessage) })
  // Mỗi không gian id một ô đếm riêng, xem PhoneRevealRateLimiter.
  const subjectOf = (id: number) => `${kind === 'WAITLIST_ENTRY' ? 'w' : 'v'}${id}`

  router.post(
    '/:id/call',
    requireAuthentication,
    requireCsrfProtection,
    requirePermission('booking.phone.call'),
    async (request, response) => {
      objectBody(request.body)
      const actor = requireAuthenticatedActor(request)
      const target = targetOf(request.params.id)
      // 'allow': thiếu cấu hình hạn mức thì vẫn gọi được, như đường booking.
      assertPhoneDisclosureAllowed(phoneDisclosureLimiter, actor.userId, subjectOf(target.id), 'allow')
      response
        .set('Cache-Control', 'no-store, private, max-age=0')
        .set('Pragma', 'no-cache')
        .status(201)
        .json(await initiateContactCall(actor, target, applicationNow()))
    },
  )

  router.get(
    '/:id/calls',
    requireAuthentication,
    requirePermission('booking.phone.call'),
    async (request, response) => {
      // Không trả về số nào, nên ai gọi được thì cũng đọc được lịch sử.
      response.json({
        calls: await listContactCalls(requireAuthenticatedActor(request), targetOf(request.params.id)),
      })
    },
  )

  router.post(
    '/:id/calls/:callId/outcome',
    requireAuthentication,
    requireCsrfProtection,
    requirePermission('booking.phone.call'),
    async (request, response) => {
      const outcome = objectBody(request.body).outcome
      // 'Tới muộn' cố ý không có ở đây: nó chuyển trạng thái một booking, mà
      // đơn chờ hay lượt ghé trần thì không có booking nào để chuyển.
      if (outcome !== 'CONTACTED' && outcome !== 'NO_ANSWER') {
        throw new AppError(400, 'INVALID_CALL_OUTCOME', 'Kết quả cuộc gọi không hợp lệ.')
      }
      response.json(await recordContactCallOutcome(
        requireAuthenticatedActor(request),
        targetOf(request.params.id),
        positiveInteger(request.params.callId, 'INVALID_CALL_ID', 'Mã lần gọi không hợp lệ.'),
        outcome,
        applicationNow(),
      ))
    },
  )
}

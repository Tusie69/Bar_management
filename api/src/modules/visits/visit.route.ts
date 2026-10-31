import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import { closeVisit, mergeVisitTables, moveVisit, type CloseVisitMode, type ManualCloseReason } from './visit.repository.js'

export const visitRouter: Router = Router()

const closeModes = new Set<CloseVisitMode>(['MANUAL', 'AFTER_PAYMENT'])
const manualReasons = new Set<ManualCloseReason>(['GUEST_LEFT', 'ENTRY_ERROR'])

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu gửi lên không hợp lệ.')
  }
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, code: string, message: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, code, message)
  return parsed
}

visitRouter.post(
  '/:id/close',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('visit.end'),
  async (request, response) => {
  const actor = requireAuthenticatedActor(request)
  const body = objectBody(request.body)
  if (typeof body.mode !== 'string' || !closeModes.has(body.mode as CloseVisitMode)) {
    throw new AppError(400, 'INVALID_CLOSE_MODE', 'Phương thức trả bàn không hợp lệ.')
  }
  if (typeof body.reason !== 'string' || !manualReasons.has(body.reason as ManualCloseReason)) {
    throw new AppError(400, 'INVALID_END_REASON', 'Lý do kết thúc lượt không hợp lệ.')
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    throw new AppError(400, 'INVALID_NOTE', 'Ghi chú phải là chuỗi.')
  }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note.length > 500) throw new AppError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 500 ký tự.')

  const visit = await closeVisit(actor, {
    visitId: positiveInteger(request.params.id, 'INVALID_VISIT_ID', 'Mã lượt khách không hợp lệ.'),
    expectedVersion: positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản lượt khách không hợp lệ.'),
    mode: body.mode as CloseVisitMode,
    reason: body.reason as ManualCloseReason,
    ...(note ? { note } : {}),
  })
  response.json({ visit })
  },
)

visitRouter.post(
  '/:id/merge',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('visit.combine'),
  async (request, response) => {
    const body = objectBody(request.body)
    if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
    response.json(await mergeVisitTables(requireAuthenticatedActor(request), {
      visitId: positiveInteger(request.params.id, 'INVALID_VISIT_ID', 'Mã lượt khách không hợp lệ.'),
      expectedVersion: positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản lượt khách không hợp lệ.'),
      tableIds: body.tableIds.map((value) => positiveInteger(value, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')),
    }))
  },
)

visitRouter.post(
  '/:id/move',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('visit.move'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    const body = objectBody(request.body)
    if (!Array.isArray(body.tableIds)) throw new AppError(400, 'TABLES_REQUIRED', 'Danh sách bàn không hợp lệ.')
    const tableIds = body.tableIds.map((value) => positiveInteger(value, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.'))
    if (body.note !== undefined && typeof body.note !== 'string') {
      throw new AppError(400, 'INVALID_NOTE', 'Ghi chú phải là chuỗi.')
    }
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (note.length > 500) throw new AppError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 500 ký tự.')
    response.json({ visit: await moveVisit(actor, {
      visitId: positiveInteger(request.params.id, 'INVALID_VISIT_ID', 'Mã lượt khách không hợp lệ.'),
      expectedVersion: positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản lượt khách không hợp lệ.'),
      tableIds,
      ...(note ? { note } : {}),
    }) })
  },
)

import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import { assertNoteHasNoPhoneNumber } from '../../security/note-privacy.js'
import { mountContactCallRoutes } from '../contacts/contact-call.route.js'
import { parseCapacityOverride } from '../tables/table-capacity.js'
import { closeVisit, mergeVisitTables, moveVisit, type CloseVisitMode, type ManualCloseReason } from './visit.repository.js'
import { listTableTurns, summarizeTableTurns, type TurnQuery } from './table-turn.repository.js'

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

function businessDateParam(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', `${field} phải có dạng YYYY-MM-DD.`)
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', `${field} không phải ngày hợp lệ.`)
  }
  return value
}

function turnQuery(query: Record<string, unknown>): TurnQuery {
  const from = businessDateParam(query.from, 'from')
  const to = businessDateParam(query.to, 'to')
  if (from > to) throw new AppError(400, 'INVALID_DATE_RANGE', 'from phải nhỏ hơn hoặc bằng to.')
  // A whole year of operating days is the widest range worth serving in one call.
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  if (spanDays > 366) throw new AppError(400, 'DATE_RANGE_TOO_WIDE', 'Khoảng ngày không được vượt quá 366 ngày.')

  const page = query.page === undefined ? 1 : Number(query.page)
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AppError(400, 'INVALID_PAGE', 'page phải là số nguyên dương.')
  }
  const pageSize = query.pageSize === undefined ? 50 : Number(query.pageSize)
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new AppError(400, 'INVALID_PAGE_SIZE', 'pageSize phải từ 1 đến 200.')
  }
  const includeUncounted = query.includeUncounted
  if (includeUncounted !== undefined && includeUncounted !== 'true' && includeUncounted !== 'false') {
    throw new AppError(400, 'INVALID_INCLUDE_UNCOUNTED', 'includeUncounted phải là true hoặc false.')
  }

  const includeZeroScopes = query.includeZeroScopes
  if (includeZeroScopes !== undefined && includeZeroScopes !== 'true' && includeZeroScopes !== 'false') {
    throw new AppError(400, 'INVALID_INCLUDE_ZERO_SCOPES', 'includeZeroScopes phải là true hoặc false.')
  }

  const closedByUserId = query.closedByUserId
  if (closedByUserId !== undefined && (typeof closedByUserId !== 'string' || !/^[1-9]\d*$/.test(closedByUserId))) {
    throw new AppError(400, 'INVALID_CLOSED_BY_USER_ID', 'closedByUserId phải là số nguyên dương.')
  }
  const checkedInByUserId = query.checkedInByUserId
  if (checkedInByUserId !== undefined && (typeof checkedInByUserId !== 'string' || !/^[1-9]\d*$/.test(checkedInByUserId))) {
    throw new AppError(400, 'INVALID_CHECKED_IN_BY_USER_ID', 'checkedInByUserId phải là số nguyên dương.')
  }
  return {
    from,
    to,
    page,
    pageSize,
    countedOnly: includeUncounted !== 'true',
    ...(includeZeroScopes === 'true' ? { includeZeroScopes: true } : {}),
    ...(checkedInByUserId === undefined ? {} : {
      checkedInByUserId: positiveInteger(checkedInByUserId, 'INVALID_CHECKED_IN_BY_USER_ID', 'checkedInByUserId phải là số nguyên dương.'),
    }),
    ...(closedByUserId === undefined ? {} : {
      closedByUserId: positiveInteger(closedByUserId, 'INVALID_CLOSED_BY_USER_ID', 'closedByUserId phải là số nguyên dương.'),
    }),
  }
}

visitRouter.get(
  '/turns',
  requireAuthentication,
  requirePermission('report.read'),
  async (request, response) => {
    response.json(await listTableTurns(requireAuthenticatedActor(request), turnQuery(request.query)))
  },
)
visitRouter.get(
  '/turns/summary',
  requireAuthentication,
  requirePermission('report.read'),
  async (request, response) => {
    response.json(await summarizeTableTurns(requireAuthenticatedActor(request), turnQuery(request.query)))
  },
)

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
  assertNoteHasNoPhoneNumber(note)

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
    const mergeOverride = parseCapacityOverride(body.capacityOverrideConfirmed)
    response.json(await mergeVisitTables(requireAuthenticatedActor(request), {
      visitId: positiveInteger(request.params.id, 'INVALID_VISIT_ID', 'Mã lượt khách không hợp lệ.'),
      expectedVersion: positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản lượt khách không hợp lệ.'),
      tableIds: body.tableIds.map((value) => positiveInteger(value, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')),
      ...(mergeOverride === undefined ? {} : { capacityOverrideConfirmed: mergeOverride }),
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
    assertNoteHasNoPhoneNumber(note)
    const moveOverride = parseCapacityOverride(body.capacityOverrideConfirmed)
    response.json({ visit: await moveVisit(actor, {
      visitId: positiveInteger(request.params.id, 'INVALID_VISIT_ID', 'Mã lượt khách không hợp lệ.'),
      expectedVersion: positiveInteger(body.version, 'INVALID_VERSION', 'Phiên bản lượt khách không hợp lệ.'),
      tableIds,
      ...(note ? { note } : {}),
      ...(moveOverride === undefined ? {} : { capacityOverrideConfirmed: moveOverride }),
    }) })
  },
)

// Gọi khách đang ngồi: bỏ quên đồ, thiếu người trong nhóm, cần dọn bàn.
mountContactCallRoutes(visitRouter, 'VISIT', 'INVALID_VISIT_ID', 'Mã lượt khách không hợp lệ.')

import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import { idempotent, idempotencyTransaction } from '../../middleware/idempotency.js'
import { listRoles, getAdminAccessLevel } from '../../auth/auth.service.js'
import { compensateOperation, getUndoState } from './operation.repository.js'
import {
  accessLevelKey,
  AUDIT_FILTERS,
  canExportAudit,
  isAuditFilterType,
} from './audit-actions.js'
import { getAuditConfig, listAuditEntries } from './audit.repository.js'
import { toCsv } from './audit-csv.js'
import { applicationNow } from '../../time/application-clock.js'

export const operationRouter: Router = Router()

function operationId(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, 'INVALID_OPERATION_ID', 'Mã thao tác không hợp lệ.')
  return parsed
}

operationRouter.get(
  '/undo-state',
  requireAuthentication,
  requirePermission('operation.undo'),
  async (request, response) => response.json(await getUndoState(requireAuthenticatedActor(request))),
)

for (const mode of ['undo', 'redo'] as const) {
  operationRouter.post(
    `/${mode}`,
    requireAuthentication,
    requireCsrfProtection,
    requirePermission('operation.undo'),
    idempotent(`operation.${mode}`),
    async (request, response) => {
      const body = request.body as Record<string, unknown> | null
      response.json(await compensateOperation(
        requireAuthenticatedActor(request),
        operationId(body?.operationId),
        mode,
        idempotencyTransaction(response),
      ))
    },
  )
}

/* ---------------- TU-35: Nhật ký thao tác ---------------- */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function dateParameter(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new AppError(400, 'INVALID_DATE', `Tham số ${name} phải có dạng YYYY-MM-DD.`)
  }
  return value
}

function typesParameter(value: unknown): string[] {
  if (value === undefined || value === '') return []
  const raw: unknown[] = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : [])
  const types = raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  for (const type of types) {
    if (!isAuditFilterType(type)) throw new AppError(400, 'INVALID_AUDIT_TYPE', `Loại thao tác "${type}" không hợp lệ.`)
  }
  return types
}

function limitParameter(value: unknown): number {
  if (value === undefined) return 50
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, 'INVALID_LIMIT', 'limit phải là số nguyên dương.')
  return parsed
}

function queryOf(request: { query: Record<string, unknown> }) {
  return {
    ...(dateParameter(request.query.from, 'from') ? { from: dateParameter(request.query.from, 'from')! } : {}),
    ...(dateParameter(request.query.to, 'to') ? { to: dateParameter(request.query.to, 'to')! } : {}),
    types: typesParameter(request.query.types),
  }
}

/**
 * Danh sách nhóm lọc. Tách khỏi dữ liệu để màn hình không phải tự biết nhóm
 * nào đã có hành động thật và nhóm nào còn trống.
 */
operationRouter.get(
  '/audit/filters',
  requireAuthentication,
  requirePermission('audit.read'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    const [config, roles, accessLevel] = await Promise.all([
      getAuditConfig(actor), listRoles(actor), getAdminAccessLevel(actor),
    ])
    response.json({
      filters: AUDIT_FILTERS.map((filter) => ({
        type: filter.type,
        label: filter.label,
        supported: filter.actions.length > 0,
        ...(filter.unsupportedNote ? { note: filter.unsupportedNote } : {}),
      })),
      retentionDays: config.retentionDays,
      canExport: canExportAudit(accessLevelKey(roles, accessLevel), config.exportLevels),
    })
  },
)

operationRouter.get(
  '/audit',
  requireAuthentication,
  requirePermission('audit.read'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    const before = request.query.before === undefined ? undefined : Number(request.query.before)
    if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) {
      throw new AppError(400, 'INVALID_CURSOR', 'Tham số before không hợp lệ.')
    }
    response.json(await listAuditEntries(actor, {
      ...queryOf(request),
      limit: limitParameter(request.query.limit),
      ...(before === undefined ? {} : { beforeId: before }),
    }))
  },
)

/**
 * Xuất file. File này là dữ liệu nhạy cảm nên ngoài `audit.read` còn phải nằm
 * trong danh sách cấp được xuất, đọc từ cấu hình (câu C3 chưa chốt).
 */
operationRouter.get(
  '/audit/export',
  requireAuthentication,
  requirePermission('audit.read'),
  async (request, response) => {
    const actor = requireAuthenticatedActor(request)
    const [config, roles, accessLevel] = await Promise.all([
      getAuditConfig(actor), listRoles(actor), getAdminAccessLevel(actor),
    ])
    if (!canExportAudit(accessLevelKey(roles, accessLevel), config.exportLevels)) {
      throw new AppError(403, 'AUDIT_EXPORT_DENIED', 'Tài khoản không được phép xuất file nhật ký.')
    }
    const page = await listAuditEntries(actor, { ...queryOf(request), limit: 5000 })
    const stamp = applicationNow().toISOString().slice(0, 10)
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', `attachment; filename="nhat-ky-thao-tac-${stamp}.csv"`)
    response.send(toCsv(page.entries))
  },
)

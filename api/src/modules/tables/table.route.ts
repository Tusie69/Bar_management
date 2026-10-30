import { Router } from 'express'

import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { AppError } from '../../errors/app-error.js'
import { configureTable, getTableCatalog, listActiveTableGroups, listTables, updateTableState } from './table.repository.js'
import { isTableState } from './table-state.js'

export const tableRouter: Router = Router()

function parseBusinessDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày làm việc phải có dạng YYYY-MM-DD.')
  }
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày làm việc không hợp lệ.')
  }
  return value
}

function parseBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Nội dung yêu cầu phải là một object JSON.')
  }
  return value as Record<string, unknown>
}

tableRouter.get('/', requireAuthentication, requirePermission('customer.view_masked'), async (request, response) => {
  const businessDate = parseBusinessDate(request.query.date)
  const actor = requireAuthenticatedActor(request)
  const [tables, groups] = await Promise.all([
    listTables(actor, businessDate),
    listActiveTableGroups(actor, businessDate),
  ])
  response.json({ businessDate, tables, groups })
})

tableRouter.get(
  '/catalog',
  requireAuthentication,
  requirePermission('customer.view_masked'),
  async (request, response) => {
    response.json(await getTableCatalog(requireAuthenticatedActor(request)))
  },
)

tableRouter.patch(
  '/:id/status',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('table.assign'),
  async (request, response) => {
    const tableId = Number(request.params.id)
    if (!Number.isSafeInteger(tableId) || tableId <= 0) {
      throw new AppError(400, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')
    }

    const body = parseBody(request.body as unknown)
    const businessDate = parseBusinessDate(body.businessDate)
    const state = body.state
    const isBackup = body.isBackup
    const expectedVersion = body.expectedVersion

    if (state !== undefined && !isTableState(state)) {
      throw new AppError(400, 'INVALID_TABLE_STATE', 'Trạng thái bàn không hợp lệ.')
    }
    if (isBackup !== undefined && typeof isBackup !== 'boolean') {
      throw new AppError(400, 'INVALID_BACKUP_FLAG', 'Cờ bàn sơ cua phải là true hoặc false.')
    }
    if (isBackup !== undefined) {
      throw new AppError(400, 'FIXED_SPARE_TABLE', 'Bàn sơ cua là cấu hình cố định và không thể thay đổi theo ngày.')
    }
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0)) {
      throw new AppError(400, 'INVALID_VERSION', 'Phiên bản bàn không hợp lệ.')
    }
    if (state === undefined) {
      throw new AppError(400, 'EMPTY_UPDATE', 'Cần gửi trạng thái bàn.')
    }

    const table = await updateTableState(requireAuthenticatedActor(request), {
      tableId,
      businessDate,
      ...(state === undefined ? {} : { state }),
      ...(expectedVersion === undefined ? {} : { expectedVersion: Number(expectedVersion) }),
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    })
    response.json({ table })
  },
)

tableRouter.patch(
  '/:id/configuration',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('venue.configure'),
  async (request, response) => {
    const tableId = Number(request.params.id)
    if (!Number.isSafeInteger(tableId) || tableId <= 0)
      throw new AppError(400, 'INVALID_TABLE_ID', 'Mã bàn không hợp lệ.')
    const body = parseBody(request.body as unknown)
    if (body.isSpare !== undefined && typeof body.isSpare !== 'boolean')
      throw new AppError(400, 'INVALID_BACKUP_FLAG', 'Cờ bàn sơ cua phải là true hoặc false.')
    if (body.status !== undefined && body.status !== 'ACTIVE' && body.status !== 'OUT_OF_SERVICE')
      throw new AppError(400, 'INVALID_TABLE_STATUS', 'Table status must be ACTIVE or OUT_OF_SERVICE.')
    if (body.isSpare === undefined && body.status === undefined)
      throw new AppError(400, 'EMPTY_UPDATE', 'Provide isSpare or status.')
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 1)
      throw new AppError(400, 'INVALID_VERSION', 'Phiên bản bàn không hợp lệ.')
    if (typeof body.reason !== 'string' || !body.reason.trim())
      throw new AppError(400, 'REASON_REQUIRED', 'Cần nhập lý do thay đổi cấu hình bàn.')
    if (body.reason.trim().length > 500)
      throw new AppError(400, 'REASON_TOO_LONG', 'Lý do không được vượt quá 500 ký tự.')
    response.json({
      table: await configureTable(requireAuthenticatedActor(request), {
        tableId,
        ...(typeof body.isSpare === 'boolean' ? { isSpare: body.isSpare } : {}),
        ...(body.status === 'ACTIVE' || body.status === 'OUT_OF_SERVICE' ? { status: body.status } : {}),
        expectedVersion: Number(body.version),
        reason: body.reason.trim(),
      }),
    })
  },
)

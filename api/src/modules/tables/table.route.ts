import { Router } from 'express'

import { AppError } from '../../errors/app-error.js'
import { listTables, updateTableState } from './table.repository.js'
import { isTableState } from './table-state.js'

export const tableRouter = Router()

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

tableRouter.get('/', async (request, response) => {
  const businessDate = parseBusinessDate(request.query.date)
  const tables = await listTables(businessDate)
  response.json({ businessDate, tables })
})

tableRouter.patch('/:id/status', async (request, response) => {
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
  if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0)) {
    throw new AppError(400, 'INVALID_VERSION', 'Phiên bản bàn không hợp lệ.')
  }
  if (state === undefined && isBackup === undefined) {
    throw new AppError(400, 'EMPTY_UPDATE', 'Cần gửi trạng thái hoặc cờ bàn sơ cua.')
  }

  const table = await updateTableState({
    tableId,
    businessDate,
    ...(state === undefined ? {} : { state }),
    ...(isBackup === undefined ? {} : { isBackup }),
    ...(expectedVersion === undefined ? {} : { expectedVersion: Number(expectedVersion) }),
    ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
  })
  response.json({ table })
})


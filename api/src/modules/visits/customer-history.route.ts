import { Router, type RequestHandler } from 'express'
import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import { idempotent, idempotencyTransaction } from '../../middleware/idempotency.js'
import {
  assignAnonymousVisit, dismissDuplicateCustomers, listAnonymousVisits, listDuplicateCustomers,
  mergeDuplicateCustomers, undoAnonymousAssignment, type DuplicateInput,
} from './customer-history.repository.js'

export const customerHistoryRouter: Router = Router()
customerHistoryRouter.use(['/visits/anonymous', '/visits/:id/customer-assignment', '/customers/duplicates'], requireAuthentication)
const read = requirePermission('report.read')
const write = requirePermission('customer.history.manage')
const replay: RequestHandler = (request, response, next) => idempotent(`customer-history:${request.path}`)(request, response, next)
function positive(value: unknown, field: string): number {
  const parsed = typeof value === 'number' || typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AppError(422, 'VALIDATION_FAILED', `${field} phải là số nguyên dương.`)
  return parsed
}
function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(422, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.')
  return value as Record<string, unknown>
}
function pagination(query: Record<string, unknown>) {
  const page = query.page === undefined ? 1 : positive(query.page, 'page')
  const pageSize = query.pageSize === undefined ? 20 : positive(query.pageSize, 'pageSize')
  if (pageSize > 50 || !Number.isSafeInteger(page * pageSize)) throw new AppError(422, 'VALIDATION_FAILED', 'pageSize tối đa 50.')
  return { page, pageSize }
}
function date(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new AppError(422, 'INVALID_BUSINESS_DATE', 'Ngày phải có dạng YYYY-MM-DD hợp lệ.')
  }
  return value
}
function pair(value: unknown): DuplicateInput {
  const input = body(value)
  return { sourceCustomerId: positive(input.sourceCustomerId, 'sourceCustomerId'),
    targetCustomerId: positive(input.targetCustomerId, 'targetCustomerId'),
    sourceVersion: positive(input.sourceVersion, 'sourceVersion'), targetVersion: positive(input.targetVersion, 'targetVersion') }
}
customerHistoryRouter.get('/visits/anonymous', read, async (request, response) => {
  const from = date(request.query.from), to = date(request.query.to)
  if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw new AppError(422, 'INVALID_DATE_RANGE', 'Khoảng ngày không hợp lệ hoặc vượt quá 366 ngày.')
  response.json(await listAnonymousVisits(requireAuthenticatedActor(request), { from, to, ...pagination(request.query) }))
})
customerHistoryRouter.post('/visits/:id/customer-assignment', requireCsrfProtection, write, replay, async (request, response) => {
  const input = body(request.body)
  if (typeof input.phone !== 'string' || input.displayName !== undefined && typeof input.displayName !== 'string') {
    throw new AppError(422, 'VALIDATION_FAILED', 'Cần nhập số điện thoại và tên khách hợp lệ.')
  }
  response.json(await assignAnonymousVisit(requireAuthenticatedActor(request), {
    visitId: positive(request.params.id, 'visitId'), version: positive(input.version, 'version'), phone: input.phone,
    ...(typeof input.displayName === 'string' ? { displayName: input.displayName } : {}),
  }, idempotencyTransaction(response)))
})
customerHistoryRouter.post('/visits/:id/customer-assignment/undo', requireCsrfProtection, write, replay, async (request, response) => {
  const input = body(request.body)
  response.json(await undoAnonymousAssignment(requireAuthenticatedActor(request), {
    visitId: positive(request.params.id, 'visitId'), version: positive(input.version, 'version'), operationId: positive(input.operationId, 'operationId'),
  }, idempotencyTransaction(response)))
})
customerHistoryRouter.get('/customers/duplicates', read, async (request, response) => {
  const { page, pageSize } = pagination(request.query)
  response.json(await listDuplicateCustomers(requireAuthenticatedActor(request), page, pageSize))
})
customerHistoryRouter.post('/customers/duplicates/merge', requireCsrfProtection, write, replay, async (request, response) => {
  response.json(await mergeDuplicateCustomers(requireAuthenticatedActor(request), pair(request.body), idempotencyTransaction(response)))
})
customerHistoryRouter.post('/customers/duplicates/dismiss', requireCsrfProtection, write, replay, async (request, response) => {
  response.json(await dismissDuplicateCustomers(requireAuthenticatedActor(request), pair(request.body), idempotencyTransaction(response)))
})

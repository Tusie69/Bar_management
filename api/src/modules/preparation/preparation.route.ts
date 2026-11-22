import { Router, type RequestHandler } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import {
  afterIdempotencyCommit,
  idempotencyTransaction,
  idempotent,
  requireBodyIdempotencyKey,
} from '../../middleware/idempotency.js'
import { publishFloorChange } from '../tables/floor-change-stream.js'
import type { PreparationStation } from './preparation.model.js'
import {
  acknowledgeReadyNotification,
  getPreparationHistory,
  getPreparationQueue,
  listReadyNotifications,
  retryPreparationPrint,
  transitionPreparationTicket,
  updatePreparationLineProgress,
} from './preparation.repository.js'

export const preparationRouter: Router = Router()

function station(value: unknown): PreparationStation {
  const normalized = typeof value === 'string' ? value.toUpperCase() : ''
  if (normalized !== 'BAR' && normalized !== 'KITCHEN') {
    throw new AppError(400, 'INVALID_PREPARATION_STATION', 'Quầy chế biến phải là BAR hoặc KITCHEN.')
  }
  return normalized
}

function positiveInteger(value: unknown, code = 'INVALID_ID'): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(400, code, 'Giá trị phải là số nguyên dương.')
  return parsed
}

function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'INVALID_BODY', 'Nội dung yêu cầu không hợp lệ.')
  return value as Record<string, unknown>
}

function stationPermission(kind: 'read' | 'transition'): RequestHandler {
  return (request, response, next) => requirePermission(
    `preparation.${station(request.params.station).toLowerCase()}.${kind}`,
  )(request, response, next)
}

preparationRouter.get(
  '/:station/tickets',
  requireAuthentication,
  stationPermission('read'),
  async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store')
    response.json(await getPreparationQueue(requireAuthenticatedActor(request), station(request.params.station)))
  },
)

preparationRouter.get(
  '/:station/history',
  requireAuthentication,
  stationPermission('read'),
  async (request, response) => {
    const limit = request.query.limit === undefined ? 50 : positiveInteger(request.query.limit, 'INVALID_LIMIT')
    const beforeTicketId = request.query.beforeTicketId === undefined
      ? undefined
      : positiveInteger(request.query.beforeTicketId, 'INVALID_CURSOR')
    response.setHeader('Cache-Control', 'private, no-store')
    response.json(await getPreparationHistory(requireAuthenticatedActor(request), station(request.params.station), {
      limit,
      ...(beforeTicketId === undefined ? {} : { beforeTicketId }),
    }))
  },
)

preparationRouter.post(
  '/:station/tickets/:ticketId/transition',
  requireAuthentication,
  requireCsrfProtection,
  stationPermission('transition'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('preparation.ticket.transition'),
  async (request, response) => {
    const input = body(request.body)
    const toStatus = input.toStatus
    if (toStatus !== 'ACCEPTED' && toStatus !== 'PREPARING' && toStatus !== 'READY' && toStatus !== 'COLLECTED') {
      throw new AppError(400, 'INVALID_PREPARATION_STATUS', 'Trạng thái đích không hợp lệ.')
    }
    const actor = requireAuthenticatedActor(request)
    const result = await transitionPreparationTicket(actor, {
      ticketId: positiveInteger(request.params.ticketId, 'INVALID_TICKET_ID'),
      station: station(request.params.station),
      toStatus,
      expectedVersion: positiveInteger(input.expectedVersion, 'INVALID_VERSION'),
      idempotencyKey: String(input.idempotencyKey),
    }, idempotencyTransaction(response))
    afterIdempotencyCommit(response, () => publishFloorChange({
      organizationId: actor.organizationId,
      venueId: actor.venueId,
      changeSeq: result.changeCursor,
    }))
    response.json(result)
  },
)

preparationRouter.post(
  '/:station/tickets/:ticketId/lines/:lineNo/progress',
  requireAuthentication,
  requireCsrfProtection,
  stationPermission('transition'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('preparation.line.progress'),
  async (request, response) => {
    const input = body(request.body)
    const doneQuantity = Number(input.doneQuantity)
    const expectedVersion = Number(input.expectedVersion)
    if (!Number.isSafeInteger(doneQuantity) || doneQuantity < 0) {
      throw new AppError(400, 'INVALID_DONE_QUANTITY', 'Số phần đã làm phải là số nguyên không âm.')
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new AppError(400, 'INVALID_PROGRESS_VERSION', 'Version tiến độ không hợp lệ.')
    }
    const actor = requireAuthenticatedActor(request)
    const result = await updatePreparationLineProgress(actor, {
      ticketId: positiveInteger(request.params.ticketId, 'INVALID_TICKET_ID'),
      lineNo: positiveInteger(request.params.lineNo, 'INVALID_LINE_NO'),
      station: station(request.params.station),
      doneQuantity,
      expectedVersion,
      idempotencyKey: String(input.idempotencyKey),
    }, idempotencyTransaction(response))
    afterIdempotencyCommit(response, () => publishFloorChange({
      organizationId: actor.organizationId,
      venueId: actor.venueId,
      changeSeq: result.changeCursor,
    }))
    response.json(result)
  },
)

preparationRouter.get(
  '/ready-notifications',
  requireAuthentication,
  requirePermission('preparation.ready.read'),
  async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store')
    response.json(await listReadyNotifications(requireAuthenticatedActor(request)))
  },
)

preparationRouter.post(
  '/ready-notifications/:eventId/acknowledge',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('preparation.ready.acknowledge'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('preparation.ready.acknowledge'),
  async (request, response) => {
    const input = body(request.body)
    const audience = input.audience
    if (audience !== 'ORDERED_BY_USER' && audience !== 'CASHIER_ROLE') {
      throw new AppError(400, 'INVALID_READY_AUDIENCE', 'Audience của thông báo READY không hợp lệ.')
    }
    response.json(await acknowledgeReadyNotification(requireAuthenticatedActor(request), {
      eventId: positiveInteger(request.params.eventId, 'INVALID_READY_EVENT_ID'),
      audience,
      idempotencyKey: String(input.idempotencyKey),
    }, idempotencyTransaction(response)))
  },
)

preparationRouter.post(
  '/:station/tickets/:ticketId/print-retry',
  requireAuthentication,
  requireCsrfProtection,
  stationPermission('read'),
  requirePermission('preparation.print.retry'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('preparation.print.retry'),
  async (request, response) => {
    const input = body(request.body)
    response.json(await retryPreparationPrint(requireAuthenticatedActor(request), {
      ticketId: positiveInteger(request.params.ticketId, 'INVALID_TICKET_ID'),
      station: station(request.params.station),
      idempotencyKey: String(input.idempotencyKey),
    }, idempotencyTransaction(response)))
  },
)

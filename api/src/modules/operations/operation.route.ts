import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import { idempotent, idempotencyTransaction } from '../../middleware/idempotency.js'
import { compensateOperation, getUndoState } from './operation.repository.js'

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

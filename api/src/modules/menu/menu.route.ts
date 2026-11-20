import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import type { MenuAvailability, WaiterMenuQuery } from './menu.model.js'
import { getWaiterMenu, getWaiterMenuItem } from './menu.repository.js'

export const waiterMenuRouter: Router = Router()
const availabilityValues = new Set<MenuAvailability>(['AVAILABLE', 'TEMPORARILY_UNAVAILABLE'])

function positiveInteger(value: unknown, code: string, message: string): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new AppError(400, code, message)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new AppError(400, code, message)
  return parsed
}

function menuQuery(query: Record<string, unknown>): WaiterMenuQuery {
  const visitId = positiveInteger(query.visitId, 'INVALID_VISIT_ID', 'visitId phải là số nguyên dương.')
  const result: WaiterMenuQuery = { visitId }
  if (query.categoryId !== undefined) {
    result.categoryId = positiveInteger(query.categoryId, 'INVALID_CATEGORY_ID', 'categoryId phải là số nguyên dương.')
  }
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.trim().length > 120) {
      throw new AppError(400, 'INVALID_MENU_SEARCH', 'Từ khóa tìm món không hợp lệ.')
    }
    if (query.search.trim()) result.search = query.search.trim()
  }
  if (query.availability !== undefined) {
    if (typeof query.availability !== 'string' || !availabilityValues.has(query.availability as MenuAvailability)) {
      throw new AppError(400, 'INVALID_AVAILABILITY', 'Trạng thái món không hợp lệ.')
    }
    result.availability = query.availability as MenuAvailability
  }
  return result
}

waiterMenuRouter.get(
  '/menu',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-cache')
    response.json(await getWaiterMenu(requireAuthenticatedActor(request), menuQuery(request.query)))
  },
)

waiterMenuRouter.get(
  '/menu/items/:itemId',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const query = menuQuery(request.query)
    query.itemId = positiveInteger(request.params.itemId, 'INVALID_MENU_ITEM_ID', 'Mã món không hợp lệ.')
    response.setHeader('Cache-Control', 'private, no-cache')
    response.json(await getWaiterMenuItem(requireAuthenticatedActor(request), query))
  },
)

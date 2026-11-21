import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { attachAuthentication } from '../src/auth/authenticated-actor.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { waiterMenuRouter } from '../src/modules/menu/menu.route.js'

vi.mock('../src/auth/auth.service.js', () => ({ hasPermission: vi.fn() }))
vi.mock('../src/modules/menu/menu.repository.js', () => ({
  getWaiterMenu: vi.fn(),
  getWaiterMenuItem: vi.fn(),
}))
vi.mock('../src/auth/auth.middleware.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/auth/auth.middleware.js')>(),
  requireAuthentication: (_request: unknown, _response: unknown, next: () => void) => next(),
}))

import { hasPermission } from '../src/auth/auth.service.js'
import { getWaiterMenu, getWaiterMenuItem } from '../src/modules/menu/menu.repository.js'

const actor = { organizationId: 1, venueId: 2, userId: 3, membershipId: 4, portal: 'waiter' as const }
const app = express()
app.use((req, _res, next) => {
  attachAuthentication(req, { actor, username: 'waiter', displayName: 'Waiter', sessionToken: 'test', portal: 'waiter', mustChangePassword: false })
  next()
})
app.use('/waiter', waiterMenuRouter)
app.use(errorHandler)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasPermission).mockResolvedValue(true)
  vi.mocked(getWaiterMenu).mockResolvedValue({
    catalogVersion: 'v1',
    visit: { visitId: 5, tableCodes: ['A1'], guestCount: 2, startedAt: '2030-01-01T12:00:00.000Z', status: 'OPEN' },
    categories: [],
    items: [],
  })
})

describe('GET waiter menu routes', () => {
  it('requires order.read and never accepts a client venueId', async () => {
    const response = await request(app).get('/waiter/menu?visitId=5&venueId=999')
    expect(response.status).toBe(200)
    expect(hasPermission).toHaveBeenCalledWith(actor, 'order.read')
    expect(getWaiterMenu).toHaveBeenCalledWith(actor, { visitId: 5 })
  })

  it('denies a session without order.read before querying catalog', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false)
    expect((await request(app).get('/waiter/menu?visitId=5')).status).toBe(403)
    expect(getWaiterMenu).not.toHaveBeenCalled()
  })

  it.each([
    '/waiter/menu',
    '/waiter/menu?visitId=0',
    '/waiter/menu?visitId=5&categoryId=x',
    '/waiter/menu?visitId=5&availability=DISCONTINUED',
    `/waiter/menu?visitId=5&search=${'a'.repeat(121)}`,
  ])('rejects invalid query %s', async (path) => {
    expect((await request(app).get(path)).status).toBe(400)
    expect(getWaiterMenu).not.toHaveBeenCalled()
  })

  it('passes normalized filters and item id to the detail projection', async () => {
    vi.mocked(getWaiterMenuItem).mockResolvedValue({
      catalogVersion: 'v1',
      visit: { visitId: 5, tableCodes: ['A1'], guestCount: 2, startedAt: '2030-01-01T12:00:00.000Z', status: 'OPEN' },
      item: {
        id: 9, code: 'ITEM', categoryId: 1, name: 'Món', description: null, preparationStation: 'BAR',
        availabilityStatus: 'AVAILABLE', displayOrder: 1, variants: [],
      },
    })
    const response = await request(app).get('/waiter/menu/items/9?visitId=5&search=%20Macallan%20')
    expect(response.status).toBe(200)
    expect(getWaiterMenuItem).toHaveBeenCalledWith(actor, { visitId: 5, search: 'Macallan', itemId: 9 })
  })
})

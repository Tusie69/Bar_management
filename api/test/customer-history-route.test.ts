import express from 'express'
import request from 'supertest'
import { beforeEach, expect, it, vi } from 'vitest'
import { attachAuthentication } from '../src/auth/authenticated-actor.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { customerHistoryRouter } from '../src/modules/visits/customer-history.route.js'
import { listAnonymousVisits } from '../src/modules/visits/customer-history.repository.js'
import { hasPermission } from '../src/auth/auth.service.js'
vi.mock('../src/auth/auth.service.js', () => ({ hasPermission: vi.fn() }))
vi.mock('../src/auth/auth.middleware.js', async (original) => ({
  ...await original<typeof import('../src/auth/auth.middleware.js')>(),
  requireAuthentication: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireCsrfProtection: (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../src/modules/visits/customer-history.repository.js', () => ({
  listAnonymousVisits: vi.fn(), assignAnonymousVisit: vi.fn(), undoAnonymousAssignment: vi.fn(),
  listDuplicateCustomers: vi.fn(), mergeDuplicateCustomers: vi.fn(), dismissDuplicateCustomers: vi.fn(),
}))
const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  attachAuthentication(req, { actor: { organizationId: 1, venueId: 1, userId: 1, membershipId: 1, portal: 'admin' },
    portal: 'admin', username: 'test', displayName: 'Owner', sessionToken: 'test', mustChangePassword: false }); next()
})
app.use(customerHistoryRouter)
app.get('/unrelated', (_req, res) => res.json({ ok: true }))
app.use(errorHandler)
beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasPermission).mockResolvedValue(true) })
it.each(['from=2030-02-30&to=2030-03-01', 'from=2030-02-02&to=2030-02-01', 'from=2020-01-01&to=2030-01-01',
  'from=2030-01-01', 'from=2030-01-01&to=2030-01-02&pageSize=51', 'from=2030-01-01&to=2030-01-02&page=0'])('rejects malformed range %s with 422', async (query) => {
  await request(app).get(`/visits/anonymous?${query}`).expect(422)
  expect(listAnonymousVisits).not.toHaveBeenCalled()
})
it('requires read permission and does not intercept unrelated routes', async () => {
  vi.mocked(hasPermission).mockResolvedValue(false)
  await request(app).get('/customers/duplicates').expect(403)
  await request(app).get('/unrelated').expect(200)
})
it.each(['/visits/1/customer-assignment', '/visits/1/customer-assignment/undo', '/customers/duplicates/merge', '/customers/duplicates/dismiss'])(
  'validates writes %s and refuses permission before processing', async (path) => {
    await request(app).post(path).send({ version: true }).expect(422)
    vi.mocked(hasPermission).mockResolvedValue(false)
    await request(app).post(path).send({}).expect(403)
  })

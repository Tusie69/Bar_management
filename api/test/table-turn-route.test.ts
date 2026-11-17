import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachAuthentication } from '../src/auth/authenticated-actor.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { visitRouter } from '../src/modules/visits/visit.route.js'

vi.mock('../src/auth/auth.service.js', () => ({ hasPermission: vi.fn() }))
vi.mock('../src/modules/visits/table-turn.repository.js', () => ({
  listTableTurns: vi.fn(), summarizeTableTurns: vi.fn(),
}))
vi.mock('../src/auth/auth.middleware.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/auth/auth.middleware.js')>(),
  requireAuthentication: (_request: unknown, _response: unknown, next: () => void) => next(),
}))
import { hasPermission } from '../src/auth/auth.service.js'
import { listTableTurns, summarizeTableTurns } from '../src/modules/visits/table-turn.repository.js'

const actor = { organizationId: 1, venueId: 2, userId: 3, membershipId: 4 }
const app = express()
app.use((req, _res, next) => {
  attachAuthentication(req, { actor, username: 'owner', displayName: 'Owner', sessionToken: 'test', portal: 'admin', mustChangePassword: false })
  next()
})
app.use('/visits', visitRouter)
app.use(errorHandler)
const range = 'from=2030-10-21&to=2030-10-27'
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasPermission).mockResolvedValue(true)
})
describe.each(['/visits/turns', '/visits/turns/summary'])('%s validation and access', (path) => {
  it.each([
    'from=2030-02-30&to=2030-03-01', 'from=30-10-21&to=2030-10-27',
    'from=2030-10-28&to=2030-10-27', 'from=2030-10-21',
    'from=2020-01-01&to=2030-01-01',
    ...['0', '-1', '1.5', 'abc', '9007199254740992', '', '1&closedByUserId=2'].map((value) => `${range}&closedByUserId=${value}`),
    ...['0', '-1', '1.5', 'abc', '9007199254740992', '', '1&checkedInByUserId=2'].map((value) => `${range}&checkedInByUserId=${value}`),
    `${range}&includeUncounted=1`, `${range}&page=0`, `${range}&pageSize=201`,
  ])('rejects invalid filter %s before reading ledger', async (query) => {
    expect((await request(app).get(`${path}?${query}`)).status).toBe(400)
    expect(listTableTurns).not.toHaveBeenCalled()
    expect(summarizeTableTurns).not.toHaveBeenCalled()
  })
  it('requires report.read', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false)
    const response = await request(app).get(`${path}?${range}`)
    expect(response.status).toBe(403)
    expect(hasPermission).toHaveBeenCalledWith(actor, 'report.read')
  })
})
it('passes identical range/staff/counting filters and returns each response unchanged', async () => {
  const turn = {
    status: 'CLOSED' as const, checkedInByUserId: 5, checkedInByDisplayName: 'Reception',
    turnId: 11, turnNo: 9, businessDate: '2030-10-21', scope: 'GROUP' as const,
    groupId: 7, groupCode: 'C1', tableId: null, tableCodes: ['B3', 'B4'], memberTableIds: [3, 4],
    guestName: 'Group', guestCount: 8, sourceCode: null, origin: 'WALK_IN',
    seatedAt: '2030-10-21T13:00:00Z', releasedAt: '2030-10-21T15:00:00Z',
    endReason: 'GUEST_LEFT', counted: true, visitId: 10, reservationId: null,
    closedByUserId: 3, closedByDisplayName: 'Owner',
  }
  const list = { from: '2030-10-21', to: '2030-10-27', page: 2, pageSize: 1,
    total: 2, completedTotal: 2, guestTotal: 16, turns: [turn] }
  const summary = { from: list.from, to: list.to, completedTotal: 2, openTotal: 0, guestTotal: 16,
    byBusinessDate: [{ businessDate: '2030-10-21', turns: 2, guests: 16 }],
    byStaff: [{ checkedInByUserId: 5, checkedInByDisplayName: 'Reception', turns: 2, guests: 16 }],
    byScope: [{ scope: 'GROUP' as const, groupId: 7, tableId: null, label: 'C1', turns: 2, guests: 16 }] }
  vi.mocked(listTableTurns).mockResolvedValue(list)
  vi.mocked(summarizeTableTurns).mockResolvedValue(summary)
  const query = `${range}&closedByUserId=3&checkedInByUserId=5&includeUncounted=true&page=2&pageSize=1`
  expect((await request(app).get(`/visits/turns?${query}`)).body).toEqual(list)
  expect((await request(app).get(`/visits/turns/summary?${query}`)).body).toEqual(summary)
  const filters = { from: list.from, to: list.to, page: 2, pageSize: 1, closedByUserId: 3, checkedInByUserId: 5, countedOnly: false }
  expect(listTableTurns).toHaveBeenCalledWith(actor, filters)
  expect(summarizeTableTurns).toHaveBeenCalledWith(actor, filters)
})

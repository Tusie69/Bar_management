/**
 * Module Phục vụ 3 — hợp đồng HTTP của ba endpoint gọi món.
 *
 * File này kiểm HÌNH DẠNG payload và lớp bảo vệ của route: permission, CSRF,
 * mã chống trùng bắt buộc, và việc venue không bao giờ đến từ client. Luật
 * nghiệp vụ (Phiên, giá, hết món, đồng thời) nằm ở
 * `waiter-order.mysql.test.ts` và phải đi qua MySQL thật — một mock chỉ xác
 * nhận đúng cái bảng mà chính nó khai.
 */
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { attachAuthentication } from '../src/auth/authenticated-actor.js'
import { errorHandler } from '../src/middleware/error-handler.js'

vi.mock('../src/auth/auth.service.js', () => ({ hasPermission: vi.fn() }))
vi.mock('../src/modules/orders/order.repository.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/modules/orders/order.repository.js')>(),
  createWaiterOrder: vi.fn(),
  listVisitOrders: vi.fn(),
  getWaiterOrder: vi.fn(),
}))
vi.mock('../src/auth/auth.middleware.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/auth/auth.middleware.js')>(),
  requireAuthentication: (_request: unknown, _response: unknown, next: () => void) => next(),
  requireCsrfProtection: (_request: unknown, _response: unknown, next: () => void) => next(),
}))
// `idempotent()` mở một transaction thật trên pool. Ở đây nó được thay bằng một
// lớp đi qua, nhưng `requireBodyIdempotencyKey` thì GIỮ NGUYÊN bản thật: việc
// mã chống trùng là bắt buộc chính là một phần hợp đồng của endpoint này.
vi.mock('../src/middleware/idempotency.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/middleware/idempotency.js')>(),
  idempotent: () => (_request: unknown, _response: unknown, next: () => void) => next(),
  idempotencyTransaction: () => undefined,
}))

import { hasPermission } from '../src/auth/auth.service.js'
import { waiterOrderRouter } from '../src/modules/orders/order.route.js'
import { createWaiterOrder, getWaiterOrder, listVisitOrders } from '../src/modules/orders/order.repository.js'

const actor = { organizationId: 1, venueId: 2, userId: 3, membershipId: 4, portal: 'waiter' as const }
const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  attachAuthentication(req, {
    actor,
    username: 'waiter',
    displayName: 'Phục vụ',
    sessionToken: 'test',
    portal: 'waiter',
    mustChangePassword: false,
  })
  next()
})
app.use('/waiter', waiterOrderRouter)
app.use(errorHandler)

const key = 'order-key-00000001'
const line = { variantId: 7, priceId: 11, priceVersion: 2, quantity: 3 }
const order = {
  orderId: 55,
  visitId: 5,
  visitSequence: 1,
  status: 'SUBMITTED' as const,
  submittedAt: '2030-01-01T13:00:00.000Z',
  orderedByUserId: 3,
  orderedByDisplayName: 'Phục vụ',
  lineCount: 1,
  itemCount: 3,
  totalAmountVnd: 1_140_000,
  cancelledItemCount: 0,
  cancelledAmountVnd: 0,
  netAmountVnd: 1_140_000,
  stations: ['BAR' as const],
  businessDate: '2030-01-01',
  lines: [],
  tickets: [],
}

function postOrder(body: unknown) {
  return request(app).post('/waiter/orders').send(body as object)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasPermission).mockResolvedValue(true)
  vi.mocked(createWaiterOrder).mockResolvedValue(order)
})

describe('POST /waiter/orders', () => {
  it('yêu cầu order.create và không bao giờ nhận venueId từ client', async () => {
    const response = await postOrder({ visitId: 5, idempotencyKey: key, venueId: 999, lines: [line] })
    expect(response.status).toBe(201)
    expect(hasPermission).toHaveBeenCalledWith(actor, 'order.create')
    expect(createWaiterOrder).toHaveBeenCalledWith(
      actor,
      { visitId: 5, idempotencyKey: key, lines: [line] },
      undefined,
    )
  })

  it('từ chối session không có order.create trước khi chạm vào đơn', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false)
    expect((await postOrder({ visitId: 5, idempotencyKey: key, lines: [line] })).status).toBe(403)
    expect(createWaiterOrder).not.toHaveBeenCalled()
  })

  it.each([
    ['thiếu mã chống trùng', { visitId: 5, lines: [line] }],
    ['mã chống trùng quá ngắn', { visitId: 5, idempotencyKey: 'abc', lines: [line] }],
    ['giỏ trống', { visitId: 5, idempotencyKey: key, lines: [] }],
    ['thiếu lines', { visitId: 5, idempotencyKey: key }],
    ['visitId không hợp lệ', { visitId: 0, idempotencyKey: key, lines: [line] }],
    ['thiếu priceId', { visitId: 5, idempotencyKey: key, lines: [{ variantId: 7, priceVersion: 2, quantity: 1 }] }],
    ['thiếu priceVersion', { visitId: 5, idempotencyKey: key, lines: [{ variantId: 7, priceId: 11, quantity: 1 }] }],
    ['số lượng 0', { visitId: 5, idempotencyKey: key, lines: [{ ...line, quantity: 0 }] }],
    ['số lượng vượt trần', { visitId: 5, idempotencyKey: key, lines: [{ ...line, quantity: 100 }] }],
    ['ghi chú quá dài', { visitId: 5, idempotencyKey: key, lines: [{ ...line, note: 'x'.repeat(201) }] }],
    ['hai dòng cùng biến thể và cùng ghi chú', { visitId: 5, idempotencyKey: key, lines: [line, { ...line, quantity: 1 }] }],
    ['hai dòng cùng biến thể, ghi chú chỉ khác dấu và chữ hoa',
      { visitId: 5, idempotencyKey: key, lines: [{ ...line, note: 'Ít Đá' }, { ...line, note: 'it  da' }] }],
  ])('từ chối payload: %s', async (_name, body) => {
    expect((await postOrder(body)).status).toBe(400)
    expect(createWaiterOrder).not.toHaveBeenCalled()
  })

  it('cắt khoảng trắng ghi chú và bỏ ghi chú rỗng', async () => {
    await postOrder({
      visitId: 5,
      idempotencyKey: key,
      lines: [{ ...line, note: '  ít đá  ' }, { variantId: 8, priceId: 12, priceVersion: 1, quantity: 1, note: '   ' }],
    })
    expect(createWaiterOrder).toHaveBeenCalledWith(
      actor,
      {
        visitId: 5,
        idempotencyKey: key,
        lines: [{ ...line, note: 'ít đá' }, { variantId: 8, priceId: 12, priceVersion: 1, quantity: 1 }],
      },
      undefined,
    )
  })

  it('nhận hai dòng cùng biến thể khi ghi chú khác nhau', async () => {
    const response = await postOrder({
      visitId: 5,
      idempotencyKey: key,
      lines: [{ ...line, quantity: 2, note: 'ít đá' }, { ...line, quantity: 1, note: 'không đá' }],
    })
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    const [, input] = vi.mocked(createWaiterOrder).mock.calls[0]!
    expect(input.lines).toEqual([
      { ...line, quantity: 2, note: 'ít đá' },
      { ...line, quantity: 1, note: 'không đá' },
    ])
  })

  it('gộp khoảng trắng bên trong ghi chú trước khi lưu', async () => {
    await postOrder({ visitId: 5, idempotencyKey: key, lines: [{ ...line, note: '  ít   đá  ' }] })
    const [, input] = vi.mocked(createWaiterOrder).mock.calls[0]!
    expect(input.lines[0]!.note).toBe('ít đá')
  })

  it('không cho client gửi giá, tên món hay quầy chế biến vào dòng đơn', async () => {
    await postOrder({
      visitId: 5,
      idempotencyKey: key,
      lines: [{ ...line, amountVnd: 1, itemName: 'Giả', preparationStation: 'KITCHEN', unitCode: 'BOTTLE' }],
    })
    const [, input] = vi.mocked(createWaiterOrder).mock.calls[0]!
    expect(Object.keys(input.lines[0]!).sort()).toEqual(['priceId', 'priceVersion', 'quantity', 'variantId'])
  })
})

describe('GET đơn theo Phiên và chi tiết đơn', () => {
  it('đọc đơn theo visitId bằng order.read', async () => {
    vi.mocked(listVisitOrders).mockResolvedValue({
      visitId: 5, tableCodes: ['A1'], orderCount: 0, totalAmountVnd: 0,
      cancelledAmountVnd: 0, netAmountVnd: 0, orders: [],
    })
    const response = await request(app).get('/waiter/visits/5/orders')
    expect(response.status).toBe(200)
    expect(hasPermission).toHaveBeenCalledWith(actor, 'order.read')
    expect(listVisitOrders).toHaveBeenCalledWith(actor, 5)
    expect(response.headers['cache-control']).toBe('private, no-cache')
  })

  it('đọc chi tiết đơn và từ chối mã đơn không hợp lệ', async () => {
    vi.mocked(getWaiterOrder).mockResolvedValue(order)
    expect((await request(app).get('/waiter/orders/55')).status).toBe(200)
    expect(getWaiterOrder).toHaveBeenCalledWith(actor, 55)
    expect((await request(app).get('/waiter/orders/0')).status).toBe(400)
    expect((await request(app).get('/waiter/visits/abc/orders')).status).toBe(400)
  })
})

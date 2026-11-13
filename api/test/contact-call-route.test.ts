import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { app } from '../src/app.js'

/**
 * Ba tuyến gọi khách của đơn chờ và lượt ghé được gắn thật vào router.
 *
 * Chúng sinh ra từ một hàm dùng chung (mountContactCallRoutes), nên lỗi dễ
 * gặp nhất không phải logic mà là quên gắn vào một trong hai router - khi đó
 * nút Gọi khách ở màn Bàn chờ bấm vào chỉ nhận 404.
 */
const unauthenticated = {
  error: { code: 'AUTHENTICATION_REQUIRED', message: 'Vui lòng đăng nhập để tiếp tục.' },
}

describe('contact call routes', () => {
  it.each([
    ['post', '/api/v1/waitlist/1/call'],
    ['post', '/api/v1/waitlist/1/calls/2/outcome'],
    ['post', '/api/v1/visits/1/call'],
    ['post', '/api/v1/visits/1/calls/2/outcome'],
  ])('%s %s fails closed without an authenticated actor', async (_method, path) => {
    const response = await request(app).post(path).set('Origin', 'http://localhost:5173').send({})
    expect(response.status).toBe(401)
    expect(response.body).toEqual(unauthenticated)
  })

  it.each(['/api/v1/waitlist/1/calls', '/api/v1/visits/1/calls'])(
    'GET %s fails closed without an authenticated actor',
    async (path) => {
      const response = await request(app).get(path)
      expect(response.status).toBe(401)
      expect(response.body).toEqual(unauthenticated)
    },
  )
})

import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { app } from '../src/app.js'

describe('POST /api/v1/visits/:id/close', () => {
  it('fails closed before touching the database when no authenticated actor exists', async () => {
    const response = await request(app)
      .post('/api/v1/visits/1/close')
      .send({ version: 1, mode: 'MANUAL', reason: 'GUEST_LEFT' })

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Vui lòng đăng nhập để tiếp tục.',
      },
    })
  })
})

import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { errorHandler } from '../src/middleware/error-handler.js'

describe('BA-005 MySQL concurrency error contract', () => {
  it.each([
    ['ER_LOCK_DEADLOCK', 1213],
    ['ER_LOCK_WAIT_TIMEOUT', 1205],
  ])('maps %s to a retryable 409 without leaking database details', async (code, errno) => {
    const app = express()
    app.get('/failure', () => {
      throw Object.assign(new Error('sensitive SQL detail'), { code, errno })
    })
    app.use(errorHandler)

    const response = await request(app).get('/failure')
    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: {
        code: 'CONCURRENT_UPDATE_RETRY',
        message: 'Có thao tác đồng thời. Vui lòng tải lại và thử lại.',
      },
    })
    expect(response.text).not.toContain('sensitive SQL detail')
  })
})

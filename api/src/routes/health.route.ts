import { Router } from 'express'

import { env } from '../config/env.js'

export const healthRouter: Router = Router()

// appEnv giúp kiểm tra nhanh đang gọi đúng bản nào (curl .../health). Nó không
// lộ gì nhạy cảm: dải băng đỏ trên giao diện Dev đã công bố điều này rồi.
healthRouter.get('/', (_request, response) => {
  response.json({ ok: true, appEnv: env.appEnv })
})

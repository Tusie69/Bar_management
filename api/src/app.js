import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { pool } from './database/pool.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { MySqlTableRepository } from './modules/tables/tableRepository.js'
import { createTableRouter } from './modules/tables/tableRoutes.js'
import { TableService } from './modules/tables/tableService.js'

export const createApp = ({ tableRepository = new MySqlTableRepository(pool) } = {}) => {
  const app = express()
  app.disable('x-powered-by')
  app.use(cors({ origin: env.corsOrigin }))
  app.use(express.json({ limit: '100kb' }))
  app.get('/api/v1/health', (_request, response) => response.json({ ok: true }))
  app.use('/api/v1/tables', createTableRouter(new TableService(tableRepository)))
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

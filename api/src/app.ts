import cors from 'cors'
import express from 'express'

import { env } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import { notFoundHandler } from './middleware/not-found.js'
import { tableRouter } from './modules/tables/table.route.js'
import { healthRouter } from './routes/health.route.js'

export const app = express()

app.disable('x-powered-by')
app.use(cors({ origin: env.webOrigin }))
app.use(express.json({ limit: '1mb' }))

app.use('/api/v1/health', healthRouter)
app.use('/api/v1/tables', tableRouter)

app.use(notFoundHandler)
app.use(errorHandler)


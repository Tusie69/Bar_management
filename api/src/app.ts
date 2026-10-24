import cors from 'cors'
import express from 'express'

import { authRouter } from './auth/auth.route.js'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import { notFoundHandler } from './middleware/not-found.js'
import { bookingRouter } from './modules/bookings/booking.route.js'
import { tableRouter } from './modules/tables/table.route.js'
import { visitRouter } from './modules/visits/visit.route.js'
import { healthRouter } from './routes/health.route.js'

export const app = express()

app.disable('x-powered-by')
app.use(cors({ origin: env.webOrigin, credentials: true }))
app.use(express.json({ limit: '1mb' }))

app.use('/api/v1/health', healthRouter)
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/tables', tableRouter)
app.use('/api/v1/bookings', bookingRouter)
app.use('/api/v1/visits', visitRouter)

app.use(notFoundHandler)
app.use(errorHandler)


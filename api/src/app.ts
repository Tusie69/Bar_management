import cors from 'cors'
import express, { type Express } from 'express'

import { authRouter } from './auth/auth.route.js'
import { requireTrustedOrigin } from './auth/auth.middleware.js'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import { notFoundHandler } from './middleware/not-found.js'
import { billRouter } from './modules/bills/bill.route.js'
import { bookingRouter } from './modules/bookings/booking.route.js'
import { accountRouter } from './modules/accounts/account.route.js'
import { operationRouter } from './modules/operations/operation.route.js'
import { tableRouter } from './modules/tables/table.route.js'
import { visitRouter } from './modules/visits/visit.route.js'
import { waitlistRouter } from './modules/waitlist/waitlist.route.js'
import { settingsRouter, venueSettingsRouter } from './modules/venues/venue-settings.route.js'
import { healthRouter } from './routes/health.route.js'
import { receptionRouter } from './modules/reception/guest-count.route.js'
import { customerHistoryRouter } from './modules/visits/customer-history.route.js'
import { waiterMenuRouter } from './modules/menu/menu.route.js'
import { waiterOrderRouter } from './modules/orders/order.route.js'
import { orderCancellationRouter } from './modules/orders/order-cancellation.route.js'
import { preparationRouter } from './modules/preparation/preparation.route.js'

export const app: Express = express()

app.disable('x-powered-by')
// Sau nginx, req.ip phải là IP của điện thoại chứ không phải 127.0.0.1. Chỉ tin
// đúng số hop đã khai báo: tin tất cả thì bất kỳ ai cũng tự đặt được
// X-Forwarded-For, còn mặc định 0 giữ nguyên hành vi cũ cho dev và test.
if (env.trustProxyHops > 0) app.set('trust proxy', env.trustProxyHops)
app.use(cors({ origin: env.webOrigin, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use('/api/v1', requireTrustedOrigin)

app.use('/api/v1/health', healthRouter)
app.use('/api/v1', customerHistoryRouter)
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/tables', tableRouter)
app.use('/api/v1/bookings', bookingRouter)
app.use('/api/v1/accounts', accountRouter)
app.use('/api/v1/operations', operationRouter)
app.use('/api/v1/visits', visitRouter)
app.use('/api/v1/waitlist', waitlistRouter)
app.use('/api/v1/settings', settingsRouter)
app.use('/api/v1/venues', venueSettingsRouter)
app.use('/api/v1/reception', receptionRouter)
app.use('/api/v1/waiter', waiterMenuRouter)
app.use('/api/v1/waiter', waiterOrderRouter)
app.use('/api/v1/orders', orderCancellationRouter)
app.use('/api/v1/bills', billRouter)
app.use('/api/v1/preparation', preparationRouter)

app.use(notFoundHandler)
app.use(errorHandler)


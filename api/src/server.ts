import { app } from './app.js'
import { env } from './config/env.js'
import { databasePool } from './database/pool.js'
import { startNoShowWorker } from './modules/bookings/no-show.worker.js'

const server = app.listen(env.port, () => {
  console.log(`21GAM API đang chạy tại http://localhost:${env.port}`)
})
const stopNoShowWorker = startNoShowWorker()

function shutdown(signal: string): void {
  console.log(`Nhận ${signal}, đang dừng API...`)

  stopNoShowWorker()
  server.close(() => {
    void databasePool.end().finally(() => process.exit(0))
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))


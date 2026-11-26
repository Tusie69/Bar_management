import { app } from './app.js'
import { env } from './config/env.js'
import { databasePool } from './database/pool.js'
import { startNoShowWorker } from './modules/bookings/no-show.worker.js'
import { startBusinessDayEndWorker } from './modules/visits/business-day.worker.js'
import { loadDevClock } from './modules/dev/dev-clock.repository.js'

// TU-42: nạp độ lệch đã lưu TRƯỚC khi nhận request và trước khi worker chạy,
// để không có khoảnh khắc nào bản Dev trả lời theo giờ thật giữa buổi demo.
await loadDevClock()

const server = app.listen(env.port, () => {
  console.log(`21GAM API đang chạy tại http://localhost:${env.port}`)
})
const stopNoShowWorker = startNoShowWorker()
const stopBusinessDayEndWorker = startBusinessDayEndWorker()

function shutdown(signal: string): void {
  console.log(`Nhận ${signal}, đang dừng API...`)

  stopNoShowWorker()
  stopBusinessDayEndWorker()
  server.close(() => {
    void databasePool.end().finally(() => process.exit(0))
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))


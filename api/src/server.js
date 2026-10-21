import { createApp } from './app.js'
import { env } from './config/env.js'

createApp().listen(env.port, '0.0.0.0', () => {
  console.log(`API đang chạy tại http://localhost:${env.port}`)
})

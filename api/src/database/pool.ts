import type { PoolConnection as CallbackPoolConnection } from 'mysql2'
import mysql from 'mysql2/promise'

import { env } from '../config/env.js'
import { devClockEnabled, mysqlSessionTimestampSql } from '../time/application-clock.js'

export const databasePool = mysql.createPool({
  host: env.database.host,
  port: env.database.port,
  database: env.database.name,
  user: env.database.user,
  password: env.database.password,
  charset: 'utf8mb4',
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: true,
  connectionLimit: 10,
  enableKeepAlive: true,
  waitForConnections: true,
  queueLimit: 0,
})

databasePool.on('connection', (connection) => {
  // mysql2 emits the callback-style connection here even when the pool uses its Promise wrapper.
  const callbackConnection = connection as unknown as CallbackPoolConnection

  callbackConnection.query("SET time_zone = '+00:00'", (timeZoneError) => {
    if (timeZoneError) {
      callbackConnection.destroy()
      return
    }

    callbackConnection.query('SET NAMES utf8mb4', (charsetError) => {
      if (charsetError) callbackConnection.destroy()
    })
  })
})


/**
 * TU-42: trên bản Dev, mỗi lần một kết nối được mượn ra, đặt giờ phiên MySQL
 * theo đồng hồ giả lập. Lệnh này xếp hàng TRƯỚC câu SQL của người mượn trên
 * cùng kết nối (mysql2 phát 'acquire' trước khi trả kết nối), nên NOW(),
 * UTC_TIMESTAMP() và mọi DEFAULT CURRENT_TIMESTAMP đều thấy giờ giả lập.
 *
 * Giới hạn đã biết: khi pool hết kết nối và một yêu cầu phải xếp hàng, mysql2
 * trao thẳng kết nối vừa nhả mà không phát 'acquire' — kết nối đó mang giờ
 * của lần mượn trước, trễ vài giây. Chấp nhận được cho bản Dev.
 *
 * Production không gắn listener này: không một dòng nào ở đây chạy ở đó.
 */
if (devClockEnabled()) {
  databasePool.on('acquire', (connection) => {
    const callbackConnection = connection as unknown as CallbackPoolConnection
    callbackConnection.query(mysqlSessionTimestampSql(), (error) => {
      if (error) console.error('Không đặt được giờ giả lập cho kết nối MySQL.', error)
    })
  })
}

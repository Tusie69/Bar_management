import type { PoolConnection as CallbackPoolConnection } from 'mysql2'
import mysql from 'mysql2/promise'

import { env } from '../config/env.js'

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


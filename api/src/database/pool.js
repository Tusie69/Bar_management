import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

export const pool = mysql.createPool({
  ...env.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
})

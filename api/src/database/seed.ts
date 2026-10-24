import { readFile } from 'node:fs/promises'
import path from 'node:path'

import mysql from 'mysql2/promise'

import { env } from '../config/env.js'

const seedFile = path.resolve(process.cwd(), 'database', 'seeds', 'demo.sql')
const sql = await readFile(seedFile, 'utf8')
const connection = await mysql.createConnection({
  host: env.database.host,
  port: env.database.port,
  database: env.database.name,
  user: env.database.user,
  password: env.database.password,
  charset: 'utf8mb4',
  multipleStatements: true,
})

try {
  await connection.query(sql)
  console.log(`Seed demo đã nhập vào ${env.database.name}`)
} finally {
  await connection.end()
}

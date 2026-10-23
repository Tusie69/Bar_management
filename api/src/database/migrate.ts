import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import mysql from 'mysql2/promise'

import { env } from '../config/env.js'

const migrationsDirectory = path.resolve(process.cwd(), 'database', 'migrations')
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
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (filename)
    ) ENGINE=InnoDB
  `)

  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort()

  for (const filename of filenames) {
    const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      'SELECT checksum FROM schema_migrations WHERE filename = ?',
      [filename],
    )

    if (rows[0]) {
      if (rows[0].checksum !== checksum) {
        throw new Error(`Migration đã bị thay đổi sau khi chạy: ${filename}`)
      }
      console.log(`Bỏ qua ${filename} (đã chạy)`)
      continue
    }

    console.log(`Đang chạy ${filename}`)
    await connection.query(sql)
    await connection.execute(
      'INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)',
      [filename, checksum],
    )
  }

  console.log('Migration hoàn tất')
} finally {
  await connection.end()
}


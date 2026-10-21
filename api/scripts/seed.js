import { pool } from '../src/database/pool.js'
import { runSqlDirectory } from './runSqlDirectory.js'

try {
  await runSqlDirectory(pool, new URL('../../database/seeds/', import.meta.url))
} finally {
  await pool.end()
}

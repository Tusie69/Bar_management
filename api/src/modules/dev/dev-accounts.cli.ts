/**
 * TU-43 — `pnpm dev:accounts`: tạo (hoặc đặt lại) tài khoản mẫu cho MỌI vai
 * trên bản Dev, mật khẩu chung lấy từ DEV_DEMO_PASSWORD trong .env.
 *
 * Chạy lại bao nhiêu lần cũng được: tài khoản đã có thì mở khoá, đưa về đúng
 * vai và đặt lại mật khẩu chung. Không in mật khẩu ra màn hình.
 */
import { env } from '../../config/env.js'
import { databasePool } from '../../database/pool.js'
import { DEV_PASSWORD_MIN_LENGTH, devDemoPassword, ensureDevAccounts } from './dev-accounts.js'

async function main(): Promise<void> {
  if (env.appEnv !== 'dev') {
    throw new Error('dev:accounts chỉ chạy trên bản Dev (APP_ENV=dev).')
  }
  const password = devDemoPassword()
  if (!password) {
    throw new Error(`Chưa khai DEV_DEMO_PASSWORD trong api/.env (tối thiểu ${DEV_PASSWORD_MIN_LENGTH} ký tự).`)
  }
  const connection = await databasePool.getConnection()
  try {
    await connection.beginTransaction()
    const results = await ensureDevAccounts(connection, env.organizationId, env.venueId, password, true)
    await connection.commit()
    console.log(`Tài khoản mẫu trên ${env.database.name} (mật khẩu = DEV_DEMO_PASSWORD trong api/.env):`)
    for (const row of results) {
      console.log(`  ${row.label.padEnd(28)} ${row.username.padEnd(16)} đăng nhập ở ${row.loginPath.padEnd(15)} (${row.action})`)
    }
  } catch (error) {
    await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    connection.release()
    await databasePool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

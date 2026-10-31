import { randomBytes } from 'node:crypto'

// Loaded before application imports. Never borrow deployment phone keys for tests.
if (process.env.RUN_MYSQL_INTEGRATION === '1') {
  if (process.env.DB_NAME !== 'gam21_platform_it_test') {
    throw new Error('MySQL integration tests require DB_NAME=gam21_platform_it_test')
  }
  process.env.PHONE_ENCRYPTION_KEYS = `1:${randomBytes(32).toString('base64')}`
  process.env.PHONE_HMAC_KEYS = `1:${randomBytes(32).toString('base64')}`
  process.env.PHONE_ACTIVE_ENCRYPTION_KEY_ID = '1'
  process.env.PHONE_ACTIVE_HMAC_KEY_ID = '1'
  process.env.PHONE_REVEAL_RATE_LIMIT_MAX = '3'
  process.env.PHONE_REVEAL_RATE_LIMIT_WINDOW_MS = '60000'
  process.env.NO_SHOW_WORKER_ENABLED = 'false'
}

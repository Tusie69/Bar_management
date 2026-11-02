import { env } from '../config/env.js'

/** E2E may freeze server time; every non-test environment always uses the real clock. */
export function applicationNow(): Date {
  return env.test.fixedNow ? new Date(env.test.fixedNow.getTime()) : new Date()
}

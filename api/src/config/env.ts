import 'dotenv/config'

function readNumber(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (!rawValue) return fallback

  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} phải là số nguyên dương`)
  }

  return value
}

function readString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`Thiếu biến môi trường ${name}`)
  return value
}

function readBoolean(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name]
  if (rawValue === undefined || rawValue === '') return fallback
  if (rawValue === 'true') return true
  if (rawValue === 'false') return false
  throw new Error(`${name} phải là true hoặc false`)
}

function readOptionalNumber(name: string): number | undefined {
  const rawValue = process.env[name]
  if (rawValue === undefined || rawValue === '') return undefined
  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} phải là số nguyên dương`)
  return value
}

function readOptionalUtcInstant(name: string): Date | undefined {
  const rawValue = process.env[name]
  if (rawValue === undefined || rawValue === '') return undefined
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(rawValue)) {
    throw new Error(`${name} phải là timestamp ISO-8601 UTC tuyệt đối, ví dụ 2026-10-25T01:13:23.124Z`)
  }
  const value = new Date(rawValue)
  if (Number.isNaN(value.getTime())) throw new Error(`${name} không phải timestamp hợp lệ`)
  return value
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
const webOrigin = readString('WEB_ORIGIN', 'http://localhost:5173')
if (webOrigin === '*' || webOrigin.includes(',')) {
  throw new Error('WEB_ORIGIN phải là một origin cụ thể, không được dùng wildcard hoặc danh sách')
}
try {
  const parsedWebOrigin = new URL(webOrigin)
  if (parsedWebOrigin.origin !== webOrigin) throw new Error('not-an-origin')
} catch {
  throw new Error('WEB_ORIGIN phải là origin hợp lệ, ví dụ https://app.example.com')
}
const sessionCsrfSecret = process.env.SESSION_CSRF_SECRET
if (nodeEnv === 'production' && (!sessionCsrfSecret || sessionCsrfSecret.length < 32)) {
  throw new Error('SESSION_CSRF_SECRET trong production phải có ít nhất 32 ký tự')
}
const sessionSameSite = process.env.SESSION_COOKIE_SAME_SITE ?? 'lax'
if (!['lax', 'strict', 'none'].includes(sessionSameSite)) {
  throw new Error('SESSION_COOKIE_SAME_SITE phải là lax, strict hoặc none')
}
const sessionCookieSecure = readBoolean('SESSION_COOKIE_SECURE', nodeEnv === 'production')
if (nodeEnv === 'production' && !sessionCookieSecure) {
  throw new Error('SESSION_COOKIE_SECURE phải là true trong production')
}
if (sessionSameSite === 'none' && !sessionCookieSecure) {
  throw new Error('SESSION_COOKIE_SECURE phải là true khi SESSION_COOKIE_SAME_SITE=none')
}
const noShowWorkerEnabled = readBoolean('NO_SHOW_WORKER_ENABLED', false)
const noShowSystemUserId = readOptionalNumber('NO_SHOW_SYSTEM_USER_ID')
const noShowAutomationCutoff = readOptionalUtcInstant('NO_SHOW_AUTOMATION_CUTOFF')
if (noShowWorkerEnabled && !noShowSystemUserId) {
  throw new Error('NO_SHOW_SYSTEM_USER_ID là bắt buộc khi NO_SHOW_WORKER_ENABLED=true')
}
if (noShowWorkerEnabled && !noShowAutomationCutoff) {
  throw new Error('NO_SHOW_AUTOMATION_CUTOFF là bắt buộc khi NO_SHOW_WORKER_ENABLED=true')
}

export const env = {
  nodeEnv,
  port: readNumber('PORT', 3000),
  webOrigin,
  organizationId: readNumber('ORGANIZATION_ID', 1),
  venueId: readNumber('VENUE_ID', 1),
  session: {
    cookieName: readString('SESSION_COOKIE_NAME', '21gam_session'),
    ttlHours: readNumber('SESSION_TTL_HOURS', 12),
    csrfSecret: sessionCsrfSecret,
    cookieSecure: sessionCookieSecure,
    sameSite: sessionSameSite as 'lax' | 'strict' | 'none',
  },
  database: {
    host: readString('DB_HOST', '127.0.0.1'),
    port: readNumber('DB_PORT', 3306),
    name: readString('DB_NAME', 'gam21_platform_dev'),
    user: readString('DB_USER', 'gam21'),
    password: readString('DB_PASSWORD', 'gam21_dev'),
  },
  noShowWorker: {
    enabled: noShowWorkerEnabled,
    intervalMs: readNumber('NO_SHOW_WORKER_INTERVAL_MS', 30_000),
    systemUserId: noShowSystemUserId,
    automationCutoff: noShowAutomationCutoff,
  },
} as const


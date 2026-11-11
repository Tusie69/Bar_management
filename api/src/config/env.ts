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

function readNonNegativeInteger(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (rawValue === undefined || rawValue === '') return fallback
  const value = Number(rawValue)
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} phải là số nguyên không âm`)
  return value
}

function readOptionalNumber(name: string): number | undefined {
  const rawValue = process.env[name]
  if (rawValue === undefined || rawValue === '') return undefined
  const value = Number(rawValue)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} phải là số nguyên dương`)
  return value
}

function readKeyRing(name: string): ReadonlyMap<number, Buffer> {
  const rawValue = process.env[name]
  const result = new Map<number, Buffer>()
  if (!rawValue) return result
  for (const item of rawValue.split(',')) {
    const separator = item.indexOf(':')
    const keyId = Number(item.slice(0, separator))
    const encoded = item.slice(separator + 1)
    const key = Buffer.from(encoded, 'base64')
    if (separator < 1 || !Number.isInteger(keyId) || keyId <= 0 || key.length !== 32) {
      throw new Error(`${name} phải có dạng keyId:base64-32-byte, phân cách bằng dấu phẩy`)
    }
    result.set(keyId, key)
  }
  return result
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
const databaseName = readString('DB_NAME', 'gam21_platform_dev')
const e2eFixedNow = readOptionalUtcInstant('E2E_FIXED_NOW')
if (e2eFixedNow && (nodeEnv !== 'test' || !/_test$/.test(databaseName))) {
  throw new Error('E2E_FIXED_NOW chỉ được phép khi NODE_ENV=test và DB_NAME kết thúc bằng _test')
}
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
const noShowPolicyMode = process.env.NO_SHOW_POLICY_MODE ?? 'MANUAL'
if (noShowPolicyMode !== 'MANUAL') {
  throw new Error('NO_SHOW_POLICY_MODE chỉ hỗ trợ MANUAL; hệ thống không tự đóng hoặc giải phóng booking quá hạn')
}
const noShowSystemUserId = readOptionalNumber('NO_SHOW_SYSTEM_USER_ID')
const noShowAutomationCutoff = readOptionalUtcInstant('NO_SHOW_AUTOMATION_CUTOFF')
const businessDayWorkerEnabled = readBoolean('BUSINESS_DAY_WORKER_ENABLED', true)
// §6: merging tables across two zones is OFF until anh Luân decides otherwise.
// Turning it on only skips the cross-zone check; every other merge rule still
// applies, so it is not a blanket permission for any combination of tables.
const allowCrossZoneTableMerge = readBoolean('ALLOW_CROSS_ZONE_TABLE_MERGE', false)
const phoneEncryptionKeys = readKeyRing('PHONE_ENCRYPTION_KEYS')
const phoneHmacKeys = readKeyRing('PHONE_HMAC_KEYS')
const phoneActiveEncryptionKeyId = readOptionalNumber('PHONE_ACTIVE_ENCRYPTION_KEY_ID')
const phoneActiveHmacKeyId = readOptionalNumber('PHONE_ACTIVE_HMAC_KEY_ID')
const phoneRevealRateLimitMax = readOptionalNumber('PHONE_REVEAL_RATE_LIMIT_MAX')
const phoneRevealRateLimitWindowMs = readOptionalNumber('PHONE_REVEAL_RATE_LIMIT_WINDOW_MS')
if ((phoneActiveEncryptionKeyId === undefined) !== (phoneActiveHmacKeyId === undefined)) {
  throw new Error('Phải cấu hình đồng thời PHONE_ACTIVE_ENCRYPTION_KEY_ID và PHONE_ACTIVE_HMAC_KEY_ID')
}
if (phoneActiveEncryptionKeyId !== undefined && !phoneEncryptionKeys.has(phoneActiveEncryptionKeyId)) {
  throw new Error('PHONE_ACTIVE_ENCRYPTION_KEY_ID không tồn tại trong PHONE_ENCRYPTION_KEYS')
}
if (phoneActiveHmacKeyId !== undefined && !phoneHmacKeys.has(phoneActiveHmacKeyId)) {
  throw new Error('PHONE_ACTIVE_HMAC_KEY_ID không tồn tại trong PHONE_HMAC_KEYS')
}
if ((phoneRevealRateLimitMax === undefined) !== (phoneRevealRateLimitWindowMs === undefined)) {
  throw new Error('Phải cấu hình đồng thời PHONE_REVEAL_RATE_LIMIT_MAX và PHONE_REVEAL_RATE_LIMIT_WINDOW_MS')
}
if (noShowWorkerEnabled && !noShowSystemUserId) {
  throw new Error('NO_SHOW_SYSTEM_USER_ID là bắt buộc khi NO_SHOW_WORKER_ENABLED=true')
}
if (noShowWorkerEnabled && !noShowAutomationCutoff) {
  throw new Error('NO_SHOW_AUTOMATION_CUTOFF là bắt buộc khi NO_SHOW_WORKER_ENABLED=true')
}

export const env = {
  nodeEnv,
  port: readNumber('PORT', 3000),
  // Số reverse proxy đứng trước API. 0 nghĩa là không tin header chuyển tiếp
  // nào, nên req.ip không thể bị giả mạo khi API nhận request trực tiếp.
  trustProxyHops: readNonNegativeInteger('TRUST_PROXY_HOPS', 0),
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
    name: databaseName,
    user: readString('DB_USER', 'gam21'),
    password: readString('DB_PASSWORD', 'gam21_dev'),
  },
  noShowWorker: {
    enabled: noShowWorkerEnabled,
    policyMode: noShowPolicyMode as 'MANUAL',
    intervalMs: readNumber('NO_SHOW_WORKER_INTERVAL_MS', 30_000),
    systemUserId: noShowSystemUserId,
    automationCutoff: noShowAutomationCutoff,
  },
  businessDayWorker: {
    enabled: businessDayWorkerEnabled,
    intervalMs: readNumber('BUSINESS_DAY_WORKER_INTERVAL_MS', 30_000),
  },
  tableGroups: {
    allowCrossZoneMerge: allowCrossZoneTableMerge,
  },
  realtime: {
    /** How often the floor-change broadcaster re-reads venues.change_seq. */
    pollIntervalMs: readNumber('REALTIME_POLL_INTERVAL_MS', 500),
    /** Comment frames that keep proxies from closing an idle SSE stream. */
    heartbeatMs: readNumber('REALTIME_HEARTBEAT_MS', 20_000),
  },
  phone: {
    activeEncryptionKeyId: phoneActiveEncryptionKeyId,
    encryptionKeys: phoneEncryptionKeys,
    activeHmacKeyId: phoneActiveHmacKeyId,
    hmacKeys: phoneHmacKeys,
    revealRateLimitMax: phoneRevealRateLimitMax,
    revealRateLimitWindowMs: phoneRevealRateLimitWindowMs,
  },
  test: {
    fixedNow: e2eFixedNow,
  },
} as const


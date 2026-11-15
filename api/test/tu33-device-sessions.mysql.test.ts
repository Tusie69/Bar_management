/**
 * TU-33 — Single Active Session & Device Management.
 *
 * Cơ chế Single Active Session đã có trước sprint này; các test ở đây xác nhận
 * nó không bị phá, và kiểm phần mới: định danh thiết bị, danh sách phiên, buộc
 * đăng xuất từ xa, và sống sót qua restart.
 *
 * Cần `RUN_MYSQL_INTEGRATION=1` và `DB_NAME=gam21_platform_it_test`.
 */
import type { RowDataPacket } from 'mysql2/promise'
import request, { type Agent } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { hashPassword } from '../src/auth/password.js'
import { describeDevice, resolveDeviceId } from '../src/auth/device-identity.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { actor, clearFixture, initializeFixture, resetFixture } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const password = 'TU33-Device-Session-Pass-01'

const ACCOUNTS = [
  { id: 9871, username: 'tu33_owner', role: 'OWNER', accessLevel: null, portal: 'admin' },
  { id: 9872, username: 'tu33_admin_write', role: 'ADMIN', accessLevel: 'WRITE', portal: 'admin' },
  { id: 9873, username: 'tu33_admin_read', role: 'ADMIN', accessLevel: 'READ_ONLY', portal: 'admin' },
  { id: 9874, username: 'tu33_letan', role: 'RECEPTIONIST', accessLevel: null, portal: 'receptionist' },
  { id: 9875, username: 'tu33_thungan', role: 'CASHIER', accessLevel: null, portal: 'cashier' },
  { id: 9876, username: 'tu33_phucvu', role: 'WAITER', accessLevel: null, portal: 'waiter' },
] as const

type Account = typeof ACCOUNTS[number]

interface SessionView {
  sessionId: number
  userId: number
  username: string
  roles: string[]
  portal: string | null
  deviceRef: string | null
  deviceLabel: string | null
  loggedInAt: string
  lastSeenAt: string | null
  status: 'ACTIVE' | 'EXPIRED'
  isCurrent: boolean
}

interface SignedIn {
  agent: Agent
  csrfToken: string
  permissions: string[]
}

async function seedAccounts(): Promise<void> {
  const passwordHash = await hashPassword(password)
  for (const entry of ACCOUNTS) {
    await databasePool.execute(
      'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)',
      [entry.id, entry.username, entry.username, passwordHash],
    )
    await databasePool.execute(
      'INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)',
      [entry.id, actor.organizationId, entry.id],
    )
    await databasePool.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id, access_level)
       SELECT ?, ?, id, ?, ? FROM roles WHERE code = ?`,
      [actor.organizationId, entry.id, actor.venueId, entry.accessLevel, entry.role],
    )
  }
}

/** Đăng nhập, tuỳ chọn khai mã thiết bị và User-Agent như một máy thật. */
async function signIn(
  entry: Account,
  options: { deviceId?: string; userAgent?: string } = {},
): Promise<SignedIn> {
  const agent = request.agent(app)
  let call = agent.post('/api/v1/auth/login').set('Origin', env.webOrigin)
  if (options.deviceId) call = call.set('X-Device-Id', options.deviceId)
  if (options.userAgent) call = call.set('User-Agent', options.userAgent)
  const response = await call.send({ username: entry.username, password, portal: entry.portal })
  expect(response.status, `${entry.username} phải đăng nhập được`).toBe(200)
  const body = response.body as { csrfToken: string; permissions: string[] }
  return { agent, csrfToken: body.csrfToken, permissions: body.permissions }
}

function post(session: SignedIn, path: string, body: Record<string, unknown> = {}) {
  return session.agent.post(path).set('Origin', env.webOrigin)
    .set('X-CSRF-Token', session.csrfToken).send(body)
}

async function listSessions(session: SignedIn) {
  const response = await session.agent.get('/api/v1/auth/sessions').set('Origin', env.webOrigin)
  return { status: response.status, sessions: (response.body as { sessions: SessionView[] }).sessions }
}

function find(username: Account['username']): Account {
  const entry = ACCOUNTS.find((candidate) => candidate.username === username)
  if (!entry) throw new Error(`Không có tài khoản ${username}`)
  return entry
}

describe('TU-33 — định danh thiết bị (thuần, không cần database)', () => {
  it('nhận mã thiết bị client khai và từ chối giá trị rác', () => {
    const valid = 'device-abc12345'
    expect(resolveDeviceId(valid)).toBe(valid)
    // Giá trị rác không gây lỗi đăng nhập, chỉ bị thay bằng mã mới: một
    // localStorage bẩn không nên chặn nhân viên vào hệ thống giữa ca.
    for (const bad of [undefined, '', 'short', 'có dấu', 'a'.repeat(65), '<script>']) {
      const resolved = resolveDeviceId(bad)
      expect(resolved).not.toBe(bad)
      expect(resolved).toMatch(/^[A-Za-z0-9-]{36}$/)
    }
  })

  it('rút gọn User-Agent thành nhãn người đọc được, không lưu nguyên UA', () => {
    const cases: [string, string][] = [
      ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36', 'Chrome trên Android'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1 Version/17.0 Safari/604.1', 'Safari trên iPhone'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36 Edg/120.0', 'Edge trên Windows'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Firefox/121.0', 'Firefox trên macOS'],
    ]
    for (const [agentString, expected] of cases) {
      expect(describeDevice(agentString)).toBe(expected)
    }
    expect(describeDevice(undefined)).toBeNull()
    // Nhãn luôn ngắn hơn UA gốc: đó là mục đích của việc rút gọn.
    const long = 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007) Chrome/120.0'
    expect((describeDevice(long) ?? '').length).toBeLessThan(long.length)
  })
})

mysqlDescribe('TU-33 — quản lý phiên và thiết bị', () => {
  beforeAll(async () => {
    await initializeFixture()
  })
  beforeEach(async () => {
    await resetFixture()
    await seedAccounts()
  })
  afterAll(async () => {
    await clearFixture()
    await databasePool.end()
  })

  describe('1. Định danh thiết bị', () => {
    it('mỗi phiên lưu một mã thiết bị và một nhãn thiết bị', async () => {
      await signIn(find('tu33_letan'), {
        deviceId: 'letan-tablet-001',
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36',
      })
      const [rows] = await databasePool.execute<(RowDataPacket & {
        device_id: string | null; device_label: string | null
      })[]>(
        `SELECT device_id, device_label FROM auth_sessions
         WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL`,
        [actor.organizationId, find('tu33_letan').id],
      )
      expect(rows[0]?.device_id).toBe('letan-tablet-001')
      expect(rows[0]?.device_label).toBe('Chrome trên Android')
    })

    it('sinh mã thiết bị khi client không khai', async () => {
      await signIn(find('tu33_thungan'))
      const [rows] = await databasePool.execute<(RowDataPacket & { device_id: string | null })[]>(
        `SELECT device_id FROM auth_sessions
         WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL`,
        [actor.organizationId, find('tu33_thungan').id],
      )
      expect(rows[0]?.device_id).toMatch(/^[A-Za-z0-9-]{36}$/)
    })

    it('không bao giờ lưu User-Agent gốc vào device_label', async () => {
      const rawAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
      await signIn(find('tu33_letan'), { userAgent: rawAgent })
      const [rows] = await databasePool.execute<(RowDataPacket & { device_label: string | null })[]>(
        `SELECT device_label FROM auth_sessions
         WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL`,
        [actor.organizationId, find('tu33_letan').id],
      )
      expect(rows[0]?.device_label).toBe('Firefox trên Windows')
      expect(rows[0]?.device_label).not.toBe(rawAgent)
    })

    it('mã thiết bị KHÔNG thay được token để xác thực', async () => {
      const session = await signIn(find('tu33_letan'), { deviceId: 'letan-tablet-001' })
      await listSessions(session) // chỉ để chắc phiên đang sống

      // Không cookie, chỉ có header thiết bị: phải là 401.
      const spoofed = await request(app).get('/api/v1/auth/me')
        .set('Origin', env.webOrigin).set('X-Device-Id', 'letan-tablet-001')
      expect(spoofed.status).toBe(401)
    })
  })

  describe('2. Session replacement', () => {
    it('thiết bị B đăng nhập thì A mất quyền gọi API, B vẫn hoạt động', async () => {
      const deviceA = await signIn(find('tu33_letan'), { deviceId: 'thiet-bi-A-0001' })
      expect((await deviceA.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status).toBe(200)

      const deviceB = await signIn(find('tu33_letan'), { deviceId: 'thiet-bi-B-0002' })

      const aAfter = await deviceA.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
      expect(aAfter.status).toBe(401)
      expect((aAfter.body as { error: { code: string } }).error.code).toBe('SESSION_REPLACED')
      // Thông báo tiếng Việt, nói rõ nguyên nhân là thiết bị khác.
      expect((aAfter.body as { error: { message: string } }).error.message).toContain('thiết bị khác')

      const bAfter = await deviceB.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
      expect(bAfter.status).toBe(200)
    })

    it('A không gọi được cả endpoint nghiệp vụ, không chỉ /auth/me', async () => {
      const deviceA = await signIn(find('tu33_letan'), { deviceId: 'thiet-bi-A-0001' })
      await signIn(find('tu33_letan'), { deviceId: 'thiet-bi-B-0002' })
      for (const path of ['/api/v1/tables', '/api/v1/bookings?date=2030-10-24', '/api/v1/auth/me']) {
        const response = await deviceA.agent.get(path).set('Origin', env.webOrigin)
        expect(response.status, `A vẫn gọi được ${path}`).toBe(401)
      }
    })

    it('đăng nhập đồng thời nhiều lần vẫn chỉ còn một phiên sống', async () => {
      // Năm lần đăng nhập song song: login khoá hàng user nên chúng phải xếp
      // hàng, và kết quả cuối cùng chỉ được có đúng một phiên chưa thu hồi.
      await Promise.all(Array.from({ length: 5 }, () => signIn(find('tu33_letan'))))
      const [rows] = await databasePool.execute<(RowDataPacket & { alive: number })[]>(
        `SELECT COUNT(*) AS alive FROM auth_sessions
         WHERE organization_id = ? AND user_id = ? AND revoked_at IS NULL
           AND expires_at > UTC_TIMESTAMP(3)`,
        [actor.organizationId, find('tu33_letan').id],
      )
      expect(Number(rows[0]?.alive)).toBe(1)
    })

    it('chính sách áp dụng cho đủ sáu cấp', async () => {
      for (const entry of ACCOUNTS) {
        const first = await signIn(entry)
        const second = await signIn(entry)
        expect((await first.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status,
          `${entry.username}: phiên cũ phải bị thu hồi`).toBe(401)
        expect((await second.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status,
          `${entry.username}: phiên mới phải còn sống`).toBe(200)
      }
    })

    it('không xoá dữ liệu đã lưu khi phiên bị thay thế', async () => {
      const owner = await signIn(find('tu33_owner'))
      const created = await post(owner, '/api/v1/bookings', {
        guestName: 'Khách TU33', partySize: 2,
        expectedAt: '2030-10-24T21:00:00+07:00', businessDate: '2030-10-24', sourceCode: 'HOTLINE',
      })
      expect(created.status).toBe(201)
      const bookingId = (created.body as { booking: { id: number } }).booking.id

      await signIn(find('tu33_owner')) // thiết bị khác đẩy phiên trên ra

      const [rows] = await databasePool.execute<RowDataPacket[]>(
        'SELECT id FROM reservations WHERE id = ?', [bookingId],
      )
      expect(rows).toHaveLength(1)
    })
  })

  describe('3. Device audit', () => {
    it('ghi lại thiết bị mới và thiết bị bị thay thế, không ghi token', async () => {
      await signIn(find('tu33_letan'), { deviceId: 'thiet-bi-A-0001' })
      await signIn(find('tu33_letan'), { deviceId: 'thiet-bi-B-0002' })

      const [rows] = await databasePool.execute<(RowDataPacket & { changes: unknown })[]>(
        `SELECT changes FROM operation_log
         WHERE action = 'AUTH_SESSION_REVOKED' AND entity_id = ?
         ORDER BY id DESC LIMIT 1`,
        [find('tu33_letan').id],
      )
      expect(rows).toHaveLength(1)
      const serialized = JSON.stringify(rows[0]?.changes)
      expect(serialized).toContain('replacedDevices')
      expect(serialized).toContain('thiet-bi') // mã ngắn của thiết bị bị thay
      expect(serialized).toContain('newDeviceRef')
      // Không bao giờ có token, cookie hay mật khẩu trong audit.
      expect(serialized).not.toContain('token')
      expect(serialized).not.toContain(password)
    })

    it('audit buộc đăng xuất ghi đúng người thực hiện và người bị tác động', async () => {
      const target = await signIn(find('tu33_letan'), { deviceId: 'letan-may-ban-01' })
      const sessions = await listSessions(await signIn(find('tu33_owner')))
      const victim = sessions.sessions.find((entry) => entry.username === 'tu33_letan')
      expect(victim).toBeDefined()
      void target

      const owner = await signIn(find('tu33_owner'))
      const revoked = await post(owner, `/api/v1/auth/sessions/${victim!.sessionId}/revoke`)
      expect(revoked.status).toBe(200)

      const [rows] = await databasePool.execute<(RowDataPacket & {
        actor_user_id: number | null; actor_kind: string; entity_id: number
        reason_code: string; auth_session_id: number | null; changes: unknown
      })[]>(
        `SELECT actor_user_id, actor_kind, entity_id, reason_code, auth_session_id, changes
         FROM operation_log
         WHERE action = 'AUTH_SESSION_FORCE_REVOKED' ORDER BY id DESC LIMIT 1`,
      )
      const row = rows[0]
      expect(row).toBeDefined()
      // Người thực hiện là OWNER, KHÔNG phải người bị đăng xuất. Đây là chốt
      // chính của test: trước TU-33 `recordAuthAudit` suy actor từ `userId`,
      // nên một bản ghi buộc đăng xuất sẽ ghi chính nạn nhân vào vai actor.
      expect(row!.actor_kind).toBe('USER')
      expect(Number(row!.actor_user_id)).toBe(find('tu33_owner').id)
      expect(Number(row!.entity_id)).toBe(find('tu33_letan').id)
      expect(row!.reason_code).toBe('FORCED_LOGOUT')
      expect(Number(row!.auth_session_id)).toBe(victim!.sessionId)
      const serialized = JSON.stringify(row!.changes)
      expect(serialized).toContain('revokedDeviceRef')
      expect(serialized).toContain('letan-ma') // mã ngắn của thiết bị bị thu hồi
      expect(serialized).not.toContain(password)
    })
  })

  describe('4. Active sessions API', () => {
    it('trả danh sách phiên thật với thiết bị, thời điểm và trạng thái', async () => {
      await signIn(find('tu33_letan'), {
        deviceId: 'letan-tablet-001',
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36',
      })
      const owner = await signIn(find('tu33_owner'), { deviceId: 'owner-laptop-0001' })
      const { status, sessions } = await listSessions(owner)

      expect(status).toBe(200)
      const letan = sessions.find((entry) => entry.username === 'tu33_letan')
      expect(letan).toBeDefined()
      expect(letan!.roles).toContain('RECEPTIONIST')
      expect(letan!.portal).toBe('receptionist')
      expect(letan!.deviceRef).toBe('letan-ta') // 8 ký tự đầu
      expect(letan!.deviceLabel).toBe('Chrome trên Android')
      expect(letan!.status).toBe('ACTIVE')
      expect(letan!.isCurrent).toBe(false)
      expect(Date.parse(letan!.loggedInAt)).not.toBeNaN()

      const self = sessions.find((entry) => entry.username === 'tu33_owner')
      expect(self?.isCurrent).toBe(true)
    })

    it('không bao giờ trả token hay digest của token', async () => {
      await signIn(find('tu33_letan'))
      const owner = await signIn(find('tu33_owner'))
      const response = await owner.agent.get('/api/v1/auth/sessions').set('Origin', env.webOrigin)
      const serialized = JSON.stringify(response.body)
      expect(serialized).not.toContain('token_hash')
      expect(serialized).not.toContain('tokenHash')
      expect(serialized).not.toContain('sessionToken')
      expect(response.headers['cache-control']).toContain('no-store')
    })

    it('phản ánh đúng thực tế: phiên bị thay thế biến mất khỏi danh sách', async () => {
      await signIn(find('tu33_letan'), { deviceId: 'thiet-bi-A-0001' })
      const owner = await signIn(find('tu33_owner'))
      const before = await listSessions(owner)
      expect(before.sessions.filter((entry) => entry.username === 'tu33_letan')).toHaveLength(1)

      await signIn(find('tu33_letan'), { deviceId: 'thiet-bi-B-0002' })
      const after = await listSessions(owner)
      const letanSessions = after.sessions.filter((entry) => entry.username === 'tu33_letan')
      expect(letanSessions).toHaveLength(1)
      expect(letanSessions[0]?.deviceRef).toBe('thiet-bi')
    })

    it('ghi mốc hoạt động cuối', async () => {
      const letan = await signIn(find('tu33_letan'))
      // Phiên vừa tạo chưa có last_seen_at; một request đã xác thực đặt nó.
      await letan.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
      // touchSessionActivity cố ý không await trong middleware, nên chờ một
      // nhịp cho lần ghi phụ trợ đó hoàn tất.
      await new Promise((resolve) => setTimeout(resolve, 300))

      const owner = await signIn(find('tu33_owner'))
      const { sessions } = await listSessions(owner)
      const view = sessions.find((entry) => entry.username === 'tu33_letan')
      expect(view?.lastSeenAt).not.toBeNull()
    })

    it('chỉ tài khoản có session.read xem được', async () => {
      for (const username of ['tu33_letan', 'tu33_thungan', 'tu33_phucvu'] as const) {
        const session = await signIn(find(username))
        expect(session.permissions).not.toContain('session.read')
        const response = await session.agent.get('/api/v1/auth/sessions').set('Origin', env.webOrigin)
        expect(response.status, `${username} không được xem danh sách phiên`).toBe(403)
      }
    })

    it('Admin Read-Only xem được danh sách nhưng không buộc đăng xuất', async () => {
      await signIn(find('tu33_letan'))
      const readOnly = await signIn(find('tu33_admin_read'))
      expect(readOnly.permissions).toContain('session.read')
      expect(readOnly.permissions).not.toContain('session.revoke')

      const { status, sessions } = await listSessions(readOnly)
      expect(status).toBe(200)
      const victim = sessions.find((entry) => entry.username === 'tu33_letan')
      expect(victim).toBeDefined()

      const attempt = await post(readOnly, `/api/v1/auth/sessions/${victim!.sessionId}/revoke`)
      expect(attempt.status).toBe(403)
    })
  })

  describe('5. Remote force logout', () => {
    it('OWNER buộc đăng xuất được nhân viên, phiên không tự khôi phục', async () => {
      const letan = await signIn(find('tu33_letan'), { deviceId: 'letan-tablet-001' })
      const owner = await signIn(find('tu33_owner'))
      const { sessions } = await listSessions(owner)
      const victim = sessions.find((entry) => entry.username === 'tu33_letan')!

      const revoked = await post(owner, `/api/v1/auth/sessions/${victim.sessionId}/revoke`)
      expect(revoked.status).toBe(200)
      expect((revoked.body as { revokedSessions: number }).revokedSessions).toBe(1)

      const after = await letan.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
      expect(after.status).toBe(401)
      expect((after.body as { error: { code: string } }).error.code).toBe('SESSION_REVOKED')
      // Thử lại nhiều lần vẫn 401: phiên bị thu hồi không tự khôi phục.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await letan.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status).toBe(401)
      }
      // Và nó rời khỏi danh sách phiên.
      const listed = await listSessions(owner)
      expect(listed.sessions.some((entry) => entry.sessionId === victim.sessionId)).toBe(false)
    })

    it('ADMIN WRITE buộc đăng xuất được nhân viên', async () => {
      await signIn(find('tu33_thungan'))
      const admin = await signIn(find('tu33_admin_write'))
      const { sessions } = await listSessions(admin)
      const victim = sessions.find((entry) => entry.username === 'tu33_thungan')!
      const response = await post(admin, `/api/v1/auth/sessions/${victim.sessionId}/revoke`)
      expect(response.status).toBe(200)
    })

    it('ADMIN không buộc đăng xuất được SuperAdmin → 403', async () => {
      const owner = await signIn(find('tu33_owner'))
      const admin = await signIn(find('tu33_admin_write'))
      const { sessions } = await listSessions(admin)
      const ownerSession = sessions.find((entry) => entry.username === 'tu33_owner')
      expect(ownerSession).toBeDefined()
      void owner

      const response = await post(admin, `/api/v1/auth/sessions/${ownerSession!.sessionId}/revoke`)
      expect(response.status).toBe(403)
      expect((response.body as { error: { code: string } }).error.code).toBe('OWNER_PROTECTED')
    })

    it('ADMIN không buộc đăng xuất được ADMIN khác → 403', async () => {
      const readOnly = await signIn(find('tu33_admin_read'))
      const admin = await signIn(find('tu33_admin_write'))
      const { sessions } = await listSessions(admin)
      const target = sessions.find((entry) => entry.username === 'tu33_admin_read')
      expect(target).toBeDefined()
      void readOnly

      const response = await post(admin, `/api/v1/auth/sessions/${target!.sessionId}/revoke`)
      expect(response.status).toBe(403)
      expect((response.body as { error: { code: string } }).error.code).toBe('ADMIN_TARGET_DENIED')
    })

    it('nhân viên không buộc đăng xuất được ai → 403', async () => {
      const owner = await signIn(find('tu33_owner'))
      const { sessions } = await listSessions(owner)
      const ownerSession = sessions.find((entry) => entry.username === 'tu33_owner')!

      for (const username of ['tu33_letan', 'tu33_thungan', 'tu33_phucvu'] as const) {
        const staff = await signIn(find(username))
        const response = await post(staff, `/api/v1/auth/sessions/${ownerSession.sessionId}/revoke`)
        expect(response.status, `${username} buộc đăng xuất được OWNER`).toBe(403)
      }
    })

    it('không buộc đăng xuất chính mình qua đường này', async () => {
      const owner = await signIn(find('tu33_owner'))
      const { sessions } = await listSessions(owner)
      const self = sessions.find((entry) => entry.isCurrent)!
      const response = await post(owner, `/api/v1/auth/sessions/${self.sessionId}/revoke`)
      expect(response.status).toBe(409)
      expect((response.body as { error: { code: string } }).error.code).toBe('CANNOT_REVOKE_SELF')
    })

    it('buộc đăng xuất hai lần trả 409, không ghi đè lý do thu hồi', async () => {
      await signIn(find('tu33_letan'))
      const owner = await signIn(find('tu33_owner'))
      const { sessions } = await listSessions(owner)
      const victim = sessions.find((entry) => entry.username === 'tu33_letan')!

      expect((await post(owner, `/api/v1/auth/sessions/${victim.sessionId}/revoke`)).status).toBe(200)
      const again = await post(owner, `/api/v1/auth/sessions/${victim.sessionId}/revoke`)
      expect(again.status).toBe(409)

      const [rows] = await databasePool.execute<(RowDataPacket & { revoke_reason: string })[]>(
        'SELECT revoke_reason FROM auth_sessions WHERE id = ?', [victim.sessionId],
      )
      expect(rows[0]?.revoke_reason).toBe('FORCED_LOGOUT')
    })

    it('phiên không tồn tại trả 404', async () => {
      const owner = await signIn(find('tu33_owner'))
      expect((await post(owner, '/api/v1/auth/sessions/99999999/revoke')).status).toBe(404)
    })

    it('buộc đăng xuất cần CSRF header', async () => {
      await signIn(find('tu33_letan'))
      const owner = await signIn(find('tu33_owner'))
      const { sessions } = await listSessions(owner)
      const victim = sessions.find((entry) => entry.username === 'tu33_letan')!
      // Không có X-CSRF-Token.
      const response = await owner.agent.post(`/api/v1/auth/sessions/${victim.sessionId}/revoke`)
        .set('Origin', env.webOrigin).send({})
      expect(response.status).toBe(403)
    })
  })

  describe('6. Server restart', () => {
    it('phiên hợp lệ sống sót khi trạng thái in-process bị mất', async () => {
      const letan = await signIn(find('tu33_letan'), { deviceId: 'letan-tablet-001' })
      expect((await letan.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status).toBe(200)

      // Mô phỏng restart: phiên hợp lệ KHÔNG được nằm trong bộ nhớ process.
      // Nếu nó nằm trong một Map nào đó thì các listener bị xoá dưới đây sẽ
      // làm phiên chết, và test này là chốt bắt đúng thiết kế đó.
      const { notifySessionsRevoked } = await import('../src/auth/session-lifecycle.js')
      notifySessionsRevoked({ sessionIds: [], userId: 0, code: 'SESSION_INVALID' })

      // Cookie cũ vẫn phải dùng được vì nguồn trạng thái là bảng auth_sessions.
      const after = await letan.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
      expect(after.status).toBe(200)
    })

    it('phiên bị thu hồi vẫn bị từ chối sau restart, không dựa vào bộ nhớ', async () => {
      const letan = await signIn(find('tu33_letan'))
      const owner = await signIn(find('tu33_owner'))
      const { sessions } = await listSessions(owner)
      const victim = sessions.find((entry) => entry.username === 'tu33_letan')!
      await post(owner, `/api/v1/auth/sessions/${victim.sessionId}/revoke`)

      // Thu hồi được ghi vào database, nên nó còn hiệu lực kể cả khi không có
      // thông báo in-process nào tới được client.
      const [rows] = await databasePool.execute<(RowDataPacket & { revoked_at: Date | null })[]>(
        'SELECT revoked_at FROM auth_sessions WHERE id = ?', [victim.sessionId],
      )
      expect(rows[0]?.revoked_at).not.toBeNull()
      expect((await letan.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)).status).toBe(401)
    })
  })
})

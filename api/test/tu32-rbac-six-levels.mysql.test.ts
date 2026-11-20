/**
 * TU-32 — sáu cấp tài khoản theo biên bản họp 15/11/2026.
 *
 * Mọi khẳng định ở đây đi qua HTTP thật và database thật. Không mock permission:
 * một test mock sẽ xác nhận đúng cái bảng mà chính nó khai, chứ không xác nhận
 * backend chặn được ai.
 *
 * Cần `RUN_MYSQL_INTEGRATION=1` và `DB_NAME=gam21_platform_it_test`. Không có
 * database test thì cả file skip — và một file skip KHÔNG phải là bằng chứng
 * phân quyền đã đúng.
 */
import request, { type Agent } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  actor, businessDate, clearFixture, initializeFixture, resetFixture,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const password = 'TU32-Six-Level-Password-01'

/** Payload tạo booking theo đúng contract hiện tại của POST /api/v1/bookings. */
function bookingInput(extra: Record<string, unknown> = {}) {
  return {
    partySize: 2,
    expectedAt: `${businessDate}T21:00:00+07:00`,
    businessDate,
    sourceCode: 'HOTLINE',
    ...extra,
  }
}

/** Sáu cấp nghiệp vụ, ánh xạ sang role + access_level + cổng đăng nhập. */
const LEVELS = [
  { level: 1, name: 'SuperAdmin', username: 'tu32_superadmin', role: 'OWNER', accessLevel: null, portal: 'admin' },
  { level: 2, name: 'Admin Edit', username: 'tu32_admin_edit', role: 'ADMIN', accessLevel: 'WRITE', portal: 'admin' },
  { level: 3, name: 'Admin Read-Only', username: 'tu32_admin_read', role: 'ADMIN', accessLevel: 'READ_ONLY', portal: 'admin' },
  { level: 4, name: 'Lễ tân', username: 'tu32_letan', role: 'RECEPTIONIST', accessLevel: null, portal: 'receptionist' },
  { level: 5, name: 'Thu ngân', username: 'tu32_thungan', role: 'CASHIER', accessLevel: null, portal: 'cashier' },
  { level: 6, name: 'Phục vụ', username: 'tu32_phucvu', role: 'WAITER', accessLevel: null, portal: 'waiter' },
] as const

type Level = typeof LEVELS[number]
type Portal = Level['portal']

interface SignedIn {
  agent: Agent
  csrfToken: string
  permissions: string[]
  roles: string[]
  accessLevel: 'WRITE' | 'READ_ONLY' | null
}

async function seedLevels(): Promise<void> {
  const passwordHash = await hashPassword(password)
  let id = 9850
  for (const entry of LEVELS) {
    id += 1
    await databasePool.execute(
      'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)',
      [id, entry.username, entry.name, passwordHash],
    )
    await databasePool.execute(
      'INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)',
      [id, actor.organizationId, id],
    )
    await databasePool.execute(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id, access_level)
       SELECT ?, ?, id, ?, ? FROM roles WHERE code = ?`,
      [actor.organizationId, id, actor.venueId, entry.accessLevel, entry.role],
    )
  }
}

async function signIn(entry: Level): Promise<SignedIn> {
  const agent = request.agent(app)
  const response = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin)
    .send({ username: entry.username, password, portal: entry.portal })
  expect(response.status, `${entry.name} phải đăng nhập được tại /${entry.portal}`).toBe(200)
  const body = response.body as {
    csrfToken: string
    permissions: string[]
    user: { roles: string[]; accessLevel: 'WRITE' | 'READ_ONLY' | null }
  }
  return {
    agent,
    csrfToken: body.csrfToken,
    permissions: body.permissions,
    roles: body.user.roles,
    accessLevel: body.user.accessLevel,
  }
}

function post(session: SignedIn, path: string, body: Record<string, unknown> = {}) {
  return session.agent.post(path).set('Origin', env.webOrigin)
    .set('X-CSRF-Token', session.csrfToken).send(body)
}

/**
 * Đăng nhập tại một cổng tuỳ ý bằng mật khẩu của sáu tài khoản TU-32.
 *
 * Không dùng `loginAtPortal` của fixture: helper đó gửi mật khẩu fixture, nên
 * với các tài khoản seed ở đây nó trả 401 INVALID_CREDENTIALS và mọi assertion
 * "sai cổng phải 403" sẽ đúng vì lý do sai.
 */
function attemptLogin(username: string, portal: Portal | 'customer-care') {
  return request(app).post('/api/v1/auth/login').set('Origin', env.webOrigin)
    .send({ username, password, portal })
}

function find(level: number): Level {
  const entry = LEVELS.find((candidate) => candidate.level === level)
  if (!entry) throw new Error(`Không có cấp ${level}`)
  return entry
}

mysqlDescribe('TU-32 — sáu cấp tài khoản', () => {
  beforeAll(async () => {
    await initializeFixture()
  })
  beforeEach(async () => {
    await resetFixture()
    await seedLevels()
  })
  afterAll(async () => {
    await clearFixture()
    await databasePool.end()
  })

  describe('1. Sáu cấp phân biệt đúng permission', () => {
    it('mỗi cấp đăng nhập được và nhận một bộ permission riêng', async () => {
      const seen = new Map<string, string>()
      for (const entry of LEVELS) {
        const session = await signIn(entry)
        expect(session.roles, `${entry.name} phải mang role ${entry.role}`).toContain(entry.role)
        expect(session.accessLevel).toBe(entry.accessLevel)
        const signature = [...session.permissions].sort().join(',')
        // Hai cấp trùng y nguyên bộ permission nghĩa là một trong hai cấp chưa
        // tồn tại thật, chỉ tồn tại trên giấy.
        const duplicate = seen.get(signature)
        expect(duplicate, `${entry.name} có bộ permission trùng ${duplicate ?? ''}`).toBeUndefined()
        seen.set(signature, entry.name)
      }
      expect(seen.size).toBe(6)
    })

    it('SuperAdmin có toàn quyền kể cả cấu hình và xem SĐT đầy đủ', async () => {
      const session = await signIn(find(1))
      for (const permission of ['venue.configure', 'user.manage', 'booking.phone.reveal',
        'customer.phone.reveal', 'audit.read', 'report.read']) {
        expect(session.permissions, `SuperAdmin phải có ${permission}`).toContain(permission)
      }
    })

    it('Phục vụ chỉ gọi món và dọn chỗ cho Phiên đang có khách', async () => {
      const session = await signIn(find(6))
      // Module Phục vụ 1 (migration 0032) thêm ba quyền đổi / ghép / tách, và
      // chỉ ba quyền đó: chúng đều gắn vào một Visit đang mở. `table.group.manage`
      // là quyền xếp mặt bằng trên cụm bàn trống và vẫn thuộc Lễ tân.
      expect([...session.permissions].sort()).toEqual([
        'order.cancel.request', 'order.create', 'order.line.adjust', 'order.read',
        'preparation.ready.acknowledge', 'preparation.ready.read',
        'visit.combine', 'visit.move', 'visit.split',
      ])
      // Biên bản không cấp cho Phục vụ quyền nào về khách hàng, kể cả 3 số cuối.
      expect(session.permissions).not.toContain('customer.view_masked')
      expect(session.permissions).not.toContain('booking.phone.call')
      expect(session.permissions).not.toContain('table.group.manage')
    })

    it('Thu ngân lên đơn và thu tiền nhưng không đặt bàn', async () => {
      const session = await signIn(find(5))
      for (const permission of ['order.create', 'order.read', 'payment.collect',
        'visit.end', 'visit.mark_paid']) {
        expect(session.permissions, `Thu ngân phải có ${permission}`).toContain(permission)
      }
      for (const permission of ['reservation.create', 'reservation.update',
        'reservation.cancel', 'table.assign']) {
        expect(session.permissions, `Thu ngân KHÔNG được có ${permission}`).not.toContain(permission)
      }
    })

    it('Lễ tân đặt bàn nhưng không lên đơn hay thanh toán', async () => {
      const session = await signIn(find(4))
      for (const permission of ['reservation.create', 'table.assign', 'visit.checkin',
        'visit.walkin', 'table.group.manage', 'table.spare.configure']) {
        expect(session.permissions, `Lễ tân phải có ${permission}`).toContain(permission)
      }
      for (const permission of ['order.create', 'payment.collect', 'visit.mark_paid',
        'venue.configure', 'user.manage']) {
        expect(session.permissions, `Lễ tân KHÔNG được có ${permission}`).not.toContain(permission)
      }
    })
  })

  describe('2. Portal login — không ai vào cổng của vai khác', () => {
    it.each(LEVELS.map((entry) => [entry.name, entry.username, entry.portal] as const))(
      '%s đăng nhập được tại cổng của mình',
      async (_name, username, portal) => {
        const response = await attemptLogin(username, portal)
        expect(response.status).toBe(200)
      },
    )

    it('Thu ngân đăng nhập /admin bị từ chối', async () => {
      const response = await attemptLogin('tu32_thungan', 'admin')
      expect(response.status).toBe(403)
      expect((response.body as { error: { code: string } }).error.code).toBe('PORTAL_ACCESS_DENIED')
    })

    it('Lễ tân đăng nhập sai cổng bị từ chối ở mọi cổng khác', async () => {
      for (const portal of ['admin', 'cashier', 'waiter', 'customer-care'] as const) {
        const response = await attemptLogin('tu32_letan', portal)
        expect(response.status, `Lễ tân không được vào /${portal}`).toBe(403)
      }
    })

    it('Phục vụ không vào được cổng quản trị, thu ngân hay lễ tân', async () => {
      for (const portal of ['admin', 'cashier', 'receptionist'] as const) {
        const response = await attemptLogin('tu32_phucvu', portal)
        expect(response.status, `Phục vụ không được vào /${portal}`).toBe(403)
      }
    })

    it('mọi cặp cấp × cổng sai đều bị chặn', async () => {
      // Quét toàn bộ ma trận thay vì vài trường hợp lẻ: một cổng mới thêm sau
      // này mà quên mapping sẽ lộ ra ở đây.
      const portals: Portal[] = ['admin', 'receptionist', 'cashier', 'waiter']
      for (const entry of LEVELS) {
        for (const portal of portals) {
          const response = await attemptLogin(entry.username, portal)
          const expected = entry.portal === portal ? 200 : 403
          expect(response.status, `${entry.name} tại /${portal}`).toBe(expected)
        }
      }
    })

    it('cổng không tồn tại bị từ chối chứ không rơi về cổng mặc định', async () => {
      const response = await request(app).post('/api/v1/auth/login').set('Origin', env.webOrigin)
        .send({ username: 'tu32_superadmin', password, portal: 'super-admin' })
      expect(response.status).toBe(400)
    })
  })

  describe('3. Admin Edit không cấu hình và không phân quyền', () => {
    it('không đổi được cấu hình venue', async () => {
      const session = await signIn(find(2))
      expect(session.permissions).not.toContain('venue.configure')
      const response = await session.agent.patch(`/api/v1/venues/${env.venueId}/settings`)
        .set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken)
        .send({ upcomingWarningMinutes: 45 })
      expect([403, 404]).toContain(response.status)
    })

    it('không tạo được tài khoản ADMIN', async () => {
      const session = await signIn(find(2))
      const response = await post(session, '/api/v1/accounts', {
        username: 'tu32_admin_moi', displayName: 'Admin mới',
        password: 'TU32-New-Admin-Password-9', roleCode: 'ADMIN', accessLevel: 'WRITE',
      })
      expect(response.status).toBe(403)
      expect((response.body as { error: { code: string } }).error.code).toBe('ADMIN_CREATION_DENIED')
    })

    it('không đổi được access level của ADMIN khác', async () => {
      const superAdmin = await signIn(find(1))
      const adminEdit = await signIn(find(2))
      const list = await superAdmin.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
      const target = (list.body as { accounts: { id: number; username: string; version: number }[] })
        .accounts.find((account) => account.username === 'tu32_admin_read')
      expect(target).toBeDefined()

      const response = await post(adminEdit, `/api/v1/accounts/${target!.id}/access-level`,
        { accessLevel: 'WRITE', version: target!.version })
      expect(response.status).toBe(403)
      // Chốt thật nằm ở repository, không ở permission: ADMIN có user.manage
      // nên đi qua được middleware rồi mới bị authority chặn.
      expect(['ADMIN_ACCESS_DENIED', 'ADMIN_TARGET_DENIED'])
        .toContain((response.body as { error: { code: string } }).error.code)
    })

    it('không quản lý được tài khoản OWNER', async () => {
      const superAdmin = await signIn(find(1))
      const adminEdit = await signIn(find(2))
      const list = await superAdmin.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
      const target = (list.body as { accounts: { id: number; username: string; version: number }[] })
        .accounts.find((account) => account.username === 'tu32_superadmin')
      expect(target).toBeDefined()

      const response = await post(adminEdit, `/api/v1/accounts/${target!.id}/status`,
        { status: 'DISABLED', version: target!.version })
      expect(response.status).toBe(403)
      expect((response.body as { error: { code: string } }).error.code).toBe('OWNER_PROTECTED')
    })

    it('chỉ được gán vai trò nhân viên, không gán được ADMIN hay OWNER', async () => {
      const session = await signIn(find(2))
      const response = await session.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
      expect(response.status).toBe(200)
      const roles = (response.body as { roles: { code: string }[] }).roles.map((role) => role.code)
      expect(roles).not.toContain('ADMIN')
      expect(roles).not.toContain('OWNER')
      expect(roles.sort()).toEqual(['CASHIER', 'CUSTOMER_CARE', 'RECEPTIONIST', 'WAITER'])
    })
  })

  describe('4. Admin Read-Only không thực hiện mutation nào', () => {
    it('xem được danh sách nhưng không tạo tài khoản', async () => {
      const session = await signIn(find(3))
      expect(session.permissions).toContain('user.read')
      const read = await session.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
      expect(read.status).toBe(200)

      const write = await post(session, '/api/v1/accounts', {
        username: 'tu32_tao_boi_read_only', displayName: 'Không được phép',
        password: 'TU32-Read-Only-Attempt-7', roleCode: 'RECEPTIONIST',
      })
      expect(write.status).toBe(403)
      // Hai chốt chặn nối tiếp nhau và chốt nào bắt trước cũng được:
      // `listPermissions` đã loại user.manage khỏi READ_ONLY nên middleware
      // requirePermission trả PERMISSION_DENIED; nếu permission có lọt qua thì
      // `requireWrite` trong repository trả READ_ONLY_ACCOUNT.
      expect(['PERMISSION_DENIED', 'READ_ONLY_ACCOUNT'])
        .toContain((write.body as { error: { code: string } }).error.code)
    })

    it('không có permission ghi nào trong bộ permission trả về', async () => {
      const session = await signIn(find(3))
      const writePermissions = [
        'reservation.create', 'reservation.update', 'reservation.cancel',
        'table.assign', 'visit.checkin', 'visit.walkin', 'visit.move', 'visit.end',
        'waitlist.create', 'hold.release', 'user.manage', 'venue.configure',
        'operation.undo', 'order.create', 'payment.collect',
      ]
      for (const permission of writePermissions) {
        expect(session.permissions, `Admin Read-Only KHÔNG được có ${permission}`)
          .not.toContain(permission)
      }
    })

    it('không tạo được booking', async () => {
      const session = await signIn(find(3))
      const response = await post(session, '/api/v1/bookings', {
        guestName: 'Khách thử', ...bookingInput(),
      })
      expect(response.status).toBe(403)
    })

    it('không nhả bàn được', async () => {
      const session = await signIn(find(3))
      const response = await post(session, '/api/v1/visits/1/close', { reason: 'GUEST_LEFT' })
      expect(response.status).toBe(403)
    })
  })

  describe('5. Lễ tân chỉ nhận 3 số cuối SĐT', () => {
    it('không có quyền xem SĐT gốc', async () => {
      const session = await signIn(find(4))
      expect(session.permissions).toContain('customer.view_masked')
      expect(session.permissions).not.toContain('booking.phone.reveal')
      expect(session.permissions).not.toContain('customer.phone.reveal')
    })

    it('danh sách booking không chứa SĐT đầy đủ', async () => {
      const superAdmin = await signIn(find(1))
      const created = await post(superAdmin, '/api/v1/bookings', {
        guestName: 'Khách TU32', phoneNumber: '0912345678', ...bookingInput(),
      })
      expect(created.status).toBe(201)

      const session = await signIn(find(4))
      const list = await session.agent.get(`/api/v1/bookings?date=${businessDate}`)
        .set('Origin', env.webOrigin)
      expect(list.status).toBe(200)
      // Chốt mạnh nhất: toàn bộ payload không được chứa chuỗi SĐT gốc ở bất kỳ
      // trường nào, kể cả một trường mới ai đó thêm sau này mà quên masking.
      expect(JSON.stringify(list.body)).not.toContain('0912345678')
    })
  })

  describe('6. Không có privilege escalation', () => {
    it('không ai tự nâng quyền cho chính mình', async () => {
      const superAdmin = await signIn(find(1))
      const list = await superAdmin.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
      const accounts = (list.body as { accounts: { id: number; username: string; version: number }[] }).accounts

      for (const entry of [find(2), find(4), find(5), find(6)]) {
        const self = accounts.find((account) => account.username === entry.username)
        if (!self) continue
        const session = await signIn(entry)
        const response = await post(session, `/api/v1/accounts/${self.id}/access-level`,
          { accessLevel: 'WRITE', version: self.version })
        expect([403, 409], `${entry.name} tự nâng quyền`).toContain(response.status)
      }
    })

    it('permission được kiểm ở backend, không chỉ ẩn nút', async () => {
      // Phục vụ gọi thẳng endpoint đặt bàn, bỏ qua mọi UI.
      const session = await signIn(find(6))
      const response = await post(session, '/api/v1/bookings', {
        guestName: 'Phục vụ tự đặt', ...bookingInput(),
      })
      expect(response.status).toBe(403)
    })

    it('Phục vụ không chốt được thanh toán', async () => {
      const session = await signIn(find(6))
      expect(session.permissions).not.toContain('payment.collect')
      expect(session.permissions).not.toContain('visit.mark_paid')
      const response = await post(session, '/api/v1/visits/1/close', { reason: 'GUEST_LEFT' })
      expect(response.status).toBe(403)
    })

    it('nhân viên không truy cập được module ngoài vai trò', async () => {
      for (const entry of [find(4), find(5), find(6)]) {
        const session = await signIn(entry)
        const accounts = await session.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
        expect(accounts.status, `${entry.name} không được đọc danh sách tài khoản`).toBe(403)
      }
    })
  })

  describe('7. RBAC không phá Single Active Session', () => {
    it('mỗi cấp vẫn chỉ có một phiên hoạt động', async () => {
      for (const entry of LEVELS) {
        const first = await signIn(entry)
        const second = await signIn(entry)

        const afterReplace = await first.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
        expect(afterReplace.status, `${entry.name}: phiên cũ phải bị thu hồi`).toBe(401)
        const stillAlive = await second.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
        expect(stillAlive.status, `${entry.name}: phiên mới phải còn sống`).toBe(200)
      }
    })
  })
})

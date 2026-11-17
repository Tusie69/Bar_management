/**
 * TU-34 — Tài khoản & phân quyền, phần đi qua database.
 *
 * Chạy khi RUN_MYSQL_INTEGRATION=1 trên database tên *_test. Các test ở đây
 * trả lời đúng những câu mà màn hình đặt ra: quyền hiệu dụng có chặn được
 * endpoint thật không, mật khẩu tạm có bắt buộc đổi không, và một tick
 * checkbox có rò sang tài khoản khác cùng vai trò không.
 */
import type { RowDataPacket } from 'mysql2/promise'
import request, { type Agent } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import { clearFixture, initializeFixture, login, resetFixture } from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

interface Account {
  id: number
  username: string
  roles: string[]
  status: 'ACTIVE' | 'DISABLED'
  version: number
}

interface PermissionView {
  code: string
  grantedByRole: boolean
  enabled: boolean
  overridden: boolean
  editable: boolean
  grantable: boolean
}

interface Session {
  agent: Agent
  csrfToken: string
}

function post(session: Session, path: string, body: Record<string, unknown>) {
  return session.agent.post(path).set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send(body)
}

async function signIn(username: string, password: string, portal: string): Promise<Session> {
  const agent = request.agent(app)
  const response = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin)
    .send({ username, password, portal })
  expect(response.status).toBe(200)
  return { agent, csrfToken: (response.body as { csrfToken: string }).csrfToken }
}

async function createStaff(owner: Session, username: string, roleCode = 'RECEPTIONIST') {
  const response = await post(owner, '/api/v1/accounts', { username, displayName: username, roleCode })
  expect(response.status).toBe(201)
  return response.body as { account: Account; temporaryPassword: string }
}

async function permissionsOf(session: Session, userId: number): Promise<PermissionView[]> {
  const response = await session.agent.get(`/api/v1/accounts/${userId}/permissions`).set('Origin', env.webOrigin)
  expect(response.status).toBe(200)
  return (response.body as { permissions: PermissionView[] }).permissions
}

function view(permissions: PermissionView[], code: string): PermissionView {
  const found = permissions.find((permission) => permission.code === code)
  expect(found, `permission ${code}`).toBeDefined()
  return found!
}

mysqlDescribe('TU-34 · quyền riêng từng tài khoản', () => {
  let owner: Session

  beforeAll(async () => {
    await initializeFixture()
  })

  afterAll(async () => {
    await clearFixture()
  })

  beforeEach(async () => {
    await resetFixture()
    owner = await login('integration_owner')
  })

  it('tài khoản mới dùng mật khẩu tạm và bị buộc đổi trước khi dùng API nghiệp vụ', async () => {
    const created = await createStaff(owner, 'tu34_letan')
    expect(created.temporaryPassword).toMatch(/^[A-Za-z2-9]{16}$/)

    // Đăng nhập được ở đúng cổng của vai trò.
    const staff = await signIn('tu34_letan', created.temporaryPassword, 'receptionist')
    const me = await staff.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
    expect(me.status).toBe(200)
    expect((me.body as { mustChangePassword: boolean }).mustChangePassword).toBe(true)

    // Nhưng mọi endpoint nghiệp vụ bị chặn cho tới khi đổi mật khẩu.
    const blocked = await staff.agent.get('/api/v1/bookings?date=2030-10-24').set('Origin', env.webOrigin)
    expect(blocked.status).toBe(403)
    expect((blocked.body as { error: { code: string } }).error.code).toBe('PASSWORD_CHANGE_REQUIRED')

    const changed = await post(staff, '/api/v1/accounts/me/password', {
      currentPassword: created.temporaryPassword,
      newPassword: 'TU34-Staff-Password-01',
    })
    expect(changed.status).toBe(200)

    // Đổi mật khẩu thu hồi phiên; đăng nhập lại thì dùng được bình thường.
    const after = await signIn('tu34_letan', 'TU34-Staff-Password-01', 'receptionist')
    const allowed = await after.agent.get('/api/v1/bookings?date=2030-10-24').set('Origin', env.webOrigin)
    expect(allowed.status).toBe(200)
  })

  it('khóa tài khoản làm phiên đang hoạt động mất hiệu lực và không đăng nhập lại được', async () => {
    const created = await createStaff(owner, 'tu34_locked')
    const staff = await signIn('tu34_locked', created.temporaryPassword, 'receptionist')
    await post(staff, '/api/v1/accounts/me/password', {
      currentPassword: created.temporaryPassword, newPassword: 'TU34-Locked-Password-1',
    })
    const live = await signIn('tu34_locked', 'TU34-Locked-Password-1', 'receptionist')

    const accounts = await owner.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
    const target = (accounts.body as { accounts: Account[] }).accounts.find((item) => item.username === 'tu34_locked')!
    const locked = await post(owner, `/api/v1/accounts/${target.id}/status`, {
      version: target.version, status: 'DISABLED',
    })
    expect(locked.status).toBe(200)

    const afterLock = await live.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
    expect(afterLock.status).toBe(401)
    const relogin = await request(app).post('/api/v1/auth/login').set('Origin', env.webOrigin)
      .send({ username: 'tu34_locked', password: 'TU34-Locked-Password-1', portal: 'receptionist' })
    expect(relogin.status).toBe(401)
  })

  it('tắt một quyền làm endpoint tương ứng trả 403, không chỉ ẩn nút', async () => {
    const created = await createStaff(owner, 'tu34_effective')
    const staff = await signIn('tu34_effective', created.temporaryPassword, 'receptionist')
    await post(staff, '/api/v1/accounts/me/password', {
      currentPassword: created.temporaryPassword, newPassword: 'TU34-Effective-Pass-1',
    })
    const working = await signIn('tu34_effective', 'TU34-Effective-Pass-1', 'receptionist')
    expect((await working.agent.get('/api/v1/bookings?date=2030-10-24').set('Origin', env.webOrigin)).status).toBe(200)

    const accounts = await owner.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
    const target = (accounts.body as { accounts: Account[] }).accounts
      .find((item) => item.username === 'tu34_effective')!
    const saved = await post(owner, `/api/v1/accounts/${target.id}/permissions`, {
      version: target.version,
      permissions: { 'customer.view_masked': false },
    })
    expect(saved.status).toBe(200)

    // Phiên cũ vẫn hợp lệ, nhưng quyền được tính lại trên từng request.
    const denied = await working.agent.get('/api/v1/bookings?date=2030-10-24').set('Origin', env.webOrigin)
    expect(denied.status).toBe(403)

    const views = await permissionsOf(owner, target.id)
    expect(view(views, 'customer.view_masked')).toMatchObject({
      grantedByRole: true, enabled: false, overridden: true,
    })
  })

  it('sửa quyền một tài khoản không ảnh hưởng tài khoản khác cùng vai trò', async () => {
    const first = await createStaff(owner, 'tu34_one')
    const second = await createStaff(owner, 'tu34_two')
    const saved = await post(owner, `/api/v1/accounts/${first.account.id}/permissions`, {
      version: first.account.version,
      permissions: { 'customer.view_masked': false },
    })
    expect(saved.status).toBe(200)

    expect(view(await permissionsOf(owner, first.account.id), 'customer.view_masked').enabled).toBe(false)
    expect(view(await permissionsOf(owner, second.account.id), 'customer.view_masked').enabled).toBe(true)
  })

  it('SuperAdmin cấp thêm được quyền ngoài vai trò, và quyền đó có hiệu lực thật', async () => {
    const created = await createStaff(owner, 'tu34_grant')
    const granted = await post(owner, `/api/v1/accounts/${created.account.id}/permissions`, {
      version: created.account.version,
      permissions: { 'report.read': true },
    })
    expect(granted.status).toBe(200)
    expect(view(await permissionsOf(owner, created.account.id), 'report.read'))
      .toMatchObject({ grantedByRole: false, enabled: true, overridden: true, grantable: true })

    // Quyền hiệu dụng của chính tài khoản đó, nhìn từ phiên của họ.
    const staff = await signIn('tu34_grant', created.temporaryPassword, 'receptionist')
    await post(staff, '/api/v1/accounts/me/password', {
      currentPassword: created.temporaryPassword, newPassword: 'TU34-Grant-Password-1',
    })
    const working = await signIn('tu34_grant', 'TU34-Grant-Password-1', 'receptionist')
    const me = await working.agent.get('/api/v1/auth/me').set('Origin', env.webOrigin)
    expect((me.body as { permissions: string[] }).permissions).toContain('report.read')
  })

  it('không cấp được việc của riêng SuperAdmin cho ai', async () => {
    const staff = await createStaff(owner, 'tu34_ceiling')
    for (const code of ['venue.configure', 'customer.anonymize']) {
      const response = await post(owner, `/api/v1/accounts/${staff.account.id}/permissions`, {
        version: staff.account.version,
        permissions: { [code]: true },
      })
      expect(response.status, code).toBe(400)
      expect((response.body as { error: { code: string } }).error.code).toBe('PERMISSION_NOT_GRANTABLE')
    }
  })

  it('không cấp được quyền ghi cho Admin Read-Only', async () => {
    const created = await post(owner, '/api/v1/accounts', {
      username: 'tu34_ro_ceiling', displayName: 'RO Ceiling', roleCode: 'ADMIN', accessLevel: 'READ_ONLY',
    })
    expect(created.status).toBe(201)
    const account = (created.body as { account: Account }).account
    const denied = await post(owner, `/api/v1/accounts/${account.id}/permissions`, {
      version: account.version, permissions: { 'reservation.cancel': true },
    })
    expect(denied.status).toBe(400)
    expect((denied.body as { error: { code: string } }).error.code).toBe('PERMISSION_NOT_GRANTABLE')

    // Nhưng quyền đọc thì cấp thêm được.
    const allowed = await post(owner, `/api/v1/accounts/${account.id}/permissions`, {
      version: account.version, permissions: { 'audit.read': true },
    })
    expect(allowed.status).toBe(200)
  })

  it('Admin Edit không dùng được chức năng phân quyền; SuperAdmin thì được', async () => {
    const adminEdit = await post(owner, '/api/v1/accounts', {
      username: 'tu34_admin_edit', displayName: 'Admin Edit', roleCode: 'ADMIN', accessLevel: 'WRITE',
    })
    expect(adminEdit.status).toBe(201)
    const other = await post(owner, '/api/v1/accounts', {
      username: 'tu34_admin_other', displayName: 'Admin Other', roleCode: 'ADMIN', accessLevel: 'WRITE',
    })
    expect(other.status).toBe(201)
    const editBody = adminEdit.body as { account: Account; temporaryPassword: string }
    const otherBody = other.body as { account: Account; temporaryPassword: string }

    const session = await signIn('tu34_admin_edit', editBody.temporaryPassword, 'admin')
    await post(session, '/api/v1/accounts/me/password', {
      currentPassword: editBody.temporaryPassword, newPassword: 'TU34-AdminEdit-Pass-1',
    })
    const admin = await signIn('tu34_admin_edit', 'TU34-AdminEdit-Pass-1', 'admin')

    const denied = await post(admin, `/api/v1/accounts/${otherBody.account.id}/permissions`, {
      version: otherBody.account.version, permissions: { 'report.read': false },
    })
    expect(denied.status).toBe(403)
    expect((denied.body as { error: { code: string } }).error.code).toBe('PERMISSION_MANAGEMENT_DENIED')

    // TU-32 AC: cấp 2 không phân quyền cho AI CẢ, kể cả nhân viên, và cũng
    // không xem được bảng quyền.
    const staff = await createStaff(owner, 'tu34_admin_edit_staff')
    const deniedStaff = await post(admin, `/api/v1/accounts/${staff.account.id}/permissions`, {
      version: staff.account.version, permissions: { 'customer.view_masked': false },
    })
    expect(deniedStaff.status).toBe(403)
    const deniedRead = await admin.agent.get(`/api/v1/accounts/${staff.account.id}/permissions`)
      .set('Origin', env.webOrigin)
    expect(deniedRead.status).toBe(403)

    const allowed = await post(owner, `/api/v1/accounts/${otherBody.account.id}/permissions`, {
      version: otherBody.account.version, permissions: { 'report.read': false },
    })
    expect(allowed.status).toBe(200)
  })

  it('Admin Read-Only không xem và không lưu được bảng quyền', async () => {
    const readOnly = await post(owner, '/api/v1/accounts', {
      username: 'tu34_admin_ro', displayName: 'Admin RO', roleCode: 'ADMIN', accessLevel: 'READ_ONLY',
    })
    expect(readOnly.status).toBe(201)
    const body = readOnly.body as { account: Account; temporaryPassword: string }
    const first = await signIn('tu34_admin_ro', body.temporaryPassword, 'admin')
    await post(first, '/api/v1/accounts/me/password', {
      currentPassword: body.temporaryPassword, newPassword: 'TU34-AdminRO-Pass-01',
    })
    const session = await signIn('tu34_admin_ro', 'TU34-AdminRO-Pass-01', 'admin')
    const staff = await createStaff(owner, 'tu34_ro_target')

    // Admin Read-Only cũng không thuộc nhóm được phân quyền.
    const read = await session.agent.get(`/api/v1/accounts/${staff.account.id}/permissions`)
      .set('Origin', env.webOrigin)
    expect(read.status).toBe(403)

    const write = await post(session, `/api/v1/accounts/${staff.account.id}/permissions`, {
      version: staff.account.version, permissions: { 'customer.view_masked': false },
    })
    expect(write.status).toBe(403)
  })

  it('không tự đổi được quyền của chính mình', async () => {
    const accounts = await owner.agent.get('/api/v1/accounts').set('Origin', env.webOrigin)
    const self = (accounts.body as { accounts: Account[] }).accounts
      .find((item) => item.username === 'integration_owner')!
    const response = await post(owner, `/api/v1/accounts/${self.id}/permissions`, {
      version: self.version, permissions: { 'report.read': false },
    })
    expect(response.status).toBe(409)
    expect((response.body as { error: { code: string } }).error.code).toBe('CANNOT_MANAGE_SELF')
  })

  it('version cũ không ghi đè thay đổi mới', async () => {
    const staff = await createStaff(owner, 'tu34_version')
    const firstSave = await post(owner, `/api/v1/accounts/${staff.account.id}/permissions`, {
      version: staff.account.version, permissions: { 'customer.view_masked': false },
    })
    expect(firstSave.status).toBe(200)

    const stale = await post(owner, `/api/v1/accounts/${staff.account.id}/permissions`, {
      version: staff.account.version, permissions: { 'customer.view_masked': true },
    })
    expect(stale.status).toBe(409)
    expect((stale.body as { error: { code: string } }).error.code).toBe('VERSION_CONFLICT')
    // Thay đổi mới vẫn còn nguyên.
    expect(view(await permissionsOf(owner, staff.account.id), 'customer.view_masked').enabled).toBe(false)
  })

  it('gọi thẳng API khi chưa đăng nhập bị 401', async () => {
    const read = await request(app).get('/api/v1/accounts/1/permissions').set('Origin', env.webOrigin)
    expect(read.status).toBe(401)
    const write = await request(app).post('/api/v1/accounts/1/permissions').set('Origin', env.webOrigin)
      .send({ version: 1, permissions: {} })
    expect(write.status).toBe(401)
  })

  it('audit ghi old/new của từng quyền và không chứa mật khẩu', async () => {
    const staff = await createStaff(owner, 'tu34_audit')
    await post(owner, `/api/v1/accounts/${staff.account.id}/permissions`, {
      version: staff.account.version, permissions: { 'customer.view_masked': false },
    })

    const [rows] = await databasePool.execute<(RowDataPacket & { action: string; changes: string })[]>(
      `SELECT action, CAST(changes AS CHAR) AS changes FROM operation_log
       WHERE entity_type = 'user' AND entity_id = ? ORDER BY id`,
      [staff.account.id],
    )
    const actions = rows.map((row) => row.action)
    expect(actions).toContain('USER_ACCOUNT_CREATED')
    expect(actions).toContain('USER_PERMISSIONS_CHANGED')

    const permissionChange = rows.find((row) => row.action === 'USER_PERMISSIONS_CHANGED')!
    expect(JSON.parse(permissionChange.changes)).toEqual([
      { type: 'account', permissions: [{ code: 'customer.view_masked', from: true, to: false }] },
    ])
    for (const row of rows) {
      expect(row.changes).not.toContain(staff.temporaryPassword)
      expect(row.changes.toLowerCase()).not.toContain('password_hash')
    }
  })
})

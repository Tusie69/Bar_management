/**
 * TU-35 — Nhật ký thao tác, phần đi qua database.
 *
 * Chạy khi RUN_MYSQL_INTEGRATION=1 trên database tên *_test.
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

interface Entry {
  id: number
  occurredAt: string
  actor: string
  actorUsername: string | null
  action: string
  actionLabel: string
  actionType: string | null
  target: string
  device: string
  detail: string
}

interface Session { agent: Agent; csrfToken: string }

function post(session: Session, path: string, body: Record<string, unknown>) {
  return session.agent.post(path).set('Origin', env.webOrigin).set('X-CSRF-Token', session.csrfToken).send(body)
}

async function audit(session: Session, query = ''): Promise<{ entries: Entry[]; retentionDays: number }> {
  const response = await session.agent.get(`/api/v1/operations/audit${query}`).set('Origin', env.webOrigin)
  expect(response.status).toBe(200)
  return response.body as { entries: Entry[]; retentionDays: number }
}

mysqlDescribe('TU-35 · nhật ký thao tác', () => {
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

  it('đăng nhập sinh một dòng đủ năm cột', async () => {
    const { entries } = await audit(owner)
    const row = entries.find((entry) => entry.action === 'AUTH_LOGIN_SUCCEEDED')
    expect(row, 'dòng đăng nhập').toBeDefined()
    expect(row!.actionLabel).toBe('Đăng nhập')
    expect(row!.actor).toBe('integration_owner')
    expect(row!.target).toContain('integration_owner')
    expect(row!.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Thiết bị: có phiên thì lấy nhãn thiết bị, không có thì nói rõ là hệ thống.
    expect(row!.device.length).toBeGreaterThan(0)
  })

  it('tạo rồi khóa tài khoản đều được ghi vết, lọc theo nhóm chạy đúng', async () => {
    const created = await post(owner, '/api/v1/accounts', {
      username: 'tu35_staff', displayName: 'TU35 Staff', roleCode: 'RECEPTIONIST',
    })
    expect(created.status).toBe(201)
    const account = (created.body as { account: { id: number; version: number } }).account
    const locked = await post(owner, `/api/v1/accounts/${account.id}/status`, {
      version: account.version, status: 'DISABLED',
    })
    expect(locked.status).toBe(200)

    const accountOnly = await audit(owner, '?types=account')
    const labels = accountOnly.entries.map((entry) => entry.actionLabel)
    expect(labels).toContain('Tạo tài khoản')
    expect(labels).toContain('Khóa tài khoản')
    expect(accountOnly.entries.every((entry) => entry.actionType === 'account')).toBe(true)

    // Lọc sang nhóm khác thì không thấy các dòng này nữa.
    const bookingOnly = await audit(owner, '?types=booking_cancel')
    expect(bookingOnly.entries.map((entry) => entry.actionLabel)).not.toContain('Tạo tài khoản')
  })

  it('đổi quyền được ghi vết kèm giá trị cũ và mới', async () => {
    const created = await post(owner, '/api/v1/accounts', {
      username: 'tu35_perm', displayName: 'TU35 Perm', roleCode: 'RECEPTIONIST',
    })
    const account = (created.body as { account: { id: number; version: number } }).account
    const saved = await post(owner, `/api/v1/accounts/${account.id}/permissions`, {
      version: account.version, permissions: { 'customer.view_masked': false },
    })
    expect(saved.status).toBe(200)

    const { entries } = await audit(owner, '?types=permission')
    const row = entries.find((entry) => entry.action === 'USER_PERMISSIONS_CHANGED')
    expect(row, 'dòng đổi quyền').toBeDefined()
    expect(row!.actionLabel).toBe('Đổi quyền')
    expect(row!.target).toContain('TU35 Perm')
    expect(row!.detail).toContain('quyền đổi: 1')
  })

  it('nhóm chưa hỗ trợ trả về rỗng; loại không có thật bị từ chối', async () => {
    expect((await audit(owner, '?types=discount')).entries).toEqual([])
    const invalid = await owner.agent.get('/api/v1/operations/audit?types=khong-ton-tai')
      .set('Origin', env.webOrigin)
    expect(invalid.status).toBe(400)
  })

  it('lọc theo khoảng ngày', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    expect((await audit(owner, `?from=${tomorrow}`)).entries).toEqual([])
    const today = new Date().toISOString().slice(0, 10)
    expect((await audit(owner, `?from=${today}&to=${today}`)).entries.length).toBeGreaterThan(0)
  })

  it('tài khoản không có quyền xem nhật ký bị chặn ở cả API', async () => {
    const reception = await login('integration_reception')
    for (const path of ['/api/v1/operations/audit', '/api/v1/operations/audit/export', '/api/v1/operations/audit/filters']) {
      const response = await reception.agent.get(path).set('Origin', env.webOrigin)
      expect(response.status, path).toBe(403)
    }
    // Chưa đăng nhập thì 401, không phải 403.
    expect((await request(app).get('/api/v1/operations/audit').set('Origin', env.webOrigin)).status).toBe(401)
  })

  it('SuperAdmin xuất được file CSV đúng phần đang lọc', async () => {
    await post(owner, '/api/v1/accounts', {
      username: 'tu35_export', displayName: 'TU35 Export', roleCode: 'RECEPTIONIST',
    })
    const response = await owner.agent.get('/api/v1/operations/audit/export?types=account')
      .set('Origin', env.webOrigin)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.headers['content-disposition']).toContain('attachment')
    const csv = response.text
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Thời gian')
    expect(csv).toContain('Tạo tài khoản')
    // Đúng phần đang lọc: không có dòng đăng nhập.
    expect(csv).not.toContain('Đăng nhập')
  })

  it('Admin Read-Only xem được nhật ký nhưng không xuất được file', async () => {
    const created = await post(owner, '/api/v1/accounts', {
      username: 'tu35_ro', displayName: 'TU35 RO', roleCode: 'ADMIN', accessLevel: 'READ_ONLY',
    })
    expect(created.status).toBe(201)
    const temporary = (created.body as { temporaryPassword: string }).temporaryPassword
    const first = request.agent(app)
    await first.post('/api/v1/auth/login').set('Origin', env.webOrigin)
      .send({ username: 'tu35_ro', password: temporary, portal: 'admin' })
    const csrf = (await first.get('/api/v1/auth/me').set('Origin', env.webOrigin)).body as { csrfToken: string }
    await first.post('/api/v1/accounts/me/password').set('Origin', env.webOrigin)
      .set('X-CSRF-Token', csrf.csrfToken)
      .send({ currentPassword: temporary, newPassword: 'TU35-ReadOnly-Pass-1' })

    const agent = request.agent(app)
    const loggedIn = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin)
      .send({ username: 'tu35_ro', password: 'TU35-ReadOnly-Pass-1', portal: 'admin' })
    expect(loggedIn.status).toBe(200)

    expect((await agent.get('/api/v1/operations/audit').set('Origin', env.webOrigin)).status).toBe(200)
    const filters = await agent.get('/api/v1/operations/audit/filters').set('Origin', env.webOrigin)
    expect((filters.body as { canExport: boolean }).canExport).toBe(false)
    const denied = await agent.get('/api/v1/operations/audit/export').set('Origin', env.webOrigin)
    expect(denied.status).toBe(403)
    expect((denied.body as { error: { code: string } }).error.code).toBe('AUDIT_EXPORT_DENIED')
  })

  it('thời gian lưu nhật ký đọc từ cấu hình quán', async () => {
    const before = await audit(owner)
    expect(before.retentionDays).toBe(90)

    await databasePool.execute(
      "INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`) VALUES (?, ?, 'audit_retention_days', CAST('30' AS JSON))"
      + ' ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [env.organizationId, env.venueId],
    )
    expect((await audit(owner)).retentionDays).toBe(30)
  })

  it('không có số điện thoại nào trong nhật ký hay file xuất', async () => {
    const [rows] = await databasePool.execute<(RowDataPacket & { changes: string | null })[]>(
      'SELECT CAST(changes AS CHAR) AS changes FROM operation_log WHERE organization_id = ?',
      [env.organizationId],
    )
    for (const row of rows) {
      // Không chuỗi số dài nào (SĐT Việt Nam 9–11 chữ số) nằm trong nội dung log.
      expect(row.changes ?? '').not.toMatch(/\d{9,}/)
    }
    const csv = (await owner.agent.get('/api/v1/operations/audit/export').set('Origin', env.webOrigin)).text
    expect(csv.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '')).not.toMatch(/\d{9,}/)
  })

  it('truy vấn một tháng dùng chỉ mục theo thời gian', async () => {
    // AC đòi dưới 2 giây trên một tháng dữ liệu. Thời gian chạy phụ thuộc máy,
    // nên điều kiểm được ở đây là kế hoạch truy vấn: có dùng index, không quét
    // toàn bảng.
    const [plan] = await databasePool.execute<(RowDataPacket & { key: string | null; type: string })[]>(
      `EXPLAIN SELECT o.id FROM operation_log AS o
       WHERE o.organization_id = ? AND o.venue_id = ?
         AND o.occurred_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY
       ORDER BY o.occurred_at DESC, o.id DESC LIMIT 50`,
      [env.organizationId, env.venueId],
    )
    expect(plan[0]!.type).not.toBe('ALL')
  })
})

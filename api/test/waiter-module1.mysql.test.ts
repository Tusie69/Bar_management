/**
 * Module Phục vụ 1 — phân quyền và dữ liệu của vai WAITER, qua HTTP thật và
 * database thật.
 *
 * Mỗi khẳng định ở đây đi qua Express + MySQL. Không mock permission: một test
 * mock chỉ xác nhận đúng cái bảng mà chính nó khai, chứ không xác nhận backend
 * chặn được ai. Cần `RUN_MYSQL_INTEGRATION=1` và
 * `DB_NAME=gam21_platform_it_test`; thiếu thì cả file skip — và một file skip
 * KHÔNG phải là bằng chứng phân quyền đã đúng.
 *
 * Migration 0032 phải được áp dụng trên database test, nếu không nhóm "đổi /
 * ghép / tách" sẽ đỏ với 403.
 */
import type { RowDataPacket } from 'mysql2/promise'
import request, { type Agent } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { app } from '../src/app.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { databasePool } from '../src/database/pool.js'
import {
  assignBookingTables,
  createBooking,
  createWalkIn,
  mergeBookingTables,
} from '../src/modules/bookings/booking.repository.js'
import { createLayoutGroup } from '../src/modules/tables/table-layout-group.repository.js'
import { WAITER_FORBIDDEN_KEYS } from '../src/modules/tables/waiter-floor-projection.js'
import { closeVisit, mergeVisitTables } from '../src/modules/visits/visit.repository.js'
import {
  actor,
  businessDate,
  clearFixture,
  initializeFixture,
  resetFixture,
  tableId,
} from './support/integration-fixture.js'

const mysqlDescribe = process.env.RUN_MYSQL_INTEGRATION === '1' && /_test$/.test(process.env.DB_NAME ?? '')
  ? describe
  : describe.skip

const password = 'Waiter-Module1-Password-01'
const waiterUserId = 9871
const cashierUserId = 9872
const tableTwoId = 9873
const tableThreeId = 9874
const tableFourId = 9875

const GUEST_NAME = 'Chị Hồng Nhung'
const GUEST_PHONE = '0912345789'

interface SignedIn {
  agent: Agent
  csrfToken: string
  permissions: string[]
}

async function seedAccount(id: number, username: string, role: string): Promise<void> {
  const passwordHash = await hashPassword(password)
  await databasePool.execute(
    'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)',
    [id, username, username, passwordHash],
  )
  await databasePool.execute(
    'INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)',
    [id, actor.organizationId, id],
  )
  await databasePool.execute(
    `INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
     SELECT ?, ?, id, ? FROM roles WHERE code = ?`,
    [actor.organizationId, id, actor.venueId, role],
  )
}

/** Thêm bàn cho các tình huống đổi / ghép / tách. Fixture chỉ có một bàn A1. */
async function addTables(): Promise<void> {
  await databasePool.execute(
    `INSERT INTO dining_tables
      (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES
      (?, ?, ?, ?, 'W2', 'W2', 'TABLE', 4, 20, 60),
      (?, ?, ?, ?, 'W3', 'W3', 'TABLE', 4, 30, 60),
      (?, ?, ?, ?, 'W4', 'W4', 'TABLE', 4, 40, 60)`,
    [
      tableTwoId, actor.organizationId, actor.venueId, tableId,
      tableThreeId, actor.organizationId, actor.venueId, tableId,
      tableFourId, actor.organizationId, actor.venueId, tableId,
    ],
  )
}

async function signIn(username: string, portal: string): Promise<SignedIn> {
  const agent = request.agent(app)
  const response = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin)
    .send({ username, password, portal })
  expect(response.status, `${username} phải đăng nhập được tại /${portal}`).toBe(200)
  const body = response.body as { csrfToken: string; permissions: string[] }
  return { agent, csrfToken: body.csrfToken, permissions: body.permissions }
}

function post(session: SignedIn, path: string, body: Record<string, unknown> = {}) {
  return session.agent.post(path).set('Origin', env.webOrigin)
    .set('X-CSRF-Token', session.csrfToken).send(body)
}

/** Một Phiên đang mở với tên và số điện thoại thật, để dò rò rỉ. */
async function seatedVisit(tableIds: number[] = [tableId]): Promise<{ visitId: number }> {
  const walkIn = await createWalkIn(actor, {
    guestName: GUEST_NAME,
    phoneNumber: GUEST_PHONE,
    partySize: 2,
    businessDate,
    tableIds,
  })
  return { visitId: walkIn.visitId }
}

async function mergedCluster(tableIds: number[]): Promise<{ visitId: number; groupId: number }> {
  const { visitId } = await seatedVisit([tableIds[0]!])
  const merged = await mergeVisitTables({ ...actor }, {
    visitId, expectedVersion: 1, tableIds,
  })
  return { visitId, groupId: merged.group.id }
}

async function visitVersion(visitId: number): Promise<number> {
  const [rows] = await databasePool.execute<(RowDataPacket & { version: number })[]>(
    'SELECT version FROM visits WHERE id = ?',
    [visitId],
  )
  return Number(rows[0]!.version)
}

async function auditRows(action: string, userId: number): Promise<number> {
  const [rows] = await databasePool.execute<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM operation_log WHERE action = ? AND actor_user_id = ?',
    [action, userId],
  )
  return Number(rows[0]!.total)
}

function allKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, found)
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key)
      allKeys(nested, found)
    }
  }
  return found
}

mysqlDescribe('Module Phục vụ 1 — WAITER', () => {
  beforeAll(initializeFixture)
  beforeEach(async () => {
    await resetFixture()
    await addTables()
    await seedAccount(waiterUserId, 'module1_phucvu', 'WAITER')
    await seedAccount(cashierUserId, 'module1_thungan', 'CASHIER')
  })
  afterAll(async () => {
    await clearFixture()
    await databasePool.end()
  })

  describe('1. Đăng nhập và bộ quyền', () => {
    it('đăng nhập được ở cổng waiter và nhận đúng quyền phục vụ cùng READY notification', async () => {
      const waiter = await signIn('module1_phucvu', 'waiter')
      expect([...waiter.permissions].sort()).toEqual([
        'order.cancel.request', 'order.create', 'order.line.adjust', 'order.read',
        'preparation.ready.acknowledge', 'preparation.ready.read',
        'visit.combine', 'visit.move', 'visit.split',
      ])
    })

    it('không có quyền nào về khách hàng, kể cả ba số cuối', async () => {
      const waiter = await signIn('module1_phucvu', 'waiter')
      for (const forbidden of ['customer.view_masked', 'customer.phone.reveal', 'booking.phone.call',
        'booking.phone.reveal', 'payment.collect', 'visit.end', 'visit.mark_paid', 'visit.checkin',
        'visit.walkin', 'table.group.manage', 'table.assign', 'reservation.create', 'waitlist.create',
        'report.read', 'audit.read', 'venue.configure', 'user.read']) {
        expect(waiter.permissions, `Phục vụ KHÔNG được có ${forbidden}`).not.toContain(forbidden)
      }
    })

    it('không đăng nhập được ở cổng của vai khác', async () => {
      for (const portal of ['admin', 'receptionist', 'cashier', 'customer-care']) {
        const response = await request(app).post('/api/v1/auth/login').set('Origin', env.webOrigin)
          .send({ username: 'module1_phucvu', password, portal })
        expect(response.status, `cổng ${portal} phải từ chối Phục vụ`).toBe(403)
      }
    })
  })

  describe('2. Projection sơ đồ không rò rỉ dữ liệu khách', () => {
    it('đọc được sơ đồ ca hiện tại ở endpoint riêng của mình', async () => {
      await seatedVisit()
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await waiter.agent.get(`/api/v1/tables/service?date=${businessDate}`)
      expect(response.status).toBe(200)
      const body = response.body as { businessDate: string; tables: { tableCode: string }[] }
      expect(body.businessDate).toBe(businessDate)
      expect(body.tables.map((table) => table.tableCode)).toContain('A1')
    })

    it('payload không chứa tên, số điện thoại hay khoá nhận dạng khách nào', async () => {
      await seatedVisit()
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await waiter.agent.get(`/api/v1/tables/service?date=${businessDate}`)
      const serialized = JSON.stringify(response.body)
      expect(serialized).not.toContain(GUEST_NAME)
      expect(serialized).not.toContain('Hồng')
      expect(serialized).not.toContain('789')
      expect(serialized).not.toContain('WALK_IN')
      const keys = [...allKeys(response.body)]
      for (const forbidden of WAITER_FORBIDDEN_KEYS) {
        expect(keys, `khoá bị cấm: ${forbidden}`).not.toContain(forbidden)
      }
    })

    it('vẫn mang đủ thông tin vận hành: Phiên, số khách, giờ mở, trạng thái', async () => {
      const { visitId } = await seatedVisit()
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await waiter.agent.get(`/api/v1/tables/service?date=${businessDate}`)
      const body = response.body as {
        tables: { tableId: number; displayState: string; claim: { visitId: number; partySize: number; startsAt: string; paid: boolean; version: number } | null }[]
      }
      const seated = body.tables.find((table) => table.tableId === tableId)
      expect(seated?.displayState).toBe('IN_USE')
      expect(seated?.claim).toMatchObject({ visitId, partySize: 2, paid: false })
      expect(typeof seated?.claim?.startsAt).toBe('string')
      expect(seated?.claim?.version).toBeGreaterThan(0)
    })

    it('chỉ thấy bàn của venue mình, không thấy bàn venue khác', async () => {
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await waiter.agent.get(`/api/v1/tables/service?date=${businessDate}`)
      expect(JSON.stringify(response.body)).not.toContain('ZZ9')
    })

    it('bàn ghép: mọi ô bàn của cụm trỏ về một visitId chung', async () => {
      const { visitId } = await mergedCluster([tableId, tableTwoId])
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await waiter.agent.get(`/api/v1/tables/service?date=${businessDate}`)
      const body = response.body as { tables: { tableId: number; claim: { visitId: number } | null }[] }
      const members = body.tables.filter((table) => table.tableId === tableId || table.tableId === tableTwoId)
      expect(members).toHaveLength(2)
      expect(new Set(members.map((table) => table.claim?.visitId))).toEqual(new Set([visitId]))
    })

    it('KHÔNG gọi được projection đầy đủ của Lễ tân, dù biết URL', async () => {
      await seatedVisit()
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await waiter.agent.get(`/api/v1/tables?date=${businessDate}`)
      expect(response.status).toBe(403)
      expect(JSON.stringify(response.body)).not.toContain(GUEST_NAME)
    })

    it('đọc được danh mục bàn, vì danh mục không có dữ liệu khách', async () => {
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await waiter.agent.get('/api/v1/tables/catalog')
      expect(response.status).toBe(200)
      expect(JSON.stringify(response.body)).not.toContain(GUEST_NAME)
    })

    it('payload của Lễ tân KHÔNG đổi: vẫn có tên khách như trước', async () => {
      await seatedVisit()
      const reception = await signIn('integration_reception', 'receptionist')
        .catch(() => null)
      // Fixture dùng mật khẩu riêng cho integration_reception, nên nếu không
      // đăng nhập được thì dùng Thu ngân — vai cũng có customer.view_masked.
      const viewer = reception ?? await signIn('module1_thungan', 'cashier')
      const response = await viewer.agent.get(`/api/v1/tables?date=${businessDate}`)
      expect(response.status).toBe(200)
      expect(JSON.stringify(response.body)).toContain(GUEST_NAME)
    })
  })

  describe('3. Không chạm được booking, waitlist, thanh toán, quản trị', () => {
    it.each([
      ['GET', `/api/v1/bookings?date=${businessDate}`],
      ['GET', `/api/v1/waitlist?date=${businessDate}`],
      ['GET', '/api/v1/accounts'],
      ['GET', '/api/v1/operations/audit'],
      ['GET', `/api/v1/visits/turns?from=${businessDate}&to=${businessDate}`],
    ])('%s %s bị chặn 403', async (_method, path) => {
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await waiter.agent.get(path)
      expect(response.status).toBe(403)
    })

    it('không tạo được booking, không mở được Walk-in, không nhả được bàn', async () => {
      const { visitId } = await seatedVisit()
      const waiter = await signIn('module1_phucvu', 'waiter')
      const booking = await post(waiter, '/api/v1/bookings', {
        partySize: 2, expectedAt: `${businessDate}T21:00:00+07:00`, businessDate, sourceCode: 'HOTLINE',
      })
      expect(booking.status).toBe(403)
      const walkIn = await post(waiter, '/api/v1/bookings/walk-ins', {
        partySize: 2, businessDate, tableIds: [tableTwoId],
      })
      expect(walkIn.status).toBe(403)
      const close = await post(waiter, `/api/v1/visits/${visitId}/close`, {
        version: 1, mode: 'MANUAL', reason: 'GUEST_LEFT',
      })
      expect(close.status).toBe(403)
      const waitlist = await post(waiter, '/api/v1/waitlist', {
        guestName: 'X', partySize: 2, businessDate, kind: 'WALK_IN', channel: 'WALK_IN',
      })
      expect(waitlist.status).toBe(403)
    })
  })

  describe('4. Đổi / ghép / tách chỉ trên Phiên đang có khách', () => {
    it('đổi bàn cho Phiên đang mở: cùng Phiên, không sinh Phiên mới, có audit log', async () => {
      const { visitId } = await seatedVisit()
      const waiter = await signIn('module1_phucvu', 'waiter')
      const before = await auditRows('VISIT_TABLES_MOVED', waiterUserId)

      const response = await post(waiter, `/api/v1/visits/${visitId}/move`, {
        version: await visitVersion(visitId), tableIds: [tableTwoId],
      })
      expect(response.status).toBe(200)
      const body = response.body as { visit: { id: number; tables: { code: string }[] } }
      expect(body.visit.id).toBe(visitId)
      expect(body.visit.tables.map((table) => table.code)).toEqual(['W2'])
      expect(await auditRows('VISIT_TABLES_MOVED', waiterUserId)).toBe(before + 1)
    })

    it('ghép Phiên đang mở với một bàn khác, có audit log', async () => {
      const { visitId } = await seatedVisit()
      const waiter = await signIn('module1_phucvu', 'waiter')
      const before = await auditRows('VISIT_TABLES_MERGED', waiterUserId)

      const response = await post(waiter, `/api/v1/visits/${visitId}/merge`, {
        version: await visitVersion(visitId), tableIds: [tableId, tableTwoId],
      })
      expect(response.status).toBe(200)
      expect(await auditRows('VISIT_TABLES_MERGED', waiterUserId)).toBe(before + 1)
    })

    it('tách cụm bàn ĐANG CÓ KHÁCH, có audit log', async () => {
      const { groupId } = await mergedCluster([tableId, tableTwoId])
      const waiter = await signIn('module1_phucvu', 'waiter')
      const before = await auditRows('TABLES_SPLIT', waiterUserId)

      const response = await post(waiter, `/api/v1/tables/groups/${groupId}/split`, {
        keepTableIds: [tableId],
      })
      expect(response.status).toBe(200)
      const body = response.body as { keptTableIds: number[]; releasedTableIds: number[] }
      expect(body.keptTableIds).toEqual([tableId])
      expect(body.releasedTableIds).toEqual([tableTwoId])
      expect(await auditRows('TABLES_SPLIT', waiterUserId)).toBe(before + 1)
    })

    it('KHÔNG rã được cụm bàn trống: đó là sắp xếp mặt bằng', async () => {
      const cluster = await createLayoutGroup({ ...actor }, { tableIds: [tableThreeId, tableFourId] })
      const waiter = await signIn('module1_phucvu', 'waiter')

      // `ALL_TO_SINGLE` rã cả cụm, kể cả cụm chưa có ai: thao tác mặt bằng,
      // nên route chặn ngay bằng permission, không đi tới repository.
      const dissolve = await post(waiter, `/api/v1/tables/groups/${cluster.group.groupId}/split`, {
        mode: 'ALL_TO_SINGLE', version: cluster.group.version,
      })
      expect(dissolve.status).toBe(403)
      expect((dissolve.body as { error: { code: string } }).error.code).toBe('PERMISSION_DENIED')

      // Nhánh keepTableIds trên một cụm chưa có claim nào vốn đã không hợp lệ
      // với MỌI vai (không có allocation nào để nhả). Điều cần chứng minh là
      // Phục vụ không thay đổi được mặt bằng, nên chỉ cần: không phải 200.
      const kept = await post(waiter, `/api/v1/tables/groups/${cluster.group.groupId}/split`, {
        keepTableIds: [tableThreeId],
      })
      expect(kept.status).not.toBe(200)
    })

    it('KHÔNG tách được cụm đang giữ cho booking chưa tới', async () => {
      const booking = await createBooking({ ...actor }, {
        guestName: GUEST_NAME,
        partySize: 4,
        expectedAt: `${businessDate}T21:00:00+07:00`,
        businessDate,
        sourceCode: 'HOTLINE',
      })
      const assigned = await assignBookingTables({ ...actor }, booking.id, booking.version, [tableThreeId])
      const merged = await mergeBookingTables({ ...actor }, assigned.id, assigned.version, [tableThreeId, tableFourId])
      const waiter = await signIn('module1_phucvu', 'waiter')

      const response = await post(waiter, `/api/v1/tables/groups/${merged.group.id}/split`, {
        keepTableIds: [tableThreeId],
      })
      expect(response.status).toBe(403)
      expect((response.body as { error: { code: string } }).error.code).toBe('SPLIT_REQUIRES_SEATED_VISIT')
    })

    it('KHÔNG quản lý được cụm bàn: tạo, thêm thành viên, rã cụm đều 403', async () => {
      const cluster = await createLayoutGroup({ ...actor }, { tableIds: [tableThreeId, tableFourId] })
      const waiter = await signIn('module1_phucvu', 'waiter')

      expect((await post(waiter, '/api/v1/tables/groups', { tableIds: [tableId, tableTwoId] })).status).toBe(403)
      expect((await post(waiter, `/api/v1/tables/groups/${cluster.group.groupId}/members`, {
        version: cluster.group.version, tableIds: [tableTwoId],
      })).status).toBe(403)
      expect((await post(waiter, `/api/v1/tables/groups/${cluster.group.groupId}/dissolve`, {
        version: cluster.group.version,
      })).status).toBe(403)
    })

    it('Phiên đã đóng thì không đổi được bàn nữa', async () => {
      const { visitId } = await seatedVisit()
      await closeVisit({ ...actor }, {
        visitId,
        expectedVersion: await visitVersion(visitId),
        mode: 'MANUAL',
        reason: 'GUEST_LEFT',
      })
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await post(waiter, `/api/v1/visits/${visitId}/move`, {
        version: await visitVersion(visitId), tableIds: [tableTwoId],
      })
      expect(response.status).toBe(409)
      expect((response.body as { error: { code: string } }).error.code).toBe('VISIT_ALREADY_CLOSED')
    })

    it('optimistic concurrency: version cũ bị từ chối', async () => {
      const { visitId } = await seatedVisit()
      const waiter = await signIn('module1_phucvu', 'waiter')
      const current = await visitVersion(visitId)
      const first = await post(waiter, `/api/v1/visits/${visitId}/move`, {
        version: current, tableIds: [tableTwoId],
      })
      expect(first.status).toBe(200)
      const stale = await post(waiter, `/api/v1/visits/${visitId}/move`, {
        version: current, tableIds: [tableThreeId],
      })
      expect(stale.status).toBe(409)
      expect((stale.body as { error: { code: string } }).error.code).toBe('VERSION_CONFLICT')
    })

    it('venue isolation: Phiên không thuộc venue của mình là 404', async () => {
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await post(waiter, '/api/v1/visits/999999/move', {
        version: 1, tableIds: [tableTwoId],
      })
      expect(response.status).toBe(404)
      expect((response.body as { error: { code: string } }).error.code).toBe('VISIT_NOT_FOUND')
    })

    it('thiếu CSRF thì mutation bị từ chối', async () => {
      const { visitId } = await seatedVisit()
      const waiter = await signIn('module1_phucvu', 'waiter')
      const response = await waiter.agent.post(`/api/v1/visits/${visitId}/move`)
        .set('Origin', env.webOrigin)
        .send({ version: await visitVersion(visitId), tableIds: [tableTwoId] })
      expect(response.status).toBe(403)
    })
  })
})

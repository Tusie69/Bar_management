import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import request from 'supertest'

import { app } from '../../src/app.js'
import { hashPassword } from '../../src/auth/password.js'
import { env } from '../../src/config/env.js'
import { databasePool } from '../../src/database/pool.js'
import { invalidateVenueShift } from '../../src/modules/venues/venue-shift.js'

export const actor = { organizationId: env.organizationId, venueId: env.venueId, userId: 9801, membershipId: 9801 }
export const otherVenueId = 9802
export const otherOrganizationId = 9803
export const tableId = 9801
export const foreignTableId = 9802
export const businessDate = '2030-10-24'
const password = randomBytes(24).toString('base64url')
let passwordHash: string

export async function initializeFixture(): Promise<void> {
  passwordHash = await hashPassword(password)
}

/**
 * T-01: when vitest gives up on a hook that exceeded its timeout it stops
 * awaiting it, but the hook's promise keeps running. The next test's setup then
 * interleaves with the abandoned one and its INSERT hits `organizations.PRIMARY`,
 * which is how one slow fixture turned into a cascade of unrelated failures.
 *
 * Every fixture mutation queues behind the previous one, so an abandoned run
 * finishes before the next begins instead of racing it. A rejection is absorbed
 * into the queue so one failure cannot poison the rest of the run.
 */
let fixtureQueue: Promise<unknown> = Promise.resolve()

function serializeFixture<T>(operation: () => Promise<T>): Promise<T> {
  const result = fixtureQueue.then(operation, operation)
  fixtureQueue = result.catch(() => undefined)
  return result
}

/** The destructive body, already inside the fixture queue when it runs. */
async function truncateFixtureTables(): Promise<void> {
  if (!['gam21_platform_it_test', 'gam21_platform_module4_test'].includes(env.database.name)) {
    throw new Error('Refusing destructive fixture outside integration database')
  }
  // TU-38: venues are deleted and reinserted under the same ids, so a shift cached from the
  // previous test would survive into the next one and quietly answer for the wrong venue row.
  invalidateVenueShift()
  await databasePool.execute('UPDATE operation_log SET compensates_operation_id = NULL WHERE compensates_operation_id IS NOT NULL')
  await databasePool.execute("UPDATE customers SET status = 'ACTIVE', merged_into_customer_id = NULL WHERE status = 'MERGED'")
  await databasePool.execute(
    "UPDATE visits SET end_reason = 'ENTRY_ERROR', merged_into_visit_id = NULL WHERE merged_into_visit_id IS NOT NULL",
  )
  // Migration 0044: notifications reference orders, visits and users. Clear the
  // inbox first so later fixture cleanup can delete every referenced parent.
  await databasePool.execute('DELETE FROM staff_notifications')
  // Module Phục vụ 3: đơn tham chiếu giá, biến thể, món và Phiên, nên phải xoá
  // trước toàn bộ danh mục món và trước visits — nếu không FK chặn fixture và
  // mọi file integration sau đó đỏ vì một lý do không liên quan tới nó.
  await databasePool.execute('DELETE FROM preparation_ready_acknowledgements')
  await databasePool.execute('DELETE FROM preparation_ready_audiences')
  await databasePool.execute('DELETE FROM preparation_ready_events')
  // Module Phục vụ 5: lịch sử sửa dòng và yêu cầu hủy tham chiếu dòng đơn, nên
  // phải xoá trước sales_order_lines — nếu không FK chặn fixture và mọi file
  // integration sau đó đỏ vì một lý do không liên quan tới nó.
  await databasePool.execute('DELETE FROM sales_order_line_changes')
  await databasePool.execute('DELETE FROM sales_order_cancellations')
  // TU-45: bill tham chiếu dòng đơn (`source_order_line_id`) và Phiên, nên phải
  // xoá trước `sales_order_lines` và trước `visits`. Ledger và dòng bill trỏ về
  // `bills`, nên chúng đi trước nó.
  // TU-46: giao dịch trỏ về `bills` và về `users`, nên nó đi trước cả hai.
  await databasePool.execute('DELETE FROM bill_payments')
  await databasePool.execute('DELETE FROM bill_charge_lines')
  // V12 (0050): nguồn dòng trỏ về cả `bill_lines` và `sales_order_lines`, nên
  // nó phải đi trước cả hai.
  await databasePool.execute('DELETE FROM bill_line_sources')
  await databasePool.execute('DELETE FROM bill_lines')
  await databasePool.execute('DELETE FROM bills')
  await databasePool.execute('DELETE FROM venue_settings')
  await databasePool.execute('DELETE FROM preparation_ready_notifications')
  await databasePool.execute('DELETE FROM preparation_print_retry_events')
  await databasePool.execute('DELETE FROM preparation_print_outbox')
  await databasePool.execute('DELETE FROM preparation_print_capabilities')
  await databasePool.execute('DELETE FROM preparation_ticket_events')
  await databasePool.execute('DELETE FROM preparation_line_progress_events')
  await databasePool.execute('DELETE FROM preparation_line_progress')
  await databasePool.execute('DELETE FROM preparation_tickets')
  await databasePool.execute('DELETE FROM sales_order_lines')
  await databasePool.execute('DELETE FROM sales_orders')
  await databasePool.execute('DELETE FROM menu_variant_prices')
  await databasePool.execute('DELETE FROM menu_item_variants')
  await databasePool.execute('DELETE FROM menu_items')
  // Categories form a two-level self-referencing tree. Remove leaves first so
  // the normal FK remains enabled while the shared integration fixture resets.
  await databasePool.execute('DELETE FROM menu_categories WHERE parent_id IS NOT NULL')
  for (const table of ['menu_categories',
    'customer_duplicate_dismissals', 'booking_call_logs', 'operation_log', 'reception_guest_counts', 'table_turns', 'table_allocations', 'table_group_members', 'table_groups', 'table_holds',
    'waitlist_table_preferences', 'waitlist_contact_attempts', 'waitlist_entries', 'reservations', 'visits',
    'customers', 'table_combination_members', 'table_combinations', 'table_adjacencies', 'dining_tables',
    'zones', 'floors', 'auth_sessions', 'membership_roles', 'memberships', 'idempotency_keys',
    // TU-34: override quyền tham chiếu users, nên phải xoá trước users.
    'user_permission_overrides', 'users',
    'booking_sources', 'venues', 'organizations']) {
    await databasePool.execute(`DELETE FROM ${table}`)
  }
}

export async function clearFixture(): Promise<void> {
  await serializeFixture(() => measureFixture('clearFixture', truncateFixtureTables))
}

async function measureFixture(name: string, operation: () => Promise<void>): Promise<void> {
  const started = performance.now()
  const warning = setTimeout(() => {
    console.warn(`[integration fixture] ${name} still running durationMs=${Math.round(performance.now() - started)}`)
  }, 9_000)
  let completed = false
  try {
    await operation()
    completed = true
  } finally {
    clearTimeout(warning)
    if (process.env.MEASURE_INTEGRATION_FIXTURE === '1' || !completed) {
      console.info(`[integration fixture] ${name} durationMs=${Math.round(performance.now() - started)} completed=${completed}`)
    }
  }
}

export async function resetFixture(): Promise<void> {
  await serializeFixture(() => measureFixture('resetFixture', populateFixture))
}

async function populateFixture(): Promise<void> {
  // The inner body: this already runs inside the queue via resetFixture.
  await truncateFixtureTables()
  await databasePool.execute("INSERT INTO organizations (id, code, name) VALUES (?, 'INTEGRATION', 'Integration'), (?, 'FOREIGN', 'Foreign')",
    [actor.organizationId, otherOrganizationId])
  await databasePool.execute(
    `INSERT INTO venues (id, organization_id, code, name, timezone, business_day_start_local, business_day_cutoff_local)
     VALUES (?, ?, 'HOME', 'Home', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00'),
       (?, ?, 'OTHER', 'Other', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00'),
       (?, ?, 'FOREIGN', 'Foreign', 'Asia/Ho_Chi_Minh', '17:00:00', '05:00:00')`,
    [actor.venueId, actor.organizationId, otherVenueId, actor.organizationId, otherOrganizationId, otherOrganizationId],
  )
  for (const [id, username, role] of [[9801, 'integration_reception', 'RECEPTIONIST'],
    [9802, 'integration_owner', 'OWNER'], [9803, 'integration_care', 'CUSTOMER_CARE']] as const) {
    await databasePool.execute("INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)",
      [id, username, username, passwordHash])
    await databasePool.execute('INSERT INTO memberships (id, organization_id, user_id) VALUES (?, ?, ?)', [id, actor.organizationId, id])
    await databasePool.execute(
      'INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id) SELECT ?, ?, id, ? FROM roles WHERE code = ?',
      [actor.organizationId, id, actor.venueId, role],
    )
  }
  await databasePool.execute(
    "INSERT INTO zones (id, organization_id, venue_id, code, name) VALUES (?, ?, ?, 'A', 'A'), (?, ?, ?, 'B', 'B')",
    [tableId, actor.organizationId, actor.venueId, foreignTableId, actor.organizationId, otherVenueId],
  )
  // Bàn của venue lạ mang mã ZZ9, cố ý nằm ngoài mọi mã bàn thật của quán.
  // Nó là mồi phát hiện rò rỉ dữ liệu chéo venue: bản export của venue nhà mà
  // chứa mã này nghĩa là có rò rỉ. Trước đây mồi là 'B1', nhưng bản export
  // mới in ra một sơ đồ cố định gồm cả ô B1 kể cả khi ô đó trống, nên mồi
  // trùng với dữ liệu hợp lệ và test báo động giả.
  await databasePool.execute(
    `INSERT INTO dining_tables (id, organization_id, venue_id, zone_id, code, display_name, kind, capacity, pos_x, pos_y)
     VALUES (?, ?, ?, ?, 'A1', 'A1', 'TABLE', 4, 10, 10), (?, ?, ?, ?, 'ZZ9', 'ZZ9', 'TABLE', 4, 10, 10)`,
    [tableId, actor.organizationId, actor.venueId, tableId, foreignTableId, actor.organizationId, otherVenueId, foreignTableId],
  )
  await databasePool.execute("INSERT INTO booking_sources (organization_id, code, name) VALUES (?, 'HOTLINE', 'Hotline')", [actor.organizationId])
}

export async function login(username = 'integration_reception') {
  const agent = request.agent(app)
  const portal = username === 'integration_owner'
    ? 'admin'
    : username === 'integration_care' ? 'customer-care' : 'receptionist'
  const response = await agent.post('/api/v1/auth/login').set('Origin', env.webOrigin).send({ username, password, portal })
  if (response.status !== 200) {
    const code = (response.body as { error?: { code?: string } }).error?.code ?? 'UNKNOWN'
    throw new Error(`Fixture login failed: ${response.status} ${code}`)
  }
  return { agent, csrfToken: (response.body as { csrfToken: string }).csrfToken }
}

/** Test-only login at an explicit portal using the fixture credential. */
export async function loginAtPortal(
  username: string,
  portal: 'admin' | 'receptionist' | 'customer-care' | 'cashier' | 'waiter' | 'preparation',
): Promise<import('supertest').Response> {
  return request(app).post('/api/v1/auth/login').set('Origin', env.webOrigin).send({ username, password, portal })
}

/** Adds a venue-scoped account using the fixture credential. */
export async function seedFixtureAccount(id: number, username: string, role: string, venueId = actor.venueId): Promise<void> {
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
    [actor.organizationId, id, venueId, role],
  )
}

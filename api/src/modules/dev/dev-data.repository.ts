/**
 * TU-43 — xoá sạch và dựng dữ liệu mẫu trên bản Dev, bằng một lần bấm.
 *
 * Nguyên tắc:
 *  - Chỉ chạy khi APP_ENV=dev VÀ chính MySQL nói database kết thúc bằng `_dev`
 *    (assertDevDatabase). Router còn không được gắn trên Production (app.ts).
 *  - Dữ liệu vận hành (đặt bàn, Phiên, đơn, Bàn chờ…) dựng bằng CHÍNH các hàm
 *    nghiệp vụ mà màn Lễ tân/Phục vụ/Bar gọi, không chèn SQL tay — nên dữ liệu
 *    mẫu luôn đúng mọi ràng buộc mà code thật đang giữ, và đổi theo khi code đổi.
 *  - Không bịa món: món lấy từ danh mục đã nhập bằng `menu:import`. Chưa có
 *    danh mục thì kịch bản vẫn dựng bàn và khách, bỏ phần gọi món, và nói rõ.
 *  - Bấm lại = xoá cũ rồi tạo lại, không bao giờ cộng dồn.
 *  - Giờ của mọi dữ liệu là giờ nghiệp vụ hiện tại (đồng hồ giả lập TU-42).
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { applicationNow, realNow } from '../../time/application-clock.js'
import { businessDateAt, currentBusinessDate } from '../bookings/business-date.js'
import { checkInBooking, createAndAssignBooking, createBooking, createWalkIn } from '../bookings/booking.repository.js'
import { currentPricePredicate, menuSourcePredicate } from '../menu/menu-catalog-sql.js'
import { createWaiterOrder } from '../orders/order.repository.js'
import { requestOrderLineCancellation } from '../orders/order-adjustment.repository.js'
import { transitionPreparationTicket } from '../preparation/preparation.repository.js'
import type { PreparationStation, PreparationStatus } from '../orders/order.model.js'
import { createWaitlistEntry } from '../waitlist/waitlist.repository.js'
import { getVenueShift } from '../venues/venue-shift.js'
import { assertDevDatabase, devActorFor, devDemoPassword, ensureDevAccounts } from './dev-accounts.js'

export const DEV_SCENARIOS = {
  empty: 'Ca trống',
  quiet: 'Ca vắng',
  busy: 'Ca đông',
} as const
export type DevScenario = keyof typeof DEV_SCENARIOS

export function parseDevScenario(body: unknown): DevScenario {
  const value = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).scenario : undefined
  if (typeof value !== 'string' || !(value in DEV_SCENARIOS)) {
    throw new AppError(400, 'INVALID_DEV_SCENARIO', `scenario phải là ${Object.keys(DEV_SCENARIOS).join(', ')}.`)
  }
  return value as DevScenario
}

/**
 * Bảng dữ liệu VẬN HÀNH — bị xoá khi reset. Mọi bảng khác là cấu hình (mặt bằng,
 * menu, tài khoản, quyền) và được giữ nguyên.
 *
 * Hai danh sách phải phủ kín schema: một migration thêm bảng mới mà chưa xếp vào
 * đây thì reset từ chối chạy (DEV_RESET_UNCLASSIFIED_TABLE), thay vì để sót dữ
 * liệu cũ hay lỡ xoá cấu hình. Test `dev-data.test.ts` giữ hai danh sách không
 * chồng nhau.
 */
export const DEV_WIPE_TABLES = [
  // TU-45/TU-46: hoá đơn và giao dịch thu tiền là dữ liệu VẬN HÀNH, cùng nhóm
  // với `sales_orders` và `visits`. Tài khoản nhận tiền cho QR thì không: nó
  // nằm trong `venue_settings`, tức là cấu hình, nên reset Dev giữ nguyên.
  'bill_charge_lines', 'bill_line_sources', 'bill_lines', 'bill_payments', 'bills',
  'booking_call_logs', 'customer_duplicate_dismissals', 'customers', 'idempotency_keys', 'operation_log',
  'preparation_line_progress', 'preparation_line_progress_events', 'preparation_print_outbox',
  'preparation_print_retry_events', 'preparation_ready_acknowledgements', 'preparation_ready_audiences',
  'preparation_ready_events', 'preparation_ready_notifications', 'preparation_ticket_events', 'preparation_tickets',
  'reception_guest_counts', 'reservations', 'sales_order_cancellations', 'sales_order_line_changes',
  'sales_order_lines', 'sales_orders', 'staff_notifications', 'table_allocations', 'table_group_members',
  'table_groups', 'table_holds', 'table_turns', 'visits', 'waitlist_contact_attempts', 'waitlist_entries',
  'waitlist_table_preferences',
] as const

export const DEV_KEEP_TABLES = [
  'auth_sessions', 'booking_sources', 'dining_tables', 'floors', 'membership_roles', 'memberships',
  'menu_categories', 'menu_item_variants', 'menu_items', 'menu_variant_prices', 'organizations', 'permissions',
  'preparation_print_capabilities', 'role_permissions', 'roles', 'schema_migrations', 'table_adjacencies',
  'table_combination_members', 'table_combinations', 'user_permission_overrides', 'users', 'venue_settings',
  'venues', 'zones',
] as const

async function wipeOperationalData(connection: PoolConnection, organizationId: number, venueId: number): Promise<void> {
  const [tableRows] = await connection.query<(RowDataPacket & { name: string })[]>(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
  )
  const known = new Set<string>([...DEV_WIPE_TABLES, ...DEV_KEEP_TABLES])
  const unknown = tableRows.map((row) => row.name).filter((name) => !known.has(name))
  if (unknown.length) {
    throw new AppError(409, 'DEV_RESET_UNCLASSIFIED_TABLE',
      `Bảng chưa được xếp loại cho reset Dev: ${unknown.join(', ')}. Thêm vào DEV_WIPE_TABLES hoặc DEV_KEEP_TABLES.`)
  }
  const existing = new Set(tableRows.map((row) => row.name))
  // Thứ tự xoá giữa các bảng có khoá ngoại vòng (visits ↔ reservations, nhóm
  // bàn ↔ allocation) không có lời giải gọn; tắt kiểm khoá ngoại trong phiên
  // này, xoá trọn các bảng vận hành, rồi bật lại trước khi commit.
  await connection.query('SET FOREIGN_KEY_CHECKS = 0')
  try {
    for (const table of DEV_WIPE_TABLES) {
      if (existing.has(table)) await connection.query(`DELETE FROM \`${table}\``)
    }
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1')
  }
  // Mọi máy đang mở sơ đồ thấy con trỏ đổi và tự tải lại.
  await connection.execute(
    'UPDATE venues SET change_seq = change_seq + 1 WHERE organization_id = ? AND id = ?',
    [organizationId, venueId],
  )
}

async function recordDevDataAudit(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  action: 'DEV_DATA_RESET' | 'DEV_DATA_SEEDED',
  details: Record<string, unknown>,
): Promise<void> {
  await connection.execute(
    `INSERT INTO operation_log
      (organization_id, venue_id, occurred_at, actor_kind, actor_user_id, actor_membership_id,
       auth_session_id, action, entity_type, entity_id, changes, reason_code, is_undoable)
     VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, 'venue', ?, CAST(? AS JSON), 'MANUAL', 0)`,
    [
      actor.organizationId, actor.venueId, realNow(), actor.userId, actor.membershipId,
      actor.authSessionId ?? null, action, actor.venueId,
      JSON.stringify([{ type: action.toLowerCase(), ...details }]),
    ],
  )
}

export interface DevDataResult {
  scenario: DevScenario | 'reset'
  businessDate: string | null
  simulatedNow: string
  counts: {
    accountsCreated: number
    seatedParties: number
    bookingsUpcoming: number
    bookingsLate: number
    bookingsUnassigned: number
    waitlist: number
    tableGroups: number
    orders: number
    cancellationRequests: number
    menuItemsAvailable: number
  }
  notes: string[]
  durationMs: number
}

function emptyCounts(): DevDataResult['counts'] {
  return {
    accountsCreated: 0, seatedParties: 0, bookingsUpcoming: 0, bookingsLate: 0, bookingsUnassigned: 0,
    waitlist: 0, tableGroups: 0, orders: 0, cancellationRequests: 0, menuItemsAvailable: 0,
  }
}

export async function resetDevData(actor: AuthenticatedActor): Promise<DevDataResult> {
  const started = Date.now()
  const connection = await databasePool.getConnection()
  try {
    await assertDevDatabase(connection)
    await connection.beginTransaction()
    await wipeOperationalData(connection, actor.organizationId, actor.venueId)
    await recordDevDataAudit(connection, actor, 'DEV_DATA_RESET', {})
    await connection.commit()
  } catch (error) {
    await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    connection.release()
  }
  return {
    scenario: 'reset', businessDate: null, simulatedNow: applicationNow().toISOString(),
    counts: emptyCounts(), notes: ['Đã xoá sạch dữ liệu vận hành. Mặt bằng, menu và tài khoản giữ nguyên.'],
    durationMs: Date.now() - started,
  }
}

// ---------------------------------------------------------------------------
// Dựng kịch bản
// ---------------------------------------------------------------------------

/** Tên và SĐT GIẢ. Đầu số 0900 000 xxx không cấp cho thuê bao thật nào của quán. */
const FAKE_NAMES = [
  'Anh Tuấn', 'Chị Hà', 'Anh Long', 'Chị Ngọc', 'Anh Bảo', 'Chị Trâm', 'Anh Huy', 'Chị Linh', 'Anh Tùng',
  'Chị Thảo', 'Anh Khoa', 'Chị Yến', 'Anh Thịnh', 'Chị Thư', 'Anh Phúc', 'Chị Hân', 'Anh Duy', 'Chị My',
  'Anh Nam', 'Chị Vy', 'Anh Quân', 'Chị Mai', 'Anh Sơn', 'Chị Lan', 'Anh Đức', 'Chị Hoa', 'Anh Minh',
  'Chị Trang', 'Anh Hải', 'Chị Nhung', 'Anh Việt', 'Chị Giang', 'Anh Kiên', 'Chị Ánh', 'Anh Lâm',
  'Chị Uyên', 'Anh Phong', 'Chị Diệp', 'Anh Toàn', 'Chị Quỳnh',
]

function fakePhone(index: number): string {
  return `0900000${String(100 + index).padStart(3, '0')}`
}

const VENUE_OFFSET_MS = 7 * 3_600_000
const RECEPTION_START_MIN = 19 * 60
const RECEPTION_END_MIN = 25 * 60

/** Phút kể từ 00:00 (giờ Việt Nam) của ngày ca; qua nửa đêm thì > 1440. */
function minutesIntoBusinessDate(now: Date, businessDate: string): number {
  const midnightUtc = Date.parse(`${businessDate}T00:00:00Z`) - VENUE_OFFSET_MS
  return Math.floor((now.getTime() - midnightUtc) / 60_000)
}

function instantAt(businessDate: string, minutes: number): Date {
  return new Date(Date.parse(`${businessDate}T00:00:00Z`) - VENUE_OFFSET_MS + minutes * 60_000)
}

/** RFC3339 có offset +07:00 như màn Lễ tân gửi lên. */
function expectedAtIso(businessDate: string, minutes: number): string {
  const local = new Date(instantAt(businessDate, minutes).getTime() + VENUE_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
    + `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00+07:00`
}

/** Làm tròn xuống mốc 15 phút (luật đặt bàn của API), kẹp vào khung nhận khách 19:00–01:00. */
function slot(minutes: number): number | null {
  const rounded = Math.floor(minutes / 15) * 15
  if (rounded < RECEPTION_START_MIN || rounded > RECEPTION_END_MIN) return null
  return rounded
}

interface TableRow extends RowDataPacket { id: number; code: string; kind: string }
interface MenuRow extends RowDataPacket {
  variant_id: number; price_id: number; price_version: number; preparation_station: PreparationStation
}

interface ScenarioPlan {
  seatedWalkIn: number
  seatedFromBooking: number
  groups: number
  barSeats: number
  late: number
  soon: number
  later: number
  unassigned: number
  waitlist: number
  /** Số đơn gọi món tối đa mỗi Phiên đang ngồi. */
  maxOrdersPerVisit: number
  advanceTickets: boolean
  cancellation: boolean
}

const PLANS: Record<DevScenario, ScenarioPlan> = {
  empty: { seatedWalkIn: 0, seatedFromBooking: 0, groups: 0, barSeats: 0, late: 0, soon: 0, later: 0, unassigned: 0, waitlist: 0, maxOrdersPerVisit: 0, advanceTickets: false, cancellation: false },
  quiet: { seatedWalkIn: 3, seatedFromBooking: 2, groups: 0, barSeats: 2, late: 0, soon: 1, later: 2, unassigned: 0, waitlist: 0, maxOrdersPerVisit: 1, advanceTickets: true, cancellation: false },
  busy: { seatedWalkIn: 6, seatedFromBooking: 5, groups: 1, barSeats: 14, late: 3, soon: 2, later: 2, unassigned: 5, waitlist: 6, maxOrdersPerVisit: 3, advanceTickets: true, cancellation: true },
}

/** Bộ sinh số giả cố định: cùng kịch bản cho ra cùng bố cục, dễ so trước/sau. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

export async function seedDevScenario(caller: AuthenticatedActor, scenario: DevScenario): Promise<DevDataResult> {
  const started = Date.now()
  const counts = emptyCounts()
  const notes: string[] = []
  const now = applicationNow()
  const shift = await getVenueShift(caller)

  // Kiểm trước khi xoá: ngoài giờ ca thì không dựng được ca nào, và không được
  // để người bấm mất dữ liệu cũ mà không nhận lại gì.
  if (scenario !== 'empty') {
    try {
      currentBusinessDate(now, shift)
    } catch {
      throw new AppError(409, 'DEV_SEED_OUTSIDE_SHIFT',
        'Đồng hồ đang ngoài giờ ca. Mở Đồng hồ Dev, chọn một mốc trong ca (VD 23:30) rồi bấm lại.')
    }
  }
  const businessDate = businessDateAt(now, shift)

  // 1) Xoá dữ liệu vận hành cũ + bảo đảm đủ tài khoản mẫu, trong một transaction.
  const connection = await databasePool.getConnection()
  let menu: MenuRow[]
  let tables: TableRow[]
  let barSeats: TableRow[]
  let sourceCode = 'HOTLINE'
  try {
    await assertDevDatabase(connection)
    await connection.beginTransaction()
    await wipeOperationalData(connection, caller.organizationId, caller.venueId)
    const password = devDemoPassword()
    if (password) {
      const accounts = await ensureDevAccounts(connection, caller.organizationId, caller.venueId, password, false)
      counts.accountsCreated = accounts.filter((account) => account.action === 'created').length
    } else {
      notes.push('Chưa khai DEV_DEMO_PASSWORD trong .env nên không tạo tài khoản mẫu (xem docs/dev-environment.md mục 12).')
    }
    await connection.commit()

    const [tableRows] = await connection.execute<TableRow[]>(
      `SELECT t.id, t.code, t.kind FROM dining_tables AS t
         JOIN zones AS z ON z.venue_id = t.venue_id AND z.id = t.zone_id AND z.is_bookable = 1
        WHERE t.organization_id = ? AND t.venue_id = ? AND t.status = 'ACTIVE' AND t.is_spare = 0
        ORDER BY t.kind, z.sort_order, t.code`,
      [caller.organizationId, caller.venueId],
    )
    tables = tableRows.filter((row) => row.kind === 'TABLE')
    barSeats = tableRows.filter((row) => row.kind === 'BAR_SEAT')

    const [menuRows] = await connection.execute<MenuRow[]>(
      `SELECT mv.id AS variant_id, p.id AS price_id, p.version AS price_version, mi.preparation_station
         FROM menu_item_variants mv
         JOIN menu_items mi ON mi.venue_id = mv.venue_id AND mi.id = mv.menu_item_id
         JOIN menu_categories mc ON mc.venue_id = mi.venue_id AND mc.id = mi.category_id AND mc.is_active = 1
         JOIN menu_variant_prices p ON p.venue_id = mv.venue_id AND p.variant_id = mv.id AND ${currentPricePredicate('p')}
        WHERE mv.venue_id = ? AND mv.is_active = 1 AND mv.is_sellable = 1 AND mv.availability_status = 'AVAILABLE'
          AND mi.is_active = 1 AND ${menuSourcePredicate('mi')}
        ORDER BY mi.preparation_station, mv.id`,
      [caller.venueId],
    )
    menu = menuRows
    counts.menuItemsAvailable = menu.length

    const [sourceRows] = await connection.execute<(RowDataPacket & { code: string })[]>(
      `SELECT code FROM booking_sources WHERE organization_id = ? AND is_active = 1 ORDER BY sort_order LIMIT 1`,
      [caller.organizationId],
    ).catch(async () => connection.execute<(RowDataPacket & { code: string })[]>(
      'SELECT code FROM booking_sources WHERE organization_id = ? ORDER BY sort_order LIMIT 1',
      [caller.organizationId],
    ))
    if (sourceRows[0]) sourceCode = sourceRows[0].code
  } catch (error) {
    await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    connection.release()
  }

  if (scenario === 'empty') {
    await auditSeed(caller, scenario, counts, businessDate)
    notes.unshift('Ca trống: chỉ còn mặt bằng, menu và tài khoản mẫu.')
    return { scenario, businessDate, simulatedNow: now.toISOString(), counts, notes, durationMs: Date.now() - started }
  }

  // 2) Người thao tác: đúng tài khoản mẫu của từng vai; thiếu thì dùng người bấm.
  const actors = await withConnection(async (c) => ({
    reception: await devActorFor(c, caller.organizationId, caller.venueId, 'letan_dev'),
    waiter: await devActorFor(c, caller.organizationId, caller.venueId, 'phucvu_dev'),
    bar: await devActorFor(c, caller.organizationId, caller.venueId, 'bartender_dev'),
    kitchen: await devActorFor(c, caller.organizationId, caller.venueId, 'bep_dev'),
  }))
  const reception: AuthenticatedActor = actors.reception ?? caller
  const waiter: AuthenticatedActor = actors.waiter ?? caller
  const stationActor = (station: PreparationStation): AuthenticatedActor =>
    (station === 'BAR' ? actors.bar : actors.kitchen) ?? caller

  const plan = PLANS[scenario]
  const random = seeded(scenario === 'busy' ? 2111 : 1907)
  const nowMin = minutesIntoBusinessDate(now, businessDate)
  const freeTables = [...tables]
  const takeTables = (n: number): number[] | null => (freeTables.length >= n ? freeTables.splice(0, n).map((t) => t.id) : null)
  let nameIndex = 0
  const nextGuest = () => {
    const index = nameIndex++
    return { guestName: FAKE_NAMES[index % FAKE_NAMES.length]!, phoneNumber: fakePhone(index), partySize: 2 + (index % 4) }
  }
  const seatedVisits: number[] = []
  const tryStep = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (notes.length < 12) notes.push(`${label}: ${message}`)
    }
  }

  // 2a) Tốp đã ngồi, đi thẳng vào (Walk-in), có một cụm bàn ghép.
  for (let i = 0; i < plan.groups; i++) {
    const tableIds = takeTables(2)
    if (!tableIds) break
    await tryStep('Bàn ghép', async () => {
      const guest = nextGuest()
      const result = await createWalkIn(reception, { ...guest, partySize: 7, businessDate, tableIds, capacityOverrideConfirmed: true })
      seatedVisits.push(result.visitId)
      counts.seatedParties++
      counts.tableGroups++
    })
  }
  for (let i = 0; i < plan.seatedWalkIn; i++) {
    const tableIds = takeTables(1)
    if (!tableIds) break
    await tryStep('Walk-in', async () => {
      const result = await createWalkIn(reception, { ...nextGuest(), businessDate, tableIds, capacityOverrideConfirmed: true })
      seatedVisits.push(result.visitId)
      counts.seatedParties++
    })
  }

  // 2b) Tốp đặt trước đã tới: đặt bàn lúc đầu ca rồi đón khách.
  const earlyNow = instantAt(businessDate, shift.startHour * 60)
  for (let i = 0; i < plan.seatedFromBooking; i++) {
    const at = slot(Math.min(nowMin - 30 - i * 10, RECEPTION_END_MIN))
    if (at === null) break
    const tableIds = takeTables(1)
    if (!tableIds) break
    await tryStep('Đặt bàn đã tới', async () => {
      const booking = await createAndAssignBooking(reception, {
        ...nextGuest(), expectedAt: expectedAtIso(businessDate, at), businessDate, sourceCode, tableIds,
        capacityOverrideConfirmed: true,
      }, earlyNow)
      await checkInBooking(reception, booking.id, booking.version)
      const visitId = await withConnection(async (c) => {
        const [rows] = await c.execute<(RowDataPacket & { visit_id: number | null })[]>(
          'SELECT visit_id FROM reservations WHERE venue_id = ? AND id = ?', [caller.venueId, booking.id])
        return rows[0]?.visit_id ?? null
      })
      if (visitId) seatedVisits.push(Number(visitId))
      counts.seatedParties++
    })
  }

  // 2c) Khách ngồi quầy Bar, mỗi người một ghế.
  for (let i = 0; i < plan.barSeats && i < barSeats.length; i++) {
    const seat = barSeats[i]!
    await tryStep('Ghế Bar', async () => {
      const guest = nextGuest()
      const result = await createWalkIn(reception, { guestName: guest.guestName, partySize: 1, businessDate, tableIds: [seat.id] })
      seatedVisits.push(result.visitId)
      counts.seatedParties++
    })
  }

  // 2d) Đặt trước chưa tới: trễ (đỏ), sắp tới (vàng), còn lâu (xanh dương).
  const bookAhead = async (kind: 'late' | 'soon' | 'later', minutes: number) => {
    const at = slot(minutes)
    if (at === null) {
      if (notes.length < 12) notes.push(`Bỏ qua 1 đặt bàn "${kind}": giờ ${Math.floor(minutes / 60) % 24}h nằm ngoài khung 19:00–01:00.`)
      return
    }
    const tableIds = takeTables(1)
    if (!tableIds) return
    await tryStep('Đặt bàn chưa tới', async () => {
      await createAndAssignBooking(reception, {
        ...nextGuest(), expectedAt: expectedAtIso(businessDate, at), businessDate, sourceCode, tableIds,
        capacityOverrideConfirmed: true,
      }, kind === 'late' ? earlyNow : now)
      if (kind === 'late') counts.bookingsLate++
      else counts.bookingsUpcoming++
    })
  }
  for (let i = 0; i < plan.late; i++) await bookAhead('late', nowMin - 20 - i * 10)
  for (let i = 0; i < plan.soon; i++) await bookAhead('soon', nowMin + 15)
  for (let i = 0; i < plan.later; i++) await bookAhead('later', nowMin + 60 + i * 30)

  // 2e) Đặt trước chưa xếp bàn (nằm ở Bàn chờ ảo của Lễ tân).
  for (let i = 0; i < plan.unassigned; i++) {
    const at = slot(Math.max(nowMin + 45 + i * 15, RECEPTION_START_MIN + 30))
    if (at === null) break
    await tryStep('Đặt bàn chưa xếp', async () => {
      await createBooking(reception, { ...nextGuest(), expectedAt: expectedAtIso(businessDate, at), businessDate, sourceCode }, now)
      counts.bookingsUnassigned++
    })
  }

  // 2f) Khách vãng lai đang chờ bàn.
  for (let i = 0; i < plan.waitlist; i++) {
    await tryStep('Bàn chờ', async () => {
      const guest = nextGuest()
      await createWaitlistEntry(reception, {
        businessDate, contactChannel: 'IN_PERSON', kind: 'WALK_IN',
        guestName: guest.guestName, partySize: guest.partySize,
      })
      counts.waitlist++
    })
  }

  // 3) Gọi món + đẩy phiếu Bar/Bếp qua đủ trạng thái + một yêu cầu huỷ món.
  if (!menu.length) {
    notes.push('Chưa có danh mục món nên bỏ phần gọi món. Chạy `pnpm --filter @21gam/api menu:import --file=<xlsx> --apply` rồi bấm lại.')
  } else if (plan.maxOrdersPerVisit > 0) {
    const barMenu = menu.filter((row) => row.preparation_station === 'BAR')
    const kitchenMenu = menu.filter((row) => row.preparation_station === 'KITCHEN')
    const pick = (rows: MenuRow[]) => rows[Math.floor(random() * rows.length)]
    const createdOrders: number[] = []
    let orderSerial = 0
    for (const visitId of seatedVisits) {
      const orderCount = 1 + Math.floor(random() * plan.maxOrdersPerVisit)
      for (let o = 0; o < orderCount; o++) {
        const lines = []
        const lineCount = 1 + Math.floor(random() * 3)
        for (let l = 0; l < lineCount; l++) {
          const source = (l === 0 || !kitchenMenu.length) && barMenu.length ? barMenu : (kitchenMenu.length ? kitchenMenu : barMenu)
          const row = pick(source)
          if (row) lines.push({ variantId: Number(row.variant_id), priceId: Number(row.price_id), priceVersion: Number(row.price_version), quantity: 1 + Math.floor(random() * 2) })
        }
        // Không gửi hai dòng trùng biến thể trong một đơn: gộp số lượng.
        const merged = new Map<number, (typeof lines)[number]>()
        for (const line of lines) {
          const existing = merged.get(line.variantId)
          if (existing) existing.quantity += line.quantity
          else merged.set(line.variantId, { ...line })
        }
        await tryStep('Gọi món', async () => {
          const detail = await createWaiterOrder(waiter, {
            visitId, lines: [...merged.values()], idempotencyKey: `dev-seed-${started}-${orderSerial++}`,
          })
          createdOrders.push(Number(detail.orderId))
          counts.orders++
        })
      }
    }

    // Yêu cầu huỷ món TRƯỚC khi đẩy phiếu: món đã làm xong thì Phục vụ không được
    // xin huỷ (phải ghi hao), nên phải xin lúc phiếu còn Mới.
    if (plan.cancellation && createdOrders.length) {
      await tryStep('Yêu cầu huỷ món', async () => {
        const orderId = createdOrders[createdOrders.length - 1]!
        const [lineRows] = await databasePool.execute<(RowDataPacket & { line_no: number; version: number })[]>(
          `SELECT line_no, version FROM sales_order_lines WHERE venue_id = ? AND order_id = ? ORDER BY line_no LIMIT 1`,
          [caller.venueId, orderId],
        )
        const line = lineRows[0]
        if (!line) return
        await requestOrderLineCancellation(waiter, {
          orderId, lineNo: Number(line.line_no), expectedLineVersion: Number(line.version), quantity: 1,
          reason: 'Khách đổi ý (dữ liệu mẫu)', acknowledgeWaste: true, idempotencyKey: `dev-seed-${started}-cancel`,
        })
        counts.cancellationRequests++
      })
    }
    if (plan.advanceTickets && createdOrders.length) {
      const [ticketRows] = await databasePool.execute<(RowDataPacket & { id: number; station: PreparationStation; version: number })[]>(
        `SELECT id, station, version FROM preparation_tickets WHERE venue_id = ? ORDER BY id`,
        [caller.venueId],
      )
      // Rải phiếu ra đủ cột: 1/5 giữ Mới, còn lại lần lượt Đã nhận → Đang làm → Xong → Đã lấy.
      const ladder: PreparationStatus[] = ['ACCEPTED', 'PREPARING', 'READY', 'COLLECTED']
      let serial = 0
      for (const [index, ticket] of ticketRows.entries()) {
        const target = index % 5
        let version = Number(ticket.version)
        for (let step = 0; step < target; step++) {
          const toStatus = ladder[step]!
          const ok = await tryStepValue(async () => transitionPreparationTicket(stationActor(ticket.station), {
            ticketId: Number(ticket.id), station: ticket.station, toStatus, expectedVersion: version,
            idempotencyKey: `dev-seed-${started}-t${serial++}`,
          }))
          if (!ok) break
          version = ok.ticket.version
        }
      }
    }
  }

  await auditSeed(caller, scenario, counts, businessDate)
  return { scenario, businessDate, simulatedNow: now.toISOString(), counts, notes, durationMs: Date.now() - started }
}

async function tryStepValue<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

async function withConnection<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await databasePool.getConnection()
  try {
    return await fn(connection)
  } finally {
    connection.release()
  }
}

async function auditSeed(
  actor: AuthenticatedActor,
  scenario: DevScenario,
  counts: DevDataResult['counts'],
  businessDate: string,
): Promise<void> {
  await withConnection(async (connection) => {
    await recordDevDataAudit(connection, actor, 'DEV_DATA_SEEDED', { scenario, label: DEV_SCENARIOS[scenario], businessDate, counts })
    await connection.execute(
      'UPDATE venues SET change_seq = change_seq + 1 WHERE organization_id = ? AND id = ?',
      [actor.organizationId, actor.venueId],
    )
  })
}

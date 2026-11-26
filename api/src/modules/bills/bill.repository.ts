/**
 * TU-45 — chốt bill.
 *
 * Mọi luật nghiệp vụ nằm ở đây, TRONG transaction đang giữ khóa dòng `visits`,
 * không ở route. Kiểm ở route là kiểm trên dữ liệu đã cũ ngay khi câu lệnh tiếp
 * theo chạy: giữa `SELECT` của route và `INSERT` của repository, một máy khác
 * kịp gửi thêm một đơn, và tờ bill thiếu một ly.
 *
 * Thứ tự khóa, và nó là luật chứ không ngẫu nhiên:
 *
 * 1. Khóa dòng `venues`. Số thứ tự bill trong ngày (`daily_seq`) dùng chung cho
 *    MỌI Phiên của quán, nên khóa theo Phiên không đủ: hai bàn chốt cùng lúc sẽ
 *    cùng đọc `MAX(daily_seq)` và cùng xin số 412. Khóa venue serialize việc
 *    chốt bill trong một quán — một hàng đợi rất ngắn, vì transaction này chỉ
 *    đọc và ghi vài chục dòng.
 * 2. Khóa dòng `visits`. Nó serialize với `lockOrderableVisit` của module gọi
 *    món, nên không có đơn nào được chèn vào giữa lúc bill đang được dựng.
 * 3. Đọc món, kiểm luật, ghi bill.
 *
 * Bill đã chốt là BẤT BIẾN. Không hàm nào ở đây UPDATE `bill_lines` hay
 * `bill_charge_lines`. Sửa một bill là một revision mới — một con số khách đã
 * nhìn thì phải còn đọc lại được.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { redactPhoneNumbersInNote } from '../../security/note-privacy.js'
import { applicationNow } from '../../time/application-clock.js'
import { createHash } from 'node:crypto'

import { groupDisplayCode } from '../tables/floor-projection.repository.js'
import { billShortCode, buildBillCode, businessDateString, buildTransferNote } from './bill-code.js'
import {
  assertGroupingIsConsistent,
  groupBillableLines,
  type BillableOrderLine,
  type GroupedBillLine,
} from './bill-grouping.js'
import { readQrConfiguration } from './qr-config.js'
import { buildVietQrPayload, maskAccountNumber, normalizeBeneficiaryName } from './vietqr.js'
import {
  MAX_BILL_LINES,
  buildBillTotals,
  buildChargeLedger,
  buildPricingPolicySnapshot,
  type BillTotals,
} from './bill-total.js'
import {
  BILL_FEATURES_IN_DEVELOPMENT,
  PAYMENT_METHOD_OPTIONS,
  type BillActor,
  type BillBlocker,
  type BillChargeView,
  type BillLineView,
  type BillListItem,
  type BillListView,
  type BillPreviewView,
  type BillStatus,
  type BillView,
  type CloseBillInput,
} from './bill.model.js'

type Queryable = Pool | PoolConnection

/* ------------------------------- đọc số liệu ------------------------------ */

function isoDateTime(value: Date | string): string {
  return (value instanceof Date ? value : new Date(`${value}Z`)).toISOString()
}

/**
 * Đọc một con số tiền từ database.
 *
 * `bigNumberStrings: true` nên BIGINT về dưới dạng chuỗi; `Number()` trên một
 * chuỗi quá lớn cho ra một số đã làm tròn mà không báo gì. Thà trả lỗi 500 còn
 * hơn trả một hoá đơn lệch: một màn hình báo lỗi thì có người gọi điện, một
 * tổng tiền sai thì không.
 */
function readMoney(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppError(500, 'BILL_AMOUNT_UNREADABLE', 'Không đọc được số tiền của bill.', { field })
  }
  return parsed
}

interface VisitRow extends RowDataPacket {
  id: number | string
  business_date: Date | string
  started_at: Date | string
  ended_at: Date | string | null
  paid_marked_at: Date | string | null
}

interface VenueRow extends RowDataPacket {
  vat_rate_basis_points: number | string
}

interface SeatingRow extends RowDataPacket {
  table_codes: string | null
  group_symbol_no: number | string | null
}

interface BillableLineRow extends RowDataPacket {
  order_line_id: number | string
  variant_id: number | string
  item_code: string
  item_name: string
  variant_display_name: string
  unit_code: string
  note: string | null
  unit_price_vnd: number | string
  remaining_quantity: number | string
}

/**
 * Món của Phiên CHƯA LÊN BILL NÀO — nguồn duy nhất để dựng một hoá đơn.
 *
 * V12 đổi câu hỏi: một Phiên có nhiều bill, nên "Phiên này có món gì" không còn
 * là câu đúng. Trừ ra phần đã góp vào các bill chưa huỷ, nếu không bill thứ hai
 * lặp lại toàn bộ món của bill thứ nhất và khách bị thu tiền hai lần.
 *
 * Bill ĐÃ HUỶ nhả món của nó ra: `status <> 'VOIDED'` trong câu con. Một bill bị
 * huỷ nghĩa là tiền đó chưa thu, nên món phải quay lại hàng chờ xuất hoá đơn.
 *
 * Trả về dòng đơn THÔ, chưa gộp. Phép gộp nằm ở `bill-grouping.ts` để nó test
 * được không cần MySQL, và để mỗi dòng bill mang theo danh sách dòng đơn đã góp
 * vào nó — thứ mà lần xuất hoá đơn sau cần để trừ cho đúng.
 *
 * Câu này KHÔNG join `menu_variant_prices`: bill đọc snapshot trên dòng đơn, nên
 * một lần đổi giá lúc 23h không viết lại tờ bill của đơn gửi lúc 21h.
 */
async function readBillableOrderLines(
  connection: Queryable,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<BillableOrderLine[]> {
  const [rows] = await connection.execute<BillableLineRow[]>(
    `SELECT l.id AS order_line_id,
            l.menu_item_variant_id AS variant_id,
            l.item_code, l.item_name, l.variant_display_name, l.unit_code, l.note,
            l.unit_price_vnd,
            (l.net_quantity - IFNULL(billed.quantity, 0)) AS remaining_quantity
       FROM sales_order_lines l
       JOIN sales_orders o ON o.venue_id = l.venue_id AND o.id = l.order_id
       LEFT JOIN (
         SELECT s.order_line_id, SUM(s.quantity) AS quantity
           FROM bill_line_sources s
           JOIN bills b ON b.venue_id = s.venue_id AND b.id = s.bill_id
          WHERE s.venue_id = ? AND b.status <> 'VOIDED'
          GROUP BY s.order_line_id
       ) AS billed ON billed.order_line_id = l.id
      WHERE l.venue_id = ? AND o.visit_id = ?
        AND (l.net_quantity - IFNULL(billed.quantity, 0)) > 0
      ORDER BY l.id`,
    [actor.venueId, actor.venueId, visitId],
  )
  return rows.map((row) => ({
    orderLineId: Number(row.order_line_id),
    variantId: Number(row.variant_id),
    itemCode: row.item_code,
    itemName: row.item_name,
    variantDisplayName: row.variant_display_name,
    unitCode: row.unit_code,
    // Ghi chú là ô gõ tự do và đã có lần mang theo số điện thoại khách. Lược ở
    // đây, nơi dữ liệu đi vào bill, chứ không ở màn hình: một tờ hoá đơn in ra
    // không đi qua màn hình nào.
    note: redactPhoneNumbersInNote(row.note),
    unitPriceVnd: readMoney(row.unit_price_vnd, 'unit_price_vnd'),
    remainingQuantity: Number(row.remaining_quantity),
  }))
}

/** Dòng bill sẽ xuất, đã gộp — dùng cho cả preview và lúc ghi. */
async function readBillableLines(
  connection: Queryable,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<GroupedBillLine[]> {
  const grouped = groupBillableLines(await readBillableOrderLines(connection, actor, visitId))
  assertGroupingIsConsistent(grouped)
  return grouped
}

/** Dòng bill dưới dạng hợp đồng API (bỏ `sources`, thứ chỉ máy chủ cần). */
function toLineView(line: GroupedBillLine): BillLineView {
  return {
    lineNo: line.lineNo,
    sourceOrderLineId: line.sourceOrderLineId,
    itemCode: line.itemCode,
    itemName: line.itemName,
    variantDisplayName: line.variantDisplayName,
    unitCode: line.unitCode,
    note: line.note,
    quantity: line.quantity,
    unitPriceVnd: line.unitPriceVnd,
    amountVnd: line.amountVnd,
  }
}

/**
 * Bàn và cụm của Phiên.
 *
 * Một cụm bàn ghép dùng MỘT `visits.id` (mọi `table_allocations` của cụm trỏ về
 * cùng một Phiên), nên "một cụm, một bill" đúng tự nhiên — không cần code riêng,
 * chỉ cần không làm sai. `GROUP_CONCAT` cho ra "A1,A2" đúng như bảng thao tác bàn.
 */
async function readSeating(
  connection: Queryable,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<{ tableCodes: string[]; groupSymbol: string | null }> {
  const [rows] = await connection.execute<SeatingRow[]>(
    `SELECT GROUP_CONCAT(DISTINCT dt.code ORDER BY dt.code SEPARATOR ',') AS table_codes,
            MIN(g.symbol_no) AS group_symbol_no
       FROM table_allocations ta
       JOIN dining_tables dt
         ON dt.organization_id = ta.organization_id AND dt.venue_id = ta.venue_id AND dt.id = ta.table_id
       LEFT JOIN table_groups g
         ON g.venue_id = ta.venue_id AND g.id = ta.group_id AND g.dissolved_at IS NULL
      WHERE ta.organization_id = ? AND ta.venue_id = ? AND ta.visit_id = ?
        AND ta.kind = 'USAGE' AND ta.released_at IS NULL`,
    [actor.organizationId, actor.venueId, visitId],
  )
  const row = rows[0]
  const symbolNo = row?.group_symbol_no === null || row?.group_symbol_no === undefined
    ? null
    : Number(row.group_symbol_no)
  return {
    tableCodes: row?.table_codes ? row.table_codes.split(',') : [],
    groupSymbol: symbolNo === null ? null : groupDisplayCode(symbolNo),
  }
}

async function countOrders(connection: Queryable, actor: AuthenticatedActor, visitId: number): Promise<number> {
  const [rows] = await connection.execute<(RowDataPacket & { order_count: number | string })[]>(
    'SELECT COUNT(*) AS order_count FROM sales_orders WHERE venue_id = ? AND visit_id = ?',
    [actor.venueId, visitId],
  )
  return Number(rows[0]?.order_count ?? 0)
}

/**
 * Số yêu cầu hủy món còn chờ duyệt (Q5).
 *
 * `net_quantity` CHƯA trừ những dòng này, nên chốt bill khi còn yêu cầu treo
 * nghĩa là khách trả tiền một món sắp được hủy — và đường hoàn lại là "hủy bill
 * đã thanh toán", thứ đang chờ HU-43. Nên chặn, và nói rõ còn mấy yêu cầu để
 * màn hình dẫn người dùng tới chỗ duyệt.
 */
async function countPendingCancellations(
  connection: Queryable,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<number> {
  const [rows] = await connection.execute<(RowDataPacket & { pending_count: number | string })[]>(
    `SELECT COUNT(*) AS pending_count
       FROM sales_order_cancellations c
       JOIN sales_orders o ON o.venue_id = c.venue_id AND o.id = c.order_id
      WHERE c.venue_id = ? AND o.visit_id = ? AND c.status = 'PENDING'`,
    [actor.venueId, visitId],
  )
  return Number(rows[0]?.pending_count ?? 0)
}

interface OpenBillRow extends RowDataPacket {
  id: number | string
  bill_code: string
  total_vnd: number | string
}

async function findOpenBill(
  connection: Queryable,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<{ billId: number; billCode: string; totalVnd: number } | null> {
  const [rows] = await connection.execute<OpenBillRow[]>(
    `SELECT id, bill_code, total_vnd FROM bills
      WHERE venue_id = ? AND visit_id = ? AND status = 'AWAITING_PAYMENT'`,
    [actor.venueId, visitId],
  )
  const row = rows[0]
  if (!row) return null
  return { billId: Number(row.id), billCode: row.bill_code, totalVnd: readMoney(row.total_vnd, 'total_vnd') }
}

async function readVisit(
  connection: Queryable,
  actor: AuthenticatedActor,
  visitId: number,
  forUpdate: boolean,
): Promise<VisitRow> {
  const [rows] = await connection.execute<VisitRow[]>(
    `SELECT id, business_date, started_at, ended_at, paid_marked_at FROM visits
      WHERE organization_id = ? AND venue_id = ? AND id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [actor.organizationId, actor.venueId, visitId],
  )
  const visit = rows[0]
  if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy Phiên bàn trong địa điểm này.')
  return visit
}

/* --------------------------------- preview -------------------------------- */

/**
 * Con số sẽ được chốt, cùng danh sách lý do chưa chốt được.
 *
 * `blockers` trả về thay vì `throw`: màn hình cần hiện nút ở trạng thái khoá KÈM
 * LÝ DO trước khi người dùng bấm. Một nút xám không nói vì sao là một nút nhân
 * viên sẽ bấm mười lần rồi gọi điện.
 */
export async function previewBill(actor: AuthenticatedActor, visitId: number): Promise<BillPreviewView> {
  const visit = await readVisit(databasePool, actor, visitId, false)
  if (visit.ended_at !== null) {
    throw new AppError(409, 'VISIT_ALREADY_CLOSED', 'Phiên bàn đã kết thúc.')
  }

  const [venues] = await databasePool.execute<VenueRow[]>(
    'SELECT vat_rate_basis_points FROM venues WHERE organization_id = ? AND id = ?',
    [actor.organizationId, actor.venueId],
  )
  const venue = venues[0]
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')

  const [lines, seating, orderCount, pendingCancellations, openBill] = await Promise.all([
    readBillableLines(databasePool, actor, visitId),
    readSeating(databasePool, actor, visitId),
    countOrders(databasePool, actor, visitId),
    countPendingCancellations(databasePool, actor, visitId),
    findOpenBill(databasePool, actor, visitId),
  ])

  const totals = buildBillTotals(lines, Number(venue.vat_rate_basis_points))
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0)

  const blockers: BillBlocker[] = []
  if (lines.length === 0) {
    blockers.push({
      code: 'BILL_EMPTY',
      message: openBill
        ? `Mọi món đã nằm trên hoá đơn ${openBill.billCode}. Gọi thêm món mới xuất được hoá đơn tiếp.`
        : 'Bàn chưa gọi món nào, nên chưa có gì để xuất hoá đơn.',
    })
  }
  if (pendingCancellations > 0) {
    blockers.push({
      code: 'ORDER_CANCELLATION_PENDING',
      message: `Còn ${pendingCancellations} yêu cầu hủy món chờ duyệt. Duyệt hoặc từ chối trước khi chốt bill.`,
      context: { pendingCount: pendingCancellations },
    })
  }
  // V12: có bill chưa thu KHÔNG còn chặn việc xuất hoá đơn tiếp. Khách gọi thêm
  // sau khi đã cầm hoá đơn là chuyện bình thường, và món mới phải lên một bill
  // mới của cùng Phiên. `openBill` vẫn được đọc để màn hình nói cho người dùng
  // biết Phiên đang còn bill nào chưa thu.
  if (visit.paid_marked_at !== null) {
    blockers.push({ code: 'VISIT_ALREADY_PAID', message: 'Phiên đã thanh toán.' })
  }

  return {
    visitId,
    tableCodes: seating.tableCodes,
    groupSymbol: seating.groupSymbol,
    orderCount,
    lines: lines.map(toLineView),
    charges: buildChargeLedger(totals, itemCount),
    ...totals,
    previewedAt: applicationNow().toISOString(),
    blockers,
    notAvailable: BILL_FEATURES_IN_DEVELOPMENT,
  }
}

/* -------------------------------- chốt bill ------------------------------- */

/**
 * Khóa dòng `venues` và trả về thuế suất.
 *
 * Hai việc trong một câu, cố ý: thuế suất phải đọc TRONG transaction (một lần
 * đổi thuế đang chạy song song không được chen vào giữa), và khóa này cũng là
 * thứ serialize việc cấp `daily_seq` giữa các Phiên khác nhau của cùng quán.
 */
async function lockVenue(connection: PoolConnection, actor: AuthenticatedActor): Promise<number> {
  const [rows] = await connection.execute<VenueRow[]>(
    `SELECT vat_rate_basis_points FROM venues
      WHERE organization_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId],
  )
  const venue = rows[0]
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Không tìm thấy địa điểm vận hành.')
  return Number(venue.vat_rate_basis_points)
}

async function nextDailySeq(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  businessDate: string,
): Promise<number> {
  const [rows] = await connection.execute<(RowDataPacket & { next_seq: number | string })[]>(
    `SELECT COALESCE(MAX(daily_seq), 0) + 1 AS next_seq FROM bills
      WHERE venue_id = ? AND business_date = ?`,
    [actor.venueId, businessDate],
  )
  return Number(rows[0]?.next_seq ?? 1)
}

async function nextRevision(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  visitId: number,
): Promise<number> {
  const [rows] = await connection.execute<(RowDataPacket & { next_revision: number | string })[]>(
    `SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision FROM bills
      WHERE venue_id = ? AND visit_id = ?`,
    [actor.venueId, visitId],
  )
  return Number(rows[0]?.next_revision ?? 1)
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
}

interface BillQr {
  provider: string
  payload: string
  sha256: string
  transferNote: string
}

/**
 * Chuỗi QR của hoá đơn, hoặc `null` khi quán chưa khai tài khoản nhận tiền.
 *
 * Không ném lỗi khi thiếu cấu hình: v1.1 đặt QR lên hoá đơn, và chặn xuất hoá
 * đơn vì thiếu số tài khoản sẽ chặn luôn cả luồng TIỀN MẶT — thứ chạy được mà
 * không cần ngân hàng nào. Hoá đơn vẫn ra, phần QR để trống, và màn Thu ngân
 * khoá thẻ Chuyển khoản kèm lý do (TN-09-K4).
 */
async function buildBillQr(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  billCode: string,
  totalVnd: number,
): Promise<BillQr | null> {
  const config = await readQrConfiguration(connection, actor)
  if (!config) return null
  const transferNote = buildTransferNote(config.venueShortName, billCode)
  try {
    const payload = buildVietQrPayload({
      beneficiary: {
        bankBin: config.bankBin,
        accountNumber: config.accountNumber,
        accountName: normalizeBeneficiaryName(config.accountName),
      },
      amountVnd: totalVnd,
      transferNote,
    })
    return {
      provider: 'VIETQR_DYNAMIC',
      payload,
      sha256: createHash('sha256').update(payload).digest('hex'),
      transferNote,
    }
  } catch {
    // Cấu hình sai dạng (BIN không phải 6 chữ số, tên có dấu…) không được làm
    // hỏng việc xuất hoá đơn. Hoá đơn ra không QR, và Thu ngân thu tiền mặt.
    return null
  }
}

async function insertBill(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  visit: VisitRow,
  input: CloseBillInput,
  lines: GroupedBillLine[],
  totals: BillTotals,
  itemCount: number,
): Promise<number> {
  const businessDate = businessDateString(visit.business_date)
  const dailySeq = await nextDailySeq(connection, actor, businessDate)
  const revision = await nextRevision(connection, actor, visit.id as number)
  const billCode = buildBillCode(businessDate, dailySeq)

  // HU-44 v1.1 — QR nằm TRÊN HOÁ ĐƠN, sinh ngay lúc xuất (TN-02-K4): Phục vụ
  // bấm Xuất hoá đơn là có mã đúng số tiền để đưa khách cầm ra quầy. Ở bản
  // trước nó được sinh lúc Thu ngân chọn phương thức, tức là khách phải đứng
  // tại quầy mới thấy QR.
  //
  // Thiếu cấu hình tài khoản thì VẪN xuất hoá đơn, chỉ không có QR. Chặn ở đây
  // sẽ chặn luôn cả luồng tiền mặt, và quán chưa cung cấp số tài khoản (HD-06).
  const qr = await buildBillQr(connection, actor, billCode, totals.totalVnd)

  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO bills
       (organization_id, venue_id, visit_id, business_date, bill_code, daily_seq, revision, status,
        vat_rate_basis_points, subtotal_vnd, vat_vnd, pre_round_total_vnd, rounding_adjustment_vnd, total_vnd,
        line_count, item_count, pricing_policy_snapshot, closed_by_user_id, idempotency_key,
        qr_provider, qr_payload, qr_payload_sha256, qr_transfer_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'AWAITING_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?)`,
    [
      actor.organizationId, actor.venueId, Number(visit.id), businessDate, billCode, dailySeq, revision,
      totals.vatRateBasisPoints, totals.subtotalVnd, totals.vatVnd, totals.preRoundTotalVnd,
      totals.roundingAdjustmentVnd, totals.totalVnd,
      lines.length, itemCount,
      JSON.stringify(buildPricingPolicySnapshot(totals.vatRateBasisPoints)),
      actor.userId, input.idempotencyKey,
      qr?.provider ?? null, qr?.payload ?? null, qr?.sha256 ?? null, qr?.transferNote ?? null,
    ],
  )
  const billId = Number(result.insertId)

  for (const line of lines) {
    const [lineResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bill_lines
         (organization_id, venue_id, bill_id, line_no, source_order_line_id,
          item_code, item_name, variant_display_name, unit_code, note, quantity, unit_price_vnd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.organizationId, actor.venueId, billId, line.lineNo, line.sourceOrderLineId,
        line.itemCode, line.itemName, line.variantDisplayName, line.unitCode, line.note,
        line.quantity, line.unitPriceVnd,
      ],
    )
    // V12 — dòng đơn nào góp bao nhiêu vào dòng bill này. Thiếu bảng này thì
    // lần Xuất hoá đơn sau lấy lại toàn bộ món của lần trước, và khách bị thu
    // tiền hai lần.
    const lineId = Number(lineResult.insertId)
    for (const source of line.sources) {
      await connection.execute(
        `INSERT INTO bill_line_sources
           (organization_id, venue_id, bill_id, bill_line_id, order_line_id, quantity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [actor.organizationId, actor.venueId, billId, lineId, source.orderLineId, source.quantity],
      )
    }
  }

  for (const charge of buildChargeLedger(totals, itemCount)) {
    await connection.execute(
      `INSERT INTO bill_charge_lines
         (organization_id, venue_id, bill_id, sequence_no, charge_code,
          basis_amount_vnd, rate_basis_points, signed_amount_vnd, explanation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.organizationId, actor.venueId, billId, charge.sequenceNo, charge.chargeCode,
        charge.basisAmountVnd, charge.rateBasisPoints, charge.signedAmountVnd, charge.explanation,
      ],
    )
  }

  // Nhật ký: ai chốt, cho Phiên nào, bao nhiêu tiền.
  //
  // `changes` KHÔNG mang `lines[]` và KHÔNG mang ghi chú món — ghi chú là ô gõ
  // tự do, và nhật ký này đọc được qua `audit.read` rồi xuất ra CSV. Đúng tiền
  // lệ của `SALES_ORDER_CREATED` (0036).
  await connection.execute(
    `INSERT INTO operation_log
       (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
        idempotency_key, action, entity_type, entity_id, entity_version_before, entity_version_after,
        changes, reason_code, is_undoable)
     VALUES (?, ?, 'USER', ?, ?, ?, ?, 'BILL_CLOSED', 'bill', ?, NULL, 1, CAST(? AS JSON), 'MANUAL', 0)`,
    [
      actor.organizationId, actor.venueId, actor.userId, actor.membershipId, actor.authSessionId ?? null,
      input.idempotencyKey, billId,
      JSON.stringify([{
        type: 'bill_closed',
        billCode,
        visitId: Number(visit.id),
        revision,
        lineCount: lines.length,
        itemCount,
        subtotalVnd: totals.subtotalVnd,
        vatRateBasisPoints: totals.vatRateBasisPoints,
        vatVnd: totals.vatVnd,
        preRoundTotalVnd: totals.preRoundTotalVnd,
        roundingAdjustmentVnd: totals.roundingAdjustmentVnd,
        totalVnd: totals.totalVnd,
      }]),
    ],
  )

  // Con trỏ realtime. Mọi mutation đã bump cột này trong transaction của nó;
  // SSE chỉ phát sau khi commit (xem `afterIdempotencyCommit` ở route), nên một
  // transaction rollback không thể phát ra một event.
  await connection.execute(
    `UPDATE venues SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
      WHERE organization_id = ? AND id = ?`,
    [actor.organizationId, actor.venueId],
  )

  return billId
}

/**
 * Chốt bill: khoá con số khách phải trả, Phiên chuyển sang Chờ thanh toán.
 *
 * `transaction` là transaction của middleware chống trùng. Khi có nó, middleware
 * tự COMMIT/ROLLBACK và việc gọi rollback ở đây sẽ đóng transaction trước khi
 * middleware kịp lưu kết quả — nên hàm này không chạm vào nó.
 */
export async function closeBill(
  actor: AuthenticatedActor,
  input: CloseBillInput,
  transaction?: PoolConnection,
): Promise<BillView> {
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()

    const vatRateBasisPoints = await lockVenue(connection, actor)
    const visit = await readVisit(connection, actor, input.visitId, true)

    if (visit.ended_at !== null) {
      throw new AppError(409, 'VISIT_ALREADY_CLOSED', 'Phiên bàn đã kết thúc, không chốt bill được.')
    }
    if (visit.paid_marked_at !== null) {
      throw new AppError(409, 'VISIT_ALREADY_PAID', 'Phiên bàn đã thanh toán.')
    }

    // V12: KHÔNG chặn khi Phiên đã có bill chưa thu. Khách gọi thêm sau khi đã
    // cầm hoá đơn là chuyện bình thường, và món mới lên một bill mới của cùng
    // Phiên (TN-02-K6). Thứ chặn trùng lặp không còn là "một bill mỗi Phiên" mà
    // là `bill_line_sources`: món đã lên bill thì không lên lần nữa.

    const pendingCancellations = await countPendingCancellations(connection, actor, input.visitId)
    if (pendingCancellations > 0) {
      throw new AppError(
        409,
        'ORDER_CANCELLATION_PENDING',
        'Còn yêu cầu hủy món chờ duyệt. Duyệt hoặc từ chối trước khi chốt bill.',
        { pendingCount: pendingCancellations },
      )
    }

    const [allocations] = await connection.execute<RowDataPacket[]>(
      `SELECT 1 FROM table_allocations
        WHERE organization_id = ? AND venue_id = ? AND visit_id = ?
          AND kind = 'USAGE' AND released_at IS NULL LIMIT 1`,
      [actor.organizationId, actor.venueId, input.visitId],
    )
    if (!allocations[0]) {
      throw new AppError(409, 'VISIT_NOT_SEATED', 'Phiên chưa gắn với bàn đang có khách.')
    }

    const lines = await readBillableLines(connection, actor, input.visitId)
    if (lines.length === 0) {
      throw new AppError(
        422,
        'BILL_EMPTY',
        'Không còn món nào chưa lên hoá đơn.',
      )
    }
    if (lines.length > MAX_BILL_LINES) {
      throw new AppError(422, 'BILL_TOO_MANY_LINES', 'Bill có quá nhiều dòng món.', { lineCount: lines.length })
    }

    const totals = buildBillTotals(lines, vatRateBasisPoints)
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0)

    // Khách gọi thêm một ly giữa lúc đưa tạm tính cho khách xem và lúc bấm Chốt
    // là chuyện xảy ra thật. Thà trả 409 kèm tổng mới còn hơn chốt một con số
    // khác con số khách vừa đồng ý.
    if (input.expectedTotalVnd !== undefined && input.expectedTotalVnd !== totals.totalVnd) {
      throw new AppError(409, 'BILL_TOTAL_CHANGED', 'Tổng tiền đã thay đổi. Xem lại rồi chốt lại.', {
        expectedTotalVnd: input.expectedTotalVnd,
        actualTotalVnd: totals.totalVnd,
      })
    }

    let billId: number
    try {
      billId = await insertBill(connection, actor, visit, input, lines, totals, itemCount)
    } catch (error) {
      // Lưới cuối: `uq_bills_daily_seq`, `uq_bills_visit_revision` và
      // `uq_bill_line_sources_pair`. Cái cuối là cái quan trọng từ V12: nó chặn
      // một dòng đơn được tính vào cùng một dòng bill hai lần, kể cả khi hai
      // thiết bị bấm Xuất hoá đơn đồng thời và cả hai cùng đọc thấy "còn món".
      if (isDuplicateKey(error)) {
        throw new AppError(
          409,
          'BILL_LINES_ALREADY_BILLED',
          'Máy khác vừa xuất hoá đơn cho những món này. Xem lại rồi xuất lại.',
        )
      }
      throw error
    }

    const view = await readBillView(connection, actor, billId)
    if (ownsTransaction) await connection.commit()
    return view
  } catch (error) {
    if (ownsTransaction) await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

/* ------------------------------- đọc một bill ----------------------------- */

interface BillRow extends RowDataPacket {
  id: number | string
  visit_id: number | string
  business_date: Date | string
  bill_code: string
  daily_seq: number | string
  revision: number | string
  status: BillStatus
  vat_rate_basis_points: number | string
  subtotal_vnd: number | string
  vat_vnd: number | string
  pre_round_total_vnd: number | string
  rounding_adjustment_vnd: number | string
  total_vnd: number | string
  line_count: number | string
  item_count: number | string
  closed_by_user_id: number | string
  closed_by_display_name: string
  closed_at: Date | string
  paid_by_user_id: number | string | null
  paid_by_display_name: string | null
  paid_at: Date | string | null
  qr_provider: string | null
  qr_payload: string | null
  qr_transfer_note: string | null
  version: number | string
}

const billSelect = `SELECT b.id, b.visit_id, b.business_date, b.bill_code, b.daily_seq, b.revision, b.status,
       b.vat_rate_basis_points, b.subtotal_vnd, b.vat_vnd, b.pre_round_total_vnd,
       b.rounding_adjustment_vnd, b.total_vnd, b.line_count, b.item_count,
       b.closed_by_user_id, cu.display_name AS closed_by_display_name, b.closed_at,
       b.paid_by_user_id, pu.display_name AS paid_by_display_name, b.paid_at,
       b.qr_provider, b.qr_payload, b.qr_transfer_note, b.version
     FROM bills b
     JOIN users cu ON cu.id = b.closed_by_user_id
     LEFT JOIN users pu ON pu.id = b.paid_by_user_id`

function actorOf(userId: unknown, displayName: string | null): BillActor | null {
  if (userId === null || userId === undefined || displayName === null) return null
  return { userId: Number(userId), displayName }
}

/**
 * `connection` cho phép đọc lại bill NGAY TRONG transaction vừa tạo nó, nên
 * response mang đúng trạng thái sẽ được commit — không phải trạng thái cũ đọc
 * từ pool ở ngoài.
 */
export async function readBillView(
  connection: Queryable,
  actor: AuthenticatedActor,
  billId: number,
): Promise<BillView> {
  const [rows] = await connection.execute<BillRow[]>(
    `${billSelect} WHERE b.organization_id = ? AND b.venue_id = ? AND b.id = ?`,
    [actor.organizationId, actor.venueId, billId],
  )
  const row = rows[0]
  // 404 chứ không 403 khi bill thuộc quán khác: một 403 nói với người gọi rằng
  // bill đó có tồn tại.
  if (!row) throw new AppError(404, 'BILL_NOT_FOUND', 'Không tìm thấy bill trong địa điểm này.')

  const visitId = Number(row.visit_id)
  const [lineRows] = await connection.execute<(RowDataPacket & {
    line_no: number | string
    source_order_line_id: number | string
    item_code: string
    item_name: string
    variant_display_name: string
    unit_code: string
    note: string | null
    quantity: number | string
    unit_price_vnd: number | string
    amount_vnd: number | string
  })[]>(
    `SELECT line_no, source_order_line_id, item_code, item_name, variant_display_name,
            unit_code, note, quantity, unit_price_vnd, amount_vnd
       FROM bill_lines WHERE venue_id = ? AND bill_id = ? ORDER BY line_no`,
    [actor.venueId, billId],
  )
  const [chargeRows] = await connection.execute<(RowDataPacket & {
    sequence_no: number | string
    charge_code: BillChargeView['chargeCode']
    basis_amount_vnd: number | string
    rate_basis_points: number | string | null
    signed_amount_vnd: number | string
    explanation: string
  })[]>(
    `SELECT sequence_no, charge_code, basis_amount_vnd, rate_basis_points, signed_amount_vnd, explanation
       FROM bill_charge_lines WHERE venue_id = ? AND bill_id = ? ORDER BY sequence_no`,
    [actor.venueId, billId],
  )

  const [seating, orderCount, qrConfig] = await Promise.all([
    readSeating(connection, actor, visitId),
    countOrders(connection, actor, visitId),
    readQrConfiguration(connection, actor),
  ])

  return {
    id: Number(row.id),
    billCode: row.bill_code,
    shortCode: billShortCode(Number(row.daily_seq)),
    visitId,
    businessDate: businessDateString(row.business_date),
    revision: Number(row.revision),
    status: row.status,
    tableCodes: seating.tableCodes,
    groupSymbol: seating.groupSymbol,
    orderCount,
    lineCount: Number(row.line_count),
    itemCount: Number(row.item_count),
    lines: lineRows.map((line): BillLineView => ({
      lineNo: Number(line.line_no),
      sourceOrderLineId: Number(line.source_order_line_id),
      itemCode: line.item_code,
      itemName: line.item_name,
      variantDisplayName: line.variant_display_name,
      unitCode: line.unit_code,
      note: redactPhoneNumbersInNote(line.note),
      quantity: Number(line.quantity),
      unitPriceVnd: readMoney(line.unit_price_vnd, 'unit_price_vnd'),
      amountVnd: readMoney(line.amount_vnd, 'amount_vnd'),
    })),
    charges: chargeRows.map((charge): BillChargeView => ({
      sequenceNo: Number(charge.sequence_no),
      chargeCode: charge.charge_code,
      basisAmountVnd: readMoney(charge.basis_amount_vnd, 'basis_amount_vnd'),
      rateBasisPoints: charge.rate_basis_points === null ? null : Number(charge.rate_basis_points),
      signedAmountVnd: Number(charge.signed_amount_vnd),
      explanation: charge.explanation,
    })),
    subtotalVnd: readMoney(row.subtotal_vnd, 'subtotal_vnd'),
    vatRateBasisPoints: Number(row.vat_rate_basis_points),
    vatVnd: readMoney(row.vat_vnd, 'vat_vnd'),
    preRoundTotalVnd: readMoney(row.pre_round_total_vnd, 'pre_round_total_vnd'),
    roundingAdjustmentVnd: readMoney(row.rounding_adjustment_vnd, 'rounding_adjustment_vnd'),
    totalVnd: readMoney(row.total_vnd, 'total_vnd'),
    closedBy: actorOf(row.closed_by_user_id, row.closed_by_display_name) ?? {
      userId: Number(row.closed_by_user_id),
      displayName: '',
    },
    closedAt: isoDateTime(row.closed_at),
    paidBy: actorOf(row.paid_by_user_id, row.paid_by_display_name),
    paidAt: row.paid_at === null ? null : isoDateTime(row.paid_at),
    qr: row.qr_payload === null
      ? null
      : {
          provider: row.qr_provider ?? 'VIETQR_DYNAMIC',
          payload: row.qr_payload,
          transferNote: row.qr_transfer_note ?? '',
          beneficiary: {
            bankBin: qrConfig?.bankBin ?? '',
            // Khách quét mã chứ không đọc số tài khoản. Che nó để một ảnh chụp
            // màn hình gửi qua Zalo không mang theo số đầy đủ.
            accountNumber: qrConfig ? maskAccountNumber(qrConfig.accountNumber) : '',
            accountName: qrConfig ? normalizeBeneficiaryName(qrConfig.accountName) : '',
          },
          amountVnd: readMoney(row.total_vnd, 'total_vnd'),
          isDemo: qrConfig?.isDemo ?? true,
        },
    // Chuyển khoản chỉ dùng được khi hoá đơn có QR. Thiếu cấu hình thì thẻ bị
    // khoá kèm lý do, và Tiền mặt vẫn chạy (TN-09-K4).
    paymentMethods: PAYMENT_METHOD_OPTIONS.map((option) =>
      option.method === 'BANK_TRANSFER' && row.qr_payload === null
        ? {
            ...option,
            available: false,
            reason: 'Chưa cấu hình tài khoản nhận tiền của quán.',
          }
        : option),
    notAvailable: BILL_FEATURES_IN_DEVELOPMENT,
    version: Number(row.version),
  }
}

export async function getBill(actor: AuthenticatedActor, billId: number): Promise<BillView> {
  return readBillView(databasePool, actor, billId)
}

/* --------------------------- Màn 1: Phiên đang mở ------------------------- */

interface ListRow extends RowDataPacket {
  visit_id: number | string
  started_at: Date | string
  bill_id: number | string | null
  bill_code: string | null
  daily_seq: number | string | null
  bill_status: BillStatus | null
  closed_at: Date | string | null
  vat_rate_basis_points: number | string
  item_count: number | string | null
  subtotal_vnd: number | string | null
  vat_vnd: number | string | null
  pre_round_total_vnd: number | string | null
  rounding_adjustment_vnd: number | string | null
  total_vnd: number | string | null
}

/**
 * Màn 1 — mọi Phiên CHƯA thanh toán của một ngày kinh doanh.
 *
 * Một cụm bàn ghép cho ra ĐÚNG MỘT hàng, vì cả cụm dùng một `visits.id`. Đó là
 * yêu cầu "cụm bàn ghép chỉ có 1 thẻ" của mockup, và nó không cần code riêng —
 * chỉ cần không GROUP BY theo bàn.
 *
 * Phiên chưa chốt bill vẫn xuất hiện, với `status = 'SERVING'` và tổng tính
 * sống từ món đang có. Hai lý do: bộ lọc của mockup có nhóm "Đang phục vụ", và
 * Thu ngân cần thấy bàn nào sắp tới lượt chứ không chỉ bàn đã chốt.
 */
export async function listOpenBills(
  actor: AuthenticatedActor,
  businessDate: string,
): Promise<BillListView> {
  const [rows] = await databasePool.execute<ListRow[]>(
    `SELECT v.id AS visit_id, v.started_at,
            b.id AS bill_id, b.bill_code, b.daily_seq, b.status AS bill_status, b.closed_at,
            ve.vat_rate_basis_points, b.item_count,
            b.subtotal_vnd, b.vat_vnd, b.pre_round_total_vnd, b.rounding_adjustment_vnd, b.total_vnd
       FROM visits v
       JOIN venues ve ON ve.organization_id = v.organization_id AND ve.id = v.venue_id
       LEFT JOIN bills b
         ON b.venue_id = v.venue_id AND b.visit_id = v.id AND b.status = 'AWAITING_PAYMENT'
      WHERE v.organization_id = ? AND v.venue_id = ? AND v.business_date = ?
        AND v.ended_at IS NULL AND v.paid_marked_at IS NULL
      ORDER BY v.started_at`,
    [actor.organizationId, actor.venueId, businessDate],
  )

  const items: BillListItem[] = []
  for (const row of rows) {
    const visitId = Number(row.visit_id)
    const [seating, orderCount] = await Promise.all([
      readSeating(databasePool, actor, visitId),
      countOrders(databasePool, actor, visitId),
    ])
    // Bàn chưa chốt bill thì chưa có con số nào được khoá, nên tổng được tính
    // sống từ món đang có — cùng công thức, cùng hàm, nên con số trên thẻ Phiên
    // không bao giờ lệch con số trên tờ bill sau khi chốt.
    const closed = row.bill_id !== null
    const lines = closed ? [] : await readBillableLines(databasePool, actor, visitId)
    const live = buildBillTotals(lines, Number(row.vat_rate_basis_points))
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0)

    items.push({
      billId: closed ? Number(row.bill_id) : null,
      billCode: row.bill_code,
      shortCode: row.daily_seq === null ? null : billShortCode(Number(row.daily_seq)),
      visitId,
      status: closed ? (row.bill_status ?? 'AWAITING_PAYMENT') : 'SERVING',
      tableCodes: seating.tableCodes,
      groupSymbol: seating.groupSymbol,
      orderCount,
      itemCount: closed ? Number(row.item_count ?? 0) : itemCount,
      startedAt: isoDateTime(row.started_at),
      closedAt: row.closed_at === null ? null : isoDateTime(row.closed_at),
      subtotalVnd: closed ? readMoney(row.subtotal_vnd, 'subtotal_vnd') : live.subtotalVnd,
      vatRateBasisPoints: Number(row.vat_rate_basis_points),
      vatVnd: closed ? readMoney(row.vat_vnd, 'vat_vnd') : live.vatVnd,
      preRoundTotalVnd: closed ? readMoney(row.pre_round_total_vnd, 'pre_round_total_vnd') : live.preRoundTotalVnd,
      roundingAdjustmentVnd: closed
        ? readMoney(row.rounding_adjustment_vnd, 'rounding_adjustment_vnd')
        : live.roundingAdjustmentVnd,
      totalVnd: closed ? readMoney(row.total_vnd, 'total_vnd') : live.totalVnd,
    })
  }

  const awaitingPayment = items.filter((item) => item.status === 'AWAITING_PAYMENT').length
  return {
    businessDate,
    counts: {
      all: items.length,
      serving: items.length - awaitingPayment,
      awaitingPayment,
    },
    items,
  }
}

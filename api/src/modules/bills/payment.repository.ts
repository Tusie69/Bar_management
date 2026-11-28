/**
 * TU-46 — thu tiền một bill.
 *
 * Hai phương thức, hai số bước, và sự khác nhau đó là cố ý:
 *
 * - TIỀN MẶT là MỘT bước. Nhân viên đang cầm tiền trong tay; bắt họ tick thêm
 *   một ô "đã nhận đủ" là thêm một lần chạm cho một điều họ vừa làm.
 * - CHUYỂN KHOẢN là HAI bước: sinh QR (`PENDING`), rồi xác nhận tay
 *   (`CAPTURED`). Chưa có cổng thanh toán (CH-02), nên người bấm đang THAY cổng
 *   khẳng định tiền đã về. Một ô tick và một cái tên là cái giá rẻ nhất để khi
 *   sao kê lệch có người trả lời được. Việc này không mâu thuẫn quyết định
 *   22/11 "bấm thanh toán là coi như xong": vẫn không chờ webhook, vẫn đóng
 *   bill ngay khi bấm.
 *
 * Thu tiền xong thì Phiên ĐÓNG, bàn về Trống và lượt khách +1 — tất cả TRONG
 * CÙNG transaction đã ghi giao dịch. Tách ra thành transaction thứ hai nghĩa là
 * có một khoảnh khắc tiền đã ghi mà bàn vẫn bận, và một lần mất kết nối ở giữa
 * sẽ để nó kẹt ở đó tới hết ca.
 *
 * Cụm bàn ghép GIỮ quan hệ ghép sau khi thanh toán (TN-12): `closeVisitWithinTransaction`
 * dùng `dissolveUnusedGroups`, hàm này chỉ thu hồi cụm CLAIM tạm thời và không
 * bao giờ chạm cụm LAYOUT của Lễ tân. Tách cụm là thao tác riêng của Lễ tân.
 */
import { createHash } from 'node:crypto'

import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import type { AuthenticatedActor } from '../../auth/authenticated-actor.js'
import { databasePool } from '../../database/pool.js'
import { AppError } from '../../errors/app-error.js'
import { closeVisitWithinTransaction } from '../visits/visit.repository.js'
import { readBillView } from './bill.repository.js'
import {
  missingQrSettings,
  readQrConfiguration,
  type QrConfiguration,
} from './qr-config.js'
import { maskAccountNumber, normalizeBeneficiaryName } from './vietqr.js'
import type {
  BillView,
  CapturePaymentInput,
  ConfirmPaymentInput,
  PaymentMethod,
  PaymentView,
  SettlementView,
} from './bill.model.js'

/* ------------------------------ cấu hình QR ------------------------------- */

/**
 * Cấu hình tài khoản nhận tiền, hoặc 409 khi quán chưa khai.
 *
 * Từ v1.1, chuỗi QR được sinh lúc XUẤT HOÁ ĐƠN và lưu trên `bills`; hàm này chỉ
 * còn dùng để dựng phần hiển thị (tên chủ tài khoản, số đã che) và để báo lỗi
 * đúng nghĩa khi Thu ngân chọn Chuyển khoản trên một hoá đơn không có QR.
 */
async function requireQrConfiguration(
  connection: PoolConnection,
  actor: AuthenticatedActor,
): Promise<QrConfiguration> {
  const config = await readQrConfiguration(connection, actor)
  if (!config) {
    throw new AppError(
      409,
      'PAYMENT_QR_NOT_CONFIGURED',
      'Chưa cấu hình tài khoản nhận tiền cho mã QR. Thu tiền mặt vẫn dùng được.',
      { missing: await missingQrSettings(connection, actor) },
    )
  }
  return config
}

/* --------------------------------- đọc bill ------------------------------- */

interface LockedBillRow extends RowDataPacket {
  id: number | string
  visit_id: number | string
  business_date: Date | string
  bill_code: string
  status: string
  total_vnd: number | string
  qr_payload: string | null
  qr_transfer_note: string | null
  version: number | string
}

async function lockBill(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  billId: number,
): Promise<LockedBillRow> {
  const [rows] = await connection.execute<LockedBillRow[]>(
    `SELECT id, visit_id, business_date, bill_code, status, total_vnd,
            qr_payload, qr_transfer_note, version FROM bills
      WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, billId],
  )
  const bill = rows[0]
  // 404 chứ không 403 khi bill thuộc quán khác: một 403 nói rằng nó có tồn tại.
  if (!bill) throw new AppError(404, 'BILL_NOT_FOUND', 'Không tìm thấy bill trong địa điểm này.')
  return bill
}

interface SettledRow extends RowDataPacket {
  id: number | string
  method: PaymentMethod
  confirmed_at: Date | string
  display_name: string
  user_id: number | string
}

/**
 * Giao dịch đã thu của bill, nếu có.
 *
 * Dùng để trả về câu "thiết bị khác đã thu, lúc mấy giờ, ai thu" thay vì một
 * lỗi trống — mockup Màn 5/6 yêu cầu đúng câu đó, và chỉ cho `Về danh sách`.
 */
async function findSettledPayment(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  billId: number,
): Promise<{ paymentId: number; method: PaymentMethod; paidAt: string; paidBy: string; paidByUserId: number } | null> {
  const [rows] = await connection.execute<SettledRow[]>(
    `SELECT p.id, p.method, p.confirmed_at, u.display_name, u.id AS user_id
       FROM bill_payments p
       JOIN users u ON u.id = p.confirmed_by_user_id
      WHERE p.venue_id = ? AND p.bill_id = ? AND p.status = 'CAPTURED'`,
    [actor.venueId, billId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    paymentId: Number(row.id),
    method: row.method,
    paidAt: isoDateTime(row.confirmed_at),
    paidBy: row.display_name,
    paidByUserId: Number(row.user_id),
  }
}

function isoDateTime(value: Date | string): string {
  return (value instanceof Date ? value : new Date(`${value}Z`)).toISOString()
}

function readMoney(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppError(500, 'BILL_AMOUNT_UNREADABLE', 'Không đọc được số tiền của bill.', { field })
  }
  return parsed
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY'
}

/**
 * Bill còn thu được không.
 *
 * `BILL_ALREADY_PAID` mang theo ai thu lúc nào, vì màn hình phải nói được câu
 * đó. Một "409 Conflict" trống khiến nhân viên bấm lại ba lần rồi gọi điện.
 */
async function assertPayable(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  bill: LockedBillRow,
): Promise<void> {
  if (bill.status === 'PAID') {
    const settled = await findSettledPayment(connection, actor, Number(bill.id))
    throw new AppError(409, 'BILL_ALREADY_PAID', 'Bill này đã được thu tiền.', {
      billCode: bill.bill_code,
      ...(settled ?? {}),
    })
  }
  if (bill.status !== 'AWAITING_PAYMENT') {
    throw new AppError(409, 'BILL_NOT_PAYABLE', 'Bill không còn ở trạng thái chờ thanh toán.', {
      status: bill.status,
    })
  }
  const settled = await findSettledPayment(connection, actor, Number(bill.id))
  if (settled) {
    throw new AppError(409, 'BILL_ALREADY_PAID', 'Bill này đã được thu tiền.', {
      billCode: bill.bill_code,
      ...settled,
    })
  }
}

/* -------------------------- đóng Phiên sau khi thu ------------------------ */

interface LockedVisitVersionRow extends RowDataPacket {
  version: number | string
  ended_at: Date | string | null
  paid_marked_at: Date | string | null
}

/**
 * Phiên đóng, bàn về Trống, lượt khách +1 (TN-13, HM-TT-04).
 *
 * `version` đọc DƯỚI khóa dòng mà transaction này đang giữ, nên nó không thể cũ
 * — đó là lý do luồng thanh toán không cần client gửi `expectedVersion` như
 * endpoint Trả bàn thủ công.
 *
 * `end_reason` của Phiên là `GUEST_LEFT` vì CHECK của `visits` chỉ cho ba giá
 * trị; sổ lượt khách thì nhận `AFTER_PAYMENT`, và `countsAsServed` tính nó là
 * một lượt đã phục vụ. Hai tên cho một sự kiện, nhưng mỗi bảng trả lời một câu
 * hỏi khác nhau.
 */
async function settleVisit(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  visitId: number,
  billCode: string,
): Promise<SettlementView> {
  const [rows] = await connection.execute<LockedVisitVersionRow[]>(
    `SELECT version, ended_at, paid_marked_at FROM visits
      WHERE organization_id = ? AND venue_id = ? AND id = ? FOR UPDATE`,
    [actor.organizationId, actor.venueId, visitId],
  )
  const visit = rows[0]
  if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Không tìm thấy Phiên bàn.')
  if (visit.ended_at !== null) {
    throw new AppError(409, 'VISIT_ALREADY_CLOSED', 'Phiên bàn đã kết thúc.')
  }

  await connection.execute(
    `UPDATE visits SET paid_marked_at = UTC_TIMESTAMP(3), paid_marked_by_user_id = ?,
            updated_at = UTC_TIMESTAMP(3)
      WHERE organization_id = ? AND venue_id = ? AND id = ?`,
    [actor.userId, actor.organizationId, actor.venueId, visitId],
  )

  const closed = await closeVisitWithinTransaction(connection, actor, {
    visitId,
    // `paid_marked_at` vừa UPDATE không chạm `version`, nên con số đọc dưới khóa
    // vẫn đúng với lần UPDATE tiếp theo.
    expectedVersion: Number(visit.version),
    reason: 'GUEST_LEFT',
    turnEndReason: 'AFTER_PAYMENT',
    auditAction: 'VISIT_CLOSED_AFTER_PAYMENT',
    note: `Thanh toán bill ${billCode}`,
  })

  return {
    visitId,
    endedAt: closed.endedAt,
    releasedTables: closed.releasedTables.map((table) => table.code),
    turn: closed.turn === null
      ? null
      : { turnNo: closed.turn.turnNo, scope: closed.turn.scope, counted: closed.turn.counted },
  }
}

/* ------------------------------ ghi giao dịch ----------------------------- */

interface PaymentRow extends RowDataPacket {
  id: number | string
  bill_id: number | string
  method: PaymentMethod
  status: PaymentView['status']
  amount_vnd: number | string
  tendered_amount_vnd: number | string | null
  change_amount_vnd: number | string | null
  confirmation_mode: 'MANUAL' | 'GATEWAY'
  qr_provider: string | null
  qr_payload: string | null
  qr_transfer_note: string | null
  collected_by_user_id: number | string
  collected_by_display_name: string
  confirmed_by_user_id: number | string | null
  confirmed_by_display_name: string | null
  confirmed_at: Date | string | null
  version: number | string
}

const paymentSelect = `SELECT p.id, p.bill_id, p.method, p.status, p.amount_vnd, p.tendered_amount_vnd,
       p.change_amount_vnd, p.confirmation_mode, p.qr_provider, p.qr_payload, p.qr_transfer_note,
       p.collected_by_user_id, cu.display_name AS collected_by_display_name,
       p.confirmed_by_user_id, fu.display_name AS confirmed_by_display_name, p.confirmed_at, p.version
     FROM bill_payments p
     JOIN users cu ON cu.id = p.collected_by_user_id
     LEFT JOIN users fu ON fu.id = p.confirmed_by_user_id`

async function readPaymentView(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  paymentId: number,
  qr: QrConfiguration | null,
): Promise<PaymentView> {
  const [rows] = await connection.execute<PaymentRow[]>(
    `${paymentSelect} WHERE p.venue_id = ? AND p.id = ?`,
    [actor.venueId, paymentId],
  )
  const row = rows[0]
  if (!row) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Không tìm thấy giao dịch thanh toán.')

  return {
    id: Number(row.id),
    billId: Number(row.bill_id),
    method: row.method,
    status: row.status,
    amountVnd: readMoney(row.amount_vnd, 'amount_vnd'),
    tenderedAmountVnd: row.tendered_amount_vnd === null ? null : readMoney(row.tendered_amount_vnd, 'tendered'),
    changeAmountVnd: row.change_amount_vnd === null ? null : readMoney(row.change_amount_vnd, 'change'),
    confirmationMode: row.confirmation_mode,
    collectedBy: { userId: Number(row.collected_by_user_id), displayName: row.collected_by_display_name },
    confirmedBy: row.confirmed_by_user_id === null || row.confirmed_by_display_name === null
      ? null
      : { userId: Number(row.confirmed_by_user_id), displayName: row.confirmed_by_display_name },
    confirmedAt: row.confirmed_at === null ? null : isoDateTime(row.confirmed_at),
    qr: row.qr_payload === null || qr === null
      ? null
      : {
          provider: row.qr_provider ?? 'VIETQR_DYNAMIC',
          payload: row.qr_payload,
          transferNote: row.qr_transfer_note ?? '',
          beneficiary: {
            bankBin: qr.bankBin,
            // Khách quét mã, không đọc số tài khoản. Che nó để một ảnh chụp màn
            // hình gửi qua Zalo không mang theo số đầy đủ.
            accountNumber: maskAccountNumber(qr.accountNumber),
            accountName: normalizeBeneficiaryName(qr.accountName),
          },
          amountVnd: readMoney(row.amount_vnd, 'amount_vnd'),
          isDemo: qr.isDemo,
        },
    // Chừa chỗ cho webhook, không giả lập nó (CH-02).
    gatewayConfirmation: {
      status: 'IN_DEVELOPMENT',
      reason: 'Chờ CH-02 chọn nhà cung cấp. Tuần này xác nhận tay.',
    },
  }
}

async function logPayment(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  action: string,
  paymentId: number,
  changes: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  // `changes` KHÔNG mang dòng món, ghi chú hay chuỗi QR. Nhật ký đọc được qua
  // `audit.read` và xuất ra CSV; chuỗi QR mang số tài khoản nhận tiền, và ghi
  // chú là ô gõ tự do đã có lần mang theo số điện thoại khách.
  await connection.execute(
    `INSERT INTO operation_log
       (organization_id, venue_id, actor_kind, actor_user_id, actor_membership_id, auth_session_id,
        idempotency_key, action, entity_type, entity_id, entity_version_before, entity_version_after,
        changes, reason_code, is_undoable)
     VALUES (?, ?, 'USER', ?, ?, ?, ?, ?, 'bill_payment', ?, NULL, 1, CAST(? AS JSON), 'MANUAL', 0)`,
    [
      actor.organizationId, actor.venueId, actor.userId, actor.membershipId, actor.authSessionId ?? null,
      idempotencyKey, action, paymentId, JSON.stringify([changes]),
    ],
  )
}

async function bumpVenue(connection: PoolConnection, actor: AuthenticatedActor): Promise<void> {
  await connection.execute(
    `UPDATE venues SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
      WHERE organization_id = ? AND id = ?`,
    [actor.organizationId, actor.venueId],
  )
}

export interface PaymentResult {
  payment: PaymentView
  bill: BillView
  settlement: SettlementView | null
}

/**
 * Tạo giao dịch thanh toán.
 *
 * Tiền mặt về thẳng `CAPTURED` và đóng Phiên ngay. Chuyển khoản dừng ở
 * `PENDING` kèm chuỗi QR, chờ `confirmPayment`.
 */
export async function capturePayment(
  actor: AuthenticatedActor,
  input: CapturePaymentInput,
  transaction?: PoolConnection,
): Promise<PaymentResult> {
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()

    // Ghi nợ bị từ chối ở API, ở route và ở CHECK của database — ba lớp cùng
    // nói một điều, nên bật nó sau này là một migration và một dòng, không phải
    // đi tìm xem còn chỗ nào khác quên (CH-05).
    if (input.method === 'CREDIT') {
      throw new AppError(422, 'PAYMENT_METHOD_NOT_AVAILABLE', 'Ghi nợ đang phát triển.', {
        status: 'IN_DEVELOPMENT',
        feature: 'CREDIT',
      })
    }

    const bill = await lockBill(connection, actor, input.billId)
    await assertPayable(connection, actor, bill)

    const amountVnd = readMoney(bill.total_vnd, 'total_vnd')
    const businessDate = typeof bill.business_date === 'string'
      ? bill.business_date.slice(0, 10)
      : bill.business_date.toISOString().slice(0, 10)

    let qr: QrConfiguration | null = null
    let qrPayload: string | null = null
    let transferNote: string | null = null

    if (input.method === 'BANK_TRANSFER') {
      // v1.1: chuỗi QR đã được sinh và lưu LÚC XUẤT HOÁ ĐƠN. Giao dịch chép lại
      // đúng chuỗi đó thay vì dựng một chuỗi mới — khách đã quét cái trên tờ
      // hoá đơn, và đối soát phải đọc đúng cái khách quét.
      qrPayload = bill.qr_payload
      transferNote = bill.qr_transfer_note
      if (qrPayload === null) {
        // Hoá đơn ra lúc quán chưa khai tài khoản. Lỗi nói đúng việc cần làm,
        // và Tiền mặt vẫn dùng được (TN-09-K4).
        throw new AppError(
          409,
          'PAYMENT_QR_NOT_CONFIGURED',
          'Hoá đơn này không có mã QR vì quán chưa cấu hình tài khoản nhận tiền. Thu tiền mặt vẫn dùng được.',
          { missing: await missingQrSettings(connection, actor) },
        )
      }
      qr = await requireQrConfiguration(connection, actor)
    }

    if (input.method === 'CASH') {
      if (input.tenderedAmountVnd === undefined) {
        throw new AppError(400, 'CASH_AMOUNT_REQUIRED', 'Phải nhập số tiền khách đưa.')
      }
      if (input.tenderedAmountVnd < amountVnd) {
        throw new AppError(422, 'CASH_AMOUNT_INSUFFICIENT', 'Khách đưa chưa đủ tiền.', {
          amountVnd,
          tenderedAmountVnd: input.tenderedAmountVnd,
          shortfallVnd: amountVnd - input.tenderedAmountVnd,
        })
      }
    }

    const capturedNow = input.method === 'CASH'

    // TN-08-K6: đang ở khối "Chờ nhận tiền" mà Thu ngân đổi sang Tiền mặt thì
    // đổi được. Dòng PENDING của mã QR phải được đóng lại, nếu không nó nằm
    // treo vĩnh viễn, làm bẩn đối soát và chặn lần tạo QR sau trên cùng bill.
    await connection.execute(
      `UPDATE bill_payments
          SET status = 'CANCELLED', failure_code = 'METHOD_SWITCHED',
              updated_at = UTC_TIMESTAMP(3), version = version + 1
        WHERE venue_id = ? AND bill_id = ? AND status = 'PENDING' AND method <> ?`,
      [actor.venueId, Number(bill.id), input.method],
    )

    // Bấm "Chuyển khoản" lần nữa trên cùng một bill — mạng chập, trình duyệt
    // tải lại, hoặc lần xác nhận trước lỗi giữa chừng — KHÔNG phải một giao
    // dịch mới: mã QR trên tờ hoá đơn không đổi, nên giao dịch đang chờ chính
    // là giao dịch đó. Trả lại nó thay vì 409, nếu không một lần xác nhận hỏng
    // sẽ khoá luôn đường thu tiền của bill này cho tới khi có người sửa tay.
    if (!capturedNow) {
      const [pendingRows] = await connection.execute<(RowDataPacket & { id: number | string })[]>(
        `SELECT id FROM bill_payments
          WHERE venue_id = ? AND bill_id = ? AND status = 'PENDING' AND method = ?`,
        [actor.venueId, Number(bill.id), input.method],
      )
      const pending = pendingRows[0]
      if (pending) {
        const payment = await readPaymentView(connection, actor, Number(pending.id), qr)
        const view = await readBillView(connection, actor, Number(bill.id))
        if (ownsTransaction) await connection.commit()
        return { payment, bill: view, settlement: null }
      }
    }

    let paymentId: number
    try {
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO bill_payments
           (organization_id, venue_id, bill_id, business_date, method, status, amount_vnd,
            tendered_amount_vnd, confirmation_mode, qr_provider, qr_payload, qr_payload_sha256,
            qr_transfer_note, collected_by_user_id, confirmed_by_user_id, confirmed_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ${capturedNow ? 'UTC_TIMESTAMP(3)' : 'NULL'}, ?)`,
        [
          actor.organizationId, actor.venueId, Number(bill.id), businessDate, input.method,
          capturedNow ? 'CAPTURED' : 'PENDING', amountVnd,
          input.method === 'CASH' ? input.tenderedAmountVnd ?? null : null,
          qrPayload === null ? null : 'VIETQR_DYNAMIC',
          qrPayload,
          qrPayload === null ? null : createHash('sha256').update(qrPayload).digest('hex'),
          transferNote,
          actor.userId,
          capturedNow ? actor.userId : null,
          input.idempotencyKey,
        ],
      )
      paymentId = Number(result.insertId)
    } catch (error) {
      // Lưới cuối: `uq_bill_payments_settled` (một bill một lần thu) và
      // `uq_bill_payments_pending` (một bill một QR đang chờ). Nếu một đường nào
      // đó lọt qua mọi lần kiểm ở trên, database vẫn chặn.
      if (isDuplicateKey(error)) {
        const settled = await findSettledPayment(connection, actor, Number(bill.id))
        if (settled) {
          throw new AppError(409, 'BILL_ALREADY_PAID', 'Bill này đã được thu tiền.', {
            billCode: bill.bill_code, ...settled,
          })
        }
        throw new AppError(409, 'PAYMENT_ALREADY_PENDING', 'Bill đã có một mã QR đang chờ nhận tiền.')
      }
      throw error
    }

    let settlement: SettlementView | null = null
    if (capturedNow) {
      settlement = await finalizeBill(connection, actor, Number(bill.id), Number(bill.visit_id), bill.bill_code)
    }

    await logPayment(
      connection,
      actor,
      capturedNow ? 'BILL_PAYMENT_CAPTURED' : 'BILL_PAYMENT_PENDING',
      paymentId,
      {
        type: capturedNow ? 'bill_payment_captured' : 'bill_payment_pending',
        billId: Number(bill.id),
        billCode: bill.bill_code,
        method: input.method,
        amountVnd,
        ...(input.method === 'CASH'
          ? {
              tenderedAmountVnd: input.tenderedAmountVnd,
              changeAmountVnd: (input.tenderedAmountVnd ?? amountVnd) - amountVnd,
            }
          : {}),
      },
      input.idempotencyKey,
    )
    await bumpVenue(connection, actor)

    const payment = await readPaymentView(connection, actor, paymentId, qr)
    const view = await readBillView(connection, actor, Number(bill.id))
    if (ownsTransaction) await connection.commit()
    return { payment, bill: view, settlement }
  } catch (error) {
    if (ownsTransaction) await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

/**
 * Bill sang PAID, và — CHỈ KHI đây là bill cuối — Phiên đóng, bàn về Trống,
 * lượt khách +1.
 *
 * HU-44 v1.1 (TN-13-K3/K4): một Phiên có nhiều bill, nên thu xong một bill
 * KHÔNG còn đồng nghĩa với đóng Phiên. Hai điều kiện phải đúng cùng lúc:
 *
 * 1. Không còn bill nào của Phiên ở trạng thái `AWAITING_PAYMENT`.
 * 2. Không còn món nào chưa lên hoá đơn.
 *
 * Thiếu điều kiện 2 thì một bàn vừa gọi thêm sẽ bị trả về Trống trong khi khách
 * còn ngồi đó — và Lễ tân sẽ xếp tốp mới vào đúng cái bàn ấy.
 *
 * Trả `null` khi Phiên chưa đóng: màn hình đọc `settlement` để biết có hiện
 * "bàn đã về Trống" hay không.
 */
async function finalizeBill(
  connection: PoolConnection,
  actor: AuthenticatedActor,
  billId: number,
  visitId: number,
  billCode: string,
): Promise<SettlementView | null> {
  await connection.execute(
    `UPDATE bills SET status = 'PAID', paid_at = UTC_TIMESTAMP(3), paid_by_user_id = ?,
            updated_at = UTC_TIMESTAMP(3), version = version + 1
      WHERE organization_id = ? AND venue_id = ? AND id = ? AND status = 'AWAITING_PAYMENT'`,
    [actor.userId, actor.organizationId, actor.venueId, billId],
  )

  const [openBills] = await connection.execute<(RowDataPacket & { total: number | string })[]>(
    `SELECT COUNT(*) AS total FROM bills
      WHERE venue_id = ? AND visit_id = ? AND status = 'AWAITING_PAYMENT'`,
    [actor.venueId, visitId],
  )
  if (Number(openBills[0]?.total ?? 0) > 0) return null

  const [unbilled] = await connection.execute<(RowDataPacket & { total: number | string })[]>(
    `SELECT COUNT(*) AS total
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
        AND (l.net_quantity - IFNULL(billed.quantity, 0)) > 0`,
    [actor.venueId, actor.venueId, visitId],
  )
  if (Number(unbilled[0]?.total ?? 0) > 0) return null

  return settleVisit(connection, actor, visitId, billCode)
}

/**
 * Xác nhận TAY một giao dịch chuyển khoản (TN-09).
 *
 * `observedTransfer` phải là `true` một cách tường minh. Không có mặc định:
 * người bấm đang thay một cổng thanh toán khẳng định tiền đã về, và dấu tick đó
 * là thứ duy nhất phân biệt "đã xem sao kê" với "bấm cho xong".
 */
export async function confirmPayment(
  actor: AuthenticatedActor,
  input: ConfirmPaymentInput,
  transaction?: PoolConnection,
): Promise<PaymentResult> {
  const connection = transaction ?? await databasePool.getConnection()
  const ownsTransaction = transaction === undefined
  try {
    if (ownsTransaction) await connection.beginTransaction()

    if (input.observedTransfer !== true) {
      throw new AppError(
        422,
        'TRANSFER_NOT_OBSERVED',
        'Phải xác nhận đã thấy tiền về trước khi ghi nhận thanh toán.',
      )
    }

    const bill = await lockBill(connection, actor, input.billId)
    await assertPayable(connection, actor, bill)

    const [rows] = await connection.execute<(RowDataPacket & {
      id: number | string
      status: string
      method: PaymentMethod
      amount_vnd: number | string
    })[]>(
      `SELECT id, status, method, amount_vnd FROM bill_payments
        WHERE venue_id = ? AND bill_id = ? AND id = ? FOR UPDATE`,
      [actor.venueId, input.billId, input.paymentId],
    )
    const payment = rows[0]
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Không tìm thấy giao dịch thanh toán.')
    if (payment.status !== 'PENDING') {
      throw new AppError(409, 'PAYMENT_NOT_PENDING', 'Giao dịch này không còn chờ xác nhận.', {
        status: payment.status,
      })
    }

    try {
      await connection.execute(
        `UPDATE bill_payments
            SET status = 'CAPTURED', confirmed_by_user_id = ?, confirmed_at = UTC_TIMESTAMP(3),
                confirmation_mode = 'MANUAL', updated_at = UTC_TIMESTAMP(3), version = version + 1
          WHERE venue_id = ? AND id = ? AND status = 'PENDING'`,
        [actor.userId, actor.venueId, input.paymentId],
      )
    } catch (error) {
      if (isDuplicateKey(error)) {
        const settled = await findSettledPayment(connection, actor, input.billId)
        throw new AppError(409, 'BILL_ALREADY_PAID', 'Bill này đã được thu tiền.', {
          billCode: bill.bill_code, ...(settled ?? {}),
        })
      }
      throw error
    }

    const settlement = await finalizeBill(
      connection, actor, input.billId, Number(bill.visit_id), bill.bill_code,
    )
    await logPayment(connection, actor, 'BILL_PAYMENT_CONFIRMED', input.paymentId, {
      type: 'bill_payment_confirmed',
      billId: input.billId,
      billCode: bill.bill_code,
      method: payment.method,
      amountVnd: readMoney(payment.amount_vnd, 'amount_vnd'),
      confirmationMode: 'MANUAL',
      observedTransfer: true,
    }, input.idempotencyKey)
    await bumpVenue(connection, actor)

    const qr = await readQrConfiguration(connection, actor).catch(() => null)
    const view = await readPaymentView(connection, actor, input.paymentId, qr)
    const billView = await readBillView(connection, actor, input.billId)
    if (ownsTransaction) await connection.commit()
    return { payment: view, bill: billView, settlement }
  } catch (error) {
    if (ownsTransaction) await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    if (ownsTransaction) connection.release()
  }
}

/**
 * Đọc lại một giao dịch — nút "Kiểm tra" của Màn 6 gọi cái này.
 *
 * Nó KHÔNG tự đóng bill dù thấy gì, đúng như mockup: chưa có cổng thanh toán,
 * nên không có nguồn nào ngoài con mắt của nhân viên để nói rằng tiền đã về.
 */
export async function getPayment(
  actor: AuthenticatedActor,
  billId: number,
  paymentId: number,
): Promise<PaymentView> {
  const connection = await databasePool.getConnection()
  try {
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT 1 FROM bill_payments WHERE venue_id = ? AND bill_id = ? AND id = ?',
      [actor.venueId, billId, paymentId],
    )
    if (!rows[0]) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Không tìm thấy giao dịch thanh toán.')
    const qr = await readQrConfiguration(connection, actor).catch(() => null)
    return await readPaymentView(connection, actor, paymentId, qr)
  } finally {
    connection.release()
  }
}

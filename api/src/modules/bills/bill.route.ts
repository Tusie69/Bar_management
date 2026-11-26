/**
 * TU-45 — năm endpoint của bill đã chốt, cộng một endpoint trả lời "chưa làm".
 *
 * Venue KHÔNG bao giờ đọc từ request: nó nằm trong session (`actor.venueId`),
 * nên một máy của quán A không chốt được bill của quán B kể cả khi nó biết
 * `visitId` của quán B.
 *
 * Validator ở đây chỉ kiểm HÌNH DẠNG payload. Mọi luật nghiệp vụ — Phiên còn
 * mở, còn món, không còn yêu cầu hủy treo, chưa có bill đang mở — nằm trong
 * repository, trong cùng transaction đang giữ khóa Phiên.
 *
 * Quyền: `payment.collect`, thuộc OWNER, ADMIN và CASHIER (migration 0027).
 * Phục vụ ĐỌC được bill (`order.read`) nhưng không chốt được. Quyết định nghiệp
 * vụ "Phục vụ chốt bill" mâu thuẫn phân quyền 15/11, và mockup NA-44 đánh dấu
 * điểm đó là CHỜ BA CHỐT — nên tuần này đi theo phân quyền đã có, vì cấp quyền
 * thu tiền rồi thu hồi giữa ca là việc không ai muốn làm.
 */
import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import {
  afterIdempotencyCommit,
  idempotencyTransaction,
  idempotent,
  requireBodyIdempotencyKey,
} from '../../middleware/idempotency.js'
import { publishCommittedFloorChange } from '../tables/floor-change-stream.js'
import {
  BILL_FEATURES_IN_DEVELOPMENT,
  type CapturePaymentInput,
  type CloseBillInput,
  type PaymentMethod,
} from './bill.model.js'
import { closeBill, getBill, listOpenBills, previewBill } from './bill.repository.js'
import { capturePayment, confirmPayment, getPayment } from './payment.repository.js'

export const billRouter: Router = Router()

function positiveInteger(value: unknown, code: string, message: string): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new AppError(400, code, message)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new AppError(400, code, message)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new AppError(400, code, message)
  return parsed
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_BODY', 'Nội dung yêu cầu không hợp lệ.')
  }
  return value as Record<string, unknown>
}

const businessDatePattern = /^\d{4}-\d{2}-\d{2}$/

function businessDateParam(value: unknown): string {
  if (typeof value !== 'string' || !businessDatePattern.test(value)) {
    throw new AppError(400, 'INVALID_BUSINESS_DATE', 'Ngày kinh doanh phải có dạng YYYY-MM-DD.')
  }
  return value
}

/**
 * Mã Phiên trên query string.
 *
 * Thẻ việc viết `?session=`, nhưng trong repo này "session" đã mang nghĩa khác:
 * `auth_sessions`, `session-lifecycle.ts` — phiên ĐĂNG NHẬP. Phiên bàn ở mọi
 * endpoint khác là `visitId`. Hai nghĩa cho một chữ trong cùng một API là cách
 * để một bug ngồi yên sáu tháng, nên endpoint nhận cả hai tên và tài liệu
 * khuyến nghị `visitId`.
 */
function visitIdFromQuery(query: Record<string, unknown>): number {
  const raw = query.visitId ?? query.session
  if (raw === undefined) {
    throw new AppError(400, 'INVALID_VISIT_ID', 'Thiếu mã Phiên bàn (visitId).')
  }
  return positiveInteger(raw, 'INVALID_VISIT_ID', 'visitId phải là số nguyên dương.')
}

/**
 * Con số SẼ được chốt, cùng lý do chưa chốt được.
 *
 * `GET`, nên nó không ghi gì và không đổi trạng thái bàn. Quyền `order.read`
 * chứ không phải `payment.collect`: đây là một con số để xem trước, và Phục vụ
 * đọc được đơn thì đọc được tổng của đơn — họ vẫn là người đưa nó cho khách xem.
 */
billRouter.get(
  '/preview',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const visitId = visitIdFromQuery(request.query)
    response.setHeader('Cache-Control', 'private, no-store')
    response.json({ preview: await previewBill(requireAuthenticatedActor(request), visitId) })
  },
)

/**
 * Màn 1 — Phiên đang mở của một ngày kinh doanh, kèm số đếm cho bộ lọc.
 *
 * Một cụm bàn ghép cho ra đúng một hàng: cả cụm dùng một Phiên, nên "cụm bàn
 * ghép chỉ có 1 thẻ" đúng tự nhiên.
 */
billRouter.get(
  '/',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const businessDate = businessDateParam((request.query as Record<string, unknown>).businessDate)
    response.setHeader('Cache-Control', 'private, no-cache')
    response.json(await listOpenBills(requireAuthenticatedActor(request), businessDate))
  },
)

/**
 * Chốt bill.
 *
 * Mã chống trùng nằm TRONG body (`idempotencyKey`), không phải header — đúng
 * hợp đồng của module gọi món, nên mọi client (kể cả mock và E2E) chỉ phải nhớ
 * một chỗ. Mã là BẮT BUỘC: một lần bấm "Chốt bill" không có mã thì hai lần chạm
 * vào cùng cái nút sẽ thành hai bill cho một bàn.
 */
billRouter.post(
  '/',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('payment.collect'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('POST /bills'),
  async (request, response) => {
    const body = objectBody(request.body)
    const actor = requireAuthenticatedActor(request)
    const visitId = positiveInteger(body.visitId, 'INVALID_VISIT_ID', 'visitId phải là số nguyên dương.')
    const expectedTotalVnd = body.expectedTotalVnd === undefined || body.expectedTotalVnd === null
      ? undefined
      : positiveInteger(body.expectedTotalVnd, 'INVALID_EXPECTED_TOTAL', 'Tổng tiền mong đợi không hợp lệ.')

    const input: CloseBillInput = { visitId, idempotencyKey: body.idempotencyKey as string }
    if (expectedTotalVnd !== undefined) input.expectedTotalVnd = expectedTotalVnd
    const bill = await closeBill(actor, input, idempotencyTransaction(response))

    // Phát SSE chỉ SAU KHI transaction chống trùng đã bền. Transaction đó được
    // giữ qua cả route handler, nên gọi thẳng `publishCommittedFloorChange` ở
    // đây sẽ phát một event cho dữ liệu chưa commit — và một thiết bị khác sẽ
    // đọc lại rồi không thấy gì.
    afterIdempotencyCommit(response, () => publishCommittedFloorChange(actor.organizationId, actor.venueId))
    response.status(201).json({ bill })
  },
)

billRouter.get(
  '/:billId',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const billId = positiveInteger(request.params.billId, 'INVALID_BILL_ID', 'billId phải là số nguyên dương.')
    response.setHeader('Cache-Control', 'private, no-store')
    response.json({ bill: await getBill(requireAuthenticatedActor(request), billId) })
  },
)

/* --------------------------- TU-46: thanh toán --------------------------- */

const PAYMENT_METHODS = new Set<PaymentMethod>(['CASH', 'BANK_TRANSFER', 'CREDIT'])

function paymentMethod(value: unknown): PaymentMethod {
  if (typeof value !== 'string' || !PAYMENT_METHODS.has(value as PaymentMethod)) {
    throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'Phương thức thanh toán không hợp lệ.')
  }
  return value as PaymentMethod
}

/**
 * Tạo giao dịch thanh toán.
 *
 * Tiền mặt: một bước, về `CAPTURED` ngay và Phiên đóng. Chuyển khoản: dừng ở
 * `PENDING` kèm chuỗi QR, chờ `/confirm`.
 *
 * Ghi nợ bị từ chối ở đây bằng `422 PAYMENT_METHOD_NOT_AVAILABLE` kèm
 * `status: "IN_DEVELOPMENT"` — và cũng bị từ chối ở repository và ở CHECK của
 * database. Ba lớp cùng nói một điều (CH-05).
 */
billRouter.post(
  '/:billId/payments',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('payment.collect'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('POST /bills/:id/payments'),
  async (request, response) => {
    const body = objectBody(request.body)
    const actor = requireAuthenticatedActor(request)
    const billId = positiveInteger(request.params.billId, 'INVALID_BILL_ID', 'billId phải là số nguyên dương.')
    const method = paymentMethod(body.method)

    const input: CapturePaymentInput = { billId, method, idempotencyKey: body.idempotencyKey as string }
    if (method === 'CASH') {
      input.tenderedAmountVnd = positiveInteger(
        body.tenderedAmountVnd,
        'INVALID_TENDERED_AMOUNT',
        'Số tiền khách đưa không hợp lệ.',
      )
    }

    const result = await capturePayment(actor, input, idempotencyTransaction(response))
    afterIdempotencyCommit(response, () => publishCommittedFloorChange(actor.organizationId, actor.venueId))
    response.status(201).json(result)
  },
)

/**
 * Xác nhận TAY một giao dịch chuyển khoản (TN-09).
 *
 * `observedTransfer` phải là `true` tường minh: người bấm đang thay một cổng
 * thanh toán khẳng định tiền đã về, và dấu tick đó là thứ duy nhất phân biệt
 * "đã xem sao kê" với "bấm cho xong".
 */
billRouter.post(
  '/:billId/payments/:paymentId/confirm',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('payment.collect'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('POST /bills/:id/payments/:id/confirm'),
  async (request, response) => {
    const body = objectBody(request.body)
    const actor = requireAuthenticatedActor(request)
    const result = await confirmPayment(
      actor,
      {
        billId: positiveInteger(request.params.billId, 'INVALID_BILL_ID', 'billId phải là số nguyên dương.'),
        paymentId: positiveInteger(
          request.params.paymentId,
          'INVALID_PAYMENT_ID',
          'paymentId phải là số nguyên dương.',
        ),
        observedTransfer: body.observedTransfer === true,
        idempotencyKey: body.idempotencyKey as string,
      },
      idempotencyTransaction(response),
    )
    afterIdempotencyCommit(response, () => publishCommittedFloorChange(actor.organizationId, actor.venueId))
    response.json(result)
  },
)

/**
 * Đọc lại một giao dịch — nút "Kiểm tra" của Màn 6.
 *
 * `GET`, và đó là cả điểm: nó KHÔNG tự đóng bill dù đọc thấy gì. Chưa có cổng
 * thanh toán, nên không có nguồn nào ngoài con mắt của nhân viên để nói rằng
 * tiền đã về.
 */
billRouter.get(
  '/:billId/payments/:paymentId',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const billId = positiveInteger(request.params.billId, 'INVALID_BILL_ID', 'billId phải là số nguyên dương.')
    const paymentId = positiveInteger(
      request.params.paymentId,
      'INVALID_PAYMENT_ID',
      'paymentId phải là số nguyên dương.',
    )
    response.setHeader('Cache-Control', 'private, no-store')
    response.json({ payment: await getPayment(requireAuthenticatedActor(request), billId, paymentId) })
  },
)

/**
 * Hủy một bill — CHƯA LÀM, và endpoint này tồn tại để nói đúng điều đó.
 *
 * TN-14 ghi "Thu ngân không tự hủy thanh toán", và luật hủy một bill đã thanh
 * toán chờ kết quả họp HU-43. Một endpoint trả 501 với `status:
 * "IN_DEVELOPMENT"` thì màn hình dựng được nhãn "Đang phát triển" từ dữ liệu
 * thật, và không ai kịp "tạm làm" một luật chưa ai chốt. Có test canh để nó
 * không bao giờ đổi trạng thái gì (`bill-void.mysql.test.ts`).
 */
billRouter.post(
  '/:billId/void',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('payment.collect'),
  (request) => {
    positiveInteger(request.params.billId, 'INVALID_BILL_ID', 'billId phải là số nguyên dương.')
    throw new AppError(
      501,
      'BILL_VOID_NOT_AVAILABLE',
      'Hủy bill đang phát triển. Chờ kết quả họp HU-43.',
      {
        status: 'IN_DEVELOPMENT',
        feature: BILL_FEATURES_IN_DEVELOPMENT.find((flag) => flag.feature === 'VOID_PAID_BILL')?.feature,
      },
    )
  },
)

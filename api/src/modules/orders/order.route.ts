import { Router } from 'express'

import { requireAuthenticatedActor } from '../../auth/authenticated-actor.js'
import { requireAuthentication, requireCsrfProtection, requirePermission } from '../../auth/auth.middleware.js'
import { AppError } from '../../errors/app-error.js'
import { normalizeSearchText } from '../../lib/search-text.js'
import {
  afterIdempotencyCommit,
  idempotencyTransaction,
  idempotent,
  requireBodyIdempotencyKey,
} from '../../middleware/idempotency.js'
import { publishCommittedFloorChange } from '../tables/floor-change-stream.js'
import type { WaiterOrderInput, WaiterOrderLineInput } from './order.model.js'
import {
  MAX_CANCELLATION_REASON_LENGTH,
  adjustOrderLineQuantity,
  requestOrderLineCancellation,
} from './order-adjustment.repository.js'
import {
  MAX_LINE_NOTE_LENGTH,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  createWaiterOrder,
  getWaiterOrder,
  listVisitOrders,
} from './order.repository.js'

/**
 * Module Phục vụ 3 — ba endpoint của giỏ gọi món.
 *
 * Venue KHÔNG bao giờ đọc từ request: nó nằm trong session (`actor.venueId`),
 * và vì thế một máy Phục vụ của quán A không gửi được đơn vào quán B kể cả khi
 * nó biết `variantId` của quán B.
 *
 * Validator ở đây chỉ kiểm HÌNH DẠNG payload. Mọi luật nghiệp vụ — Phiên còn
 * mở, bàn còn khách, món còn bán, giá còn đúng — nằm trong repository, trong
 * cùng transaction đang giữ khóa Phiên. Kiểm ở route là kiểm trên dữ liệu đã
 * cũ ngay khi câu lệnh tiếp theo chạy.
 */
export const waiterOrderRouter: Router = Router()

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

function orderLine(value: unknown): WaiterOrderLineInput {
  const raw = objectBody(value)
  const line: WaiterOrderLineInput = {
    variantId: positiveInteger(raw.variantId, 'INVALID_VARIANT_ID', 'Mã biến thể món không hợp lệ.'),
    priceId: positiveInteger(raw.priceId, 'INVALID_PRICE_ID', 'Mã giá không hợp lệ.'),
    priceVersion: positiveInteger(raw.priceVersion, 'INVALID_PRICE_VERSION', 'Phiên bản giá không hợp lệ.'),
    quantity: positiveInteger(raw.quantity, 'INVALID_QUANTITY', 'Số lượng món không hợp lệ.'),
  }
  if (line.quantity > MAX_LINE_QUANTITY) {
    throw new AppError(400, 'INVALID_QUANTITY', `Số lượng mỗi món tối đa ${MAX_LINE_QUANTITY}.`)
  }
  if (raw.note !== undefined && raw.note !== null) {
    if (typeof raw.note !== 'string') throw new AppError(400, 'INVALID_LINE_NOTE', 'Ghi chú món không hợp lệ.')
    // Gộp khoảng trắng bên trong, không chỉ cắt hai đầu: "ít  đá" và "ít đá" là
    // một lời nhắn, và nếu chúng không bằng nhau thì chúng thành hai dòng riêng
    // trên phiếu của Bar vì một cú chạm phím space.
    const note = raw.note.trim().replace(/\s+/g, ' ')
    if (note.length > MAX_LINE_NOTE_LENGTH) {
      throw new AppError(400, 'INVALID_LINE_NOTE', `Ghi chú mỗi món tối đa ${MAX_LINE_NOTE_LENGTH} ký tự.`)
    }
    if (note) line.note = note
  }
  return line
}

/**
 * Khóa nhận dạng một CUSTOMIZE: biến thể cộng ghi chú đã chuẩn hoá.
 *
 * Chuẩn hoá bằng đúng `normalizeSearchText` mà phần còn lại của hệ thống dùng
 * (bỏ dấu, hạ chữ thường), nên "Ít Đá" và "it da" là một customize. Chỉ dùng để
 * SO SÁNH; nội dung lưu vào dòng đơn vẫn là nguyên văn nhân viên gõ, vì đó là
 * cái Bar đọc.
 *
 * Giỏ ở máy Phục vụ gộp theo đúng khóa này (`cart-model.ts`), nên hai dòng
 * trùng khóa là payload dựng sai — chứ không phải một yêu cầu hợp lệ.
 */
function customizationKey(line: WaiterOrderLineInput): string {
  return `${line.variantId}\u0000${normalizeSearchText(line.note ?? '')}`
}

function orderBody(value: unknown): WaiterOrderInput {
  const raw = objectBody(value)
  const visitId = positiveInteger(raw.visitId, 'INVALID_VISIT_ID', 'visitId phải là số nguyên dương.')
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    throw new AppError(400, 'ORDER_LINES_REQUIRED', 'Giỏ gọi món đang trống.')
  }
  if (raw.lines.length > MAX_ORDER_LINES) {
    throw new AppError(400, 'ORDER_TOO_MANY_LINES', `Một đơn tối đa ${MAX_ORDER_LINES} dòng món.`)
  }
  const lines = raw.lines.map(orderLine)
  const seen = new Set<string>()
  for (const line of lines) {
    // CÙNG biến thể, KHÁC ghi chú là hợp lệ: "hai ly Macallan, một ly không đá"
    // là hai dòng và Bar phải nhận đúng hai dòng. Chỉ cặp trùng khít (cùng biến
    // thể, cùng ghi chú) bị từ chối, vì giỏ đã phải gộp số lượng cho nó rồi —
    // chấp nhận nó cho ra một đơn mà tổng tiền trên màn hình không khớp database.
    const key = customizationKey(line)
    if (seen.has(key)) {
      throw new AppError(
        400,
        'ORDER_DUPLICATE_LINE',
        'Hai dòng cùng món và cùng ghi chú. Gộp số lượng lại thành một dòng.',
      )
    }
    seen.add(key)
  }
  return { visitId, lines, idempotencyKey: String(raw.idempotencyKey) }
}

/** Chuỗi tùy chọn đã cắt khoảng trắng; rỗng nghĩa là không gửi. */
function optionalText(value: unknown, code: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new AppError(400, code, 'Nội dung chữ không hợp lệ.')
  const text = value.trim().replace(/\s+/g, ' ')
  if (text.length > maxLength) throw new AppError(400, code, `Nội dung tối đa ${maxLength} ký tự.`)
  return text || undefined
}

waiterOrderRouter.post(
  '/orders',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('order.create'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('waiter.order.create'),
  async (request, response) => {
    const input = orderBody(request.body)
    const order = await createWaiterOrder(
      requireAuthenticatedActor(request),
      input,
      idempotencyTransaction(response),
    )
    const actor = requireAuthenticatedActor(request)
    afterIdempotencyCommit(response, () => publishCommittedFloorChange(actor.organizationId, actor.venueId))
    response.status(201).json({ order })
  },
)

waiterOrderRouter.get(
  '/visits/:visitId/orders',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const visitId = positiveInteger(request.params.visitId, 'INVALID_VISIT_ID', 'visitId phải là số nguyên dương.')
    response.setHeader('Cache-Control', 'private, no-cache')
    response.json(await listVisitOrders(requireAuthenticatedActor(request), visitId))
  },
)

waiterOrderRouter.get(
  '/orders/:orderId',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const orderId = positiveInteger(request.params.orderId, 'INVALID_ORDER_ID', 'Mã đơn không hợp lệ.')
    response.setHeader('Cache-Control', 'private, no-cache')
    response.json({ order: await getWaiterOrder(requireAuthenticatedActor(request), orderId) })
  },
)

/**
 * Module Phục vụ 5 — sửa số lượng một dòng món.
 *
 * `PATCH`, không `POST`: nó sửa một tài nguyên đang có, và `expectedLineVersion`
 * là chốt chống ghi đè mù. Quyền là `order.line.adjust`; route KHÔNG nhắc tên
 * vai trò nào, nên cấp quyền cho một vai mới sau này không phải sửa file này.
 */
waiterOrderRouter.patch(
  '/orders/:orderId/lines/:lineNo',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('order.line.adjust'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('waiter.order.line.adjust'),
  async (request, response) => {
    const raw = objectBody(request.body)
    const quantity = positiveInteger(raw.quantity, 'INVALID_QUANTITY', 'Số lượng món không hợp lệ.')
    if (quantity > MAX_LINE_QUANTITY) {
      throw new AppError(400, 'INVALID_QUANTITY', `Số lượng mỗi món tối đa ${MAX_LINE_QUANTITY}.`)
    }
    const reason = optionalText(raw.reason, 'INVALID_ADJUST_REASON', MAX_CANCELLATION_REASON_LENGTH)
    const order = await adjustOrderLineQuantity(
      requireAuthenticatedActor(request),
      {
        orderId: positiveInteger(request.params.orderId, 'INVALID_ORDER_ID', 'Mã đơn không hợp lệ.'),
        lineNo: positiveInteger(request.params.lineNo, 'INVALID_LINE_NO', 'Số dòng món không hợp lệ.'),
        expectedLineVersion: positiveInteger(
          raw.expectedLineVersion,
          'INVALID_VERSION',
          'Phiên bản dòng món không hợp lệ.',
        ),
        quantity,
        ...(reason === undefined ? {} : { reason }),
        idempotencyKey: String(raw.idempotencyKey),
      },
      idempotencyTransaction(response),
    )
    response.json({ order })
  },
)

/**
 * Module Phục vụ 5 — GỬI yêu cầu hủy món.
 *
 * Endpoint này không hủy gì. Nó ghi lại ai muốn hủy, bao nhiêu và vì sao; quyết
 * định nằm ở `/api/v1/orders/cancellations/:id/approve|reject` với một quyền
 * khác. Lý do là BẮT BUỘC: một yêu cầu hủy không lý do thì người duyệt chỉ có
 * thể đoán, và nhật ký sau một tháng không dựng lại được chuyện gì đã xảy ra.
 */
waiterOrderRouter.post(
  '/orders/:orderId/lines/:lineNo/cancellations',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('order.cancel.request'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('waiter.order.line.cancel-request'),
  async (request, response) => {
    const raw = objectBody(request.body)
    const reason = optionalText(raw.reason, 'INVALID_CANCEL_REASON', MAX_CANCELLATION_REASON_LENGTH)
    if (reason === undefined) {
      throw new AppError(400, 'CANCEL_REASON_REQUIRED', 'Phải ghi lý do hủy món.')
    }
    const quantity = positiveInteger(raw.quantity, 'INVALID_QUANTITY', 'Số lượng hủy không hợp lệ.')
    if (quantity > MAX_LINE_QUANTITY) {
      throw new AppError(400, 'INVALID_QUANTITY', `Số lượng mỗi món tối đa ${MAX_LINE_QUANTITY}.`)
    }
    if (raw.acknowledgeWaste !== undefined && typeof raw.acknowledgeWaste !== 'boolean') {
      throw new AppError(400, 'INVALID_WASTE_ACKNOWLEDGEMENT', 'Xác nhận ghi hao không hợp lệ.')
    }
    const result = await requestOrderLineCancellation(
      requireAuthenticatedActor(request),
      {
        orderId: positiveInteger(request.params.orderId, 'INVALID_ORDER_ID', 'Mã đơn không hợp lệ.'),
        lineNo: positiveInteger(request.params.lineNo, 'INVALID_LINE_NO', 'Số dòng món không hợp lệ.'),
        expectedLineVersion: positiveInteger(
          raw.expectedLineVersion,
          'INVALID_VERSION',
          'Phiên bản dòng món không hợp lệ.',
        ),
        quantity,
        reason,
        ...(raw.acknowledgeWaste === undefined ? {} : { acknowledgeWaste: raw.acknowledgeWaste }),
        idempotencyKey: String(raw.idempotencyKey),
      },
      idempotencyTransaction(response),
    )
    response.status(201).json({ cancellation: result })
  },
)

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
import { clearVisitOrdering, markVisitOrdering } from '../tables/waiter-visit-phase.repository.js'
import { acknowledgeStaffNotification, listStaffNotifications } from './staff-notification.repository.js'
import type { WaiterOrderInput, WaiterOrderLineInput } from './order.model.js'
import {
  MAX_CANCELLATION_REASON_LENGTH,
  adjustOrderLineQuantity,
  requestOrderCancellation,
  requestOrderLineCancellation,
} from './order-adjustment.repository.js'
import {
  MAX_LINE_NOTE_LENGTH,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  createWaiterOrder,
  getVisitBill,
  getWaiterOrder,
  listVisitItems,
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
    // Đơn đã gửi thì bàn chuyển sang "Chờ đồ", nên dấu "đang gọi món" phải tắt
    // ngay trong cùng một lần bấm. Để nó lại thì bàn ở màu cam cho tới khi dấu
    // hết hạn, và màu cam lúc đó nói sai: không ai đang lên đơn nữa, khách
    // đang chờ đồ.
    afterIdempotencyCommit(response, async () => {
      await clearVisitOrdering(actor, input.visitId)
      await publishCommittedFloorChange(actor.organizationId, actor.venueId)
    })
    response.status(201).json({ order })
  },
)

/**
 * Module Phục vụ 1 (v1.1) — dấu "đang gọi món" của một Phiên.
 *
 * Hai endpoint này KHÔNG tạo, sửa hay xoá một thứ gì thuộc về khách. Chúng chỉ
 * nói "máy này đang mở màn Gọi món của bàn kia", để sơ đồ của những máy khác
 * tô bàn đó màu cam. Vì vậy quyền là `order.create` — ai lên đơn được thì mới
 * có lý do mở màn Gọi món — chứ không phải một permission mới.
 *
 * `PUT`, không `POST`: gọi mười lần cũng ra một kết quả. Màn Gọi món đập nhịp
 * định kỳ để dấu không hết hạn khi nhân viên còn đang tư vấn cho khách, và một
 * endpoint tạo-mới sẽ sinh mười bản ghi cho một lần mở menu.
 */
waiterOrderRouter.put(
  '/visits/:visitId/ordering',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('order.create'),
  async (request, response) => {
    const visitId = positiveInteger(request.params.visitId, 'INVALID_VISIT_ID', 'visitId phải là số nguyên dương.')
    const actor = requireAuthenticatedActor(request)
    const announced = await markVisitOrdering(actor, visitId)
    if (announced) await publishCommittedFloorChange(actor.organizationId, actor.venueId)
    response.json({ ordering: true })
  },
)

waiterOrderRouter.delete(
  '/visits/:visitId/ordering',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('order.create'),
  async (request, response) => {
    const visitId = positiveInteger(request.params.visitId, 'INVALID_VISIT_ID', 'visitId phải là số nguyên dương.')
    const actor = requireAuthenticatedActor(request)
    const cleared = await clearVisitOrdering(actor, visitId)
    if (cleared) await publishCommittedFloorChange(actor.organizationId, actor.venueId)
    response.json({ ordering: false })
  },
)

/**
 * Module Phục vụ 1 (v1.1) — món đã gọi của Phiên, gộp sẵn cho bảng thao tác bàn.
 *
 * Tách khỏi `/visits/:visitId/orders`: màn kia kể chuyện theo TỪNG ĐƠN (đơn 1
 * lúc 21:42, đơn 2 lúc 22:30) vì đó là thứ cần khi đi tra một yêu cầu hủy.
 * Màn này chỉ trả lời "trên bàn đang có gì", và để trả lời nó bằng endpoint
 * kia thì điện thoại phải gọi một lần cho danh sách đơn rồi một lần nữa cho
 * mỗi đơn.
 */
waiterOrderRouter.get(
  '/visits/:visitId/items',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const visitId = positiveInteger(request.params.visitId, 'INVALID_VISIT_ID', 'visitId phải là số nguyên dương.')
    response.setHeader('Cache-Control', 'private, no-cache')
    response.json(await listVisitItems(requireAuthenticatedActor(request), visitId))
  },
)

/**
 * Module Phục vụ (v1.1) — PV-18: bill TẠM TÍNH của một Phiên.
 *
 * `GET`, và đó là cả điểm: nó không ghi gì, không đổi trạng thái bàn, không
 * đánh dấu đã in. Bấm "In bill tạm tính" mười lần vẫn chỉ là mười lần đọc.
 *
 * Quyền `order.read` chứ không phải `payment.collect`: đây là một con số cho
 * khách xem trước, không phải một lần thu tiền. Phục vụ đọc được đơn thì đọc
 * được tổng của đơn.
 */
waiterOrderRouter.get(
  '/visits/:visitId/bill',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    const visitId = positiveInteger(request.params.visitId, 'INVALID_VISIT_ID', 'visitId phải là số nguyên dương.')
    response.setHeader('Cache-Control', 'private, no-store')
    response.json({ bill: await getVisitBill(requireAuthenticatedActor(request), visitId) })
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
 * Module Phục vụ (v1.1) — "Hủy đơn?": gửi yêu cầu hủy CẢ ĐƠN.
 *
 * Cùng quyền, cùng luật và cùng bảng với yêu cầu từng dòng; khác ở chỗ nó sinh
 * một nhóm để người duyệt quyết định một lần. Nó vẫn KHÔNG hủy gì — quyết định
 * nằm ở `/api/v1/orders/cancellations/groups/:groupId/approve|reject`.
 */
waiterOrderRouter.post(
  '/orders/:orderId/cancellations',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('order.cancel.request'),
  requireBodyIdempotencyKey('idempotencyKey'),
  idempotent('waiter.order.cancellation.request'),
  async (request, response) => {
    const raw = objectBody(request.body)
    const orderId = positiveInteger(request.params.orderId, 'INVALID_ORDER_ID', 'Mã đơn không hợp lệ.')
    const reason = optionalText(raw.reason, 'INVALID_CANCELLATION_REASON', MAX_CANCELLATION_REASON_LENGTH)
    if (!reason) {
      throw new AppError(400, 'INVALID_CANCELLATION_REASON', 'Lý do hủy là bắt buộc.')
    }
    if (raw.acknowledgeWaste !== undefined && typeof raw.acknowledgeWaste !== 'boolean') {
      throw new AppError(400, 'INVALID_WASTE_ACK', 'Xác nhận ghi hao không hợp lệ.')
    }
    const result = await requestOrderCancellation(
      requireAuthenticatedActor(request),
      {
        orderId,
        reason,
        ...(raw.acknowledgeWaste === true ? { acknowledgeWaste: true as const } : {}),
        idempotencyKey: String(raw.idempotencyKey),
      },
      idempotencyTransaction(response),
    )
    response.status(201).json({ cancellation: result })
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

/**
 * Module Phục vụ (v1.1) — PV-20: hộp tin của chính người đang đăng nhập.
 *
 * Quyền là `order.read`: ai đọc được đơn thì đọc được tin về đơn của mình. Lọc
 * theo người nhận nằm ở repository, không ở đây — một endpoint "lấy tin" mà
 * quên mệnh đề WHERE sẽ phát lý do hủy và số tiền của cả quán cho một người.
 */
waiterOrderRouter.get(
  '/notifications',
  requireAuthentication,
  requirePermission('order.read'),
  async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store')
    response.json({ notifications: await listStaffNotifications(requireAuthenticatedActor(request)) })
  },
)

waiterOrderRouter.post(
  '/notifications/:notificationId/acknowledge',
  requireAuthentication,
  requireCsrfProtection,
  requirePermission('order.read'),
  async (request, response) => {
    await acknowledgeStaffNotification(
      requireAuthenticatedActor(request),
      positiveInteger(request.params.notificationId, 'INVALID_NOTIFICATION_ID', 'Mã thông báo không hợp lệ.'),
    )
    response.json({ acknowledged: true })
  },
)

/**
 * NA-45 ⇄ TU-45/46 — bộ chuyển đổi giữa màn thanh toán và API bill thật.
 *
 * Màn hình của Nam nói một thứ tiếng (`PaymentApi`, `PayBill`, giờ dạng
 * "20:15", `visitId` là chuỗi), API của TU-45/46 nói một thứ tiếng khác
 * (`Bill`, mốc thời gian ISO, id là số). File này là chỗ DUY NHẤT hai thứ
 * tiếng gặp nhau: không màn hình nào gọi `bills-http-client` trực tiếp, và
 * không chỗ nào khác được phép biết `PayBill` được ghép từ đâu.
 *
 * Ba điều cần biết trước khi sửa file này:
 *
 * 1. `PaymentApi` lấy PHIÊN làm trung tâm (`getBill(visitId)`), còn API lấy
 *    HOÁ ĐƠN làm trung tâm (`/bills/:billId`). V12 cho một Phiên nhiều hoá
 *    đơn, nên mọi hàm ở đây mở đầu bằng một lần đọc `GET /bills/session/:id`
 *    rồi tự chọn tờ đang tới lượt: tờ CHƯA THU cũ nhất.
 *
 * 2. Phiên chưa xuất hoá đơn vẫn phải hiện được một tờ để xem trước. Lúc đó
 *    số tiền KHÔNG được tính ở trình duyệt — gọi `GET /bills/preview`, để con
 *    số khách nhìn và con số sẽ được chốt do cùng một công thức trên máy chủ
 *    sinh ra.
 *
 * 3. Những gì API chưa có thì ném 501 kèm lý do thật, không giả lập. Luồng huỷ
 *    bill đã thu (TN-14) chưa có backend; màn hình gọi tới sẽ hiện lỗi, và đó
 *    là hành vi đúng — thà một màn báo "chưa có" còn hơn một nút bấm vào rồi
 *    tiền biến mất khỏi sổ mà không ai ghi.
 */
import { ApiError, clock } from "@/services"
import { businessDateOf, fmtTime } from "@/lib/time"
import type {
  CancelEffect,
  CancelRequest,
  PayBill,
  PayBillSummary,
  PaidBillSummary,
  PaymentApi,
  PaymentAuditEntry,
  PaymentNotification,
  PayLine,
  PreviewBill,
  Receipt,
  SessionBills,
} from "./contracts"
import {
  type Bill,
  type BillLine,
  type BillListItem,
  type BillPreview,
  type SessionBills as HttpSessionBills,
  capturePayment,
  closeBill,
  confirmPayment,
  fetchBillPreview,
  fetchOpenBills,
  fetchSessionBills,
} from "./bills-http-client"

/* ------------------------------ phiên dịch ------------------------------- */

/** Giờ trên màn thanh toán là "20:15", không phải mốc ISO. */
function hhmm(iso: string | null | undefined): string {
  if (!iso) return "--:--"
  return fmtTime(new Date(iso))
}

/**
 * Mã hoá đơn của một Phiên CHƯA xuất hoá đơn.
 *
 * Máy chủ chỉ cấp mã khi chốt bill, nên trước đó màn hình vẫn cần một nhãn để
 * hiển thị. Nó không bao giờ được gửi lên máy chủ.
 */
function placeholderBillCode(visitId: number): string {
  return `B${String(visitId).padStart(4, "0")}`
}

/** `clusterCode` chỉ có nghĩa khi Phiên đang ngồi nhiều bàn. */
function clusterOf(context: { tableCodes: string[]; groupSymbol: string | null }) {
  return context.tableCodes.length > 1 && context.groupSymbol ? { clusterCode: context.groupSymbol } : {}
}

function toPayLine(line: BillLine): PayLine {
  return {
    orderRound: line.orderRound,
    name: line.variantDisplayName || line.itemName,
    unit: line.unitCode,
    qty: line.quantity,
    unitPriceVnd: line.unitPriceVnd,
    lineTotalVnd: line.amountVnd,
    state: line.state,
    ...(line.note ? { note: line.note } : {}),
  }
}

/** Một tờ hoá đơn đã xuất. `sessionStatus` là trạng thái của cả Phiên. */
function toPayBill(bill: Bill, sessionStatus: SessionBills["status"]): PayBill {
  return {
    billCode: bill.billCode,
    visitId: String(bill.visitId),
    sessionCode: bill.sessionCode,
    code: bill.code,
    tables: [...bill.tableCodes],
    ...clusterOf(bill),
    status: bill.status === "PAID" ? "PAID" : sessionStatus,
    billStatus: bill.status === "PAID" ? "PAID" : "UNPAID",
    lines: bill.lines.map(toPayLine),
    subtotalVnd: bill.subtotalVnd,
    vatVnd: bill.vatVnd,
    preRoundVnd: bill.preRoundTotalVnd,
    roundingVnd: bill.roundingAdjustmentVnd,
    dueVnd: bill.totalVnd,
    version: bill.version,
    openedAt: hhmm(bill.openedAt),
    issuedAt: hhmm(bill.closedAt),
    issuedBy: bill.closedBy.displayName,
    waiterName: bill.waiterName,
    guests: bill.guests,
    roundCount: bill.roundCount,
    // Mã QR của máy chủ đi kèm tờ hoá đơn: màn Chuyển khoản vẽ đúng chuỗi này.
    qr: bill.qr,
    ...(bill.paidAt ? { paidAt: hhmm(bill.paidAt) } : {}),
    ...(bill.paidBy ? { paidBy: bill.paidBy.displayName } : {}),
  }
}

/**
 * Tờ hoá đơn "chưa xuất": món đang có, số tiền do máy chủ tính trước.
 *
 * Màn hình cần nó cho bước Chi tiết của một bàn vừa gọi món mà chưa ai bấm
 * Xuất hoá đơn.
 */
function previewToPayBill(preview: BillPreview, sessionStatus: SessionBills["status"]): PayBill {
  return {
    billCode: placeholderBillCode(preview.visitId),
    visitId: String(preview.visitId),
    sessionCode: preview.sessionCode,
    code: preview.code,
    tables: [...preview.tableCodes],
    ...clusterOf(preview),
    status: sessionStatus,
    lines: preview.lines.map(toPayLine),
    subtotalVnd: preview.subtotalVnd,
    vatVnd: preview.vatVnd,
    preRoundVnd: preview.preRoundTotalVnd,
    roundingVnd: preview.roundingAdjustmentVnd,
    dueVnd: preview.totalVnd,
    version: preview.version,
    openedAt: hhmm(preview.openedAt),
    waiterName: preview.waiterName,
    guests: preview.guests,
    roundCount: preview.roundCount,
  }
}

function toPreviewBill(preview: BillPreview): PreviewBill {
  return {
    visitId: String(preview.visitId),
    sessionCode: preview.sessionCode,
    code: preview.code,
    tables: [...preview.tableCodes],
    ...clusterOf(preview),
    lines: preview.lines.map(toPayLine),
    subtotalVnd: preview.subtotalVnd,
    vatVnd: preview.vatVnd,
    preRoundVnd: preview.preRoundTotalVnd,
    roundingVnd: preview.roundingAdjustmentVnd,
    dueVnd: preview.totalVnd,
    version: preview.version,
  }
}

function toSessionBills(session: HttpSessionBills): SessionBills {
  return {
    visitId: String(session.visitId),
    sessionCode: session.sessionCode,
    code: session.code,
    tables: [...session.tableCodes],
    ...clusterOf(session),
    status: session.status,
    unbilledLineCount: session.unbilledLineCount,
    bills: session.bills.map((bill) => toPayBill(bill, session.status)),
    version: session.version,
  }
}

function toSummary(item: BillListItem): PayBillSummary {
  return {
    visitId: String(item.visitId),
    billCode: item.billCode ?? placeholderBillCode(item.visitId),
    sessionCode: item.sessionCode,
    code: item.code,
    tables: [...item.tableCodes],
    ...clusterOf(item),
    status: item.status === "SERVING" ? "SERVING" : "AWAITING_PAYMENT",
    openedAt: hhmm(item.startedAt),
    waiterName: item.waiterName,
    guests: item.guests,
    // Cả số nợ của Phiên, không phải tổng một tờ: xem `dueTotalVnd` ở API.
    dueVnd: item.dueTotalVnd,
    hasOrderLines: item.itemCount > 0,
    unpaidBillCount: item.unpaidBillCount,
    ...(item.closedAt ? { issuedAt: hhmm(item.closedAt) } : {}),
    version: item.version,
  }
}

/* ----------------------------- chọn đúng tờ ------------------------------ */

/**
 * Tờ hoá đơn mà thao tác sắp tới nhắm vào.
 *
 * `billCode` do màn hình truyền xuống thắng, vì Thu ngân có thể đang mở đúng
 * tờ thứ hai. Không truyền thì lấy tờ CHƯA THU cũ nhất — thu theo thứ tự xuất,
 * giống như xếp hàng.
 */
function pickTargetBill(session: HttpSessionBills, billCode?: string): Bill {
  if (billCode) {
    const match = session.bills.find((bill) => bill.billCode === billCode)
    if (!match) {
      throw new ApiError(404, "NOT_FOUND", `Không tìm thấy hoá đơn ${billCode} trong Phiên này.`)
    }
    return match
  }
  const unpaid = session.bills.find((bill) => bill.status === "AWAITING_PAYMENT")
  if (!unpaid) {
    throw new ApiError(409, "INVALID_STATE", "Phiên chưa có hoá đơn nào đang chờ thu tiền.")
  }
  return unpaid
}

/**
 * Khoá chống trùng cho bước xác nhận chuyển khoản.
 *
 * Phải KHÁC khoá của bước tạo giao dịch, vì máy chủ buộc một khoá vào đúng một
 * (người, endpoint, nội dung) và sẽ từ chối lần gọi thứ hai. Và phải lọt qua
 * `^[A-Za-z0-9_-]{8,64}$`: dấu hai chấm bị từ chối thẳng, nên hậu tố là
 * `-xacnhan`, và phần gốc bị cắt để tổng không vượt 64 ký tự.
 */
function confirmationKey(idempotencyKey: string): string {
  return `${idempotencyKey.slice(0, 56)}-xacnhan`
}

function notBuiltYet(what: string): never {
  throw new ApiError(501, "NOT_IMPLEMENTED_YET", what)
}

/* -------------------------------- bộ API --------------------------------- */

export const httpPaymentApi: PaymentApi = {
  async listOpen(): Promise<PayBillSummary[]> {
    const list = await fetchOpenBills(businessDateOf(clock.now()))
    return list.items.map(toSummary)
  },

  async getBill(visitId: string): Promise<PayBill> {
    const session = await fetchSessionBills(Number(visitId))
    const unpaid = session.bills.find((bill) => bill.status === "AWAITING_PAYMENT")
    if (unpaid) return toPayBill(unpaid, session.status)
    const lastBill = session.bills[session.bills.length - 1]
    if (lastBill && session.unbilledLineCount === 0) return toPayBill(lastBill, session.status)
    // Chưa có tờ nào đang chờ thu: dựng tờ xem trước từ món chưa lên hoá đơn.
    const preview = await fetchBillPreview(Number(visitId))
    return previewToPayBill(preview, session.status)
  },

  async previewBill(visitId: string): Promise<PreviewBill> {
    return toPreviewBill(await fetchBillPreview(Number(visitId)))
  },

  /**
   * Xuất hoá đơn = chốt bill.
   *
   * `version` của màn hình không được gửi đi: API chặn chốt trùng bằng khoá
   * idempotency, khoá hàng trong giao dịch và một UNIQUE ở DB, nên một con số
   * version gửi kèm chỉ thêm một đường thất bại chứ không thêm một lớp bảo vệ.
   */
  async issueInvoice(visitId: string, _version: number, idempotencyKey: string): Promise<PayBill> {
    const bill = await closeBill({ visitId: Number(visitId), idempotencyKey })
    return toPayBill(bill, "AWAITING_PAYMENT")
  },

  async getSessionBills(visitId: string): Promise<SessionBills> {
    return toSessionBills(await fetchSessionBills(Number(visitId)))
  },

  async confirmCash(
    visitId: string,
    givenVnd: number,
    _version: number,
    idempotencyKey: string,
    billCode?: string,
  ): Promise<Receipt> {
    const session = await fetchSessionBills(Number(visitId))
    const target = pickTargetBill(session, billCode)
    const result = await capturePayment({
      billId: target.id,
      method: "CASH",
      tenderedAmountVnd: givenVnd,
      idempotencyKey,
    })
    return {
      billCode: result.bill.billCode,
      visitId: String(result.bill.visitId),
      sessionCode: result.bill.sessionCode,
      code: result.bill.code,
      tables: [...result.bill.tableCodes],
      ...clusterOf(result.bill),
      method: "CASH",
      manual: false,
      givenVnd: result.payment.tenderedAmountVnd ?? result.payment.amountVnd,
      changeVnd: result.payment.changeAmountVnd ?? 0,
      preRoundVnd: result.bill.preRoundTotalVnd,
      dueVnd: result.bill.totalVnd,
      confirmedAt: hhmm(result.payment.confirmedAt ?? result.bill.paidAt),
      confirmedBy: result.payment.confirmedBy?.displayName ?? result.payment.collectedBy.displayName,
    }
  },

  /**
   * Chuyển khoản: tạo giao dịch rồi xác nhận đã thấy tiền về.
   *
   * Hai lần gọi, không phải một, vì API ghi nhận hai việc khác nhau: khách quét
   * mã (PENDING) và một người khẳng định tiền đã về (CAPTURED, có tên người
   * khẳng định trên giao dịch). Mỗi lần gọi phải mang khoá idempotency RIÊNG
   * (xem `confirmationKey`) — máy chủ buộc khoá vào (người, endpoint, body),
   * nên dùng lại một khoá cho endpoint thứ hai sẽ bị từ chối.
   */
  async confirmTransfer(
    visitId: string,
    manual: boolean,
    _version: number,
    idempotencyKey: string,
    billCode?: string,
  ): Promise<Receipt> {
    const session = await fetchSessionBills(Number(visitId))
    const target = pickTargetBill(session, billCode)
    const captured = await capturePayment({
      billId: target.id,
      method: "BANK_TRANSFER",
      idempotencyKey,
    })
    const result =
      captured.payment.status === "PENDING"
        ? await confirmPayment({
            billId: target.id,
            paymentId: captured.payment.id,
            observedTransfer: true,
            idempotencyKey: confirmationKey(idempotencyKey),
          })
        : captured
    return {
      billCode: result.bill.billCode,
      visitId: String(result.bill.visitId),
      sessionCode: result.bill.sessionCode,
      code: result.bill.code,
      tables: [...result.bill.tableCodes],
      ...clusterOf(result.bill),
      method: "TRANSFER",
      manual,
      givenVnd: result.bill.totalVnd,
      changeVnd: 0,
      preRoundVnd: result.bill.preRoundTotalVnd,
      dueVnd: result.bill.totalVnd,
      confirmedAt: hhmm(result.payment.confirmedAt ?? result.bill.paidAt),
      confirmedBy: result.payment.confirmedBy?.displayName ?? result.payment.collectedBy.displayName,
    }
  },

  /**
   * "Tiền về chưa?" — câu trả lời thật là "hoá đơn đã được ghi nhận thu chưa".
   *
   * Chưa có cổng thanh toán nào để hỏi, nên hàm này KHÔNG dò ngân hàng; nó đọc
   * lại Phiên. Trả `true` chỉ khi hoá đơn đã sang PAID, nghĩa là đã có người
   * chịu trách nhiệm cho khoản tiền đó.
   */
  async checkTransfer(visitId: string): Promise<{ found: boolean }> {
    const session = await fetchSessionBills(Number(visitId))
    const unpaid = session.bills.some((bill) => bill.status === "AWAITING_PAYMENT")
    return { found: !unpaid && session.bills.length > 0 }
  },

  /**
   * Chưa có endpoint thông báo. Trả danh sách rỗng chứ không ném lỗi: màn Thu
   * ngân hỏi lại mỗi vài giây, và một lỗi lặp lại ở đó sẽ che mất những lỗi
   * đáng đọc.
   */
  async listNotifications(): Promise<PaymentNotification[]> {
    return []
  },

  createPrebill: () =>
    notBuiltYet("Tạm tính đã được thay bằng Xuất hoá đơn (HU-44 v1.1), không còn endpoint riêng."),
  requestPayment: () =>
    notBuiltYet("Gọi thanh toán đã được thay bằng Xuất hoá đơn (HU-44 v1.1), không còn endpoint riêng."),

  // TN-14: luồng huỷ hoá đơn đã thu chưa có backend (còn chờ chốt nghiệp vụ).
  requestCancel: (): Promise<CancelRequest> => notBuiltYet("Luồng xin huỷ hoá đơn chưa được kết nối máy chủ."),
  listMyCancelRequests: (): Promise<CancelRequest[]> =>
    notBuiltYet("Luồng xin huỷ hoá đơn chưa được kết nối máy chủ."),
  listCancelRequests: (): Promise<CancelRequest[]> =>
    notBuiltYet("Hàng chờ duyệt huỷ hoá đơn chưa được kết nối máy chủ."),
  decideCancel: (): Promise<CancelRequest> => notBuiltYet("Duyệt huỷ hoá đơn chưa được kết nối máy chủ."),
  cancelPaid: (): Promise<CancelEffect> => notBuiltYet("Huỷ hoá đơn đã thu chưa được kết nối máy chủ."),
  listPaidBills: (): Promise<PaidBillSummary[]> =>
    notBuiltYet("Danh sách hoá đơn đã thu trong ngày chưa được kết nối máy chủ."),
  listAudit: (): Promise<PaymentAuditEntry[]> => notBuiltYet("Nhật ký thanh toán chưa được kết nối máy chủ."),
}

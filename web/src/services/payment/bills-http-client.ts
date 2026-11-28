/**
 * TU-45 / TU-46 — hợp đồng HTTP của bill, nhìn từ phía trình duyệt.
 *
 * Các kiểu ở đây phản chiếu `api/src/modules/bills/bill.model.ts`. Chúng được
 * viết tay chứ không sinh tự động, nên khi API thêm một trường thì màn hình
 * không tự nhận nó — và đó là điều muốn: một trường mới ở phía máy chủ phải đi
 * qua một lần đọc của người, vì danh sách "bill không bao giờ mang gì" là một
 * allow-list.
 *
 * Bill KHÔNG mang thông tin khách: không tên, không số điện thoại, không mã
 * khách. Việc lọc nằm ở MÁY CHỦ (`bill.model.ts` giải thích tại sao), nên
 * không có hàm nào ở đây "che" dữ liệu — nếu một màn hình phải che thì nó đang
 * gọi sai endpoint.
 */
import { ApiError, httpClient } from "@/services"

function requireHttp(): NonNullable<typeof httpClient> {
  if (!httpClient) {
    throw new ApiError(
      501,
      "BILL_REQUIRES_HTTP",
      "Chốt bill và thanh toán cần kết nối API thật: bản demo không ghi nhận tiền.",
    )
  }
  return httpClient
}

export type BillStatus = "AWAITING_PAYMENT" | "PAID" | "VOIDED" | "SUPERSEDED"

export type BillChargeCode = "ITEM_SUBTOTAL" | "VAT" | "FINAL_ROUNDING"

export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CREDIT"

export type BillBlockerCode = "BILL_EMPTY" | "ORDER_CANCELLATION_PENDING" | "BILL_ALREADY_OPEN" | "VISIT_ALREADY_PAID"

export interface BillBlocker {
  code: BillBlockerCode
  message: string
  context?: Record<string, number | string>
}

export interface BillFeatureFlag {
  feature: "DISCOUNT" | "SERVICE_FEE" | "SURCHARGE" | "SPLIT_BILL" | "SPLIT_PAYMENT" | "E_INVOICE" | "VOID_PAID_BILL"
  status: "IN_DEVELOPMENT"
  label: string
}

export type BillLineState = "SERVED" | "MAKING" | "CANCELLED"

export interface BillLine {
  lineNo: number
  /** Đợt gọi món. Màn hình gom thành "Đợt 1", "Đợt 2". */
  orderRound: number
  /** Bar/Bếp đã mang ra chưa. Món đang làm vẫn tính tiền. */
  state: BillLineState
  sourceOrderLineId: number
  itemCode: string
  itemName: string
  variantDisplayName: string
  unitCode: string
  note: string | null
  quantity: number
  unitPriceVnd: number
  amountVnd: number
}

export interface BillCharge {
  sequenceNo: number
  chargeCode: BillChargeCode
  basisAmountVnd: number
  rateBasisPoints: number | null
  signedAmountVnd: number
  explanation: string
}

export interface BillActor {
  userId: number
  displayName: string
}

/** Bối cảnh Phiên mà tờ bill nào cũng mang. Không có gì về khách. */
export interface BillVisitContext {
  sessionCode: string
  code: string
  tableCodes: string[]
  groupSymbol: string | null
  guests: number
  /** Nhân viên phục vụ bàn, KHÔNG phải tên khách. */
  waiterName: string
  openedAt: string
  roundCount: number
}

export interface BillAmounts {
  subtotalVnd: number
  /** Điểm cơ bản: 1000 = 10%. */
  vatRateBasisPoints: number
  vatVnd: number
  preRoundTotalVnd: number
  roundingAdjustmentVnd: number
  totalVnd: number
}

export interface BillPreview extends BillAmounts, BillVisitContext {
  visitId: number
  /** Phiên bản của Phiên lúc xem trước. */
  version: number
  orderCount: number
  lines: BillLine[]
  charges: BillCharge[]
  previewedAt: string
  /** Rỗng nghĩa là chốt bill được ngay. */
  blockers: BillBlocker[]
  notAvailable: BillFeatureFlag[]
}

export interface PaymentMethodOption {
  method: PaymentMethod
  available: boolean
  label: string
  status?: "IN_DEVELOPMENT"
  reason?: string
}

export interface BillQr {
  provider: string
  /** Chuỗi EMVCo. Trình duyệt vẽ nó thành ảnh; máy chủ không lưu ảnh. */
  payload: string
  transferNote: string
  beneficiary: { bankBin: string; accountNumber: string; accountName: string }
  amountVnd: number
  /** Quán chưa cung cấp tài khoản thật → phủ nhãn DEMO lên mã. */
  isDemo: boolean
}

export interface Bill extends BillAmounts, BillVisitContext {
  id: number
  billCode: string
  shortCode: string
  visitId: number
  businessDate: string
  revision: number
  status: BillStatus
  tableCodes: string[]
  groupSymbol: string | null
  orderCount: number
  lineCount: number
  itemCount: number
  lines: BillLine[]
  charges: BillCharge[]
  closedBy: BillActor
  closedAt: string
  paidBy: BillActor | null
  paidAt: string | null
  /**
   * HU-44 v1.1 — QR nằm TRÊN hoá đơn, sinh lúc Xuất hoá đơn, để Phục vụ đưa
   * khách cầm ra quầy. `null` khi quán chưa khai tài khoản nhận tiền.
   */
  qr: BillQr | null
  paymentMethods: PaymentMethodOption[]
  notAvailable: BillFeatureFlag[]
  version: number
}

export interface BillListItem extends BillAmounts, BillVisitContext {
  billId: number | null
  billCode: string | null
  shortCode: string | null
  visitId: number
  status: BillStatus | "SERVING"
  tableCodes: string[]
  groupSymbol: string | null
  orderCount: number
  itemCount: number
  startedAt: string
  closedAt: string | null
  /** V12: một Phiên có thể đang giữ nhiều hoá đơn chưa thu. */
  unpaidBillCount: number
  version: number
  /** Tổng mọi hoá đơn chưa thu CỘNG món chưa lên hoá đơn: số nợ của cả Phiên. */
  dueTotalVnd: number
}

export interface BillList {
  businessDate: string
  counts: { all: number; serving: number; awaitingPayment: number }
  items: BillListItem[]
}

/**
 * Con số sẽ được chốt.
 *
 * Tham số tên `visitId`, không phải `session`: API nhận cả hai, nhưng trong dự
 * án này "session" đã mang nghĩa phiên ĐĂNG NHẬP, và một chữ hai nghĩa trong
 * cùng một API là cách để một bug ngồi yên sáu tháng.
 */
export async function fetchBillPreview(visitId: number): Promise<BillPreview> {
  const response = await requireHttp().get<{ preview: BillPreview }>(`/bills/preview?visitId=${visitId}`)
  return response.preview
}

export async function fetchBill(billId: number): Promise<Bill> {
  const response = await requireHttp().get<{ bill: Bill }>(`/bills/${billId}`)
  return response.bill
}

export async function fetchOpenBills(businessDate: string): Promise<BillList> {
  return requireHttp().get<BillList>(`/bills?businessDate=${businessDate}`)
}

export interface CloseBillPayload {
  visitId: number
  idempotencyKey: string
  /**
   * Tổng mà người bấm vừa nhìn thấy. Gửi kèm để máy chủ từ chối nếu khách gọi
   * thêm giữa lúc đưa tạm tính cho khách xem và lúc bấm Chốt — thà báo lỗi còn
   * hơn chốt một con số khác con số khách vừa đồng ý.
   */
  expectedTotalVnd?: number
}

export async function closeBill(payload: CloseBillPayload): Promise<Bill> {
  const response = await requireHttp().post<{ bill: Bill }>("/bills", payload, {
    idempotencyKey: payload.idempotencyKey,
  })
  return response.bill
}

/* --------------------------- TU-46: thanh toán --------------------------- */

export type PaymentStatus = "PENDING" | "CAPTURED" | "FAILED" | "CANCELLED"

export type PaymentConfirmationMode = "MANUAL" | "GATEWAY"

/** Cùng hình dạng với QR trên hoá đơn: giao dịch chép lại đúng chuỗi khách đã quét. */
export type PaymentQr = BillQr

export interface Payment {
  id: number
  billId: number
  method: PaymentMethod
  status: PaymentStatus
  amountVnd: number
  tenderedAmountVnd: number | null
  changeAmountVnd: number | null
  confirmationMode: PaymentConfirmationMode
  collectedBy: BillActor
  confirmedBy: BillActor | null
  confirmedAt: string | null
  qr: PaymentQr | null
  gatewayConfirmation: { status: "IN_DEVELOPMENT"; reason: string }
}

/** Hệ quả của một lần thu tiền lên Phiên và sơ đồ bàn. */
export interface Settlement {
  visitId: number
  endedAt: string
  releasedTables: string[]
  turn: { turnNo: number; scope: "TABLE" | "GROUP"; counted: boolean } | null
}

export interface PaymentResult {
  payment: Payment
  bill: Bill
  /** `null` khi giao dịch mới chỉ ở `PENDING` (chuyển khoản chờ xác nhận). */
  settlement: Settlement | null
}

export interface CapturePaymentPayload {
  billId: number
  method: PaymentMethod
  /** Bắt buộc với tiền mặt, phải ≥ tổng bill. */
  tenderedAmountVnd?: number
  idempotencyKey: string
}

export async function capturePayment(payload: CapturePaymentPayload): Promise<PaymentResult> {
  const { billId, ...body } = payload
  return requireHttp().post<PaymentResult>(`/bills/${billId}/payments`, body, {
    idempotencyKey: payload.idempotencyKey,
  })
}

export interface ConfirmPaymentPayload {
  billId: number
  paymentId: number
  /** Phải là `true`: người bấm đang thay một cổng thanh toán khẳng định tiền đã về. */
  observedTransfer: boolean
  idempotencyKey: string
}

export async function confirmPayment(payload: ConfirmPaymentPayload): Promise<PaymentResult> {
  const { billId, paymentId, ...body } = payload
  return requireHttp().post<PaymentResult>(`/bills/${billId}/payments/${paymentId}/confirm`, body, {
    idempotencyKey: payload.idempotencyKey,
  })
}

/** Nút "Kiểm tra" của Màn 6 đọc cái này. Nó KHÔNG bao giờ tự đóng bill. */
export async function fetchPayment(billId: number, paymentId: number): Promise<Payment> {
  const response = await requireHttp().get<{ payment: Payment }>(`/bills/${billId}/payments/${paymentId}`)
  return response.payment
}

/* --------------------- NA-45: mọi hoá đơn của một Phiên -------------------- */

export interface SessionBills extends BillVisitContext {
  visitId: number
  status: "SERVING" | "AWAITING_PAYMENT" | "PAID" | "CLOSED_UNPAID"
  unbilledLineCount: number
  unbilledLines: BillLine[]
  bills: Bill[]
  version: number
}

/**
 * Mọi hoá đơn của một Phiên trong MỘT lần gọi.
 *
 * Màn Thu ngân đọc cái này cho các bước Chi tiết → Chọn phương thức → Thu tiền.
 * Ghép từ nhiều lần gọi sẽ cho ra bức tranh chắp vá khi máy khác vừa thu xong
 * một bill ở giữa hai lần đó.
 */
export async function fetchSessionBills(visitId: number): Promise<SessionBills> {
  const response = await requireHttp().get<{ session: SessionBills }>(`/bills/session/${visitId}`)
  return response.session
}

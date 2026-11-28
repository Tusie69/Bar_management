/**
 * TU-45 / TU-46 — hợp đồng dữ liệu của bill, và danh sách những gì nó KHÔNG mang.
 *
 * Bill chỉ chứa: món, số tiền, mã bàn, mã Phiên, người thao tác.
 *
 * Không có `customerId`, `contactName`, `guestName`, `phoneE164`, `phoneLast3`,
 * `honorific`, `reservationId` — ở MỌI vai, kể cả Thu ngân và Quản trị. Lý do
 * không phải "Phục vụ không được xem": một tờ bill là thứ ra khỏi hệ thống, nó
 * được in, chụp ảnh, gửi qua Zalo. Thông tin khách không nên có mặt ở đó dù ai
 * đang cầm nó.
 *
 * Các kiểu ở đây viết tay chứ không `Omit<...>` một kiểu rộng hơn: đó là khác
 * biệt giữa allow-list và deny-list. Thêm một trường nhận dạng khách vào phép
 * chiếu Phiên sau này sẽ KHÔNG tự động chảy sang bill. `bill-privacy.test.ts`
 * canh đúng danh sách này.
 */

export type BillStatus = 'AWAITING_PAYMENT' | 'PAID' | 'VOIDED' | 'SUPERSEDED'

export type BillChargeCode = 'ITEM_SUBTOTAL' | 'VAT' | 'FINAL_ROUNDING'

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CREDIT'

/**
 * Lý do một Phiên chưa chốt bill được, trả về ở `preview.blockers` để màn hình
 * giải thích TRƯỚC khi người dùng bấm, chứ không để nút khoá mà không nói vì sao.
 */
export type BillBlockerCode =
  /** Phiên chưa gọi món nào còn hiệu lực. */
  | 'BILL_EMPTY'
  /** Còn yêu cầu hủy món đang chờ duyệt (Q5). */
  | 'ORDER_CANCELLATION_PENDING'
  /** Đã có bill đang chờ thanh toán. */
  | 'BILL_ALREADY_OPEN'
  /** Phiên đã thanh toán. */
  | 'VISIT_ALREADY_PAID'

export interface BillBlocker {
  code: BillBlockerCode
  /** Câu tiếng Việt hiện ngay cạnh nút bị khoá. */
  message: string
  /** Số liệu để màn hình dẫn người dùng tới chỗ cần xử lý. */
  context?: Readonly<Record<string, number | string>>
}

/**
 * Một tính năng có mặt trên thiết kế nhưng chưa được xây.
 *
 * API trả về nó thay vì im lặng, vì mockup NA-44 yêu cầu các thẻ này HIỆN RA ở
 * trạng thái khoá kèm nhãn — một tính năng biến mất khỏi màn hình sẽ được hỏi
 * lại mỗi sprint, còn một tính năng hiện ra với chữ "Đang phát triển" thì không.
 *
 * `status` luôn là `IN_DEVELOPMENT`: không tự đoán nghiệp vụ đang chờ HU-43.
 */
export interface BillFeatureFlag {
  feature: 'DISCOUNT' | 'SERVICE_FEE' | 'SURCHARGE' | 'SPLIT_BILL' | 'SPLIT_PAYMENT' | 'E_INVOICE' | 'VOID_PAID_BILL'
  status: 'IN_DEVELOPMENT'
  label: string
}

/** Danh sách cố định, dùng chung cho preview và bill đã chốt. */
export const BILL_FEATURES_IN_DEVELOPMENT: readonly BillFeatureFlag[] = [
  { feature: 'DISCOUNT', status: 'IN_DEVELOPMENT', label: 'Giảm giá' },
  { feature: 'SERVICE_FEE', status: 'IN_DEVELOPMENT', label: 'Phí phục vụ' },
  { feature: 'SURCHARGE', status: 'IN_DEVELOPMENT', label: 'Phụ thu' },
  { feature: 'SPLIT_BILL', status: 'IN_DEVELOPMENT', label: 'Tách bill' },
  { feature: 'SPLIT_PAYMENT', status: 'IN_DEVELOPMENT', label: 'Thanh toán nhiều phương thức' },
  { feature: 'E_INVOICE', status: 'IN_DEVELOPMENT', label: 'Hóa đơn điện tử' },
  { feature: 'VOID_PAID_BILL', status: 'IN_DEVELOPMENT', label: 'Hủy bill đã thanh toán' },
] as const

/**
 * Trạng thái một dòng món nhìn từ tờ bill (NA-45).
 *
 * `CANCELLED` không bao giờ xuất hiện trên dòng ĐÃ LÊN BILL: phần bị hủy đã bị
 * `net_quantity` trừ ra từ trước. Nó chỉ có nghĩa ở màn tạm tính, nơi màn hình
 * cần nói rõ dòng nào đã hủy để khách đối chiếu.
 */
export type BillLineState = 'SERVED' | 'MAKING' | 'CANCELLED'

export interface BillLineView {
  lineNo: number
  /** Đợt gọi món (`sales_orders.visit_sequence`). Màn hình gom "Đợt 1", "Đợt 2". */
  orderRound: number
  /** Bar/Bếp đã mang ra chưa. Món đang làm VẪN tính tiền. */
  state: BillLineState
  /** `MIN(sales_order_lines.id)` của nhóm đã gộp — con trỏ đối soát, không phải khóa. */
  sourceOrderLineId: number
  itemCode: string
  itemName: string
  variantDisplayName: string
  unitCode: string
  /** Đã lược số điện thoại. */
  note: string | null
  quantity: number
  unitPriceVnd: number
  amountVnd: number
}

export interface BillChargeView {
  sequenceNo: number
  chargeCode: BillChargeCode
  basisAmountVnd: number
  rateBasisPoints: number | null
  signedAmountVnd: number
  explanation: string
}

/** Nhân viên đã thao tác. Đây là người duy nhất có tên trên bill. */
export interface BillActor {
  userId: number
  displayName: string
}

/**
 * Thông tin Phiên mà tờ bill nào cũng cần in hoặc hiện.
 *
 * KHÔNG có gì về khách: `waiterName` là NHÂN VIÊN phục vụ bàn, không phải tên
 * khách; `guests` là số người, không phải danh tính ai.
 */
export interface BillVisitContext {
  /** `S-0042` — mã Phiên đọc được, dựng từ `visits.id`. */
  sessionCode: string
  /** Mã cụm ghép nếu có, không thì mã bàn đầu tiên. Dùng làm nhãn ngắn. */
  code: string
  tableCodes: string[]
  groupSymbol: string | null
  /** Số khách của Phiên. */
  guests: number
  /** Phục vụ phụ trách — người gửi đơn đầu tiên của Phiên. */
  waiterName: string
  /** Giờ mở Phiên. */
  openedAt: string
  /** Số đợt gọi món của Phiên. */
  roundCount: number
}

export interface BillAmounts {
  subtotalVnd: number
  vatRateBasisPoints: number
  vatVnd: number
  preRoundTotalVnd: number
  roundingAdjustmentVnd: number
  totalVnd: number
}

/**
 * Con số SẼ được chốt, đọc trước khi ghi gì.
 *
 * Khác bill tạm tính (`GET /visits/:id/bill`) ở bước làm tròn lên nghìn: tạm
 * tính là con số cho khách xem, preview là con số sẽ khoá lại. Hai endpoint cùng
 * tồn tại vì hai câu hỏi khác nhau, và vì bill tạm tính đã chạy trên máy Phục vụ
 * từ module trước — đổi nghĩa của nó bây giờ sẽ làm lệch một màn hình đang dùng.
 */
export interface BillPreview {
  /** `visits.version` lúc xem trước. */
  version: number
  visitId: number
  tableCodes: string[]
  /** `G01`… khi Phiên đang ngồi một cụm bàn ghép. */
  groupSymbol: string | null
  orderCount: number
  lines: BillLineView[]
  charges: BillChargeView[]
  previewedAt: string
  /** Rỗng nghĩa là chốt bill được ngay. */
  blockers: BillBlocker[]
  notAvailable: readonly BillFeatureFlag[]
}

export type BillPreviewView = BillPreview & BillAmounts & BillVisitContext

export interface PaymentMethodOption {
  method: PaymentMethod
  available: boolean
  label: string
  /** Chỉ có khi `available` là false. */
  status?: 'IN_DEVELOPMENT'
  /** Câu hiện cạnh thẻ bị khoá. */
  reason?: string
}

/**
 * Ba phương thức, và Ghi nợ bị KHOÁ (CH-05).
 *
 * Nó vẫn có mặt trong danh sách thay vì bị lọc ra: mockup yêu cầu thẻ hiện ra
 * ở trạng thái khoá, và `ck_bill_payments_method` ở database cũng chặn nó, nên
 * ba lớp cùng nói một điều. Bật Ghi nợ sau này là đổi một dòng ở đây và nới một
 * CHECK — không phải thêm một luồng mới.
 */
export const PAYMENT_METHOD_OPTIONS: readonly PaymentMethodOption[] = [
  { method: 'CASH', available: true, label: 'Tiền mặt' },
  { method: 'BANK_TRANSFER', available: true, label: 'Chuyển khoản QR' },
  {
    method: 'CREDIT',
    available: false,
    label: 'Ghi nợ',
    status: 'IN_DEVELOPMENT',
    reason: 'Đang phát triển',
  },
] as const

export interface BillView extends BillAmounts, BillVisitContext {
  id: number
  billCode: string
  /** `B0412` — bản ngắn cho chỗ chật trên màn hình. Không dùng để đối soát. */
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
  lines: BillLineView[]
  charges: BillChargeView[]
  closedBy: BillActor
  closedAt: string
  paidBy: BillActor | null
  paidAt: string | null
  /**
   * HU-44 v1.1 — QR nằm TRÊN hoá đơn, sinh lúc xuất (TN-02-K4), để Phục vụ đưa
   * khách cầm ra quầy. `null` khi quán chưa khai tài khoản nhận tiền: hoá đơn
   * vẫn xuất được, chỉ thẻ Chuyển khoản ở màn Thu ngân bị khoá.
   */
  qr: PaymentQrView | null
  paymentMethods: readonly PaymentMethodOption[]
  notAvailable: readonly BillFeatureFlag[]
  version: number
}

/** Một hàng của Màn 1 (Phiên đang mở). Không mang dòng món — màn đó chỉ cần tổng. */
export interface BillListItem extends BillAmounts, BillVisitContext {
  billId: number | null
  billCode: string | null
  shortCode: string | null
  visitId: number
  status: BillStatus | 'SERVING'
  tableCodes: string[]
  groupSymbol: string | null
  orderCount: number
  itemCount: number
  /** Giờ mở Phiên, để màn hình hiện "đã ngồi 1 giờ 20". */
  startedAt: string
  closedAt: string | null
  /**
   * V12: một Phiên có thể đang giữ NHIỀU hoá đơn chưa thu. `billId` ở trên là
   * tờ cũ nhất — tờ Thu ngân sẽ thu trước — còn con số này cho màn hình biết
   * còn mấy tờ nữa phía sau.
   */
  unpaidBillCount: number
  /** `visits.version`, để màn hình gửi lại khi Xuất hoá đơn. */
  version: number
  /**
   * Tất cả những gì Phiên này còn nợ: tổng mọi hoá đơn chưa thu, CỘNG phần món
   * chưa lên hoá đơn nào (tính sống, cùng công thức).
   *
   * Thẻ ở Màn 1 hiện con số này, không phải `totalVnd` của một tờ: một bàn đã
   * thu tờ 1 và còn gọi tiếp mà chỉ hiện tờ 2 là báo thiếu tiền cho Thu ngân.
   */
  dueTotalVnd: number
}

/**
 * Mọi hoá đơn của MỘT Phiên, cộng phần món chưa lên hoá đơn nào.
 *
 * V12 làm endpoint này cần thiết: màn Thu ngân phải thấy cả bill 1 đã thu lẫn
 * bill 2 đang chờ, và biết còn món nào chưa xuất để quyết định xuất tiếp hay
 * đóng Phiên. Đọc từng bill một rồi tự ghép ở trình duyệt sẽ cho ra một bức
 * tranh chắp vá giữa hai lần gọi.
 */
export interface SessionBillsView extends BillVisitContext {
  visitId: number
  /** Trạng thái Phiên nhìn từ phía thu tiền. */
  status: 'SERVING' | 'AWAITING_PAYMENT' | 'PAID' | 'CLOSED_UNPAID'
  /** Số dòng món chưa lên hoá đơn nào. 0 nghĩa là xuất hết rồi. */
  unbilledLineCount: number
  /** Món chưa lên hoá đơn, để màn hình hiện trước khi bấm Xuất hóa đơn. */
  unbilledLines: BillLineView[]
  bills: BillView[]
  /** `visits.version`, để client gửi kèm khi ghi. */
  version: number
}

export interface BillListView {
  businessDate: string
  counts: {
    all: number
    serving: number
    awaitingPayment: number
  }
  items: BillListItem[]
}

/* --------------------------- TU-46: thanh toán --------------------------- */

export type PaymentStatus = 'PENDING' | 'CAPTURED' | 'FAILED' | 'CANCELLED'

/**
 * `MANUAL`: một người đã tick "đã thấy tiền về" và tên họ nằm trên giao dịch.
 * `GATEWAY`: cổng thanh toán tự khớp. Chưa dùng tuần này (CH-02) — chừa chỗ,
 * không giả lập.
 */
export type PaymentConfirmationMode = 'MANUAL' | 'GATEWAY'

export interface PaymentQrView {
  provider: string
  /** Chuỗi EMVCo đầy đủ. Trình duyệt vẽ nó thành ảnh; máy chủ không lưu ảnh. */
  payload: string
  /** `21GAM B261126-0412`. Không bao giờ mang gì về khách. */
  transferNote: string
  beneficiary: {
    bankBin: string
    /** Đã che: khách quét mã chứ không đọc số tài khoản. */
    accountNumber: string
    accountName: string
  }
  amountVnd: number
  /** Quán chưa cung cấp tài khoản thật → màn hình phủ nhãn DEMO. */
  isDemo: boolean
}

export interface PaymentView {
  id: number
  billId: number
  method: PaymentMethod
  status: PaymentStatus
  amountVnd: number
  /** Tiền khách đưa. `null` với chuyển khoản. */
  tenderedAmountVnd: number | null
  /** Tiền thừa phải trả lại khách. Cột sinh ở database, không do client tính. */
  changeAmountVnd: number | null
  confirmationMode: PaymentConfirmationMode
  collectedBy: BillActor
  /** Ai tick "đã thấy tiền về". */
  confirmedBy: BillActor | null
  confirmedAt: string | null
  qr: PaymentQrView | null
  /** Webhook cổng thanh toán chờ CH-02. Luôn `IN_DEVELOPMENT` tuần này. */
  gatewayConfirmation: { status: 'IN_DEVELOPMENT'; reason: string }
}

/** Hệ quả của một lần thu tiền lên Phiên và sơ đồ bàn. */
export interface SettlementView {
  visitId: number
  endedAt: string
  /** Mã bàn vừa về Trống. Cụm ghép vẫn giữ quan hệ ghép. */
  releasedTables: string[]
  turn: { turnNo: number; scope: 'TABLE' | 'GROUP'; counted: boolean } | null
}

export interface CapturePaymentInput {
  billId: number
  method: PaymentMethod
  /** Bắt buộc với `CASH`, phải ≥ tổng bill. */
  tenderedAmountVnd?: number
  idempotencyKey: string
}

export interface ConfirmPaymentInput {
  billId: number
  paymentId: number
  /** Phải là `true` tường minh. Không có mặc định cho một lời khẳng định về tiền. */
  observedTransfer: boolean
  idempotencyKey: string
}

export interface CloseBillInput {
  visitId: number
  idempotencyKey: string
  /**
   * Tổng mà người bấm vừa nhìn thấy trên màn hình.
   *
   * Tuỳ chọn nhưng nên gửi: khách gọi thêm một ly giữa lúc Phục vụ đưa tạm tính
   * cho khách xem và lúc Thu ngân bấm Chốt là chuyện xảy ra thật. Có trường này
   * thì máy chủ trả 409 kèm tổng mới; thiếu nó thì bill được chốt ở một con số
   * khác con số khách vừa đồng ý, và không ai biết điều đó đã xảy ra.
   */
  expectedTotalVnd?: number
}

/**
 * TU-45 — luật tính tiền của BILL ĐÃ CHỐT.
 *
 * Khác `visit-bill.ts` ở đúng một chỗ, và đó là cả điểm: bill tạm tính dừng ở
 * `subtotal + vat`, còn bill đã chốt đi thêm một bước — LÀM TRÒN LÊN NGHÌN —
 * vì nó là con số khách thật sự trả. TN-06 (anh Luân, 18/11): 230.560đ → 231.000đ.
 *
 * Bốn quyết định đã chốt 26/11 nằm nguyên trong file này, nên đọc file này là
 * đọc hết luật tiền:
 *
 * 1. Tiền là SỐ NGUYÊN ĐỒNG (Q0). Không float, không DECIMAL, không chia cho
 *    100 ở đâu cả. Đồng Việt Nam không có đơn vị nhỏ hơn.
 * 2. VAT tính MỘT LẦN TRÊN TỔNG tạm tính, làm tròn nửa lên tới đồng (Q2) —
 *    không phải từng dòng rồi cộng. Hai cách lệch nhau thật: hai dòng 44.995đ
 *    và 45.005đ cho ra 99.000đ theo cách này và 100.000đ theo cách kia, vì
 *    phần lệch 1đ đủ để nhảy qua một mốc nghìn.
 * 3. Làm tròn lên nghìn CHỈ Ở TỔNG CUỐI (Q3). Làm tròn từng dòng rồi cộng cho
 *    ra một số khác: ba dòng 33.333đ ra 113.000đ thay vì 110.000đ.
 * 4. Phần chênh do làm tròn được LƯU RIÊNG (`roundingAdjustmentVnd`), không
 *    trộn vào VAT. Kế toán phải thấy được quán đã làm tròn bao nhiêu.
 *
 * Mọi hàm ở đây THUẦN, nên luật tiền kiểm được bằng assert mà không cần MySQL —
 * xem `api/test/bill-total.test.ts`.
 */
import { vatAmountVnd } from '../orders/visit-bill.js'

export { vatAmountVnd }

/** Đơn vị làm tròn cuối cùng. 1000 = làm tròn tới nghìn đồng. */
export const ROUNDING_UNIT_VND = 1000

/**
 * Trần của một bill, bằng trần của một đơn (xem `0036`) nhân số đơn tối đa của
 * một Phiên mà vẫn còn nằm trong khoảng nguyên chính xác của JavaScript.
 *
 * Tiền đi qua JSON dưới dạng `number`. Trần này tồn tại để một con số không còn
 * chính xác không bao giờ tới được trình duyệt, nơi nó sẽ bị làm tròn âm thầm
 * và không ai thấy lỗi ở đâu. `ck_bills_total` chặn cùng con số này ở database.
 */
export const MAX_BILL_TOTAL_VND = 4_950_000_000_000

/** Số dòng tối đa một bill chứa được. Một Phiên 500 dòng món là một Phiên đã sai ở đâu đó. */
export const MAX_BILL_LINES = 500

/**
 * Một dòng trên bill đã chốt.
 *
 * `amountVnd` được truyền vào chứ không tính lại từ `unitPriceVnd * quantity`:
 * nguồn của nó là `sales_order_lines.net_total_vnd`, một cột SINH của MySQL.
 * Tính lại ở đây là dựng nguồn sự thật thứ hai cho cùng một phép nhân, và hai
 * nguồn sẽ lệch nhau ở lần sửa đầu tiên.
 */
export interface BillLineInput {
  readonly quantity: number
  readonly unitPriceVnd: number
  readonly amountVnd: number
}

export interface BillTotals {
  /** Tổng các dòng, chưa thuế. */
  subtotalVnd: number
  /** Thuế suất tại thời điểm chốt, điểm cơ bản: 1000 = 10%. */
  vatRateBasisPoints: number
  vatVnd: number
  /** `subtotal + vat`, trước khi làm tròn. Con số kế toán cần. */
  preRoundTotalVnd: number
  /** 0..999. Phần quán làm tròn lên cho khách dễ trả. */
  roundingAdjustmentVnd: number
  /** Số khách phải trả. Luôn chia hết cho 1000. */
  totalVnd: number
}

/**
 * Làm tròn LÊN tới nghìn đồng.
 *
 * `ceil` chứ không `round`: 49.500đ thành 50.000đ, không phải 49.000đ. Đây là
 * làm tròn lên, không phải làm tròn tới số gần nhất — quán không bao giờ thu
 * ít hơn số đã tính.
 *
 * Viết bằng số nguyên (`+ 999` rồi chia lấy nguyên) chứ không `Math.ceil(x /
 * 1000)`: phép chia cho ra số thực, và một số thực đi qua `Math.ceil` ở biên
 * có thể nhảy sai một đơn vị.
 */
export function roundUpToThousand(amountVnd: number): number {
  if (!Number.isSafeInteger(amountVnd) || amountVnd <= 0) return 0
  return Math.floor((amountVnd + ROUNDING_UNIT_VND - 1) / ROUNDING_UNIT_VND) * ROUNDING_UNIT_VND
}

/**
 * Bốn bước tính tiền, theo đúng thứ tự đã chốt.
 *
 * `subtotal` cộng lại từ chính những dòng SẼ HIỆN TRÊN BILL, không đọc một tổng
 * tính sẵn ở nơi khác: tờ bill khách cầm phải cộng đúng bằng tay được, và một
 * tổng không khớp các dòng của nó là tờ bill không ai cãi lại được.
 */
export function buildBillTotals(
  lines: readonly BillLineInput[],
  vatRateBasisPoints: number,
): BillTotals {
  const subtotalVnd = lines.reduce((total, line) => total + line.amountVnd, 0)
  const vatVnd = vatAmountVnd(subtotalVnd, vatRateBasisPoints)
  const preRoundTotalVnd = subtotalVnd + vatVnd
  const totalVnd = roundUpToThousand(preRoundTotalVnd)
  return {
    subtotalVnd,
    vatRateBasisPoints,
    vatVnd,
    preRoundTotalVnd,
    roundingAdjustmentVnd: totalVnd - preRoundTotalVnd,
    totalVnd,
  }
}

/** Ba loại khoản mục đang có. Giảm giá, phí phục vụ và phụ thu chờ HU-43. */
export type BillChargeCode = 'ITEM_SUBTOTAL' | 'VAT' | 'FINAL_ROUNDING'

/**
 * Một dòng của sổ tính tiền (ledger), append-only, theo `sequenceNo`.
 *
 * Tồn tại để Module 8 in được tờ bill mà KHÔNG phải đọc lại menu hay cấu hình
 * thuế — cả hai đều đổi được sau khi bill đã chốt. Và để thêm phí phục vụ sau
 * này là thêm một hàng ledger chứ không phải sửa công thức đã in ra hoá đơn cũ.
 *
 * `signedAmountVnd` CÓ DẤU dù cả ba loại hiện tại đều không âm: giảm giá sẽ là
 * một hàng âm, và đổi kiểu cột khi đã có dữ liệu là một migration không ai muốn.
 */
export interface BillChargeLine {
  sequenceNo: number
  chargeCode: BillChargeCode
  /** Nền đã dùng để tính khoản này. 0 với `ITEM_SUBTOTAL`. */
  basisAmountVnd: number
  /** Chỉ `VAT` có thuế suất; hai loại kia là `null`. */
  rateBasisPoints: number | null
  signedAmountVnd: number
  /** Câu tiếng Việt in được thẳng lên bill. */
  explanation: string
}

/** "10%", "8%", "10,5%" — nhãn đọc cho khách, dựng từ điểm cơ bản. */
export function formatVatRate(basisPoints: number): string {
  const percent = basisPoints / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, '').replace('.', ',')}%`
}

/**
 * Sổ tính tiền của một bill: mỗi bước một hàng, đọc từ trên xuống là ra tổng.
 *
 * `FINAL_ROUNDING` LUÔN có mặt, kể cả khi bằng 0. Một hàng "làm tròn 0đ" nói
 * với người đọc rằng bước làm tròn đã chạy và không cộng gì; thiếu hàng đó thì
 * không phân biệt được "đã tròn sẵn" với "quên làm tròn".
 */
export function buildChargeLedger(totals: BillTotals, itemCount: number): BillChargeLine[] {
  return [
    {
      sequenceNo: 1,
      chargeCode: 'ITEM_SUBTOTAL',
      basisAmountVnd: 0,
      rateBasisPoints: null,
      signedAmountVnd: totals.subtotalVnd,
      explanation: `Tạm tính ${itemCount} món`,
    },
    {
      sequenceNo: 2,
      chargeCode: 'VAT',
      basisAmountVnd: totals.subtotalVnd,
      rateBasisPoints: totals.vatRateBasisPoints,
      signedAmountVnd: totals.vatVnd,
      explanation: `VAT ${formatVatRate(totals.vatRateBasisPoints)}`,
    },
    {
      sequenceNo: 3,
      chargeCode: 'FINAL_ROUNDING',
      basisAmountVnd: totals.preRoundTotalVnd,
      rateBasisPoints: null,
      signedAmountVnd: totals.roundingAdjustmentVnd,
      explanation: 'Làm tròn lên nghìn',
    },
  ]
}

/**
 * Tham số đã dùng để tính bill này, chép vào `bills.pricing_policy_snapshot`.
 *
 * Đây là đường thoát cho ngày HU-43 đổi luật: một bill đã chốt mang theo luật
 * của chính nó, nên đổi cấu hình hôm sau không viết lại hoá đơn hôm trước. Tập
 * khoá CỐ ĐỊNH và có test canh — một JSON tự do là chỗ sớm muộn sẽ có người
 * nhét số điện thoại khách vào "cho chắc".
 */
export interface PricingPolicySnapshot {
  vatRateBasisPoints: number
  /** `EXCLUSIVE`: giá menu CHƯA gồm VAT (CH-01). `INCLUSIVE` chờ HU-43. */
  vatMode: 'EXCLUSIVE'
  /** `TOTAL`: VAT tính một lần trên tổng tạm tính (Q2). */
  vatBasis: 'TOTAL'
  /** `UP`: làm tròn lên (Q3). */
  roundingMode: 'UP'
  /** `FINAL_TOTAL`: chỉ áp ở tổng cuối (Q3). */
  roundingScope: 'FINAL_TOTAL'
  roundingUnitVnd: number
}

export function buildPricingPolicySnapshot(vatRateBasisPoints: number): PricingPolicySnapshot {
  return {
    vatRateBasisPoints,
    vatMode: 'EXCLUSIVE',
    vatBasis: 'TOTAL',
    roundingMode: 'UP',
    roundingScope: 'FINAL_TOTAL',
    roundingUnitVnd: ROUNDING_UNIT_VND,
  }
}

/** Tập khoá hợp lệ của snapshot. Test dùng để chặn mọi trường lạ lọt vào JSON. */
export const PRICING_POLICY_SNAPSHOT_KEYS = [
  'vatRateBasisPoints',
  'vatMode',
  'vatBasis',
  'roundingMode',
  'roundingScope',
  'roundingUnitVnd',
] as const

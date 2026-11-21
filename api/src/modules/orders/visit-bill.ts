/**
 * Module Phục vụ (v1.1) — PV-18: luật của BILL TẠM TÍNH.
 *
 * "Tạm tính" là nghĩa đen: đây là con số để khách xem trước khi quyết định
 * thanh toán. Bàn vẫn Đang dùng, vẫn gọi thêm được, và không một đồng nào
 * được ghi nhận. Thanh toán thật là Pha 5b.
 *
 * Hàm thuần, nên luật tiền kiểm được bằng assert mà không cần MySQL.
 */

/** Một dòng trên bill: đã gộp theo món, chỉ còn phần khách thật sự phải trả. */
export interface VisitBillLine {
  itemName: string
  variantDisplayName: string
  note: string | null
  quantity: number
  unitPriceVnd: number
  amountVnd: number
}

export interface VisitBill {
  visitId: number
  tableCodes: string[]
  /** Số đơn đã gửi của Phiên. */
  orderCount: number
  lines: VisitBillLine[]
  /** Tổng các dòng, chưa thuế. */
  subtotalVnd: number
  /** Thuế suất tại thời điểm in, điểm cơ bản: 1000 = 10%. */
  vatRateBasisPoints: number
  vatVnd: number
  totalVnd: number
  /** Mốc thời gian máy chủ in bill, để tờ bill nói rõ nó cũ bao lâu. */
  printedAt: string
}

/**
 * Tiền thuế, làm tròn NỬA LÊN tới đồng.
 *
 * Đồng Việt Nam không có đơn vị nhỏ hơn, nên con số phải là số nguyên ở đây —
 * không phải ở chỗ nào đó trong frontend, nơi mỗi màn hình sẽ làm tròn một
 * kiểu và tổng trên màn lệch tổng trên máy in.
 *
 * Làm tròn trên TỔNG, không trên từng dòng: cộng các dòng đã làm tròn cho ra
 * một con số khác với làm tròn tổng, và con số khách phải trả là con số cuối.
 */
export function vatAmountVnd(subtotalVnd: number, basisPoints: number): number {
  if (!Number.isSafeInteger(subtotalVnd) || subtotalVnd < 0) return 0
  if (!Number.isSafeInteger(basisPoints) || basisPoints <= 0) return 0
  return Math.floor((subtotalVnd * basisPoints + 5000) / 10000)
}

export interface BuildVisitBillInput {
  visitId: number
  tableCodes: string[]
  orderCount: number
  lines: VisitBillLine[]
  vatRateBasisPoints: number
  printedAt: Date
}

/**
 * Dựng bill từ các dòng đã gộp.
 *
 * `subtotal` cộng lại từ chính những dòng HIỆN TRÊN BILL, không đọc một tổng
 * tính sẵn ở nơi khác: tờ giấy khách cầm phải cộng đúng bằng tay được, và một
 * tổng không khớp các dòng của nó là tờ bill không ai cãi lại được.
 */
export function buildVisitBill(input: BuildVisitBillInput): VisitBill {
  const subtotalVnd = input.lines.reduce((total, line) => total + line.amountVnd, 0)
  const vatVnd = vatAmountVnd(subtotalVnd, input.vatRateBasisPoints)
  return {
    visitId: input.visitId,
    tableCodes: [...input.tableCodes],
    orderCount: input.orderCount,
    lines: input.lines,
    subtotalVnd,
    vatRateBasisPoints: input.vatRateBasisPoints,
    vatVnd,
    totalVnd: subtotalVnd + vatVnd,
    printedAt: input.printedAt.toISOString(),
  }
}

/** "10%", "8%", "10,5%" — nhãn đọc cho khách, dựng từ điểm cơ bản. */
export function formatVatRate(basisPoints: number): string {
  const percent = basisPoints / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, '').replace('.', ',')}%`
}

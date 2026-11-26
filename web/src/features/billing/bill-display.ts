/**
 * TU-45 — luật hiển thị của bill, viết thành hàm thuần.
 *
 * Ở đây KHÔNG có phép tính tiền nào. Mọi con số do máy chủ gửi xuống, và màn
 * hình chỉ chọn hiện gì. Tính lại VAT hay làm tròn ở trình duyệt là dựng nguồn
 * sự thật thứ hai: hai màn hình sẽ làm tròn hai kiểu, và tổng trên màn lệch
 * tổng trên tờ bill.
 *
 * Hàm thuần nên test được không cần render — xem `bill-display.test.ts`.
 */
import type { BillAmounts, BillBlocker, BillCharge, BillFeatureFlag, BillStatus } from "./billing-api"

/** Một dòng trong khối tổng tiền. */
export interface AmountRow {
  key: string
  label: string
  amountVnd: number
  /** Dòng tổng cuối: in đậm, chữ to hơn. */
  emphasis: boolean
  /** Câu giải thích nhỏ dưới nhãn, khi có. */
  hint?: string
}

/** "10%", "8%", "10,5%" — dựng từ điểm cơ bản, không hard-code. */
export function formatVatRate(basisPoints: number): string {
  const percent = basisPoints / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, "").replace(".", ",")}%`
}

/**
 * Bốn dòng của khối tổng tiền, theo đúng thứ tự tính.
 *
 * Dòng "Làm tròn lên nghìn" CHỈ hiện khi nó khác 0. Một dòng "0đ" không nói
 * thêm điều gì cho khách đang đọc tờ bill, trong khi `bill_charge_lines` ở
 * database vẫn giữ đủ ba hàng cho kế toán — màn hình và sổ sách có hai người
 * đọc khác nhau.
 */
export function amountRows(amounts: BillAmounts): AmountRow[] {
  const rows: AmountRow[] = [
    { key: "subtotal", label: "Tạm tính", amountVnd: amounts.subtotalVnd, emphasis: false },
    {
      key: "vat",
      label: `VAT ${formatVatRate(amounts.vatRateBasisPoints)}`,
      amountVnd: amounts.vatVnd,
      emphasis: false,
    },
  ]
  if (amounts.roundingAdjustmentVnd > 0) {
    rows.push({
      key: "rounding",
      label: "Làm tròn lên nghìn",
      amountVnd: amounts.roundingAdjustmentVnd,
      emphasis: false,
    })
  }
  rows.push({ key: "total", label: "Khách phải trả", amountVnd: amounts.totalVnd, emphasis: true })
  return rows
}

/**
 * Sổ tính tiền từ máy chủ, dựng thành dòng hiển thị.
 *
 * Dùng ở bản in 80mm, nơi tờ giấy phải cộng đúng bằng tay được: ledger giữ cả
 * hàng làm tròn 0đ, nên người đọc thấy bước đó đã chạy chứ không phải bị quên.
 */
export function chargeRows(charges: readonly BillCharge[]): AmountRow[] {
  return charges.map((charge) => ({
    key: `charge-${charge.sequenceNo}`,
    label: charge.explanation,
    amountVnd: charge.signedAmountVnd,
    emphasis: false,
  }))
}

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  AWAITING_PAYMENT: "Chờ thanh toán",
  PAID: "Đã thanh toán",
  VOIDED: "Đã hủy",
  SUPERSEDED: "Đã thay thế",
}

export type BillListStatus = BillStatus | "SERVING"

export const BILL_LIST_STATUS_LABEL: Record<BillListStatus, string> = {
  SERVING: "Đang phục vụ",
  ...BILL_STATUS_LABEL,
}

/** Bộ lọc của Màn 1, đúng ba nhóm của mockup. */
export type BillFilter = "all" | "serving" | "awaitingPayment"

export const BILL_FILTER_LABEL: Record<BillFilter, string> = {
  all: "Tất cả",
  serving: "Đang phục vụ",
  awaitingPayment: "Chờ thanh toán",
}

export const BILL_FILTER_ORDER: readonly BillFilter[] = ["all", "serving", "awaitingPayment"]

export function matchesFilter(status: BillListStatus, filter: BillFilter): boolean {
  if (filter === "all") return true
  if (filter === "serving") return status === "SERVING"
  return status === "AWAITING_PAYMENT"
}

/**
 * Lý do nút Chốt bill bị khoá, và nó phải nói ĐƯỢC VIỆC GÌ cần làm.
 *
 * Câu từ máy chủ đã đủ nghĩa nên màn hình dùng nguyên văn; hàm này chỉ thêm
 * nhãn hành động khi có chỗ để đi tới. Một nút xám không nói vì sao là một nút
 * nhân viên sẽ bấm mười lần rồi gọi điện.
 */
export interface BlockerDisplay {
  code: BillBlocker["code"]
  message: string
  /** Nhãn của nút dẫn tới chỗ xử lý, hoặc `null` khi không có chỗ nào để đi. */
  actionLabel: string | null
}

export function blockerDisplays(blockers: readonly BillBlocker[]): BlockerDisplay[] {
  return blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    actionLabel:
      blocker.code === "ORDER_CANCELLATION_PENDING"
        ? "Mở màn duyệt hủy món"
        : blocker.code === "BILL_ALREADY_OPEN"
          ? "Mở bill đang chờ"
          : null,
  }))
}

/** Chỉ những blocker thật sự chặn việc chốt. `BILL_ALREADY_OPEN` là một lối đi, không phải bế tắc. */
export function canCloseBill(blockers: readonly BillBlocker[]): boolean {
  return blockers.length === 0
}

/**
 * Nhãn "Đang phát triển" của những tính năng có trên thiết kế mà chưa xây.
 *
 * Mockup NA-44 yêu cầu các thẻ này HIỆN RA ở trạng thái khoá. Một tính năng
 * biến mất khỏi màn hình sẽ bị hỏi lại mỗi sprint; một tính năng hiện ra với
 * chữ "Đang phát triển" thì không.
 */
export const IN_DEVELOPMENT_LABEL = "Đang phát triển"

export function inDevelopmentLabels(flags: readonly BillFeatureFlag[]): string[] {
  return flags.filter((flag) => flag.status === "IN_DEVELOPMENT").map((flag) => flag.label)
}

/**
 * "1 giờ 20" — khách đã ngồi bao lâu.
 *
 * Nhận `now` làm tham số thay vì gọi `Date.now()` bên trong: một hàm đọc đồng
 * hồ hệ thống là một hàm không test được, và màn hình này đã có `useNow`.
 */
export function seatedDurationLabel(startedAtIso: string, now: Date): string {
  const started = new Date(startedAtIso).getTime()
  if (!Number.isFinite(started)) return "—"
  const minutes = Math.max(0, Math.floor((now.getTime() - started) / 60_000))
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest}`
}

/** "A1 + A2 · G01" — mã bàn của Phiên, kèm ký hiệu cụm khi có. */
export function seatingLabel(tableCodes: readonly string[], groupSymbol: string | null): string {
  const codes = tableCodes.length === 0 ? "—" : tableCodes.join(" + ")
  return groupSymbol === null ? codes : `${codes} · ${groupSymbol}`
}

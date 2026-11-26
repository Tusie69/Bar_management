/**
 * TU-46 — luật của màn Tiền mặt (Màn 5 của mockup NA-44), viết thành hàm thuần.
 *
 * Không có phép tính tiền nào ở đây ngoài một phép trừ: tổng phải trả do máy
 * chủ gửi xuống, và "còn thiếu" / "tiền thừa" là hiệu của nó với số nhân viên
 * vừa gõ. Con số thừa cuối cùng vẫn do database tính (`change_amount_vnd` là
 * cột sinh) — hàm này chỉ để màn hình nói trước khi bấm.
 *
 * Xem `cash-model.test.ts`.
 */

/** Trạng thái của khối kết quả, đúng ba nhánh mockup mô tả. */
export type CashState = "EMPTY" | "SHORT" | "ENOUGH"

export interface CashResult {
  state: CashState
  /** Số khách đưa đã đọc được, hoặc `null` khi ô còn trống. */
  tenderedVnd: number | null
  /** > 0 khi còn thiếu. */
  shortfallVnd: number
  /** >= 0 khi đã đủ. */
  changeVnd: number
  /** Nút "Xác nhận đã nhận" bật hay không. */
  canConfirm: boolean
  /** Lý do nút bị khoá, hiện ngay cạnh nút. `null` khi nút bật. */
  disabledReason: string | null
}

/**
 * Đọc ô "Khách đưa".
 *
 * Chỉ nhận chữ số: mockup ghi rõ ô này tự thêm dấu chấm nghìn và tối đa 9 chữ
 * số, nên dấu chấm người dùng thấy là định dạng chứ không phải dữ liệu. Bỏ mọi
 * ký tự không phải số thay vì từ chối cả chuỗi — nhân viên dán "250.000" vào ô
 * thì ý họ là 250000, không phải một lỗi nhập liệu.
 */
export const MAX_CASH_DIGITS = 9

export function parseCashInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, "").slice(0, MAX_CASH_DIGITS)
  if (digits.length === 0) return null
  const value = Number(digits)
  return Number.isSafeInteger(value) ? value : null
}

/** "250.000" — dấu chấm nghìn kiểu Việt, dùng cho chính ô nhập. */
export function formatCashInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, MAX_CASH_DIGITS)
  if (digits.length === 0) return ""
  return Number(digits).toLocaleString("vi-VN")
}

export function evaluateCash(totalVnd: number, raw: string): CashResult {
  const tenderedVnd = parseCashInput(raw)
  if (tenderedVnd === null) {
    return {
      state: "EMPTY",
      tenderedVnd: null,
      shortfallVnd: totalVnd,
      changeVnd: 0,
      canConfirm: false,
      disabledReason: "Nhập số tiền khách đưa",
    }
  }
  if (tenderedVnd < totalVnd) {
    const shortfallVnd = totalVnd - tenderedVnd
    return {
      state: "SHORT",
      tenderedVnd,
      shortfallVnd,
      changeVnd: 0,
      canConfirm: false,
      disabledReason: "Chưa đủ tiền",
    }
  }
  return {
    state: "ENOUGH",
    tenderedVnd,
    shortfallVnd: 0,
    changeVnd: tenderedVnd - totalVnd,
    canConfirm: true,
    disabledReason: null,
  }
}

/** Các mệnh giá tròn mockup liệt kê: 50k, 100k, 200k, 500k, 1tr. */
const ROUND_STEPS = [50_000, 100_000, 200_000, 500_000, 1_000_000] as const

/**
 * Dãy nút mệnh giá nhanh: "vừa đủ" trước, rồi các mức tròn LỚN HƠN tổng.
 *
 * Mỗi bước sinh bội số nhỏ nhất của nó mà vẫn ≥ tổng, nên với bill 231.000đ thì
 * 50k cho 250.000, 100k cho 300.000, 200k cho 400.000, 500k và 1tr cho chính
 * nó. Trùng nhau thì bỏ — hai nút cùng số là hai nút nhân viên phải đọc để
 * nhận ra chúng giống nhau.
 *
 * Không có mệnh giá nào NHỎ hơn tổng: một nút bấm vào là nút bị khoá ngay sau
 * đó thì nó không phải lối tắt, nó là một cái bẫy.
 */
export function quickTenderOptions(totalVnd: number): number[] {
  if (!Number.isSafeInteger(totalVnd) || totalVnd <= 0) return []
  const options = [totalVnd]
  for (const step of ROUND_STEPS) {
    const rounded = Math.ceil(totalVnd / step) * step
    if (rounded > totalVnd) options.push(rounded)
  }
  return [...new Set(options)].sort((a, b) => a - b)
}

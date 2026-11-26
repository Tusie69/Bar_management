/**
 * TU-46 — dựng chuỗi VietQR (EMVCo) cho một bill.
 *
 * Phạm vi tuần này là MỘT việc: sinh đúng chuỗi, đúng số tiền, đúng nội dung
 * chuyển khoản, rồi lưu nó lại. KHÔNG có cổng thanh toán, KHÔNG webhook, KHÔNG
 * tự xác nhận tiền về — nhà cung cấp còn chờ CH-02 và anh Luân chưa duyệt chi
 * phí. Giao dịch mang `confirmation_mode = 'MANUAL'` và tên người đã tick "đã
 * thấy tiền về"; chỗ cho `GATEWAY` đã có sẵn trong CHECK của database.
 *
 * Toàn bộ file là hàm thuần, không gọi mạng, không đọc cấu hình. Thông tin tài
 * khoản nhận tiền được TRUYỀN VÀO, không đọc ở đây: nó nằm trong `venue_settings`
 * và đổi được giữa ca.
 *
 * Định dạng EMVCo: mỗi trường là `ID(2 ký tự) + LEN(2 chữ số) + VALUE`, lồng
 * nhau được. Sai một chữ số LEN thì app ngân hàng báo "QR không hợp lệ" mà
 * không nói vì sao, nên `field()` là nơi duy nhất dựng cặp ID/LEN.
 *
 * Xem `api/test/vietqr.test.ts`.
 */
import { AppError } from '../../errors/app-error.js'

/** Mã định danh của NAPAS trong trường Merchant Account Information. */
const NAPAS_AID = 'A000000727'
/** Chuyển nhanh tới tài khoản (Instant Funds Transfer To Account). */
const SERVICE_CODE = 'QRIBFTTA'
/** ISO 4217 cho đồng Việt Nam. */
const CURRENCY_VND = '704'
const COUNTRY_VN = 'VN'
/** `12` = QR động, dùng một lần. Chuỗi này mang số tiền cụ thể nên nó không tĩnh. */
const POINT_OF_INITIATION_DYNAMIC = '12'

/** Nhiều ngân hàng cắt nội dung chuyển khoản ở đây. */
export const MAX_TRANSFER_NOTE_LENGTH = 25
/** Trường `59` của EMVCo. */
export const MAX_BENEFICIARY_NAME_LENGTH = 25

export interface VietQrBeneficiary {
  /** Mã BIN ngân hàng, 6 chữ số. Ví dụ `970415` (VietinBank). */
  bankBin: string
  accountNumber: string
  /** Tên chủ tài khoản, ASCII hoa không dấu. */
  accountName: string
}

export interface VietQrInput {
  beneficiary: VietQrBeneficiary
  /** Số nguyên đồng, chia hết 1000 (bằng `bills.total_vnd`). */
  amountVnd: number
  /** `21GAM B261126-0412`. Không bao giờ mang gì về khách. */
  transferNote: string
}

/**
 * Chuẩn hoá tên chủ tài khoản: bỏ dấu tiếng Việt, hoa hết, chỉ giữ chữ-số-khoảng
 * trắng, cắt 25 ký tự.
 *
 * `normalize('NFD')` tách dấu thành ký tự tổ hợp rồi xoá chúng; `đ` và `Đ` không
 * phải chữ có dấu tổ hợp nên phải thay riêng — thiếu dòng đó thì "ĐỨC" thành
 * "C" và tên người nhận tiền biến mất.
 */
export function normalizeBeneficiaryName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (match) => (match === 'đ' ? 'd' : 'D'))
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BENEFICIARY_NAME_LENGTH)
}

/**
 * CRC-16/CCITT-FALSE: đa thức 0x1021, khởi tạo 0xFFFF, không đảo bit, không XOR
 * đầu ra. Trả về 4 ký tự hex HOA.
 *
 * Tính trên TOÀN BỘ chuỗi KỂ CẢ `6304` — bốn ký tự ID và LEN của chính trường
 * CRC. Đây là chỗ hay sai nhất của EMVCo, và sai nó thì mọi app ngân hàng từ
 * chối mã mà không ai biết tại sao.
 */
export function crc16CcittFalse(value: string): string {
  let crc = 0xffff
  for (let index = 0; index < value.length; index += 1) {
    crc ^= value.charCodeAt(index) << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** `ID + LEN + VALUE`. Nơi duy nhất dựng cặp ID/LEN, nên độ dài không thể lệch. */
function field(id: string, value: string): string {
  if (value.length > 99) {
    throw new AppError(500, 'VIETQR_FIELD_TOO_LONG', 'Không dựng được mã QR.', { id, length: value.length })
  }
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

function assert(condition: boolean, reason: string): void {
  if (!condition) {
    throw new AppError(500, 'VIETQR_INVALID_INPUT', 'Không dựng được mã QR cho bill này.', { reason })
  }
}

/**
 * Chuỗi VietQR đầy đủ, sẵn sàng render thành ảnh ở trình duyệt.
 *
 * Máy chủ KHÔNG sinh ảnh: ảnh là một cách vẽ của chuỗi này, và lưu ảnh nghĩa là
 * lưu hai nguồn sự thật cho cùng một mã. Đối soát đọc chuỗi, không đọc ảnh.
 */
export function buildVietQrPayload(input: VietQrInput): string {
  const { bankBin, accountNumber, accountName } = input.beneficiary
  assert(/^\d{6}$/.test(bankBin), 'bankBin phải là 6 chữ số')
  assert(/^\d{4,19}$/.test(accountNumber), 'accountNumber phải là 4–19 chữ số')
  assert(accountName.length > 0 && accountName.length <= MAX_BENEFICIARY_NAME_LENGTH, 'accountName không hợp lệ')
  assert(/^[A-Z0-9 ]+$/.test(accountName), 'accountName phải là ASCII hoa không dấu')
  assert(Number.isSafeInteger(input.amountVnd) && input.amountVnd > 0, 'amountVnd phải là số nguyên dương')
  // Tổng của một bill luôn chẵn nghìn (`ck_bills_total_thousand`). Kiểm lại ở
  // đây để một con số đã đi lạc không bao giờ thành một mã QR khách quét được.
  assert(input.amountVnd % 1000 === 0, 'amountVnd phải chia hết 1000')
  assert(
    input.transferNote.length > 0 && input.transferNote.length <= MAX_TRANSFER_NOTE_LENGTH,
    'transferNote không hợp lệ',
  )
  assert(/^[A-Z0-9 -]+$/.test(input.transferNote), 'transferNote phải là ASCII hoa, số, khoảng trắng và gạch')

  const merchantAccount = field('00', NAPAS_AID)
    + field('01', field('00', bankBin) + field('01', accountNumber))
    + field('02', SERVICE_CODE)

  const body = field('00', '01')
    + field('01', POINT_OF_INITIATION_DYNAMIC)
    + field('38', merchantAccount)
    + field('52', '0000')
    + field('53', CURRENCY_VND)
    + field('54', String(input.amountVnd))
    + field('58', COUNTRY_VN)
    + field('59', accountName)
    + field('62', field('08', input.transferNote))

  // `6304` phải nằm trong chuỗi được tính CRC.
  return `${body}6304${crc16CcittFalse(`${body}6304`)}`
}

/** Che số tài khoản khi trả về trình duyệt: khách quét QR, không đọc số. */
export function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber
  return `${accountNumber.slice(0, 4)}${'•'.repeat(Math.max(0, accountNumber.length - 8))}${accountNumber.slice(-4)}`
}

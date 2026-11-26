/**
 * TU-45 — mã bill, và lý do nó dài hơn mockup.
 *
 * Mockup NA-44 hiện `B0412`: bốn chữ số, không có ngày. Bốn chữ số đủ để nhân
 * viên đọc qua điện thoại, nhưng chúng LẶP LẠI mỗi ngày — và mã bill không chỉ
 * sống trên màn hình: nó đi vào nội dung chuyển khoản, rồi vào sao kê ngân
 * hàng. Một sao kê tháng có ba mươi dòng `B0412` là một cuộc đối soát không ai
 * làm xong được.
 *
 * Nên mã lưu trong database là `B261126-0412`, còn `billShortCode` trả về
 * `B0412` cho những chỗ chật chỗ trên màn hình. Một mã để đối soát, một mã để
 * đọc to, cùng một con số.
 *
 * "Ngày" ở đây là NGÀY KINH DOANH (`visits.business_date`), không phải ngày
 * dương lịch. Quán mở 17:00–05:00, nên một bill chốt lúc 02h sáng thuộc ngày
 * hôm trước — đúng như mọi bảng khác của dự án đã làm. Đánh số theo ngày dương
 * lịch sẽ cắt một ca làm việc thành hai dãy số lúc nửa đêm.
 *
 * Hàm thuần — xem `api/test/bill-code.test.ts`.
 */
import { AppError } from '../../errors/app-error.js'

/** Số thứ tự tối đa trong một ngày kinh doanh. 9999 bill một tối là một con số đã sai. */
export const MAX_BILL_DAILY_SEQ = 9999

const businessDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `business_date` về từ MySQL dưới dạng `Date` hoặc chuỗi `YYYY-MM-DD` tuỳ
 * driver và tuỳ câu lệnh. Chuẩn hoá về chuỗi ở một chỗ, chứ không `new Date()`
 * rồi `toISOString()` ở mỗi nơi gọi: `toISOString` quy về UTC, và một ngày kinh
 * doanh đi qua UTC có thể lùi một ngày.
 */
export function businessDateString(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * `B` + `yyMMdd` của ngày kinh doanh + `-` + số thứ tự 4 chữ số.
 *
 * Ví dụ: ngày kinh doanh 2026-11-26, bill thứ 412 → `B261126-0412`.
 */
export function buildBillCode(businessDate: Date | string, dailySeq: number): string {
  const date = businessDateString(businessDate)
  const parts = businessDatePattern.exec(date)
  if (!parts) {
    throw new AppError(500, 'BILL_CODE_UNBUILDABLE', 'Không dựng được mã bill.', { businessDate: date })
  }
  if (!Number.isSafeInteger(dailySeq) || dailySeq < 1 || dailySeq > MAX_BILL_DAILY_SEQ) {
    throw new AppError(500, 'BILL_CODE_UNBUILDABLE', 'Không dựng được mã bill.', { dailySeq })
  }
  return `B${date.slice(2, 4)}${parts[2]}${parts[3]}-${String(dailySeq).padStart(4, '0')}`
}

/** `B0412` — bản ngắn cho chỗ chật trên màn hình. KHÔNG dùng để đối soát. */
export function billShortCode(dailySeq: number): string {
  return `B${String(dailySeq).padStart(4, '0')}`
}

/**
 * Nội dung chuyển khoản: tên viết tắt của quán + mã bill đầy đủ.
 *
 * Nhiều ngân hàng cắt nội dung ở 25 ký tự và bỏ mọi thứ không phải chữ-số, nên
 * chuỗi này chỉ chứa `A-Z`, `0-9`, khoảng trắng và dấu gạch. Và nó KHÔNG chứa
 * gì về khách: nội dung chuyển khoản hiện trên app ngân hàng của khách và trong
 * sao kê của quán — một cái tên lọt vào đây là rò rỉ ra ngoài hệ thống.
 */
export const MAX_TRANSFER_NOTE_LENGTH = 25

export function buildTransferNote(venueShortName: string, billCode: string): string {
  const venue = venueShortName.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const note = `${venue} ${billCode}`.replace(/[^A-Z0-9 -]/g, '').trim()
  return note.slice(0, MAX_TRANSFER_NOTE_LENGTH)
}

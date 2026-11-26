/**
 * TU-45 — mã bill và nội dung chuyển khoản.
 *
 * Hai điều file này canh, và cả hai đều là chuyện đối soát chứ không phải
 * chuyện hiển thị:
 *
 * 1. Mã lưu trong database mang ngày KINH DOANH, nên nó duy nhất trong sao kê
 *    ngân hàng của cả tháng. Mã ngắn `B0412` chỉ để đọc to.
 * 2. Nội dung chuyển khoản không bao giờ mang gì về khách. Nó hiện trên app
 *    ngân hàng của khách và trong sao kê của quán, nên một cái tên lọt vào đây
 *    là rò rỉ ra ngoài hệ thống.
 */
import { describe, expect, it } from 'vitest'

import { AppError } from '../src/errors/app-error.js'
import {
  MAX_BILL_DAILY_SEQ,
  MAX_TRANSFER_NOTE_LENGTH,
  billShortCode,
  buildBillCode,
  buildTransferNote,
  businessDateString,
} from '../src/modules/bills/bill-code.js'

describe('businessDateString', () => {
  it('cắt chuỗi DATETIME về đúng ngày', () => {
    expect(businessDateString('2026-11-26')).toBe('2026-11-26')
    expect(businessDateString('2026-11-26 02:14:00.000')).toBe('2026-11-26')
  })

  it('đọc Date theo giờ địa phương, không quy về UTC', () => {
    // 02:14 giờ địa phương vẫn là ngày 26, dù UTC đã lùi về ngày 25.
    expect(businessDateString(new Date(2026, 10, 26, 2, 14))).toBe('2026-11-26')
    expect(businessDateString(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('buildBillCode', () => {
  it('B + yyMMdd + 4 chữ số', () => {
    expect(buildBillCode('2026-11-26', 412)).toBe('B261126-0412')
    expect(buildBillCode('2026-11-26', 1)).toBe('B261126-0001')
    expect(buildBillCode('2027-01-02', 9999)).toBe('B270102-9999')
  })

  it('bill chốt lúc 02h thuộc ngày kinh doanh hôm trước', () => {
    // Ca 17:00–05:00: Phiên mở tối 26 mà chốt 02h sáng 27 vẫn mang business_date 26.
    expect(buildBillCode(new Date(2026, 10, 26, 2, 14), 7)).toBe('B261126-0007')
  })

  it('từ chối số thứ tự ngoài khoảng, thay vì sinh một mã nhìn-như-đúng', () => {
    expect(() => buildBillCode('2026-11-26', 0)).toThrow(AppError)
    expect(() => buildBillCode('2026-11-26', -1)).toThrow(AppError)
    expect(() => buildBillCode('2026-11-26', MAX_BILL_DAILY_SEQ + 1)).toThrow(AppError)
    expect(() => buildBillCode('2026-11-26', 1.5)).toThrow(AppError)
  })

  it('từ chối ngày kinh doanh không đọc được', () => {
    expect(() => buildBillCode('26/11/2026', 1)).toThrow(AppError)
    expect(() => buildBillCode('', 1)).toThrow(AppError)
  })
})

describe('billShortCode', () => {
  it('bản ngắn cho chỗ chật trên màn hình, đúng như mockup', () => {
    expect(billShortCode(412)).toBe('B0412')
    expect(billShortCode(1)).toBe('B0001')
  })
})

describe('buildTransferNote', () => {
  it('tên quán + mã bill đầy đủ', () => {
    expect(buildTransferNote('21GAM', 'B261126-0412')).toBe('21GAM B261126-0412')
  })

  it('chuẩn hoá tên quán về chữ hoa không dấu, bỏ ký tự ngân hàng sẽ cắt', () => {
    expect(buildTransferNote('21gam', 'B261126-0412')).toBe('21GAM B261126-0412')
    expect(buildTransferNote('21 Gam!', 'B261126-0412')).toBe('21GAM B261126-0412')
  })

  it('không vượt 25 ký tự — nhiều ngân hàng cắt ở đó', () => {
    const note = buildTransferNote('TENQUANRATDAIVALANHOA', 'B261126-0412')
    expect(note.length).toBeLessThanOrEqual(MAX_TRANSFER_NOTE_LENGTH)
  })

  it('chỉ chứa chữ hoa, số, khoảng trắng và dấu gạch', () => {
    const note = buildTransferNote('21GAM', 'B261126-0412')
    expect(note).toMatch(/^[A-Z0-9 -]+$/)
  })
})

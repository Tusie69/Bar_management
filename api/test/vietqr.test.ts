/**
 * TU-46 — chuỗi VietQR, kiểm bằng assert không cần mạng.
 *
 * Ba thứ file này canh, và cả ba đều là lý do một app ngân hàng từ chối mã mà
 * không nói vì sao:
 *
 * 1. CRC-16/CCITT-FALSE tính trên toàn chuỗi KỂ CẢ `6304`.
 * 2. Mọi `LEN` khớp đúng độ dài giá trị của nó.
 * 3. Số tiền là chuỗi số nguyên đồng, không dấu phân cách, không thập phân.
 *
 * Và một thứ không phải chuyện ngân hàng: nội dung chuyển khoản hiện trên app
 * của khách và trong sao kê của quán, nên nó không bao giờ mang gì về khách.
 */
import { describe, expect, it } from 'vitest'

import { AppError } from '../src/errors/app-error.js'
import { buildTransferNote } from '../src/modules/bills/bill-code.js'
import {
  MAX_BENEFICIARY_NAME_LENGTH,
  MAX_TRANSFER_NOTE_LENGTH,
  buildVietQrPayload,
  crc16CcittFalse,
  maskAccountNumber,
  normalizeBeneficiaryName,
  type VietQrInput,
} from '../src/modules/bills/vietqr.js'

const input: VietQrInput = {
  beneficiary: { bankBin: '970415', accountNumber: '103900007412', accountName: 'CONG TY 21GAM' },
  amountVnd: 231_000,
  transferNote: '21GAM B261126-0412',
}

/** Tách chuỗi EMVCo thành các cặp ID → VALUE, và nổ nếu một LEN nói dối. */
function parseTlv(payload: string): Map<string, string> {
  const fields = new Map<string, string>()
  let cursor = 0
  while (cursor < payload.length) {
    const id = payload.slice(cursor, cursor + 2)
    const length = Number(payload.slice(cursor + 2, cursor + 4))
    expect(Number.isInteger(length), `LEN của trường ${id} phải là số`).toBe(true)
    const value = payload.slice(cursor + 4, cursor + 4 + length)
    expect(value.length, `LEN của trường ${id} phải khớp độ dài thật`).toBe(length)
    fields.set(id, value)
    cursor += 4 + length
  }
  expect(cursor, 'chuỗi phải kết thúc đúng ranh giới một trường').toBe(payload.length)
  return fields
}

describe('crc16CcittFalse', () => {
  it('khớp vector chuẩn của CCITT-FALSE', () => {
    // Vector kinh điển: "123456789" → 0x29B1.
    expect(crc16CcittFalse('123456789')).toBe('29B1')
  })

  it('luôn trả về bốn ký tự hex hoa', () => {
    for (const sample of ['', 'A', '00020101021238', '21GAM B261126-0412']) {
      expect(crc16CcittFalse(sample)).toMatch(/^[0-9A-F]{4}$/)
    }
  })

  it('đổi một ký tự thì đổi CRC', () => {
    expect(crc16CcittFalse('00020101021138')).not.toBe(crc16CcittFalse('00020101021238'))
  })
})

describe('buildVietQrPayload', () => {
  const payload = buildVietQrPayload(input)

  it('mọi LEN khớp độ dài thật, chuỗi kết thúc đúng ranh giới', () => {
    const fields = parseTlv(payload)
    expect(fields.get('00')).toBe('01')
    expect(fields.get('52')).toBe('0000')
    expect(fields.get('58')).toBe('VN')
  })

  it('là QR ĐỘNG: nó mang một số tiền cụ thể nên không thể dùng lại', () => {
    expect(parseTlv(payload).get('01')).toBe('12')
  })

  it('tiền tệ là 704 (VND) và số tiền là chuỗi số nguyên đồng', () => {
    const fields = parseTlv(payload)
    expect(fields.get('53')).toBe('704')
    expect(fields.get('54')).toBe('231000')
    // Không dấu chấm nghìn, không phần thập phân, không dấu cách.
    expect(fields.get('54')).toMatch(/^\d+$/)
  })

  it('mang đúng ngân hàng, số tài khoản và dịch vụ chuyển nhanh', () => {
    const merchant = parseTlv(parseTlv(payload).get('38') as string)
    expect(merchant.get('00')).toBe('A000000727')
    expect(merchant.get('02')).toBe('QRIBFTTA')
    const account = parseTlv(merchant.get('01') as string)
    expect(account.get('00')).toBe('970415')
    expect(account.get('01')).toBe('103900007412')
  })

  it('nội dung chuyển khoản mang mã bill, nằm ở trường 62.08', () => {
    const additional = parseTlv(parseTlv(payload).get('62') as string)
    expect(additional.get('08')).toBe('21GAM B261126-0412')
  })

  it('CRC nằm ở cuối và tính trên toàn chuỗi kể cả 6304', () => {
    expect(payload.slice(-8, -4)).toBe('6304')
    const body = payload.slice(0, -4)
    expect(payload.slice(-4)).toBe(crc16CcittFalse(body))
    expect(payload.slice(-4)).toMatch(/^[0-9A-F]{4}$/)
  })

  it('đổi số tiền thì đổi cả CRC — một mã cũ không trả đúng số mới', () => {
    const other = buildVietQrPayload({ ...input, amountVnd: 232_000 })
    expect(other.slice(-4)).not.toBe(payload.slice(-4))
    expect(other).not.toBe(payload)
  })

  it('từ chối số tiền không chia hết 1000 — tổng bill luôn chẵn nghìn', () => {
    expect(() => buildVietQrPayload({ ...input, amountVnd: 230_560 })).toThrow(AppError)
  })

  it('từ chối số tiền không hợp lệ thay vì sinh một mã nhìn-như-đúng', () => {
    for (const amountVnd of [0, -1000, 1000.5, Number.NaN]) {
      expect(() => buildVietQrPayload({ ...input, amountVnd })).toThrow(AppError)
    }
  })

  it('từ chối thông tin tài khoản không hợp lệ', () => {
    const bad = [
      { bankBin: '97041', accountNumber: '103900007412', accountName: 'CONG TY 21GAM' },
      { bankBin: '97041X', accountNumber: '103900007412', accountName: 'CONG TY 21GAM' },
      { bankBin: '970415', accountNumber: '12', accountName: 'CONG TY 21GAM' },
      { bankBin: '970415', accountNumber: '103900007412', accountName: '' },
      { bankBin: '970415', accountNumber: '103900007412', accountName: 'Công ty 21Gam' },
    ]
    for (const beneficiary of bad) {
      expect(() => buildVietQrPayload({ ...input, beneficiary })).toThrow(AppError)
    }
  })

  it('từ chối nội dung chuyển khoản quá dài hoặc có ký tự ngân hàng sẽ cắt', () => {
    expect(() => buildVietQrPayload({ ...input, transferNote: 'A'.repeat(26) })).toThrow(AppError)
    expect(() => buildVietQrPayload({ ...input, transferNote: 'Khách Nguyễn' })).toThrow(AppError)
    expect(() => buildVietQrPayload({ ...input, transferNote: '' })).toThrow(AppError)
  })

  it('nội dung dựng từ buildTransferNote luôn được chấp nhận', () => {
    const note = buildTransferNote('21GAM', 'B261126-9999')
    expect(note.length).toBeLessThanOrEqual(MAX_TRANSFER_NOTE_LENGTH)
    expect(() => buildVietQrPayload({ ...input, transferNote: note })).not.toThrow()
  })

  /**
   * Không quét số điện thoại bằng regex trên cả chuỗi: một số tài khoản hợp lệ
   * cũng chứa mười chữ số liền bắt đầu bằng 0, và một test báo động giả sẽ bị
   * tắt đi chứ không được sửa.
   *
   * Thứ cần canh là KHÔNG CÓ Ô TỰ DO nào trong chuỗi: đúng hai trường mang chữ
   * (`59` tên thụ hưởng, `62.08` nội dung chuyển khoản), cả hai đều do người
   * gọi truyền vào và cả hai đều được kiểm dạng. Không có chỗ thứ ba để dữ liệu
   * khách lọt vào.
   */
  it('chỉ có hai trường mang chữ, và cả hai đều không nói gì về khách', () => {
    const fields = parseTlv(payload)
    expect(fields.get('59')).toBe('CONG TY 21GAM')
    expect(parseTlv(fields.get('62') as string).get('08')).toBe('21GAM B261126-0412')
    expect(payload).toContain('B261126-0412')
    // Mọi trường còn lại là hằng số hoặc số.
    for (const [id, value] of fields) {
      if (id === '59' || id === '62' || id === '38') continue
      expect(value, `trường ${id} phải là hằng hoặc số`).toMatch(/^[0-9A-Z]+$/)
    }
  })
})

describe('normalizeBeneficiaryName', () => {
  it('bỏ dấu tiếng Việt và viết hoa', () => {
    expect(normalizeBeneficiaryName('Nguyễn Văn Đức')).toBe('NGUYEN VAN DUC')
    expect(normalizeBeneficiaryName('Công ty 21Gam')).toBe('CONG TY 21GAM')
  })

  it('xử lý đ/Đ, thứ mà bỏ dấu tổ hợp không chạm tới', () => {
    expect(normalizeBeneficiaryName('đức Đạt')).toBe('DUC DAT')
  })

  it('gộp khoảng trắng và bỏ ký tự lạ', () => {
    expect(normalizeBeneficiaryName('  CTY   21GAM (HN) ')).toBe('CTY 21GAM HN')
  })

  it('cắt ở 25 ký tự — giới hạn của trường 59', () => {
    const long = normalizeBeneficiaryName('CONG TY TRACH NHIEM HUU HAN MOT THANH VIEN 21GAM')
    expect(long.length).toBeLessThanOrEqual(MAX_BENEFICIARY_NAME_LENGTH)
  })

  it('kết quả luôn dùng được cho buildVietQrPayload', () => {
    const accountName = normalizeBeneficiaryName('Nguyễn Văn Đức')
    expect(() => buildVietQrPayload({ ...input, beneficiary: { ...input.beneficiary, accountName } })).not.toThrow()
  })
})

describe('maskAccountNumber', () => {
  it('giữ bốn số đầu và bốn số cuối', () => {
    expect(maskAccountNumber('103900007412')).toBe('1039••••7412')
  })

  it('số quá ngắn thì không che nửa vời', () => {
    expect(maskAccountNumber('1234')).toBe('1234')
  })
})

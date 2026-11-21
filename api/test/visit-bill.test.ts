import { describe, expect, it } from 'vitest'

import { buildVisitBill, formatVatRate, vatAmountVnd, type VisitBillLine } from '../src/modules/orders/visit-bill.js'

function line(overrides: Partial<VisitBillLine> = {}): VisitBillLine {
  return {
    itemName: 'VỎ ỐC THÌ THẦM',
    variantDisplayName: 'Ly',
    note: null,
    quantity: 2,
    unitPriceVnd: 280_000,
    amountVnd: 560_000,
    ...overrides,
  }
}

describe('vatAmountVnd', () => {
  it('10% của 7.850.000 là 785.000', () => {
    expect(vatAmountVnd(7_850_000, 1000)).toBe(785_000)
  })

  /** Đồng Việt Nam không có đơn vị nhỏ hơn: kết quả luôn là số nguyên. */
  it('làm tròn nửa lên tới đồng', () => {
    expect(vatAmountVnd(105, 1000)).toBe(11) // 10,5 → 11
    expect(vatAmountVnd(104, 1000)).toBe(10) // 10,4 → 10
    expect(Number.isInteger(vatAmountVnd(333_333, 1000))).toBe(true)
  })

  it('thuế suất khác 10% vẫn đúng', () => {
    expect(vatAmountVnd(1_000_000, 800)).toBe(80_000)
    expect(vatAmountVnd(1_000_000, 1050)).toBe(105_000)
  })

  it('thuế suất 0 hoặc tổng 0 thì không có thuế', () => {
    expect(vatAmountVnd(1_000_000, 0)).toBe(0)
    expect(vatAmountVnd(0, 1000)).toBe(0)
  })

  it('đầu vào rác không sinh ra NaN trên một tờ bill', () => {
    expect(vatAmountVnd(Number.NaN, 1000)).toBe(0)
    expect(vatAmountVnd(-5, 1000)).toBe(0)
    expect(vatAmountVnd(1000, Number.NaN)).toBe(0)
  })
})

describe('buildVisitBill', () => {
  const printedAt = new Date('2026-11-22T16:45:00.000Z')

  /** Tờ giấy khách cầm phải cộng đúng bằng tay được. */
  it('tổng phụ cộng từ chính các dòng trên bill', () => {
    const bill = buildVisitBill({
      visitId: 1,
      tableCodes: ['A7', 'A6'],
      orderCount: 3,
      lines: [line(), line({ itemName: 'KHOAI TÂY CHIÊN', quantity: 1, unitPriceVnd: 120_000, amountVnd: 120_000 })],
      vatRateBasisPoints: 1000,
      printedAt,
    })
    expect(bill.subtotalVnd).toBe(680_000)
    expect(bill.vatVnd).toBe(68_000)
    expect(bill.totalVnd).toBe(748_000)
    expect(bill.subtotalVnd + bill.vatVnd).toBe(bill.totalVnd)
  })

  it('bàn chưa gọi gì vẫn ra một tờ bill hợp lệ, không phải lỗi', () => {
    const bill = buildVisitBill({
      visitId: 2,
      tableCodes: ['A1'],
      orderCount: 0,
      lines: [],
      vatRateBasisPoints: 1000,
      printedAt,
    })
    expect(bill.subtotalVnd).toBe(0)
    expect(bill.totalVnd).toBe(0)
    expect(bill.lines).toEqual([])
  })

  it('mang theo giờ in để tờ bill nói được nó cũ bao lâu', () => {
    const bill = buildVisitBill({
      visitId: 1,
      tableCodes: ['A1'],
      orderCount: 1,
      lines: [line()],
      vatRateBasisPoints: 1000,
      printedAt,
    })
    expect(bill.printedAt).toBe('2026-11-22T16:45:00.000Z')
    expect(bill.vatRateBasisPoints).toBe(1000)
  })
})

describe('formatVatRate', () => {
  it('đọc được cho khách', () => {
    expect(formatVatRate(1000)).toBe('10%')
    expect(formatVatRate(800)).toBe('8%')
    expect(formatVatRate(1050)).toBe('10,5%')
  })
})

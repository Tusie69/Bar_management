/**
 * TU-45 — luật tiền của bill đã chốt, kiểm bằng assert không cần MySQL.
 *
 * Tám bộ số ở `moneyCases` là tám câu đã chốt với BA, không phải tám ví dụ
 * minh hoạ. Hai bộ quan trọng nhất:
 *
 * - `T2` là ví dụ của anh Luân (TN-06, 18/11): 230.560đ → 231.000đ.
 * - `T6` là bộ canh quyết định Q2. Hai dòng 44.995đ và 45.005đ cho ra 99.000đ
 *   khi VAT tính trên tổng, và 100.000đ khi VAT tính từng dòng rồi cộng. Lệch
 *   đúng 1.000đ, vì phần lệch 1đ của VAT đủ để nhảy qua một mốc nghìn. Bộ này
 *   tồn tại để một lần "tối ưu" sang cách tính từng dòng sẽ làm đỏ test chứ
 *   không làm lệch tiền của khách.
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_BILL_TOTAL_VND,
  PRICING_POLICY_SNAPSHOT_KEYS,
  ROUNDING_UNIT_VND,
  buildBillTotals,
  buildChargeLedger,
  buildPricingPolicySnapshot,
  formatVatRate,
  roundUpToThousand,
  vatAmountVnd,
  type BillLineInput,
} from '../src/modules/bills/bill-total.js'

function line(quantity: number, unitPriceVnd: number): BillLineInput {
  return { quantity, unitPriceVnd, amountVnd: quantity * unitPriceVnd }
}

interface MoneyCase {
  name: string
  lines: BillLineInput[]
  vatRateBasisPoints: number
  subtotalVnd: number
  vatVnd: number
  preRoundTotalVnd: number
  roundingAdjustmentVnd: number
  totalVnd: number
}

const moneyCases: MoneyCase[] = [
  {
    name: 'T1 · bàn chưa gọi món: mọi con số là 0',
    lines: [],
    vatRateBasisPoints: 1000,
    subtotalVnd: 0,
    vatVnd: 0,
    preRoundTotalVnd: 0,
    roundingAdjustmentVnd: 0,
    totalVnd: 0,
  },
  {
    name: 'T2 · ví dụ TN-06 của anh Luân: 230.560đ → 231.000đ',
    lines: [line(2, 100_000), line(1, 9_600)],
    vatRateBasisPoints: 1000,
    subtotalVnd: 209_600,
    vatVnd: 20_960,
    preRoundTotalVnd: 230_560,
    roundingAdjustmentVnd: 440,
    totalVnd: 231_000,
  },
  {
    name: 'T3 · đã chẵn nghìn thì không cộng thêm đồng nào',
    lines: [line(1, 100_000)],
    vatRateBasisPoints: 1000,
    subtotalVnd: 100_000,
    vatVnd: 10_000,
    preRoundTotalVnd: 110_000,
    roundingAdjustmentVnd: 0,
    totalVnd: 110_000,
  },
  {
    name: 'T4 · làm tròn LÊN, không phải tới số gần nhất: 49.500đ → 50.000đ',
    lines: [line(1, 45_000)],
    vatRateBasisPoints: 1000,
    subtotalVnd: 45_000,
    vatVnd: 4_500,
    preRoundTotalVnd: 49_500,
    roundingAdjustmentVnd: 500,
    totalVnd: 50_000,
  },
  {
    name: 'T5 · VAT của 1đ làm tròn nửa-lên ra 0; phần làm tròn chạm trần 999',
    lines: [line(1, 1)],
    vatRateBasisPoints: 1000,
    subtotalVnd: 1,
    vatVnd: 0,
    preRoundTotalVnd: 1,
    roundingAdjustmentVnd: 999,
    totalVnd: 1_000,
  },
  {
    name: 'T6 · Q2: VAT trên tổng ra 99.000đ (từng dòng sẽ ra 100.000đ)',
    lines: [line(5, 8_999), line(5, 9_001)],
    vatRateBasisPoints: 1000,
    subtotalVnd: 90_000,
    vatVnd: 9_000,
    preRoundTotalVnd: 99_000,
    roundingAdjustmentVnd: 0,
    totalVnd: 99_000,
  },
  {
    name: 'T7 · thuế suất đọc từ venue, không hard-code 10%: 8%',
    lines: [line(1, 250_000)],
    vatRateBasisPoints: 800,
    subtotalVnd: 250_000,
    vatVnd: 20_000,
    preRoundTotalVnd: 270_000,
    roundingAdjustmentVnd: 0,
    totalVnd: 270_000,
  },
  {
    name: 'T7b · bộ số của US HU-44 v1.1 (TN-03-K1, TN-06-K5): 2.767.000đ → 3.044.000đ',
    lines: [line(1, 2_767_000)],
    vatRateBasisPoints: 1000,
    subtotalVnd: 2_767_000,
    vatVnd: 276_700,
    preRoundTotalVnd: 3_043_700,
    roundingAdjustmentVnd: 300,
    totalVnd: 3_044_000,
  },
  {
    name: 'T8 · số lớn, không mất chính xác',
    lines: [line(1, 1_000_000)],
    vatRateBasisPoints: 1000,
    subtotalVnd: 1_000_000,
    vatVnd: 100_000,
    preRoundTotalVnd: 1_100_000,
    roundingAdjustmentVnd: 0,
    totalVnd: 1_100_000,
  },
]

describe('buildBillTotals — tám bộ số đã chốt', () => {
  for (const testCase of moneyCases) {
    it(testCase.name, () => {
      const totals = buildBillTotals(testCase.lines, testCase.vatRateBasisPoints)
      expect(totals.subtotalVnd).toBe(testCase.subtotalVnd)
      expect(totals.vatVnd).toBe(testCase.vatVnd)
      expect(totals.preRoundTotalVnd).toBe(testCase.preRoundTotalVnd)
      expect(totals.roundingAdjustmentVnd).toBe(testCase.roundingAdjustmentVnd)
      expect(totals.totalVnd).toBe(testCase.totalVnd)
    })
  }

  it('giữ bốn bất biến trên mọi bộ số', () => {
    for (const testCase of moneyCases) {
      const totals = buildBillTotals(testCase.lines, testCase.vatRateBasisPoints)
      const lineSum = testCase.lines.reduce((sum, item) => sum + item.amountVnd, 0)
      // 1. Tổng tạm tính phải cộng đúng bằng tay từ các dòng trên bill.
      expect(totals.subtotalVnd).toBe(lineSum)
      // 2. Ba con số của bước làm tròn không thể lệch nhau.
      expect(totals.totalVnd).toBe(totals.preRoundTotalVnd + totals.roundingAdjustmentVnd)
      // 3. Số khách trả luôn chẵn nghìn.
      expect(totals.totalVnd % ROUNDING_UNIT_VND).toBe(0)
      // 4. Làm tròn LÊN, tối đa 999đ.
      expect(totals.roundingAdjustmentVnd).toBeGreaterThanOrEqual(0)
      expect(totals.roundingAdjustmentVnd).toBeLessThan(ROUNDING_UNIT_VND)
    }
  })
})

describe('Q2 — VAT trên tổng khác VAT từng dòng, và khác bao nhiêu', () => {
  it('T6: lệch đúng 1.000đ sau khi làm tròn', () => {
    const lines = [line(5, 8_999), line(5, 9_001)]
    const onTotal = buildBillTotals(lines, 1000)

    // Cách KHÔNG dùng: VAT từng dòng rồi cộng.
    const perLineVat = lines.reduce((sum, item) => sum + vatAmountVnd(item.amountVnd, 1000), 0)
    const perLineTotal = roundUpToThousand(onTotal.subtotalVnd + perLineVat)

    expect(onTotal.vatVnd).toBe(9_000)
    expect(perLineVat).toBe(9_001)
    expect(onTotal.totalVnd).toBe(99_000)
    expect(perLineTotal).toBe(100_000)
    expect(perLineTotal - onTotal.totalVnd).toBe(1_000)
  })
})

describe('Q3 — làm tròn chỉ ở tổng cuối, không ở từng dòng', () => {
  it('ba dòng 33.333đ: 110.000đ thay vì 113.000đ', () => {
    const lines = [line(1, 33_333), line(1, 33_333), line(1, 33_333)]
    const onlyFinal = buildBillTotals(lines, 1000)
    expect(onlyFinal.subtotalVnd).toBe(99_999)
    expect(onlyFinal.vatVnd).toBe(10_000)
    expect(onlyFinal.totalVnd).toBe(110_000)

    // Cách KHÔNG dùng: làm tròn từng dòng trước khi cộng.
    const roundedLines = lines.map((item) => ({ ...item, amountVnd: roundUpToThousand(item.amountVnd) }))
    const perLine = buildBillTotals(roundedLines, 1000)
    expect(perLine.subtotalVnd).toBe(102_000)
    expect(perLine.totalVnd).toBe(113_000)
    expect(perLine.totalVnd - onlyFinal.totalVnd).toBe(3_000)
  })
})

describe('roundUpToThousand', () => {
  it('giữ nguyên số đã chẵn nghìn', () => {
    expect(roundUpToThousand(1_000)).toBe(1_000)
    expect(roundUpToThousand(231_000)).toBe(231_000)
  })

  it('đẩy lên mốc nghìn kế tiếp, kể cả khi chỉ thiếu 1đ', () => {
    expect(roundUpToThousand(1)).toBe(1_000)
    expect(roundUpToThousand(999)).toBe(1_000)
    expect(roundUpToThousand(1_001)).toBe(2_000)
    expect(roundUpToThousand(230_560)).toBe(231_000)
  })

  it('trả 0 cho đầu vào không phải số tiền hợp lệ', () => {
    expect(roundUpToThousand(0)).toBe(0)
    expect(roundUpToThousand(-5_000)).toBe(0)
    expect(roundUpToThousand(1.5)).toBe(0)
    expect(roundUpToThousand(Number.NaN)).toBe(0)
    expect(roundUpToThousand(Number.MAX_VALUE)).toBe(0)
  })

  it('không vượt trần của một bill hợp lệ', () => {
    expect(roundUpToThousand(MAX_BILL_TOTAL_VND)).toBe(MAX_BILL_TOTAL_VND)
    expect(MAX_BILL_TOTAL_VND % ROUNDING_UNIT_VND).toBe(0)
  })
})

describe('vatAmountVnd — làm tròn nửa lên tới đồng', () => {
  it('0,5đ làm tròn lên 1đ', () => {
    // 5đ × 10% = 0,5đ → 1đ
    expect(vatAmountVnd(5, 1000)).toBe(1)
    // 4đ × 10% = 0,4đ → 0đ
    expect(vatAmountVnd(4, 1000)).toBe(0)
  })

  it('trả 0 cho thuế suất và tạm tính không hợp lệ', () => {
    expect(vatAmountVnd(100_000, 0)).toBe(0)
    expect(vatAmountVnd(-1, 1000)).toBe(0)
    expect(vatAmountVnd(1.5, 1000)).toBe(0)
  })
})

describe('buildChargeLedger', () => {
  it('ba hàng theo đúng thứ tự, cộng lại bằng tổng phải trả', () => {
    const totals = buildBillTotals([line(2, 100_000), line(1, 9_600)], 1000)
    const ledger = buildChargeLedger(totals, 3)

    expect(ledger.map((row) => row.chargeCode)).toEqual(['ITEM_SUBTOTAL', 'VAT', 'FINAL_ROUNDING'])
    expect(ledger.map((row) => row.sequenceNo)).toEqual([1, 2, 3])
    expect(ledger.reduce((sum, row) => sum + row.signedAmountVnd, 0)).toBe(totals.totalVnd)
  })

  it('chỉ hàng VAT mang thuế suất, và nền của mỗi hàng là con số đã dùng', () => {
    const totals = buildBillTotals([line(1, 209_600)], 1000)
    const ledger = buildChargeLedger(totals, 1)

    expect(ledger[0]?.rateBasisPoints).toBeNull()
    expect(ledger[1]?.rateBasisPoints).toBe(1000)
    expect(ledger[1]?.basisAmountVnd).toBe(totals.subtotalVnd)
    expect(ledger[2]?.rateBasisPoints).toBeNull()
    expect(ledger[2]?.basisAmountVnd).toBe(totals.preRoundTotalVnd)
  })

  it('giữ hàng FINAL_ROUNDING kể cả khi làm tròn 0đ', () => {
    const totals = buildBillTotals([line(1, 100_000)], 1000)
    const ledger = buildChargeLedger(totals, 1)
    expect(ledger).toHaveLength(3)
    expect(ledger[2]?.signedAmountVnd).toBe(0)
  })

  it('dựng câu giải thích tiếng Việt in được lên bill', () => {
    const ledger = buildChargeLedger(buildBillTotals([line(4, 50_000)], 800), 4)
    expect(ledger[0]?.explanation).toBe('Tạm tính 4 món')
    expect(ledger[1]?.explanation).toBe('VAT 8%')
    expect(ledger[2]?.explanation).toBe('Làm tròn lên nghìn')
  })
})

describe('formatVatRate', () => {
  it('dựng nhãn từ điểm cơ bản, dấu phẩy thập phân kiểu Việt', () => {
    expect(formatVatRate(1000)).toBe('10%')
    expect(formatVatRate(800)).toBe('8%')
    expect(formatVatRate(1050)).toBe('10,5%')
  })
})

describe('buildPricingPolicySnapshot', () => {
  it('chép đúng luật đã chốt 26/11', () => {
    expect(buildPricingPolicySnapshot(1000)).toEqual({
      vatRateBasisPoints: 1000,
      vatMode: 'EXCLUSIVE',
      vatBasis: 'TOTAL',
      roundingMode: 'UP',
      roundingScope: 'FINAL_TOTAL',
      roundingUnitVnd: 1000,
    })
  })

  it('không mang trường nào ngoài tập khoá cố định (chặn PII lọt vào JSON)', () => {
    const snapshot = buildPricingPolicySnapshot(800)
    expect(Object.keys(snapshot).sort()).toEqual([...PRICING_POLICY_SNAPSHOT_KEYS].sort())
  })
})

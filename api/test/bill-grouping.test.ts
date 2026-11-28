/**
 * HU-44 v1.1 (V12) — gộp dòng chưa lên bill.
 *
 * Bộ test quan trọng nhất ở đây là "lần xuất thứ hai không lặp lại món của lần
 * thứ nhất". Đó là lỗi thu tiền hai lần của khách, và nó chỉ xuất hiện khi một
 * Phiên có nhiều bill — tức là chỉ từ bản v1.1 trở đi.
 */
import { describe, expect, it } from 'vitest'

import {
  assertGroupingIsConsistent,
  groupBillableLines,
  type BillableOrderLine,
} from '../src/modules/bills/bill-grouping.js'

function line(overrides: Partial<BillableOrderLine> & { orderLineId: number }): BillableOrderLine {
  return {
    variantId: 1,
    itemCode: 'MACALLAN_12',
    itemName: 'MACALLAN 12',
    variantDisplayName: 'Ly',
    unitCode: 'GLASS',
    note: null,
    unitPriceVnd: 100_000,
    remainingQuantity: 1,
    orderRound: 1,
    state: 'SERVED',
    ...overrides,
  }
}

describe('groupBillableLines', () => {
  it('gộp hai dòng đơn cùng biến thể, cùng ghi chú, cùng giá', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 10, remainingQuantity: 2 }),
      line({ orderLineId: 20, remainingQuantity: 3 }),
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.quantity).toBe(5)
    expect(grouped[0]?.amountVnd).toBe(500_000)
    expect(grouped[0]?.sources).toEqual([
      { orderLineId: 10, quantity: 2 },
      { orderLineId: 20, quantity: 3 },
    ])
  })

  it('KHÔNG gộp hai ĐỢT khác nhau — tờ hoá đơn xếp món theo đợt', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 10, orderRound: 1, remainingQuantity: 2 }),
      line({ orderLineId: 20, orderRound: 3, remainingQuantity: 2, state: 'MAKING' }),
    ])
    expect(grouped).toHaveLength(2)
    expect(grouped.map((item) => item.orderRound)).toEqual([1, 3])
    // Mỗi dòng mang trạng thái của chính đợt mình: đợt 1 đã ra, đợt 3 đang làm.
    expect(grouped.map((item) => item.state)).toEqual(['SERVED', 'MAKING'])
    expect(grouped.every((item) => item.quantity === 2)).toBe(true)
  })

  it('KHÔNG gộp hai ghi chú khác nhau — hai lời nhắn là hai dòng', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 10, note: 'ít đá' }),
      line({ orderLineId: 20, note: 'không đá' }),
    ])
    expect(grouped).toHaveLength(2)
    expect(grouped.map((item) => item.note)).toEqual(['ít đá', 'không đá'])
  })

  it('KHÔNG gộp hai giá khác nhau — quán đổi giá giữa ca', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 10, unitPriceVnd: 100_000 }),
      line({ orderLineId: 20, unitPriceVnd: 120_000 }),
    ])
    expect(grouped).toHaveLength(2)
    expect(grouped.map((item) => item.unitPriceVnd)).toEqual([100_000, 120_000])
  })

  it('KHÔNG gộp hai biến thể khác nhau', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 10, variantId: 1, variantDisplayName: 'Ly' }),
      line({ orderLineId: 20, variantId: 2, variantDisplayName: 'Chai' }),
    ])
    expect(grouped).toHaveLength(2)
  })

  it('ghi chú chứa dấu gạch đứng không trộn hai nhóm vào nhau', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 10, variantId: 1, note: 'a' }),
      // Với dấu phân cách "|" thì hai dòng này cho cùng một khoá gộp.
      line({ orderLineId: 20, variantId: 1, note: 'a|100000' }),
    ])
    expect(grouped).toHaveLength(2)
  })

  it('bỏ dòng đã lên bill hết hoặc đã huỷ hết', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 10, remainingQuantity: 0 }),
      line({ orderLineId: 20, remainingQuantity: -1 }),
      line({ orderLineId: 30, remainingQuantity: 2 }),
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.sources).toEqual([{ orderLineId: 30, quantity: 2 }])
  })

  it('V12 — lần xuất thứ hai chỉ lấy phần CÒN LẠI, không lặp lại bill thứ nhất', () => {
    // Bill 1 đã lấy hết dòng 10 và 11.
    const afterFirstBill = [
      line({ orderLineId: 10, remainingQuantity: 0 }),
      line({ orderLineId: 11, remainingQuantity: 0 }),
      // Khách gọi thêm 2 Coca sau khi đã Xuất hóa đơn (TN-02-K6).
      line({ orderLineId: 12, variantId: 9, itemCode: 'COCA', itemName: 'COCA-COLA', remainingQuantity: 2 }),
    ]
    const grouped = groupBillableLines(afterFirstBill)
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.itemCode).toBe('COCA')
    expect(grouped[0]?.quantity).toBe(2)
  })

  it('một dòng đơn lên bill một phần: phần còn lại vào bill sau', () => {
    // Dòng 10 có net_quantity 5, bill 1 đã lấy 3 → còn 2.
    const grouped = groupBillableLines([line({ orderLineId: 10, remainingQuantity: 2 })])
    expect(grouped[0]?.quantity).toBe(2)
    expect(grouped[0]?.sources).toEqual([{ orderLineId: 10, quantity: 2 }])
  })

  it('không còn gì để xuất thì trả mảng rỗng — cũng là điều kiện đóng Phiên', () => {
    expect(groupBillableLines([])).toEqual([])
    expect(groupBillableLines([line({ orderLineId: 10, remainingQuantity: 0 })])).toEqual([])
  })

  it('đánh số dòng liên tục từ 1 theo dòng đơn sớm nhất của mỗi nhóm', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 30, variantId: 3 }),
      line({ orderLineId: 10, variantId: 1 }),
      line({ orderLineId: 20, variantId: 2 }),
    ])
    expect(grouped.map((item) => item.lineNo)).toEqual([1, 2, 3])
    expect(grouped.map((item) => item.sourceOrderLineId)).toEqual([10, 20, 30])
  })

  it('con trỏ tra ngược là dòng đơn sớm nhất, kể cả khi dữ liệu về không theo thứ tự', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 50, remainingQuantity: 1 }),
      line({ orderLineId: 20, remainingQuantity: 1 }),
    ])
    expect(grouped[0]?.sourceOrderLineId).toBe(20)
    expect(grouped[0]?.quantity).toBe(2)
  })
})

describe('assertGroupingIsConsistent', () => {
  it('chấp nhận kết quả gộp hợp lệ', () => {
    const grouped = groupBillableLines([
      line({ orderLineId: 10, remainingQuantity: 2 }),
      line({ orderLineId: 20, remainingQuantity: 3 }),
    ])
    expect(() => assertGroupingIsConsistent(grouped)).not.toThrow()
  })

  it('nổ khi số lượng dòng bill lệch tổng các nguồn', () => {
    const grouped = groupBillableLines([line({ orderLineId: 10, remainingQuantity: 2 })])
    grouped[0]!.quantity = 3
    expect(() => assertGroupingIsConsistent(grouped)).toThrow(/lệch nguồn/)
  })

  it('nổ khi thành tiền lệch đơn giá nhân số lượng', () => {
    const grouped = groupBillableLines([line({ orderLineId: 10, remainingQuantity: 2 })])
    grouped[0]!.amountVnd = 1
    expect(() => assertGroupingIsConsistent(grouped)).toThrow(/lệch thành tiền/)
  })
})

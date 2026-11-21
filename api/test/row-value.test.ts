import { describe, expect, it } from 'vitest'

import { sqlBoolean } from '../src/database/row-value.js'

/**
 * Bẫy đã làm mọi bàn có khách bị báo là "đã thanh toán".
 *
 * Pool bật `bigNumberStrings`, nên một biểu thức `x IS NOT NULL` về tới Node
 * dưới dạng chuỗi `'0'` / `'1'`. `Boolean('0')` là `true`, và code đọc cờ đó
 * trông hoàn toàn đúng trong lúc nó trả `true` cho mọi hàng.
 */
describe('sqlBoolean', () => {
  it("chuỗi '0' của MySQL là FALSE, không phải true", () => {
    expect(sqlBoolean('0')).toBe(false)
    expect(sqlBoolean('1')).toBe(true)
  })

  it('cột TINYINT trả về số vẫn đọc đúng', () => {
    expect(sqlBoolean(0)).toBe(false)
    expect(sqlBoolean(1)).toBe(true)
  })

  it('NULL và chuỗi rỗng là FALSE', () => {
    expect(sqlBoolean(null)).toBe(false)
    expect(sqlBoolean(undefined)).toBe(false)
    expect(sqlBoolean('')).toBe(false)
  })

  it('boolean và bigint đi qua đúng', () => {
    expect(sqlBoolean(true)).toBe(true)
    expect(sqlBoolean(false)).toBe(false)
    expect(sqlBoolean(1n)).toBe(true)
    expect(sqlBoolean(0n)).toBe(false)
  })

  it('BIT(1) dạng Buffer đọc theo byte đầu', () => {
    expect(sqlBoolean(Uint8Array.from([0]))).toBe(false)
    expect(sqlBoolean(Uint8Array.from([1]))).toBe(true)
  })
})

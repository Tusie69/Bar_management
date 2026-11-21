/**
 * Đọc giá trị thô từ một hàng MySQL cho đúng kiểu.
 *
 * Lý do tồn tại: pool bật `supportBigNumbers` + `bigNumberStrings` (xem
 * `pool.ts`), nên mọi BIỂU THỨC boolean trong câu SELECT — `x IS NOT NULL`,
 * `TRUE`, `a = b` — về tới Node dưới dạng CHUỖI `'0'` hoặc `'1'`, không phải
 * số. Và `Boolean('0')` là `true`.
 *
 * Đó là một cái bẫy im lặng: code đọc `Boolean(row.paid)` trông đúng, chạy
 * không lỗi, và trả về `true` cho mọi hàng. Cột TINYINT thật (`is_spare`,
 * `is_birthday`) vẫn về dạng số nên `Boolean()` ở đó vẫn đúng — nghĩa là bẫy
 * chỉ sập ở những chỗ dùng biểu thức, và sập theo hướng "luôn bật".
 *
 * Dùng hàm này cho MỌI cờ đọc từ một biểu thức SQL.
 */
export function sqlBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value !== '' && value !== '0'
  if (typeof value === 'bigint') return value !== 0n
  // Buffer (BIT(1)) và mọi thứ khác: null/undefined là false, còn lại đọc byte đầu.
  if (value === null || value === undefined) return false
  if (typeof value === 'object' && 'length' in (value as { length?: unknown })) {
    const buffer = value as unknown as Uint8Array
    return buffer.length > 0 && buffer[0] !== 0
  }
  return Boolean(value)
}

/**
 * Mã hiển thị của một cụm bàn ghép: G01, G02, … G50.
 *
 * Trước đây có ba cách gọi cùng một thứ cùng tồn tại: máy chủ trả `◆A`, web tự
 * quy đổi thành `G01` để vẽ pill trên sơ đồ, còn tài liệu hợp đồng 09/11 lại
 * đề xuất `N7`. Hệ quả là trên đúng một màn hình lễ tân, pill ghi `G01` còn
 * sheet chi tiết ghi `◆D`. Giờ máy chủ sinh thẳng `Gnn` và đây là nơi duy nhất
 * web biết về dạng mã đó.
 *
 * KHÔNG liên quan tới bộ hình (Nơ, Sao, Thoi…) trong `domain/symbols.ts`: đó
 * là một cách đọc khác của cùng `symbolNo`, có xuất xứ riêng (TH §3), và vẫn
 * giữ nguyên.
 */

/** `1` → `"G01"`. Trả null cho số không hợp lệ thay vì sinh `"GNaN"`. */
export function groupCodeFromSymbol(symbolNo: number | null | undefined): string | null {
  if (!symbolNo || !Number.isSafeInteger(symbolNo) || symbolNo < 1) return null
  return `G${String(symbolNo).padStart(2, "0")}`
}

/**
 * Đưa một mã cụm bất kỳ về dạng `Gnn`.
 *
 * Vẫn cần vì dữ liệu cũ: `table_turns.group_code_snapshot` chụp lại chuỗi hiển
 * thị tại thời điểm trả bàn, nên những lượt đóng trước lần đổi này đang giữ
 * `◆A` trong database. Lịch sử không bị viết lại; nó được đọc lại cho đúng.
 *
 * Tên cụm do người dùng tự đặt (ví dụ "Bàn sếp") không khớp dạng nào thì giữ
 * nguyên — đó là chữ của họ, không phải mã sinh ra.
 */
export function normalizeGroupCode(groupRef: number | string | null | undefined): string | null {
  if (groupRef === null || groupRef === undefined || groupRef === "" || groupRef === 0) return null
  if (typeof groupRef === "number") return groupCodeFromSymbol(groupRef)

  const str = String(groupRef).trim()
  if (!str) return null

  // Đã đúng dạng, chỉ chuẩn hóa độ rộng: "G1" → "G01".
  const asGroupCode = str.match(/^G(\d+)$/i)
  if (asGroupCode) return groupCodeFromSymbol(parseInt(asGroupCode[1], 10)) ?? str

  // Dữ liệu cũ: "◆A", "◆AA" — đánh số kiểu cột Excel. Chỉ nhận chuỗi có tiền
  // tố ◆: chữ cái trần hay chuỗi "có chứa số" là tên người dùng tự đặt hoặc
  // mã bàn ("C1" là Khu C bàn 1), quy đổi chúng là sửa sai dữ liệu.
  const asLegacyLetters = str.match(/^◆([A-Za-z]+)$/)
  if (asLegacyLetters) {
    const letters = asLegacyLetters[1].toUpperCase()
    let n = 0
    for (let i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64)
    }
    return groupCodeFromSymbol(n) ?? str
  }

  return str
}

/**
 * Mã cụm bàn: một dạng duy nhất, và đọc được dữ liệu cũ.
 *
 * Trước đây máy chủ trả `◆A` còn sơ đồ tự quy đổi thành `G01`, nên cùng một
 * cụm mang hai tên trên cùng một màn hình. Test này chốt dạng mới và chốt luôn
 * rằng lượt khách đóng từ trước vẫn đọc ra đúng cụm.
 */
import { describe, expect, it } from "vitest"
import { groupCodeFromSymbol, normalizeGroupCode } from "./group-code"

describe("mã cụm sinh từ symbolNo", () => {
  it.each([
    [1, "G01"],
    [2, "G02"],
    [9, "G09"],
    [10, "G10"],
    [50, "G50"],
  ])("ký hiệu %s thành %s", (symbolNo, code) => {
    expect(groupCodeFromSymbol(symbolNo)).toBe(code)
  })

  it("khớp đúng hàm groupDisplayCode của máy chủ", () => {
    // Lệch nhau thì bản demo và bản chạy thật gọi cùng một cụm bằng hai tên.
    // `symbol_no` bị chặn 1..50 bởi ck_table_groups_symbol nên hai chữ số là đủ.
    expect(groupCodeFromSymbol(4)).toBe("G04")
    expect(groupCodeFromSymbol(50)).toBe("G50")
  })

  it("số không hợp lệ trả null, không sinh ra GNaN", () => {
    expect(groupCodeFromSymbol(0)).toBeNull()
    expect(groupCodeFromSymbol(-1)).toBeNull()
    expect(groupCodeFromSymbol(null)).toBeNull()
    expect(groupCodeFromSymbol(undefined)).toBeNull()
    expect(groupCodeFromSymbol(1.5)).toBeNull()
  })
})

describe("đọc lại mã cũ trong sổ lượt", () => {
  it.each([
    ["◆A", "G01"],
    ["◆D", "G04"],
    ["◆Z", "G26"],
    ["◆AA", "G27"],
  ])("lượt đóng trước đây lưu %s, đọc ra %s", (snapshot, code) => {
    // `table_turns.group_code_snapshot` chụp chuỗi hiển thị lúc trả bàn, nên
    // dữ liệu cũ vẫn là ◆. Lịch sử không bị viết lại, chỉ đọc lại cho đúng.
    expect(normalizeGroupCode(snapshot)).toBe(code)
  })

  it("chữ cái trần KHÔNG bị quy đổi", () => {
    // Chỉ chuỗi có tiền tố ◆ mới chắc chắn là mã cụm cũ. "A" trần có thể là
    // tên người dùng đặt, và "C1" là mã bàn Khu C — đổi chúng thành G01 là
    // sửa sai dữ liệu chứ không phải chuẩn hóa.
    expect(normalizeGroupCode("A")).toBe("A")
    expect(normalizeGroupCode("C1")).toBe("C1")
    expect(normalizeGroupCode("Bar 16 + Bar 17")).toBe("Bar 16 + Bar 17")
  })

  it("mã đã đúng dạng thì giữ nguyên, chỉ chuẩn hóa độ rộng", () => {
    expect(normalizeGroupCode("G01")).toBe("G01")
    expect(normalizeGroupCode("G1")).toBe("G01")
    expect(normalizeGroupCode("g7")).toBe("G07")
  })

  it("nhận cả số thuần", () => {
    expect(normalizeGroupCode(4)).toBe("G04")
  })

  it("tên do người dùng tự đặt thì giữ nguyên chữ của họ", () => {
    // "Bàn sếp" không phải mã sinh ra, biến nó thành G-gì đó là sửa lời người
    // dùng. Chỉ những chuỗi có dạng mã mới được quy đổi.
    expect(normalizeGroupCode("Bàn sếp")).toBe("Bàn sếp")
  })

  it("rỗng và null không thành mã", () => {
    expect(normalizeGroupCode("")).toBeNull()
    expect(normalizeGroupCode(null)).toBeNull()
    expect(normalizeGroupCode(undefined)).toBeNull()
    expect(normalizeGroupCode(0)).toBeNull()
  })
})

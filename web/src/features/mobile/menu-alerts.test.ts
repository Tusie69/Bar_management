/**
 * Chấm đỏ thông báo trên nút mở menu của Lễ tân.
 *
 * Hàng trên của màn sơ đồ chỉ còn dư 39px sau ô tìm kiếm và nút Xuất Text —
 * không đủ cho một nút 44px. Nên tín hiệu dán lên nút menu sẵn có, còn danh
 * sách cảnh báo nằm ngay đầu menu đó.
 */
import { describe, expect, it } from "vitest"
import { alertSectionTitle, menuButtonLabel } from "./menu-alerts"

describe("nhãn trợ năng của nút mở menu", () => {
  it("không có gì chưa xem thì giữ nguyên nhãn gốc", () => {
    // Đọc thêm "0 thông báo chưa xem" ở mọi lần lướt qua là tiếng ồn.
    expect(menuButtonLabel("Menu", 0)).toBe("Menu")
    expect(menuButtonLabel("Tài khoản và giao diện", 0)).toBe("Tài khoản và giao diện")
  })

  it("có cảnh báo chưa xem thì nói rõ bao nhiêu", () => {
    // Chấm đỏ là tín hiệu nhìn bằng mắt; trình đọc màn hình không thấy nó nên
    // số phải nằm trong nhãn.
    expect(menuButtonLabel("Menu", 5)).toBe("Menu, 5 thông báo chưa xem")
    expect(menuButtonLabel("Menu", 1)).toBe("Menu, 1 thông báo chưa xem")
  })

  it("số âm coi như không có, không đọc ra câu vô nghĩa", () => {
    expect(menuButtonLabel("Menu", -2)).toBe("Menu")
  })
})

describe("tiêu đề mục Thông báo trong menu", () => {
  it("có cảnh báo thì kèm số", () => {
    // Chấm đỏ cố ý không mang số để nút menu khỏi chật; số đếm nằm ở đây.
    expect(alertSectionTitle(5)).toBe("Thông báo · 5")
    expect(alertSectionTitle(1)).toBe("Thông báo · 1")
  })

  it("không có cảnh báo thì chỉ là tiêu đề trơn", () => {
    expect(alertSectionTitle(0)).toBe("Thông báo")
  })
})

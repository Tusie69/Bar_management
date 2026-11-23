/**
 * TU-35 — Định dạng thời gian của nhật ký.
 *
 * Nhật ký dùng để đối chiếu với lời kể của nhân viên, nên giờ hiển thị phải là
 * giờ quán (UTC+7), không phải giờ của máy đang mở trang.
 */
import { describe, expect, it } from "vitest"
import { fmtAuditDetail, fmtAuditTime } from "./audit-format"

describe("giờ trên dòng nhật ký", () => {
  it("đổi UTC sang giờ quán", () => {
    // 14:48 UTC = 21:48 giờ quán, cùng ngày.
    expect(fmtAuditTime("2026-11-12T14:48:12.000Z")).toBe("12/11 21:48:12")
  })

  it("qua nửa đêm vẫn ra đúng ngày dương lịch của quán", () => {
    // 18:05 UTC ngày 12 = 01:05 ngày 13 giờ quán.
    expect(fmtAuditTime("2026-11-12T18:05:30.000Z")).toBe("13/11 01:05:30")
  })

  it("giữ nguyên giây để đối chiếu từng thao tác", () => {
    expect(fmtAuditTime("2026-11-12T16:00:07.000Z")).toBe("12/11 23:00:07")
  })

  it("giá trị hỏng không làm vỡ bảng", () => {
    expect(fmtAuditTime("không phải ngày")).toBe("—")
  })
})

describe("UI-52 định dạng chi tiết nhật ký sang tiếng Việt", () => {
  it("đổi portal và result sang nhãn tiếng Việt", () => {
    expect(fmtAuditDetail("portal: admin · result: FAILURE")).toBe("Cổng: Quản trị · Kết quả: Thất bại")
    expect(fmtAuditDetail("portal: preparation · result: SUCCESS")).toBe("Cổng: Chế biến · Kết quả: Thành công")
    expect(fmtAuditDetail("roleCode: WAITER · accessLevel: READ_ONLY")).toBe("Vai trò: Phục vụ · Cấp truy cập: Chỉ xem")
  })

  it("giữ nguyên khóa lạ hoặc giá trị chưa biết", () => {
    expect(fmtAuditDetail("unknownKey: rawValue · portal: customPortal")).toBe(
      "unknownKey: rawValue · Cổng: customPortal",
    )
    expect(fmtAuditDetail("Khách báo bận")).toBe("Khách báo bận")
  })
})

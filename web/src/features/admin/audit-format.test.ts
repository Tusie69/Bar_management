/**
 * TU-35 — Định dạng thời gian của nhật ký.
 *
 * Nhật ký dùng để đối chiếu với lời kể của nhân viên, nên giờ hiển thị phải là
 * giờ quán (UTC+7), không phải giờ của máy đang mở trang.
 */
import { describe, expect, it } from "vitest"
import { fmtAuditTime } from "./audit-format"

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

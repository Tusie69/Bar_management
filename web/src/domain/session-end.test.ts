import { describe, expect, it } from "vitest"

import {
  isSessionEndCode,
  SESSION_END_NOTICE_SECONDS,
  sessionEndCountdownLabel,
  sessionEndMessage,
  sessionEndTitle,
} from "./session-end"

describe("session end messages", () => {
  it.each([
    ["SESSION_REPLACED", "thiết bị khác"],
    ["SESSION_EXPIRED", "hết hạn"],
    ["SESSION_REVOKED", "thu hồi"],
    ["ACCOUNT_LOCKED", "bị khóa"],
    ["SESSION_INVALID", "không hợp lệ"],
  ])("maps %s to a Vietnamese message", (code, phrase) => {
    expect(isSessionEndCode(code)).toBe(true)
    expect(sessionEndMessage(code)).toContain(phrase)
  })
})

describe("màn báo trước khi về trang đăng nhập", () => {
  it("tiêu đề nói nguyên nhân, không nói hậu quả", () => {
    // "Đã đăng xuất" làm nhân viên tưởng mình bấm nhầm và gọi hỗ trợ; biết
    // là có nơi khác đăng nhập thì họ tự xử lý được.
    expect(sessionEndTitle("SESSION_REPLACED")).toContain("nơi khác")
    expect(sessionEndTitle("SESSION_REPLACED")).not.toContain("Đăng xuất")
  })

  it.each([
    ["ACCOUNT_LOCKED", "khóa"],
    ["SESSION_REVOKED", "thu hồi"],
    ["SESSION_EXPIRED", "hết hạn"],
  ])("%s có tiêu đề riêng", (code, phrase) => {
    expect(sessionEndTitle(code)).toContain(phrase)
  })

  it("mã lạ vẫn có tiêu đề, không để màn hình trống tiêu đề", () => {
    expect(sessionEndTitle("MỘT_MÃ_MỚI")).toBe("Phiên đăng nhập đã kết thúc")
  })

  it("đếm ngược nói rõ còn bao nhiêu giây", () => {
    expect(sessionEndCountdownLabel(7)).toContain("7 giây")
  })

  it("hết giờ thì đổi sang câu đang chuyển, không đếm âm", () => {
    expect(sessionEndCountdownLabel(0)).not.toContain("0 giây")
    expect(sessionEndCountdownLabel(-3)).toBe(sessionEndCountdownLabel(0))
  })

  it("đủ lâu để đọc hết một câu, không lâu tới mức chặn việc", () => {
    expect(SESSION_END_NOTICE_SECONDS).toBeGreaterThanOrEqual(5)
    expect(SESSION_END_NOTICE_SECONDS).toBeLessThanOrEqual(30)
  })
})

import { describe, expect, it } from "vitest"

import { isSessionEndCode, sessionEndMessage } from "./session-end"

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

import { describe, expect, it } from "vitest"
import { parseAppEnv, shouldShowEnvBanner } from "@/config/runtime"

describe("TU-41 dải băng môi trường", () => {
  it("chỉ hiện ở bản Dev", () => {
    expect(shouldShowEnvBanner("dev")).toBe(true)
    expect(shouldShowEnvBanner("production")).toBe(false)
    expect(shouldShowEnvBanner("local")).toBe(false)
  })

  it("đọc VITE_APP_ENV, mặc định theo chế độ build", () => {
    expect(parseAppEnv("dev", true)).toBe("dev")
    expect(parseAppEnv(undefined, true)).toBe("production")
    expect(parseAppEnv("", false)).toBe("local")
    expect(() => parseAppEnv("staging", true)).toThrow(/VITE_APP_ENV/)
  })
})

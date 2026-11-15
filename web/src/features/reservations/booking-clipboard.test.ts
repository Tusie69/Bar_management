import { describe, expect, it, vi } from "vitest"
import { writeBookingExportToClipboard } from "./booking-clipboard"

describe("writeBookingExportToClipboard", () => {
  it("copies the approved text unchanged", async () => {
    const writeText = vi.fn(async () => undefined)
    const text = "A7: Tùng 4p 21:30"

    await writeBookingExportToClipboard(text, true, { writeText })

    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith(text)
  })

  it("rejects insecure or unavailable clipboard contexts", async () => {
    await expect(writeBookingExportToClipboard("text", false, { writeText: vi.fn() })).rejects.toThrow(
      "Clipboard API không khả dụng",
    )
    await expect(writeBookingExportToClipboard("text", true, null)).rejects.toThrow("Clipboard API không khả dụng")
  })

  it("propagates a browser permission rejection", async () => {
    const denied = new DOMException("Denied", "NotAllowedError")
    await expect(
      writeBookingExportToClipboard("text", true, { writeText: vi.fn(async () => Promise.reject(denied)) }),
    ).rejects.toBe(denied)
  })
})

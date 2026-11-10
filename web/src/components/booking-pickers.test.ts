import React from "react"
import { describe, expect, it, vi } from "vitest"
import { renderToString } from "react-dom/server"
import {
  HonorificPicker,
  IconPicker,
  MAIN_SOURCE_BUTTONS,
  SOCIAL_PLATFORMS,
  SourcePicker,
  formatBookingIcons,
  formatBookingSource,
  formatHonorificName,
  guestCount,
  guestError,
  guestValueFrom,
  handleSourceChange,
  honorificSupported,
  iconKeysSupported,
  socialPlatformSupported,
  validateSocialPlatform,
} from "./booking-pickers"

describe("booking-pickers guest helpers", () => {
  it("creates guest value correctly for quick picks (1-6)", () => {
    const v = guestValueFrom(4)
    expect(v.mode).toBe("quick")
    expect(v.party).toBe(4)
    expect(v.otherText).toBe("")
    expect(guestCount(v)).toBe(4)
    expect(guestError(v)).toBeNull()
  })

  it("creates guest value correctly for other counts (> 6)", () => {
    const v = guestValueFrom(12)
    expect(v.mode).toBe("other")
    expect(v.party).toBe(12)
    expect(v.otherText).toBe("12")
    expect(guestCount(v)).toBe(12)
    expect(guestError(v)).toBeNull()
  })

  it("handles empty or invalid other text", () => {
    const v = { mode: "other" as const, party: 0, otherText: "" }
    expect(guestCount(v)).toBeNull()
    expect(guestError(v)).toBe("Nhập số khách.")
  })
})

describe("SourcePicker and source rules", () => {
  it("defines the 5 main buttons in order with WK disabled", () => {
    expect(MAIN_SOURCE_BUTTONS).toHaveLength(5)
    expect(MAIN_SOURCE_BUTTONS.map((b) => b.label)).toEqual(["WK", "Hotline", "Social", "Cổ đông", "Nhân sự"])
    expect(MAIN_SOURCE_BUTTONS[0].code).toBeNull()
    expect(MAIN_SOURCE_BUTTONS[0].disabled).toBe(true)
    expect(MAIN_SOURCE_BUTTONS[0].disabledReason).toBe("Chưa có mã nguồn WK từ API")
    expect(MAIN_SOURCE_BUTTONS[1].code).toBe("HOTLINE")
    expect(MAIN_SOURCE_BUTTONS[2].code).toBe("SOCIAL")
    expect(MAIN_SOURCE_BUTTONS[3].code).toBe("SHAREHOLDER")
    expect(MAIN_SOURCE_BUTTONS[4].code).toBe("STAFF")
  })

  it("renders 5 main buttons in order in the UI", () => {
    const html = renderToString(
      React.createElement(SourcePicker, {
        source: "HOTLINE",
        onSourceChange: () => {},
        platform: "",
        onPlatformChange: () => {},
      }),
    )
    expect(html).toContain("WK")
    expect(html).toContain("Hotline")
    expect(html).toContain("Social")
    expect(html).toContain("Cổ đông")
    expect(html).toContain("Nhân sự")
    expect(html).toContain("disabled")
    expect(html).toContain('title="Chưa có mã nguồn WK từ API"')
    // Select should not be rendered when source is HOTLINE
    expect(html).not.toContain("<select")
  })

  it("renders compact select only when source is SOCIAL and capability is on", () => {
    const htmlSocial = renderToString(
      React.createElement(SourcePicker, {
        source: "SOCIAL",
        onSourceChange: () => {},
        platform: "",
        onPlatformChange: () => {},
        supported: true,
      }),
    )
    expect(htmlSocial).toContain("<select")
    expect(htmlSocial).toContain("Chọn nền tảng")
    for (const p of SOCIAL_PLATFORMS) {
      expect(htmlSocial).toContain(`value="${p.value}"`)
      expect(htmlSocial).toContain(p.label)
    }

    const htmlHotline = renderToString(
      React.createElement(SourcePicker, {
        source: "HOTLINE",
        onSourceChange: () => {},
        platform: "",
        onPlatformChange: () => {},
        supported: true,
      }),
    )
    expect(htmlHotline).not.toContain("<select")
  })

  it("has no default platform and never preselects FB", () => {
    const html = renderToString(
      React.createElement(SourcePicker, {
        source: "SOCIAL",
        onSourceChange: () => {},
        platform: "",
        onPlatformChange: () => {},
        supported: true,
      }),
    )
    // FB option must not be preselected
    expect(html).toContain('<option value="" disabled="" selected="">Chọn nền tảng</option>')
    expect(html).not.toContain('<option value="FB" selected')
  })

  it("clears platform value when switching away from Social", () => {
    const onSourceChange = vi.fn()
    const onPlatformChange = vi.fn()

    // Switching from SOCIAL to HOTLINE
    handleSourceChange("HOTLINE", "SOCIAL", onSourceChange, onPlatformChange)
    expect(onSourceChange).toHaveBeenCalledWith("HOTLINE")
    expect(onPlatformChange).toHaveBeenCalledWith("")

    // Clicking same source does nothing
    onSourceChange.mockClear()
    onPlatformChange.mockClear()
    handleSourceChange("SOCIAL", "SOCIAL", onSourceChange, onPlatformChange)
    expect(onSourceChange).not.toHaveBeenCalled()
    expect(onPlatformChange).not.toHaveBeenCalled()
  })

  it("blocks save with clear inline message when Social has no platform and capability is on", () => {
    expect(validateSocialPlatform("SOCIAL", "", true)).toBe("Vui lòng chọn nền tảng mạng xã hội.")
    expect(validateSocialPlatform("SOCIAL", null, true)).toBe("Vui lòng chọn nền tảng mạng xã hội.")
    expect(validateSocialPlatform("SOCIAL", "FB", true)).toBeNull()
    expect(validateSocialPlatform("HOTLINE", "", true)).toBeNull()

    const htmlError = renderToString(
      React.createElement(SourcePicker, {
        source: "SOCIAL",
        onSourceChange: () => {},
        platform: "",
        onPlatformChange: () => {},
        error: "Vui lòng chọn nền tảng mạng xã hội.",
        supported: true,
      }),
    )
    expect(htmlError).toContain('role="alert"')
    expect(htmlError).toContain("Vui lòng chọn nền tảng mạng xã hội.")
  })

  it("hides select and skips required check when HTTP capability is off", () => {
    // When supported is false (e.g. on HTTP today)
    const htmlHttp = renderToString(
      React.createElement(SourcePicker, {
        source: "SOCIAL",
        onSourceChange: () => {},
        platform: "",
        onPlatformChange: () => {},
        supported: false,
      }),
    )
    expect(htmlHttp).not.toContain("<select")
    expect(validateSocialPlatform("SOCIAL", "", false)).toBeNull()
  })

  it("shows saved source and platform when editing", () => {
    const html = renderToString(
      React.createElement(SourcePicker, {
        source: "SOCIAL",
        onSourceChange: () => {},
        platform: "TIKTOK",
        onPlatformChange: () => {},
        supported: true,
      }),
    )
    expect(html).toContain('value="TIKTOK"')
    expect(html).toContain('selected=""')
    expect(html).toContain("TikTok")
  })

  it("keeps old FANPAGE, ZALO, or OTHER bookings as extra selected chip", () => {
    const htmlFanpage = renderToString(
      React.createElement(SourcePicker, {
        source: "FANPAGE",
        onSourceChange: () => {},
        platform: "",
        onPlatformChange: () => {},
      }),
    )
    expect(htmlFanpage).toContain("Fanpage")
    expect(htmlFanpage).toContain('aria-checked="true"')

    const htmlZalo = renderToString(
      React.createElement(SourcePicker, {
        source: "ZALO",
        onSourceChange: () => {},
        platform: "",
        onPlatformChange: () => {},
      }),
    )
    expect(htmlZalo).toContain("Zalo")

    const htmlOther = renderToString(
      React.createElement(SourcePicker, {
        source: "OTHER",
        onSourceChange: () => {},
        platform: "",
        onPlatformChange: () => {},
      }),
    )
    expect(htmlOther).toContain("Khác")
  })

  it("formats booking detail source with platform when present", () => {
    expect(formatBookingSource("SOCIAL", "FB")).toBe("Social - FB")
    expect(formatBookingSource("SOCIAL", "IG")).toBe("Social - IG")
    expect(formatBookingSource("SOCIAL", "TIKTOK")).toBe("Social - TIKTOK")
    expect(formatBookingSource("SOCIAL", null)).toBe("Social")
    expect(formatBookingSource("SOCIAL", "")).toBe("Social")
    expect(formatBookingSource("HOTLINE", null)).toBe("Hotline")
    expect(formatBookingSource("FANPAGE", null)).toBe("Fanpage")
    expect(formatBookingSource("SHAREHOLDER", null)).toBe("Cổ đông")
  })
})

describe("IconPicker and icon row rules (HU-32 H7)", () => {
  it("renders 3 equal buttons: Bàn sếp, Chỉ định, Sinh nhật in order", () => {
    const html = renderToString(
      React.createElement(IconPicker, {
        isBirthday: false,
        onBirthdayChange: () => {},
        iconKeys: [],
        onIconKeysChange: () => {},
        supported: true,
      }),
    )
    expect(html).toContain("Bàn sếp")
    expect(html).toContain("Chỉ định")
    expect(html).toContain("Sinh nhật")
    expect(html).toContain("grid grid-cols-3")
  })

  it("Sinh nhật is always enabled and reflects isBirthday boolean", () => {
    const htmlOff = renderToString(
      React.createElement(IconPicker, {
        isBirthday: false,
        onBirthdayChange: () => {},
        iconKeys: [],
        onIconKeysChange: () => {},
        supported: false,
      }),
    )
    // Sinh nhat must not be disabled even when supported is false (works on HTTP today)
    expect(htmlOff).toContain('aria-label="Sinh nhật"')
    expect(htmlOff).toContain('aria-checked="false"')

    const htmlOn = renderToString(
      React.createElement(IconPicker, {
        isBirthday: true,
        onBirthdayChange: () => {},
        iconKeys: [],
        onIconKeysChange: () => {},
        supported: false,
      }),
    )
    expect(htmlOn).toContain('aria-checked="true"')
  })

  it("disables star and pin when HTTP capability is off", () => {
    const htmlHttp = renderToString(
      React.createElement(IconPicker, {
        isBirthday: false,
        onBirthdayChange: () => {},
        iconKeys: [],
        onIconKeysChange: () => {},
        supported: false,
      }),
    )
    expect(htmlHttp).toContain('title="Chưa hỗ trợ Bàn sếp trên HTTP"')
    expect(htmlHttp).toContain('title="Chưa hỗ trợ Chỉ định trên HTTP"')
  })

  it("supports selecting several icons at once", () => {
    const htmlMulti = renderToString(
      React.createElement(IconPicker, {
        isBirthday: true,
        onBirthdayChange: () => {},
        iconKeys: ["star", "pin"],
        onIconKeysChange: () => {},
        supported: true,
      }),
    )
    expect(htmlMulti).toContain('title="Bàn sếp"')
    expect(htmlMulti).toContain('title="Chỉ định"')
    expect(formatBookingIcons(true, ["star", "pin"])).toBe("⭐ Bàn sếp · 📌 Chỉ định · 🎂 Sinh nhật")
  })

  it("never assigns defaults when editing", () => {
    const htmlEmpty = renderToString(
      React.createElement(IconPicker, {
        isBirthday: false,
        onBirthdayChange: () => {},
        iconKeys: [],
        onIconKeysChange: () => {},
        supported: true,
      }),
    )
    expect(htmlEmpty).toContain("Sinh nhật")
    expect(formatBookingIcons(false, [])).toBe("Không có")
    expect(formatBookingIcons(false, undefined)).toBe("Không có")
  })
})

describe("HonorificPicker and honorific rules", () => {
  it("renders Mr and Ms buttons with no default selection (never preselect Mr)", () => {
    const html = renderToString(
      React.createElement(HonorificPicker, {
        value: null,
        onChange: () => {},
        supported: true,
      }),
    )
    expect(html).toContain("Mr")
    expect(html).toContain("Ms")
    // Neither button should be checked
    const checkedCount = (html.match(/aria-checked="true"/g) || []).length
    expect(checkedCount).toBe(0)
    const uncheckedCount = (html.match(/aria-checked="false"/g) || []).length
    expect(uncheckedCount).toBe(2)
  })

  it("reflects MR and MS active state", () => {
    const htmlMr = renderToString(
      React.createElement(HonorificPicker, {
        value: "MR",
        onChange: () => {},
        supported: true,
      }),
    )
    expect(htmlMr).toContain('aria-checked="true"')
    expect(htmlMr).toContain('title="Bỏ chọn Mr"')

    const htmlMs = renderToString(
      React.createElement(HonorificPicker, {
        value: "MS",
        onChange: () => {},
        supported: true,
      }),
    )
    expect(htmlMs).toContain('aria-checked="true"')
    expect(htmlMs).toContain('title="Bỏ chọn Ms"')
  })

  it("disables buttons with short reason in title when HTTP capability is off", () => {
    const html = renderToString(
      React.createElement(HonorificPicker, {
        value: null,
        onChange: () => {},
        supported: false,
      }),
    )
    expect(html).toContain("disabled")
    expect(html).toContain('title="Chưa hỗ trợ danh xưng trên HTTP"')
  })

  /**
   * Migration 0016's columns are now read and written by the HTTP API, so these
   * three are no longer mock-only. A regression to `api.mode === "mock"` would
   * silently throw the receptionist's input away again.
   */
  it("keeps the three 0016 fields enabled in both API modes", () => {
    expect(iconKeysSupported).toBe(true)
    expect(honorificSupported).toBe(true)
    expect(socialPlatformSupported).toBe(true)
    expect(validateSocialPlatform("SOCIAL", null)).toBe("Vui lòng chọn nền tảng mạng xã hội.")
    expect(validateSocialPlatform("SOCIAL", "IG")).toBeNull()
    expect(validateSocialPlatform("HOTLINE", null)).toBeNull()
  })

  it("formats guest display name with honorific only when set", () => {
    expect(formatHonorificName("Nam", "MR")).toBe("Mr Nam")
    expect(formatHonorificName("Lan", "MS")).toBe("Ms Lan")
    expect(formatHonorificName("Nam", null)).toBe("Nam")
    expect(formatHonorificName("Nam", undefined)).toBe("Nam")
    expect(formatHonorificName("Khách Walk-in", null)).toBe("Khách Walk-in")
  })
})

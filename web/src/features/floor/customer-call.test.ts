import { describe, expect, it } from "vitest"
import { customerCallCapability, toTelHref } from "./customer-call"

describe("customer call safety", () => {
  it("normalizes only valid international phone numbers into tel links", () => {
    expect(toTelHref("+84 901-234-567")).toBe("tel:+84901234567")
    expect(toTelHref("0084 (901) 234 567")).toBe("tel:+84901234567")
    expect(toTelHref("0901234567")).toBeNull()
    expect(toTelHref("+84;alert(1)")).toBeNull()
    expect(toTelHref("tel:+84901234567")).toBeNull()
  })

  it("checks permission before phone presence to avoid leaking metadata", () => {
    expect(customerCallCapability({ canRevealPhone: false, phoneLast3: null })).toEqual(
      customerCallCapability({ canRevealPhone: false, phoneLast3: "567" }),
    )
  })

  it("blocks missing phone and does not create a tel link before reveal", () => {
    expect(customerCallCapability({ canRevealPhone: true, phoneLast3: null })).toEqual({
      enabled: false,
      reason: "Booking không có số điện thoại khách hàng.",
    })
    expect(customerCallCapability({ canRevealPhone: true, phoneLast3: "567" })).toEqual({
      enabled: false,
      reason: "Số điện thoại chưa được mở cho thao tác gọi này.",
    })
  })

  it("enables a tel link only after a valid revealed E.164 number is supplied", () => {
    expect(
      customerCallCapability({
        canRevealPhone: true,
        phoneLast3: "567",
        revealedPhoneE164: "+84901234567",
      }),
    ).toEqual({ enabled: true, href: "tel:+84901234567" })
  })
})

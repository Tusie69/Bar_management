import { describe, expect, it } from "vitest"

import { roleCan } from "./access"

describe("BA-023 calling permission matrix", () => {
  it("lets receptionists call without granting either reveal permission", () => {
    expect(roleCan("RECEPTIONIST", "booking.phone.call")).toBe(true)
    expect(roleCan("RECEPTIONIST", "booking.phone.reveal")).toBe(false)
    expect(roleCan("RECEPTIONIST", "customer.phone.reveal")).toBe(false)
  })

  it("keeps call access away from unrelated roles", () => {
    expect(roleCan("CASHIER", "booking.phone.call")).toBe(false)
    expect(roleCan("CUSTOMER_CARE", "booking.phone.call")).toBe(false)
    expect(roleCan("OWNER_ADMIN", "booking.phone.call")).toBe(true)
  })
})

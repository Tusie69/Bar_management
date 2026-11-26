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
    expect(roleCan("OWNER", "booking.phone.call")).toBe(true)
    expect(roleCan("ADMIN", "booking.phone.reveal")).toBe(true)
  })
})

describe("HU-44 v1.1 D1 Bartender payment/order permissions", () => {
  it("grants BAR order.read to view bar bills and issue invoices without payment.collect", () => {
    expect(roleCan("BAR", "order.read")).toBe(true)
    expect(roleCan("BAR", "payment.collect")).toBe(false)
    expect(roleCan("WAITER", "order.read")).toBe(true)
    expect(roleCan("WAITER", "payment.collect")).toBe(false)
    expect(roleCan("CASHIER", "payment.collect")).toBe(true)
    expect(roleCan("RECEPTIONIST", "order.read")).toBe(false)
    expect(roleCan("KITCHEN", "order.read")).toBe(false)
  })
})

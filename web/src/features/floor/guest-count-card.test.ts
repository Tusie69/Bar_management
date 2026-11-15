import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined })
  vi.stubGlobal("document", {
    documentElement: { classList: { toggle: () => undefined }, style: {} },
    querySelector: () => null,
  })
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { GuestCountCard } from "./guest-count-card"
import { guestCountDraft, parseGuestCountDraft } from "./guest-count-values"

const values = {
  arrivedBefore: 2,
  arrivedAfter: 0,
  arrivedTotal: 2,
  bookedTables: 6,
  bookedGuests: 6,
  returningGuests: 0,
}

describe("GuestCountCard", () => {
  it("starts expanded by default on every mount", () => {
    const client = new QueryClient()
    const html = renderToString(createElement(QueryClientProvider, { client },
      createElement(GuestCountCard, { businessDate: "2026-11-15" })))
    expect(html).toContain('data-testid="guest-count-card"')
    expect(html).toContain("Tổng đã tới")
    expect(html).not.toContain('data-testid="guest-count-card-collapsed"')
  })

  it("accepts six non-negative integers without deriving totals", () => {
    expect(parseGuestCountDraft(guestCountDraft(values))).toEqual(values)
    expect(parseGuestCountDraft({ ...guestCountDraft(values), arrivedTotal: "99" })).toMatchObject({ arrivedTotal: 99 })
  })

  it("rejects blanks, negative values and decimals", () => {
    const draft = guestCountDraft(values)
    expect(parseGuestCountDraft({ ...draft, bookedTables: "" })).toBeNull()
    expect(parseGuestCountDraft({ ...draft, bookedTables: "-1" })).toBeNull()
    expect(parseGuestCountDraft({ ...draft, bookedTables: "1.5" })).toBeNull()
  })
})

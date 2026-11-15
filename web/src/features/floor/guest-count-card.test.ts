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
import { GuestCountCard, GuestCountSheetPanel } from "./guest-count-card"
import { guestCountDraft, parseGuestCountDraft } from "./guest-count-values"

const values = {
  arrivedBefore: 2,
  arrivedAfter: 0,
  arrivedTotal: 2,
  bookedTables: 6,
  bookedGuests: 6,
  returningGuests: 0,
}

const sampleCount = {
  businessDate: "2026-11-15" as const,
  ...values,
  version: 1,
  updatedAt: null,
}

describe("GuestCountCard", () => {
  it("always shows all six fields with no collapse toggle, Thu gọn button, or inline edit inputs", () => {
    const client = new QueryClient()
    const html = renderToString(createElement(QueryClientProvider, { client },
      createElement(GuestCountCard, { businessDate: "2026-11-15" })))
    expect(html).toContain('data-testid="guest-count-card"')
    expect(html).toContain("Đếm khách")
    expect(html).toContain("Trước 21:30")
    expect(html).toContain("Sau 21:30")
    expect(html).toContain("Tổng đã tới")
    expect(html).toContain("Tổng bàn đặt")
    expect(html).toContain("Tổng khách đặt")
    expect(html).toContain("Đã từng đặt bàn")
    expect(html).not.toContain('data-testid="guest-count-card-collapsed"')
    expect(html).not.toContain("Thu gọn")
    expect(html).not.toContain("<input")
  })

  it("renders view summary and modal edit controls inside GuestCountSheetPanel without expanding the map card", () => {
    const viewHtml = renderToString(createElement(GuestCountSheetPanel, {
      count: sampleCount,
      editing: false,
      canEdit: true,
      draft: null,
      valid: true,
      remoteChanged: false,
      pending: false,
      onStartEdit: () => undefined,
      onDraftChange: () => undefined,
      onReload: () => undefined,
      onCancel: () => undefined,
      onSave: () => undefined,
    }))
    expect(viewHtml).toContain('data-testid="guest-count-summary"')
    expect(viewHtml).toContain("Sửa bộ đếm khách")
    expect(viewHtml).not.toContain('data-testid="guest-count-editor"')

    const editHtml = renderToString(createElement(GuestCountSheetPanel, {
      count: sampleCount,
      editing: true,
      canEdit: true,
      draft: guestCountDraft(values),
      valid: true,
      remoteChanged: false,
      pending: false,
      onStartEdit: () => undefined,
      onDraftChange: () => undefined,
      onReload: () => undefined,
      onCancel: () => undefined,
      onSave: () => undefined,
    }))
    expect(editHtml).toContain('data-testid="guest-count-editor"')
    expect(editHtml).toContain('aria-label="Trước 21:30"')
    expect(editHtml).toContain('aria-label="Đã từng đặt bàn"')
    expect(editHtml).toContain("Hủy")
    expect(editHtml).toContain("Lưu")

    const conflictHtml = renderToString(createElement(GuestCountSheetPanel, {
      count: sampleCount,
      editing: true,
      canEdit: true,
      draft: { ...guestCountDraft(values), arrivedTotal: "" },
      valid: false,
      remoteChanged: true,
      pending: false,
      onStartEdit: () => undefined,
      onDraftChange: () => undefined,
      onReload: () => undefined,
      onCancel: () => undefined,
      onSave: () => undefined,
    }))
    expect(conflictHtml).toContain("Có dữ liệu mới · Tải lại")
    expect(conflictHtml).toContain("Nhập số nguyên không âm")
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

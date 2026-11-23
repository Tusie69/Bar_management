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
import { qk } from "@/hooks/use-data"
import { GuestCountCard, GuestCountSheetPanel } from "./guest-count-card"
import { GUEST_COUNT_MAX, guestCountDraft, parseGuestCountDraft, stepGuestCountValue } from "./guest-count-values"

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
  it("renders collapsed chip by default on phones and expands to show all six fields at >=12px with no inline edit inputs", () => {
    const client = new QueryClient()
    const collapsedHtml = renderToString(
      createElement(QueryClientProvider, { client }, createElement(GuestCountCard, { businessDate: "2026-11-15" })),
    )
    expect(collapsedHtml).toContain('data-testid="guest-count-card"')
    expect(collapsedHtml).toContain('data-testid="guest-count-toggle"')
    expect(collapsedHtml).toContain('aria-expanded="false"')
    expect(collapsedHtml).toContain("Đếm khách")
    expect(collapsedHtml).not.toContain("<input")

    const expandedHtml = renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(GuestCountCard, { businessDate: "2026-11-15", defaultExpanded: true }),
      ),
    )
    expect(expandedHtml).toContain('data-testid="guest-count-card"')
    expect(expandedHtml).toContain("Đếm khách")
    expect(expandedHtml).toContain("Trước 21:30")
    expect(expandedHtml).toContain("Sau 21:30")
    expect(expandedHtml).toContain("Tổng đã tới")
    expect(expandedHtml).toContain("Tổng bàn đặt")
    expect(expandedHtml).toContain("Tổng khách đặt")
    expect(expandedHtml).toContain("Đã từng đặt bàn")
    expect(expandedHtml).toContain("text-xs")
    expect(expandedHtml).not.toMatch(/text-\[(?:8|9|9\.5|10|11)px\]/)
    expect(expandedHtml).not.toContain("lg:min-h-8")
    expect(expandedHtml).not.toContain("lg:min-w-8")
    expect(expandedHtml).not.toContain("<input")
  })

  it("renders view summary and modal edit controls inside GuestCountSheetPanel without expanding the map card", () => {
    const viewHtml = renderToString(
      createElement(GuestCountSheetPanel, {
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
      }),
    )
    expect(viewHtml).toContain('data-testid="guest-count-summary"')
    expect(viewHtml).toContain("Sửa bộ đếm khách")
    expect(viewHtml).not.toContain('data-testid="guest-count-editor"')

    const editHtml = renderToString(
      createElement(GuestCountSheetPanel, {
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
      }),
    )
    expect(editHtml).toContain('data-testid="guest-count-editor"')
    expect(editHtml).toContain('aria-label="Trước 21:30"')
    expect(editHtml).toContain('aria-label="Đã từng đặt bàn"')
    expect(editHtml).toContain("Hủy")
    expect(editHtml).toContain("Lưu")
    // Mỗi ô có hai nút cộng trừ ngay cạnh, con số đọc từ trái sang.
    expect(editHtml).toContain('aria-label="Thêm 1 · Trước 21:30"')
    expect(editHtml).toContain('aria-label="Bớt 1 · Trước 21:30"')
    expect(editHtml).toContain("text-left")
    expect(editHtml).not.toContain("text-right")

    const conflictHtml = renderToString(
      createElement(GuestCountSheetPanel, {
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
      }),
    )
    expect(conflictHtml).toContain("Có dữ liệu mới · Tải lại")
    expect(conflictHtml).toContain("Nhập số nguyên không âm")
  })

  it("accepts six non-negative integers without deriving totals", () => {
    expect(parseGuestCountDraft(guestCountDraft(values))).toEqual(values)
    expect(parseGuestCountDraft({ ...guestCountDraft(values), arrivedTotal: "99" })).toMatchObject({ arrivedTotal: 99 })
  })

  it("nút cộng trừ đi từng bước và không bao giờ ra giá trị bị từ chối", () => {
    expect(stepGuestCountValue("0", 1)).toBe("1")
    expect(stepGuestCountValue("7", -1)).toBe("6")
    // Ô trống tính như 0 — bấm + lần đầu phải ra 1.
    expect(stepGuestCountValue("", 1)).toBe("1")
    // Không tụt xuống âm, không vượt trần UNSIGNED INT.
    expect(stepGuestCountValue("0", -1)).toBe("0")
    expect(stepGuestCountValue(String(GUEST_COUNT_MAX), 1)).toBe(String(GUEST_COUNT_MAX))
  })

  it("rejects blanks, negative values and decimals", () => {
    const draft = guestCountDraft(values)
    expect(parseGuestCountDraft({ ...draft, bookedTables: "" })).toBeNull()
    expect(parseGuestCountDraft({ ...draft, bookedTables: "-1" })).toBeNull()
    expect(parseGuestCountDraft({ ...draft, bookedTables: "1.5" })).toBeNull()
  })

  it("renders full 3-digit and 4-digit populated metrics in two non-truncated columns", () => {
    const client = new QueryClient()
    client.setQueryData(qk.guestCount("2026-11-15"), {
      businessDate: "2026-11-15",
      arrivedBefore: 123,
      arrivedAfter: 345,
      arrivedTotal: 468,
      bookedTables: 42,
      bookedGuests: 129,
      returningGuests: 1299,
      version: 2,
      updatedAt: null,
    })
    const html = renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(GuestCountCard, { businessDate: "2026-11-15", defaultExpanded: true }),
      ),
    )
    for (const num of ["123", "345", "468", "42", "129", "1299"]) {
      expect(html).toContain(`>${num}<`)
    }
    expect(html).toContain('data-testid="guest-count-label-arrivedTotal"')
    expect(html).toContain('data-testid="guest-count-value-arrivedTotal"')
    expect(html).toContain('data-testid="guest-count-label-returningGuests"')
    expect(html).toContain('data-testid="guest-count-value-returningGuests"')
  })
})

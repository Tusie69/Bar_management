import { createElement, type ReactElement } from "react"
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuditEntryView, AuditFiltersView } from "@/services/contracts"

const mockState = vi.hoisted(() => ({
  filtersResult: {
    data: undefined as AuditFiltersView | undefined,
    isPending: false,
    isError: false,
  },
  entriesResult: {
    data: undefined as { entries: AuditEntryView[]; hasMore: boolean } | undefined,
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[1] === "audit-filters") return mockState.filtersResult
    return mockState.entriesResult
  },
}))

import AdminAuditPage from "./audit-page"

describe("AdminAuditPage", () => {
  beforeEach(() => {
    mockState.filtersResult = {
      data: {
        retentionDays: 90,
        canExport: true,
        filters: [
          { type: "BOOKING_CANCEL", label: "Hủy booking", supported: true },
          { type: "DISCOUNT_APPROVAL", label: "Giảm giá / hủy món", supported: false, note: "Chưa hỗ trợ" },
        ],
      },
      isPending: false,
      isError: false,
    }
    mockState.entriesResult = {
      data: {
        hasMore: true,
        entries: [
          {
            id: 10,
            occurredAt: "2026-11-17T14:48:12.000Z",
            actor: "Chủ quán",
            actorUsername: "owner",
            action: "BOOKING_CANCEL",
            actionType: "BOOKING_CANCEL",
            actionLabel: "Hủy booking",
            target: "Bàn A7 · Phạm Quốc Khoa",
            detail: "portal: admin · result: FAILURE",
            device: "Web Admin",
          },
        ],
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
  })

  it("renders action filter chips, date inputs, Lọc sheet trigger, Vietnamese audit details, and entries", () => {
    const html = renderToString(createElement(AdminAuditPage) as ReactElement)
    expect(html).toContain("Tất cả")
    expect(html).toContain("Hủy booking")
    expect(html).toContain("Từ ngày")
    expect(html).toContain("Đến ngày")
    expect(html).toContain("Lọc")
    expect(html).toContain("Xuất file")
    expect(html).toContain("giữ 90 ngày")
    expect(html).toContain("Bàn A7 · Phạm Quốc Khoa")
    expect(html).toContain("Cổng: Quản trị · Kết quả: Thất bại")
    expect(html).not.toContain("portal: admin")
    expect(html).toContain("@owner")
    expect(html).toContain("Còn thao tác cũ hơn")
  })

  it("renders empty and error states cleanly", () => {
    mockState.entriesResult = {
      data: { entries: [], hasMore: false },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    const emptyHtml = renderToString(createElement(AdminAuditPage) as ReactElement)
    expect(emptyHtml).toContain("Chưa có thao tác nào được ghi trong khoảng thời gian lưu nhật ký.")

    mockState.entriesResult = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("Mất kết nối"),
      refetch: vi.fn(),
    }
    const errorHtml = renderToString(createElement(AdminAuditPage) as ReactElement)
    expect(errorHtml).toContain("Không tải được nhật ký")
    expect(errorHtml).toContain("Thử lại")
  })
})

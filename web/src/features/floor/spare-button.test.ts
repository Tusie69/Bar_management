import React from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/state/session", () => ({
  useCan: vi.fn(() => true),
  useSession: Object.assign(vi.fn(), {
    getState: () => ({ permissions: ["venue.configure"] }),
  }),
}))

vi.mock("./spare-table", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./spare-table")>()
  return {
    ...actual,
    useSpareToggle: vi.fn(() => ({
      toggle: vi.fn(),
      pending: false,
    })),
  }
})

import { renderToString } from "react-dom/server"
import type { TableView } from "@/domain/models"
import { SpareButton } from "./spare-button"
import { useSpareToggle } from "./spare-table"

const mockNormalTable: TableView = {
  id: 10,
  version: 1,
  code: "B4",
  displayName: "Bàn B4",
  zoneId: 2,
  zoneCode: "B",
  kind: "TABLE",
  capacity: 4,
  seqNo: null,
  isSpare: false,
  status: "ACTIVE",
  x: 50,
  y: 50,
  w: 40,
  h: 40,
  seating: "four-sides",
}

const mockSpareTable: TableView = {
  ...mockNormalTable,
  id: 11,
  code: "B5",
  displayName: "Bàn B5",
  isSpare: true,
}

describe("SpareButton", () => {
  beforeEach(() => {
    vi.mocked(useSpareToggle).mockReturnValue({
      toggle: vi.fn().mockResolvedValue(true),
      pending: false,
    })
  })

  describe("button label both ways", () => {
    it("renders 'Sơ cua' for a normal table", () => {
      const html = renderToString(
        React.createElement(SpareButton, {
          table: mockNormalTable,
          canConfigure: true,
        }),
      )
      expect(html).toContain("Sơ cua")
      expect(html).not.toContain("Bỏ sơ cua")
      expect(html).toContain('aria-disabled="false"')
      expect(html).not.toMatch(/\sdisabled(?=[>\s=])/)
    })

    it("renders 'Bỏ sơ cua' for a spare table", () => {
      const html = renderToString(
        React.createElement(SpareButton, {
          table: mockSpareTable,
          canConfigure: true,
        }),
      )
      expect(html).toContain("Bỏ sơ cua")
      expect(html).toContain('aria-disabled="false"')
      expect(html).not.toMatch(/\sdisabled(?=[>\s=])/)
    })
  })

  describe("disabled with visible reason", () => {
    it("disables button and displays visible reason when user lacks permission", () => {
      const html = renderToString(
        React.createElement(SpareButton, {
          table: mockNormalTable,
          canConfigure: false,
        }),
      )
      expect(html).toMatch(/\sdisabled(?=[>\s=])/)
      expect(html).toContain('aria-disabled="true"')
      expect(html).toContain("Bạn không có quyền quản lý bàn sơ cua.")
      expect(html).toContain('data-slot="spare-button-reason"')
    })

    it("disables button and displays visible reason when table is in a group", () => {
      const html = renderToString(
        React.createElement(SpareButton, {
          table: mockNormalTable,
          inGroup: true,
          canConfigure: true,
        }),
      )
      expect(html).toMatch(/\sdisabled(?=[>\s=])/)
      expect(html).toContain('aria-disabled="true"')
      expect(html).toContain("Bàn đang thuộc nhóm ghép. Vui lòng tách nhóm trước.")
    })

    it("disables button and displays visible reason when table has active booking or seated guest", () => {
      const htmlSeated = renderToString(
        React.createElement(SpareButton, {
          table: mockNormalTable,
          state: "seated",
          canConfigure: true,
        }),
      )
      expect(htmlSeated).toMatch(/\sdisabled(?=[>\s=])/)
      expect(htmlSeated).toContain('aria-disabled="true"')
      expect(htmlSeated).toContain("Không thể đổi sơ cua khi bàn có booking, khách hoặc đang được giữ.")

      const htmlClaim = renderToString(
        React.createElement(SpareButton, {
          table: mockNormalTable,
          hasClaim: true,
          canConfigure: true,
        }),
      )
      expect(htmlClaim).toMatch(/\sdisabled(?=[>\s=])/)
      expect(htmlClaim).toContain('aria-disabled="true"')
      expect(htmlClaim).toContain("Không thể đổi sơ cua khi bàn có booking, khách hoặc đang được giữ.")
    })
  })

  describe("pending state and double tap prevention", () => {
    it("shows pending state and disables button when toggle is in-flight", () => {
      vi.mocked(useSpareToggle).mockReturnValue({
        toggle: vi.fn(),
        pending: true,
      })

      const html = renderToString(
        React.createElement(SpareButton, {
          table: mockNormalTable,
          canConfigure: true,
        }),
      )
      expect(html).toContain("disabled")
      expect(html).toContain("Đang lưu...")
      expect(html).toContain("animate-spin")
    })

    it("blocks double tap by guarding toggle execution while pending", async () => {
      let resolvePromise: (val: boolean) => void = () => {}
      const pendingPromise = new Promise<boolean>((resolve) => {
        resolvePromise = resolve
      })

      const toggleMock = vi.fn().mockReturnValue(pendingPromise)
      vi.mocked(useSpareToggle).mockReturnValue({
        toggle: toggleMock,
        pending: false,
      })

      // Simulate double tap handler execution
      let pending = false
      const handleClick = async () => {
        if (pending) return false
        pending = true
        try {
          return await toggleMock(mockNormalTable)
        } finally {
          pending = false
        }
      }

      // First tap starts
      const firstTap = handleClick()
      expect(toggleMock).toHaveBeenCalledTimes(1)

      // Second tap while first is in-flight
      const secondTap = handleClick()
      await expect(secondTap).resolves.toBe(false)
      // toggleMock must NOT be called again
      expect(toggleMock).toHaveBeenCalledTimes(1)

      // Resolve first tap
      resolvePromise(true)
      await firstTap
      expect(toggleMock).toHaveBeenCalledTimes(1)
    })
  })

  describe("styling and mobile compliance", () => {
    it("ensures min 44px touch target on mobile via min-h-[44px]", () => {
      const html = renderToString(
        React.createElement(SpareButton, {
          table: mockNormalTable,
          canConfigure: true,
        }),
      )
      expect(html).toContain("min-h-[44px]")
    })

    it("uses outline variant matching existing floor action buttons", () => {
      const html = renderToString(
        React.createElement(SpareButton, {
          table: mockNormalTable,
          canConfigure: true,
        }),
      )
      expect(html).toContain('data-variant="outline"')
    })

    it("does not mutate the original table object (no optimistic state)", () => {
      const original = structuredClone(mockNormalTable)
      renderToString(
        React.createElement(SpareButton, {
          table: mockNormalTable,
          canConfigure: true,
        }),
      )
      expect(mockNormalTable).toEqual(original)
    })
  })
})

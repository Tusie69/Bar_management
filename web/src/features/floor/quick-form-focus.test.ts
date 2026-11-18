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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import type { QuickDraft } from "@/state/ui"
import type { FloorModel } from "./use-floor-model"
import { QuickForm } from "./quick-form"
import { resolveLeaveConfirmFocusTarget } from "./quick-form-focus"

const emptyModel: FloorModel = {
  floor: undefined,
  catalog: undefined,
  tables: [],
  byId: new Map(),
  states: new Map(),
  freeIds: new Set(),
  counts: {
    free: 0,
    reserved: 0,
    upcoming: 0,
    late: 0,
    late_confirmed: 0,
    noshow: 0,
    seated: 0,
    hold: 0,
    hold_overdue: 0,
    oos: 0,
    spare: 0,
  },
  codes: (ids) => ids.map((id) => `T${id}`),
  label: (id) => `T${id}`,
  loading: false,
  error: null,
}

describe("QuickForm leave confirmation focus restoration (P4-03)", () => {
  it("restores focus to the connected invoking control on cancel", () => {
    const invoker = { id: "close-btn" }
    const fallback = { id: "create-btn" }

    const target = resolveLeaveConfirmFocusTarget({
      discarded: false,
      invoker,
      isFocusable: () => true,
      findFallback: () => fallback,
    })

    expect(target).toBe(invoker)
  })

  it("falls back to the visible floor create control when the invoker is no longer focusable", () => {
    const invoker = { id: "removed-btn" }
    const fallback = { id: "create-btn" }

    const target = resolveLeaveConfirmFocusTarget({
      discarded: false,
      invoker,
      isFocusable: () => false,
      findFallback: () => fallback,
    })

    expect(target).toBe(fallback)
  })

  it("never returns focus to the closing form invoker when discarding the draft", () => {
    const invoker = { id: "close-btn" }
    const fallback = { id: "create-btn" }

    const target = resolveLeaveConfirmFocusTarget({
      discarded: true,
      invoker,
      isFocusable: () => true,
      findFallback: () => fallback,
    })

    expect(target).toBe(fallback)
  })

  it("renders retained draft content when ui.draft is already cleared during exit (P4-02)", () => {
    const client = new QueryClient()
    const retainedDraft: QuickDraft = {
      kind: "booking",
      date: "2026-11-17",
      time: "20:00",
      party: 4,
      tableIds: [],
    }

    const html = renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(QuickForm, {
          model: emptyModel,
          availability: undefined,
          availabilityStatus: "ready",
          compact: true,
          draft: retainedDraft,
        }),
      ),
    )

    expect(html).toContain('role="form"')
    expect(html).toContain("Tạo đặt bàn")
    expect(html).not.toContain("Ca tối")
  })
})

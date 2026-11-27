// @vitest-environment node
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { RoleCode } from "@/domain/enums"

const sessionState = {
  role: "RECEPTIONIST" as RoleCode,
}

vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined })
  vi.stubGlobal("document", {
    documentElement: { classList: { toggle: () => undefined }, style: {} },
    querySelector: () => null,
  })
})

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  SheetContent: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SheetHeader: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SheetTitle: ({ children }: { children: ReactNode }) => createElement("h2", null, children),
  SheetDescription: ({ children }: { children: ReactNode }) => createElement("p", null, children),
  SheetFooter: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: () => null,
  DialogContent: () => null,
  DialogDescription: () => null,
  DialogHeader: () => null,
  DialogTitle: () => null,
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: () => null,
  AlertDialogAction: () => null,
  AlertDialogCancel: () => null,
  AlertDialogContent: () => null,
  AlertDialogDescription: () => null,
  AlertDialogFooter: () => null,
  AlertDialogHeader: () => null,
  AlertDialogMedia: () => null,
  AlertDialogTitle: () => null,
}))

vi.mock("@/services", () => ({
  api: { mode: "mock" },
  clock: { now: () => new Date("2026-11-26T21:00:00+07:00") },
}))

vi.mock("@/services/payment", () => ({
  isPaymentAvailable: true,
}))

vi.mock("@/state/session", () => ({
  useSession: () => ({
    user: { id: 1, displayName: "Lễ tân 1", role: sessionState.role, deviceLabel: "iPad quầy" },
    users: [{ id: 1, displayName: "Lễ tân 1", role: sessionState.role, deviceLabel: "iPad quầy" }],
    theme: "light",
    setUser: vi.fn(),
    setTheme: vi.fn(),
    principal: null,
    permissions: [],
    logout: vi.fn(),
  }),
}))

vi.mock("@/features/mobile/actions", () => ({
  useMobileActions: () => ({}),
}))

vi.mock("@/features/mobile/context", () => ({
  useM: () => ({ role: sessionState.role }),
}))

vi.mock("@/features/mobile/overlay-focus", () => ({
  useRestoreTriggerFocus: () => ({ overlayId: "ov-1", onCloseAutoFocus: vi.fn() }),
}))

import { AccountSheet } from "@/features/mobile/overlays"

function renderAccountSheetAs(role: RoleCode): string {
  sessionState.role = role
  return renderToStaticMarkup(
    createElement(AccountSheet, {
      open: true,
      onClose: vi.fn(),
      alerts: [],
      onOpenNotifications: vi.fn(),
      onOpenAlert: vi.fn(),
      focusAfterClose: () => false,
    }),
  )
}

describe("W4b Reception AccountSheet menu entry", () => {
  it("shows one 'Huỷ thanh toán' item for RECEPTIONIST", () => {
    const html = renderAccountSheetAs("RECEPTIONIST")
    expect(html).toContain("Huỷ thanh toán")
  })

  it("hides 'Huỷ thanh toán' reception entry from non-receptionist roles", () => {
    for (const role of ["OWNER", "ADMIN", "CASHIER", "WAITER", "BAR"] as const) {
      const html = renderAccountSheetAs(role)
      expect(html).not.toContain("Huỷ thanh toán")
    }
  })
})

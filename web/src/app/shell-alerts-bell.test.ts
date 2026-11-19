import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { RoleCode } from "@/domain/enums"

const state = vi.hoisted(() => ({
  role: "RECEPTIONIST" as RoleCode,
  alerts: [
    {
      key: "a1",
      tone: "noshow" as const,
      icon: null,
      title: "B3 · Tới muộn",
      detail: "Quá 20 phút",
      tableId: 1,
    },
  ],
}))

vi.mock("react-router", () => ({
  NavLink: () => null,
  Outlet: () => null,
  useLocation: () => ({ pathname: "/floor" }),
  useNavigate: () => vi.fn(),
}))

vi.mock("@/state/session", () => ({
  useSession: (selector: (s: { user: { role: RoleCode } }) => unknown) => selector({ user: { role: state.role } }),
  useCan: () => true,
}))

vi.mock("@/state/ui", () => ({
  useUi: () => ({ floorMode: "live", availDate: "2026-11-17", selectTable: vi.fn(), openReservation: vi.fn() }),
}))

vi.mock("@/hooks/use-data", () => ({
  useNow: () => new Date("2026-11-17T21:30:00+07:00"),
  // TU-38: giờ ca đọc từ cấu hình địa điểm, không cố định 17:00-05:00.
  useBusinessShift: () => ({ startLocal: "17:00:00", cutoffLocal: "05:00:00" }),
  useOverview: () => ({ data: undefined }),
  useReservations: () => ({ data: [] }),
}))

vi.mock("@/features/floor/use-floor-model", () => ({
  useFloorModel: () => ({ floor: { businessDate: "2026-11-17" } }),
}))

vi.mock("@/features/floor/alerts", () => ({
  useShiftAlerts: () => state.alerts,
}))

import { AlertsBell } from "./shell"

describe("AlertsBell role visibility in AppShell", () => {
  it("renders nothing for RECEPTIONIST", () => {
    state.role = "RECEPTIONIST"
    const html = renderToString(createElement(AlertsBell))
    expect(html).toBe("")
    expect(html).not.toContain("lucide-bell")
    expect(html).not.toContain("Thông báo")
    expect(html).not.toContain("Cần xử lý")
  })

  it("renders alert bell and badge for OWNER", () => {
    state.role = "OWNER"
    const html = renderToString(createElement(AlertsBell))
    expect(html).toContain('aria-label="Cần xử lý: 1"')
    expect(html).toContain("lucide-bell")
    expect(html).toContain("bg-st-noshow")
    expect(html).toContain(">1<")
  })
})

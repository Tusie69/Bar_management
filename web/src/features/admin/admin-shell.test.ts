import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server"
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { roleCan, type Permission } from "@/domain/access"
import {
  PORTAL_CONFIG,
  portalFromPath,
  resolvePortalLoginDestination,
} from "@/domain/auth-portal"
import type { RoleCode } from "@/domain/enums"
import { AuthBoundary } from "@/features/auth/auth-boundary"
import { qk } from "@/hooks/use-data"
import type { AuthenticatedUser } from "@/services"
import { clock } from "@/services"
import {
  ADMIN_DESKTOP_MEDIA_QUERY,
  ADMIN_NAV_ITEMS,
  ADMIN_ROLE_LABELS,
  ADMIN_SHIFT_LABEL,
  formatAdminBusinessDate,
  getAdminRoleLabel,
  getUserHomePath,
  resolveActiveAdminNavItem,
  resolveDrawerCloseFocusTarget,
} from "./admin-config"

interface TestSessionState {
  authStatus: "loading" | "authenticated" | "anonymous" | "error"
  authError: string | null
  portal: "admin" | "receptionist" | "cashier" | "customer-care" | null
  user: { id: number; displayName: string; role: RoleCode; deviceLabel: string }
  users: never[]
  principal: AuthenticatedUser | null
  permissions: string[]
  theme: "light" | "dark"
  setUser: () => void
  setTheme: () => void
  bootstrap: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
  expire: () => void
}

const ALL_ADMIN_PERMS: Permission[] = [
  "report.read",
  "customer.view_masked",
  "customer.phone.reveal",
  "booking.phone.reveal",
  "user.read",
  "user.manage",
  "venue.configure",
  "audit.read",
]

const sessionHolder = vi.hoisted(() => ({
  state: null as unknown as TestSessionState,
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/state/session", () => {
  const useSession = <T,>(selector?: (state: TestSessionState) => T): T | TestSessionState =>
    selector ? selector(sessionHolder.state) : sessionHolder.state
  useSession.getState = () => sessionHolder.state
  useSession.setState = (partial: Partial<TestSessionState>) => {
    sessionHolder.state = { ...sessionHolder.state, ...partial }
  }
  return {
    useSession,
    useCan: (permission: Permission) =>
      sessionHolder.state.principal
        ? sessionHolder.state.permissions.includes(permission)
        : roleCan(sessionHolder.state.user.role, permission),
  }
})

import {
  AdminRoutes,
  adminChildRouteObjects as barrelAdminChildRouteObjects,
  adminRouteObject as barrelAdminRouteObject,
} from "./index"
import { adminChildRouteObjects, adminRouteObject } from "./admin-routes"

function setSessionState({
  authStatus = "authenticated",
  role = "OWNER",
  displayName = "Luân Nguyễn",
  accessLevel = null,
  permissions = ALL_ADMIN_PERMS,
  portal = "admin",
  userId = 1,
}: {
  authStatus?: "loading" | "authenticated" | "anonymous" | "error"
  role?: RoleCode
  displayName?: string
  accessLevel?: "WRITE" | "READ_ONLY" | null
  permissions?: Permission[]
  portal?: "admin" | "receptionist" | "cashier" | "customer-care" | null
  userId?: number
}) {
  sessionHolder.state = {
    authStatus,
    authError: authStatus === "error" ? "Lỗi kết nối máy chủ" : null,
    portal,
    user: {
      id: authStatus === "anonymous" ? 0 : userId,
      displayName,
      role,
      deviceLabel: "Test",
    },
    users: [],
    principal:
      authStatus === "authenticated"
        ? {
            id: userId,
            username: "test.user",
            displayName,
            organizationId: 1,
            venueId: 1,
            roles: [role],
            accessLevel,
          }
        : null,
    permissions,
    theme: "light",
    setUser: () => {},
    setTheme: () => {},
    bootstrap: async () => {},
    login: async () => {},
    logout: async () => {},
    expire: () => {},
  }
}

function renderAdminAt(path: string, seedQuery?: (qc: QueryClient) => void): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  seedQuery?.(queryClient)
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(AdminRoutes),
      ),
    ),
  )
}

async function renderAsyncElement(element: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element)
  await stream.allReady
  return await new Response(stream).text()
}

async function renderAdminRouteObjectAt(path: string): Promise<string> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createMemoryRouter([adminRouteObject], { initialEntries: [path] })
  return renderAsyncElement(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(RouterProvider, { router }),
    ),
  )
}

describe("Sprint 4 NA-32 Admin shell", () => {
  beforeEach(() => {
    setSessionState({})
    vi.unstubAllGlobals()
  })

  describe("config, menu order, labels, and business date", () => {
    it("defines the 8 sidebar items in exact Figma order and Vietnamese labels", () => {
      expect(ADMIN_NAV_ITEMS.map((item) => item.navLabel)).toEqual([
        "Tổng quan",
        "Báo cáo",
        "Đối soát",
        "Khách hàng",
        "Sổ lượt",
        "Tài khoản",
        "Cấu hình",
        "Nhật ký",
      ])
      expect(ADMIN_NAV_ITEMS.map((item) => item.path)).toEqual([
        "/admin/overview",
        "/admin/reports",
        "/admin/reconciliation",
        "/admin/customers",
        "/admin/turns",
        "/admin/accounts",
        "/admin/settings",
        "/admin/audit",
      ])
    })

    it("keeps role labels in one map and resolves OWNER / ADMIN WRITE / ADMIN READ_ONLY", () => {
      expect(ADMIN_ROLE_LABELS).toEqual({
        OWNER: "SuperAdmin",
        ADMIN_WRITE: "Admin",
        ADMIN_READ_ONLY: "Chỉ xem",
      })
      expect(getAdminRoleLabel("OWNER", null)).toBe("SuperAdmin")
      expect(getAdminRoleLabel("ADMIN", "WRITE")).toBe("Admin")
      expect(getAdminRoleLabel("ADMIN", "READ_ONLY")).toBe("Chỉ xem")
    })

    it("formats business date using app time helper into 'T5 · 12/11/2026' format", () => {
      expect(formatAdminBusinessDate("2026-11-12")).toBe("T5 · 12/11/2026")
      expect(ADMIN_SHIFT_LABEL).toBe("Ca 17:00 → 05:00")
    })

    it("resolves /admin index to overview and unknown paths to undefined", () => {
      expect(resolveActiveAdminNavItem("/admin")?.id).toBe("overview")
      expect(resolveActiveAdminNavItem("/admin/turns")?.id).toBe("turns")
      expect(resolveActiveAdminNavItem("/admin/x")).toBeUndefined()
    })

    it("exports adminRouteObject from the feature barrel and matches App createBrowserRouter structure", async () => {
      expect(ADMIN_DESKTOP_MEDIA_QUERY).toBe("(min-width: 1025px)")
      expect(barrelAdminRouteObject).toBe(adminRouteObject)
      expect(barrelAdminChildRouteObjects).toBe(adminChildRouteObjects)
      expect(barrelAdminRouteObject.path).toBe("/admin")
      expect(barrelAdminRouteObject.children?.some((c) => c.path === "login")).toBe(true)
      const shellBranch = barrelAdminRouteObject.children?.find((c) => c.children)
      expect(shellBranch?.children?.map((c) => (c.index ? "index" : c.path))).toEqual([
        "index",
        "overview",
        "reports",
        "reconciliation",
        "customers",
        "turns",
        "accounts",
        "settings",
        "audit",
        "*",
      ])

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const router = createMemoryRouter([barrelAdminRouteObject], {
        initialEntries: ["/admin/turns"],
      })
      const html = await renderAsyncElement(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(RouterProvider, { router }),
        ),
      )
      expect(html).toContain('data-testid="admin-shell"')
      expect(html).toContain('data-testid="turn-ledger-page"')
    })

    it("restores drawer-close focus to a visible desktop sidebar item when the trigger is hidden on desktop", () => {
      const hiddenTrigger = { getClientRects: () => [] } as unknown as HTMLElement
      const visibleTrigger = { getClientRects: () => [{ width: 44, height: 44 }] } as unknown as HTMLElement
      const activeNavLink = { id: "active-nav" } as unknown as HTMLElement
      const firstNavLink = { id: "first-nav" } as unknown as HTMLElement
      const mainContent = { id: "main-content" } as unknown as HTMLElement
      const querySelector = vi.fn((selector: string) =>
        selector.includes('aria-current="page"') ? activeNavLink : firstNavLink,
      )
      const desktopSidebar = { querySelector } as unknown as HTMLElement

      expect(
        resolveDrawerCloseFocusTarget({
          trigger: visibleTrigger,
          isDesktop: false,
          desktopSidebar,
          mainContent,
        }),
      ).toBe(visibleTrigger)

      expect(
        resolveDrawerCloseFocusTarget({
          trigger: hiddenTrigger,
          isDesktop: true,
          desktopSidebar,
          mainContent,
        }),
      ).toBe(activeNavLink)

      expect(
        resolveDrawerCloseFocusTarget({
          trigger: hiddenTrigger,
          isDesktop: true,
          desktopSidebar: {
            querySelector: (selector: string) =>
              selector.includes('aria-current="page"') ? null : firstNavLink,
          } as unknown as HTMLElement,
          mainContent,
        }),
      ).toBe(firstNavLink)

      expect(
        resolveDrawerCloseFocusTarget({
          trigger: visibleTrigger,
          isDesktop: true,
          desktopSidebar: { querySelector: () => null } as unknown as HTMLElement,
          mainContent,
        }),
      ).toBe(mainContent)
    })
  })

  describe("AdminGuard access control & AuthBoundary deep-link portal resolution", () => {
    it("maps admin home to /admin/overview and resolves /admin/* deep links to admin portal", () => {
      expect(PORTAL_CONFIG.admin.home).toBe("/admin/overview")
      expect(portalFromPath("/admin")).toBe("admin")
      expect(portalFromPath("/admin/overview")).toBe("admin")
      expect(portalFromPath("/admin/turns")).toBe("admin")
      expect(portalFromPath("/admin/accounts")).toBe("admin")
      expect(portalFromPath("/admin/x")).toBe("admin")
      expect(portalFromPath("/admin/login")).toBe("admin")
      expect(portalFromPath("/receptionist/login")).toBe("receptionist")
      expect(portalFromPath("/cashier/login")).toBe("cashier")
      expect(portalFromPath("/floor")).toBeNull()
    })

    it("resolves post-login return path to requested admin page or /admin/overview", () => {
      expect(resolvePortalLoginDestination("admin", "/admin/turns")).toBe("/admin/turns")
      expect(resolvePortalLoginDestination("admin", "/admin/accounts?tab=1")).toBe(
        "/admin/accounts?tab=1",
      )
      expect(resolvePortalLoginDestination("admin", "/admin/login")).toBe("/admin/overview")
      expect(resolvePortalLoginDestination("admin", "/admin")).toBe("/admin/overview")
      expect(resolvePortalLoginDestination("admin", "/admin/login", "/admin/turns")).toBe(
        "/admin/turns",
      )
      expect(resolvePortalLoginDestination("admin", "/admin/login", "https://evil.com")).toBe(
        "/admin/overview",
      )
      expect(resolvePortalLoginDestination("admin", "/admin/login", "//evil.com")).toBe(
        "/admin/overview",
      )
      expect(resolvePortalLoginDestination("receptionist", "/floor")).toBe("/floor")
      expect(resolvePortalLoginDestination("cashier", "/cashier/login")).toBe("/floor")
    })

    it("routes anonymous AuthBoundary deep links on /admin/* to admin login while keeping receptionist/cashier portals", async () => {
      const services = await import("@/services")
      const originalMode = services.api.mode
      ;(services.api as { mode: "mock" | "http" }).mode = "http"

      try {
        setSessionState({ authStatus: "anonymous", permissions: [], portal: null })

        vi.stubGlobal("window", { location: { pathname: "/admin/turns" } })
        const adminDeepLinkHtml = renderToStaticMarkup(
          React.createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            React.createElement(AuthBoundary, null, React.createElement("div", null, "Protected")),
          ),
        )
        expect(adminDeepLinkHtml).toContain("Đăng nhập Quản trị")
        expect(adminDeepLinkHtml).not.toContain("Đăng nhập Lễ tân")

        vi.stubGlobal("window", { location: { pathname: "/floor" } })
        const receptionistHtml = renderToStaticMarkup(
          React.createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            React.createElement(AuthBoundary, null, React.createElement("div", null, "Protected")),
          ),
        )
        expect(receptionistHtml).toContain("Đăng nhập Lễ tân")

        vi.stubGlobal("window", { location: { pathname: "/thungan/login" } })
        const cashierHtml = renderToStaticMarkup(
          React.createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            React.createElement(AuthBoundary, null, React.createElement("div", null, "Protected")),
          ),
        )
        expect(cashierHtml).toContain("Đăng nhập Thu ngân")
      } finally {
        ;(services.api as { mode: "mock" | "http" }).mode = originalMode
      }
    })

    it("redirects unauthenticated (anonymous) users to /admin/login and never renders admin shell", () => {
      setSessionState({ authStatus: "anonymous", permissions: [], portal: null })
      const html = renderAdminAt("/admin/overview")
      expect(html).toContain('data-testid="admin-unauthenticated-redirect"')
      expect(html).toContain('data-redirect-to="/admin/login"')
      expect(html).toContain("Đăng nhập Quản trị")
      expect(html).not.toContain('data-testid="admin-shell"')
    })

    it("blocks loading and error states without rendering admin content", () => {
      setSessionState({ authStatus: "loading", permissions: [] })
      const loadingHtml = renderAdminAt("/admin/overview")
      expect(loadingHtml).toContain('data-testid="admin-loading-state"')
      expect(loadingHtml).not.toContain('data-testid="shift-overview-page"')

      setSessionState({ authStatus: "error", permissions: [] })
      const errorHtml = renderAdminAt("/admin/overview")
      expect(errorHtml).toContain('data-testid="admin-error-state"')
      expect(errorHtml).not.toContain('data-testid="shift-overview-page"')
    })

    it.each([
      ["RECEPTIONIST", "/floor"],
      ["CASHIER", "/floor"],
      ["CUSTOMER_CARE", "/waitlist"],
    ] as const)(
      "blocks authenticated non-admin role %s with Không có quyền page linking to %s",
      (role, expectedHome) => {
        setSessionState({
          authStatus: "authenticated",
          role,
          displayName: "Nhân sự vận hành",
          permissions: ["customer.view_masked"],
          portal:
            role === "CUSTOMER_CARE"
              ? "customer-care"
              : role === "CASHIER"
                ? "cashier"
                : "receptionist",
        })
        const html = renderAdminAt("/admin/overview")
        expect(getUserHomePath(role)).toBe(expectedHome)
        expect(html).toContain('data-testid="admin-forbidden-page"')
        expect(html).toContain("Không có quyền truy cập")
        expect(html).toContain(`href="${expectedHome}"`)
        expect(html).not.toContain('data-testid="admin-shell"')
        expect(html).not.toContain('data-testid="shift-overview-page"')
      },
    )

    it("allows OWNER and renders SuperAdmin footer label without read-only banner", () => {
      setSessionState({
        role: "OWNER",
        displayName: "Luân Nguyễn",
        permissions: ALL_ADMIN_PERMS,
      })
      const html = renderAdminAt("/admin/overview")
      expect(html).toContain('data-testid="admin-shell"')
      expect(html).toContain("Luân Nguyễn")
      expect(html).toContain("SuperAdmin")
      expect(html).not.toContain('data-testid="admin-readonly-banner"')
    })

    it("allows ADMIN WRITE and renders Admin footer label without false read-only banner", () => {
      setSessionState({
        role: "ADMIN",
        accessLevel: "WRITE",
        displayName: "Hải Quản lý",
        permissions: ALL_ADMIN_PERMS.filter((p) => p !== "venue.configure"),
      })
      const overviewHtml = renderAdminAt("/admin/overview")
      expect(overviewHtml).toContain('data-testid="admin-shell"')
      expect(overviewHtml).toContain("Admin")
      expect(overviewHtml).not.toContain('data-testid="admin-readonly-banner"')

      const accountsHtml = renderAdminAt("/admin/accounts")
      expect(accountsHtml).toContain('data-testid="admin-accounts-page"')
      expect(accountsHtml).not.toContain('data-testid="admin-readonly-banner"')
    })

    it("allows ADMIN READ_ONLY, renders Chỉ xem label and hides account mutation controls", () => {
      const seedStaff = (qc: QueryClient) => {
        qc.setQueryData(qk.accounts, {
          accounts: [
            {
              id: 2,
              username: "letan1",
              displayName: "Lễ tân 1",
              status: "ACTIVE",
              membershipStatus: "ACTIVE",
              roles: ["RECEPTIONIST"],
              accessLevel: null,
              lastLoginAt: null,
              version: 1,
            },
          ],
          roles: [{ code: "RECEPTIONIST", name: "Lễ tân" }],
        })
      }

      setSessionState({
        role: "ADMIN",
        accessLevel: "READ_ONLY",
        displayName: "Minh Kiểm toán",
        permissions: ["report.read", "customer.view_masked", "user.read", "audit.read"],
      })

      const roAccountsHtml = renderAdminAt("/admin/accounts", seedStaff)
      expect(roAccountsHtml).toContain('data-testid="admin-shell"')
      expect(roAccountsHtml).toContain("Chỉ xem")
      expect(roAccountsHtml).toContain('data-testid="admin-readonly-banner"')
      expect(roAccountsHtml).toContain("Lễ tân 1")
      expect(roAccountsHtml).toContain("letan1")
      expect(roAccountsHtml).not.toContain("Tạo tài khoản")
      expect(roAccountsHtml).not.toContain("Đặt lại mật khẩu")
      expect(roAccountsHtml).not.toContain(">Khóa<")
      expect(roAccountsHtml).not.toContain(">Thao tác<")

      setSessionState({
        role: "OWNER",
        displayName: "Luân Nguyễn",
        permissions: ALL_ADMIN_PERMS,
      })
      const ownerAccountsHtml = renderAdminAt("/admin/accounts", seedStaff)
      expect(ownerAccountsHtml).toContain("Tạo tài khoản")
      expect(ownerAccountsHtml).toContain("Đặt lại mật khẩu")
      expect(ownerAccountsHtml).toContain("Khóa")
    })
  })

  describe("Per-permission menu visibility and direct URL blocking", () => {
    it("hides menu items lacking permissions and blocks direct URL access", () => {
      setSessionState({
        role: "ADMIN",
        accessLevel: "READ_ONLY",
        permissions: ["report.read", "customer.view_masked"],
      })

      const overviewHtml = renderAdminAt("/admin/overview")
      expect(overviewHtml).toContain('data-testid="admin-nav-overview"')
      expect(overviewHtml).toContain('data-testid="admin-nav-turns"')
      expect(overviewHtml).not.toContain('data-testid="admin-nav-accounts"')
      expect(overviewHtml).not.toContain('data-testid="admin-nav-audit"')

      const directAccountsHtml = renderAdminAt("/admin/accounts")
      expect(directAccountsHtml).toContain('data-testid="admin-route-permission-denied"')
      expect(directAccountsHtml).toContain("Thiếu quyền user.read")
      expect(directAccountsHtml).not.toContain('data-testid="admin-accounts-page"')

      const directAuditHtml = renderAdminAt("/admin/audit")
      expect(directAuditHtml).toContain('data-testid="admin-route-permission-denied"')
      expect(directAuditHtml).toContain("Thiếu quyền audit.read")
      expect(directAuditHtml).not.toContain('data-testid="admin-audit-slot"')

      setSessionState({
        role: "ADMIN",
        accessLevel: "READ_ONLY",
        permissions: ["user.read"],
      })
      const directOverviewHtml = renderAdminAt("/admin/overview")
      expect(directOverviewHtml).toContain('data-testid="admin-route-permission-denied"')
      expect(directOverviewHtml).toContain("Thiếu quyền report.read")
      const directTurnsHtml = renderAdminAt("/admin/turns")
      expect(directTurnsHtml).toContain('data-testid="admin-route-permission-denied"')
      expect(directTurnsHtml).toContain("Thiếu quyền report.read")
    })
  })

  describe("Mounted NA-33 / NA-34 pages, active state, redirect, clean copy, and 404 inside shell", () => {
    it("renders mounted lazy ShiftOverviewPage on /admin/overview and TurnLedgerPage on /admin/turns", async () => {
      const overviewHtml = await renderAdminRouteObjectAt("/admin/overview")
      expect(overviewHtml).toContain('data-testid="admin-shell"')
      expect(overviewHtml).toContain('aria-current="page" data-testid="admin-nav-overview"')
      expect(overviewHtml).toMatch(/data-testid="shift-overview-(page|loading)"/)

      const turnsHtml = await renderAdminRouteObjectAt("/admin/turns")
      expect(turnsHtml).toContain('data-testid="admin-shell"')
      expect(turnsHtml).toContain('aria-current="page" data-testid="admin-nav-turns"')
      expect(turnsHtml).toContain('data-testid="turn-ledger-page"')
    })

    it("renders all 8 menu items in DOM order and marks active link with aria-current='page'", () => {
      const html = renderAdminAt("/admin/turns")
      const navMatches = [...html.matchAll(/data-testid="admin-nav-([a-z]+)"/g)].map((m) => m[1])
      expect(navMatches).toEqual([
        "overview",
        "reports",
        "reconciliation",
        "customers",
        "turns",
        "accounts",
        "settings",
        "audit",
      ])
      expect(html).toContain('aria-current="page" data-testid="admin-nav-turns"')
      const activeCount = (html.match(/aria-current="page"/g) ?? []).length
      expect(activeCount).toBe(1)
      expect(html).toContain("Sổ lượt tới quán")
    })

    it("redirects /admin index to /admin/overview with overview active", () => {
      const html = renderAdminAt("/admin")
      expect(html).toContain('data-testid="admin-index-redirect"')
      expect(html).toContain('data-redirect-to="/admin/overview"')
      expect(html).toContain('aria-current="page" data-testid="admin-nav-overview"')
    })

    it("renders Dot-2 empty states and audit placeholder without developer text or fake buttons", () => {
      const developerTokens = ["Figma", "Frame", "AdminShell", "NA-33", "NA-34", "TU-35", "overview-page.tsx"]
      for (const [path, id, title] of [
        ["/admin/reports", "reports", "Báo cáo"],
        ["/admin/reconciliation", "reconciliation", "Đối soát"],
        ["/admin/customers", "customers", "Khách hàng"],
        ["/admin/settings", "settings", "Cấu hình"],
      ] as const) {
        const html = renderAdminAt(path)
        expect(html).toContain(`data-testid="admin-dot2-${id}"`)
        expect(html).toContain("Đợt 2 - Sprint 5")
        expect(html).toContain(title)
        for (const token of developerTokens) {
          expect(html).not.toContain(token)
        }
      }

      const auditHtml = renderAdminAt("/admin/audit")
      expect(auditHtml).toContain('data-testid="admin-audit-slot"')
      expect(auditHtml).toContain("Đang xây dựng")
      for (const token of developerTokens) {
        expect(auditHtml).not.toContain(token)
      }
    })

    it("renders unknown /admin/x inside the shell as an in-shell 404 page", () => {
      const html = renderAdminAt("/admin/x")
      expect(html).toContain('data-testid="admin-shell"')
      expect(html).toContain('data-testid="admin-sidebar"')
      expect(html).toContain('data-testid="admin-header"')
      expect(html).toContain('data-testid="admin-not-found-page"')
      expect(html).toContain("/admin/x")
      expect(html).toContain('href="/admin/overview"')
      expect(html).not.toContain('aria-current="page"')
    })

    it("displays shift label and formatted business date in header", () => {
      const expectedDate = formatAdminBusinessDate(
        `${clock.now().getUTCFullYear()}-${String(clock.now().getUTCMonth() + 1).padStart(2, "0")}-${String(clock.now().getUTCDate()).padStart(2, "0")}`,
      )
      expect(expectedDate.length).toBeGreaterThan(0)
      const html = renderAdminAt("/admin/overview")
      expect(html).toContain(ADMIN_SHIFT_LABEL)
      expect(html).toContain('data-testid="admin-business-date"')
    })
  })
})

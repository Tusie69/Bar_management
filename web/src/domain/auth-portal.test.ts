import { describe, expect, it } from "vitest"
import {
  AUTH_PORTALS,
  PORTAL_CONFIG,
  canonicalPortalPath,
  portalFromPath,
  portalLoginPath,
  resolvePortalLoginDestination,
  unavailablePortalFromPath,
} from "./auth-portal"

describe("portal-bound login routes", () => {
  it.each([
    // TU-32: URL tiếng Việt là URL công bố.
    ["/admin/login", "admin"],
    ["/letan/login", "receptionist"],
    ["/thungan/login", "cashier"],
    ["/phucvu/login", "waiter"],
    // Alias tiếng Anh vẫn mở được vì đang nằm trong bookmark của nhân viên.
    ["/login/receptionist", "receptionist"],
    ["/customer-care", "customer-care"],
    ["/cashier/login/", "cashier"],
    ["/waiter", "waiter"],
    // Không có hậu tố /login cũng nhận ra cổng.
    ["/letan", "receptionist"],
    ["/login/phucvu", "waiter"],
  ] as const)("maps %s to %s", (path, portal) => {
    expect(portalFromPath(path)).toBe(portal)
  })

  it("does not derive a portal from an unrelated or unsupported URL", () => {
    expect(portalFromPath("/floor")).toBeNull()
    expect(portalFromPath("/warehouse/login")).toBeNull()
    expect(portalFromPath("")).toBeNull()
  })

  it.each([
    ["/warehouse/login", "Kho"],
    ["/login/bar", "Quầy bar"],
    ["/super-admin", "SuperAdmin"],
  ])("routes unsupported %s to an under-construction portal", (path, label) => {
    expect(unavailablePortalFromPath(path)).toBe(label)
  })

  it("no longer treats Phục vụ as an unavailable portal", () => {
    // Trước TU-32 cổng này hiện trang "đang xây dựng"; giờ nó có vai trò thật.
    expect(unavailablePortalFromPath("/phucvu")).toBeNull()
    expect(unavailablePortalFromPath("/waiter")).toBeNull()
    expect(portalFromPath("/phucvu/login")).toBe("waiter")
  })

  it("uses the Vietnamese URL as the canonical login path", () => {
    expect(portalLoginPath("admin")).toBe("/admin/login")
    expect(portalLoginPath("receptionist")).toBe("/letan/login")
    expect(portalLoginPath("cashier")).toBe("/thungan/login")
    expect(portalLoginPath("waiter")).toBe("/phucvu/login")
  })

  it("redirects an alias URL to the canonical one and leaves canonical URLs alone", () => {
    expect(canonicalPortalPath("/receptionist/login")).toBe("/letan/login")
    expect(canonicalPortalPath("/cashier")).toBe("/thungan/login")
    expect(canonicalPortalPath("/letan/login")).toBeNull()
    expect(canonicalPortalPath("/admin/login")).toBeNull()
    expect(canonicalPortalPath("/floor")).toBeNull()
    expect(canonicalPortalPath("/admin/turns")).toBeNull()
    expect(canonicalPortalPath("/admin/accounts")).toBeNull()
    expect(canonicalPortalPath("/waiter/login")).toBe("/phucvu/login")
  })
  it("returns only to the admin subtree after an admin login", () => {
    expect(resolvePortalLoginDestination("admin", "/admin/turns?date=2026-11-16#ledger")).toBe(
      "/admin/turns?date=2026-11-16#ledger",
    )
    for (const target of ["/administrator", "/admin-other/turns", "//evil.example/admin/turns", "/admin/login"]) {
      expect(resolvePortalLoginDestination("admin", undefined, target)).toBe("/admin/overview")
    }
    // Một cổng không phải admin bỏ qua redirect vào /admin và về ĐÚNG home của
    // nó. Viết theo PORTAL_CONFIG thay vì hardcode "/floor": Phục vụ đã có khu
    // vực riêng ở /phucvu, và cổng tiếp theo cũng sẽ có home riêng.
    for (const portal of ["receptionist", "cashier", "waiter"] as const) {
      expect(resolvePortalLoginDestination(portal, undefined, "/admin/turns")).toBe(PORTAL_CONFIG[portal].home)
    }
    expect(PORTAL_CONFIG.waiter.home).toBe("/phucvu")
    expect(PORTAL_CONFIG.cashier.home).toBe("/payment")
  })

  it("gives every portal exactly one role set and a home route", () => {
    // Một cổng không có cấu hình sẽ làm trang đăng nhập hỏng lúc chạy, nên
    // chốt ở đây thay vì để lộ ra khi nhân viên gõ URL.
    for (const portal of AUTH_PORTALS) {
      expect(PORTAL_CONFIG[portal].roles.length).toBeGreaterThan(0)
      expect(PORTAL_CONFIG[portal].home.startsWith("/")).toBe(true)
    }
  })

  it("keeps the three admin levels on one portal", () => {
    // SuperAdmin, Admin Edit và Admin Read-Only khác nhau về quyền, không về
    // cổng vào. Cổng do người dùng tự gõ nên không bao giờ là chốt phân quyền.
    expect(PORTAL_CONFIG.admin.roles).toEqual(["OWNER", "ADMIN"])
  })

  it("never maps two portals to the same URL slug", () => {
    const slugs = AUTH_PORTALS.map((portal) => portalLoginPath(portal))
    expect(new Set(slugs).size).toBe(AUTH_PORTALS.length)
  })
})

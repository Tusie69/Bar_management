import { describe, expect, it } from "vitest"
import { portalFromPath, portalLoginPath, unavailablePortalFromPath } from "./auth-portal"

describe("portal-bound login routes", () => {
  it.each([
    ["/admin/login", "admin"],
    ["/login/receptionist", "receptionist"],
    ["/customer-care", "customer-care"],
    ["/cashier/login/", "cashier"],
  ] as const)("maps %s to %s", (path, portal) => {
    expect(portalFromPath(path)).toBe(portal)
  })

  it("does not derive a portal from an unrelated or unsupported URL", () => {
    expect(portalFromPath("/floor")).toBeNull()
    expect(portalFromPath("/warehouse/login")).toBeNull()
  })

  it.each([
    ["/warehouse/login", "Kho"],
    ["/login/bar", "Quầy bar"],
    ["/service", "Phục vụ"],
  ])("routes unsupported %s to an under-construction portal", (path, label) => {
    expect(unavailablePortalFromPath(path)).toBe(label)
  })

  it("uses one canonical login URL per supported portal", () => {
    expect(portalLoginPath("admin")).toBe("/admin/login")
    expect(portalLoginPath("receptionist")).toBe("/receptionist/login")
  })
})

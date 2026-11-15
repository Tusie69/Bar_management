import { describe, expect, it } from "vitest"
import type { RoleCode } from "@/domain/enums"
import { FLOOR_H, FLOOR_W, WALL_BOUNDS } from "@/domain/venue-layout"
import { shouldUseMobileShell } from "./shell-mode"

describe("shouldUseMobileShell (NA-38 role-based layout selection)", () => {
  it("always selects the MobileApp reception shell for RECEPTIONIST regardless of viewport width", () => {
    expect(shouldUseMobileShell("RECEPTIONIST", true)).toBe(true)
    expect(shouldUseMobileShell("RECEPTIONIST", false)).toBe(true)
  })

  it("keeps the 768px breakpoint behavior for all non-receptionist roles", () => {
    const otherRoles: RoleCode[] = ["OWNER", "ADMIN", "CASHIER", "CUSTOMER_CARE"]
    for (const role of otherRoles) {
      expect(shouldUseMobileShell(role, true)).toBe(true)
      expect(shouldUseMobileShell(role, false)).toBe(false)
    }
  })

  it("fits the whole floor inside the constrained 628px reception container across phone, iPad, and laptop viewports without scroll or iPad/desktop control overlap", () => {
    const viewports = [
      { label: "phone 375x812", vw: 375, vh: 812, checkOverlayClearance: false },
      { label: "phone 390x844", vw: 390, vh: 844, checkOverlayClearance: false },
      { label: "iPad portrait 768x1024", vw: 768, vh: 1024, checkOverlayClearance: true },
      { label: "iPad Air portrait 820x1180", vw: 820, vh: 1180, checkOverlayClearance: true },
      { label: "iPad landscape 1024x768", vw: 1024, vh: 768, checkOverlayClearance: true },
      { label: "laptop 1366x768", vw: 1366, vh: 768, checkOverlayClearance: true },
      { label: "laptop 1440x900", vw: 1440, vh: 900, checkOverlayClearance: true },
      { label: "desktop 1920x1080", vw: 1920, vh: 1080, checkOverlayClearance: true },
    ]
    const MAX_RECEPTION_W = 628
    const CHROME_H = 56 + 52 // 56px top header + 52px bottom undo/redo row
    const padH = 8
    const padV = 6

    for (const vp of viewports) {
      const containerW = Math.min(vp.vw, MAX_RECEPTION_W)
      const canvasH = vp.vh - CHROME_H
      const k = Math.min((containerW - padH * 2) / FLOOR_W, (canvasH - padV * 2) / FLOOR_H)
      const x = (containerW - FLOOR_W * k) / 2
      const y = (canvasH - FLOOR_H * k) / 2

      const wallLeft = x + WALL_BOUNDS.x * k
      const wallRight = x + (WALL_BOUNDS.x + WALL_BOUNDS.w) * k
      const wallTop = y + WALL_BOUNDS.y * k
      const wallBottom = y + (WALL_BOUNDS.y + WALL_BOUNDS.h) * k

      expect(wallLeft, `${vp.label} wallLeft`).toBeGreaterThanOrEqual(0)
      expect(wallRight, `${vp.label} wallRight`).toBeLessThanOrEqual(containerW)
      expect(wallTop, `${vp.label} wallTop`).toBeGreaterThanOrEqual(0)
      expect(wallBottom, `${vp.label} wallBottom`).toBeLessThanOrEqual(canvasH)

      if (vp.checkOverlayClearance || vp.vw < 768) {
        // GuestCountCard (top: 6, left: 6, width: 140 on phone / 228 on md+, height: <= 80) vs C4 (x: 156, y: 10) & B7 (x: 40, y: 130)
        const guestRight = 6 + (vp.vw < 768 ? 140 : 228)
        const guestBottom = 6 + 80
        const c4Left = x + 156 * k
        const b7Left = x + 40 * k
        const b7Top = y + 130 * k
        expect(guestRight, `${vp.label} GuestCountCard clear of C4`).toBeLessThanOrEqual(c4Left)
        const guestClearOfB7 = guestBottom <= b7Top || guestRight <= b7Left
        expect(guestClearOfB7, `${vp.label} GuestCountCard clear of B7`).toBe(true)
      }

      if (vp.checkOverlayClearance) {

        // Right-side controls (top: 8, right: 8, width: 80, height: 140) vs B21 (x: 322, y: 130, w: 54)
        const rightStackLeft = containerW - 8 - 80
        const rightStackBottom = 8 + 140
        const b21Right = x + (322 + 54) * k
        const b21Top = y + 130 * k
        const rightStackClearOfB21 = rightStackBottom <= b21Top || rightStackLeft >= b21Right
        expect(rightStackClearOfB21, `${vp.label} right controls clear of B21`).toBe(true)
      }
    }
  })
})

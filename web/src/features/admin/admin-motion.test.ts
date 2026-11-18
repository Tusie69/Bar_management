/**
 * Hợp đồng chuyển động của khung Trang Quản trị.
 *
 * Test chạy ở Node, không có DOM, nên chúng kiểm phần quyết định: pha nào
 * còn trong DOM, pha nào nhận thao tác, chờ bao lâu rồi gỡ. Phần nhìn thấy
 * được (panel trượt từ mép trái vào) kiểm bằng mắt và bằng e2e
 * `sprint4-admin-capture.mjs`, đoạn đã chờ `rect.left ≈ 0`.
 */
import { describe, expect, it } from "vitest"
import {
  ADMIN_MOTION_MS,
  drawerDataState,
  drawerExitDelay,
  drawerIsInteractive,
  drawerIsMounted,
  nextDrawerPhase,
  type DrawerPhase,
} from "./admin-motion"

describe("pha của drawer quản trị", () => {
  it("bấm nút 3 sọc thì mở, bấm đóng thì sang pha closing chứ không mất ngay", () => {
    expect(nextDrawerPhase("closed", "open")).toBe("open")
    expect(nextDrawerPhase("open", "close")).toBe("closing")
  })

  it("mở lại trong lúc đang đóng thì nhận lệnh ngay, không chờ hết animation", () => {
    expect(nextDrawerPhase("closing", "open")).toBe("open")
  })

  it("đóng một drawer đã đóng thì không sinh pha mới", () => {
    // Nếu không chặn ở đây, mỗi lần Escape lại hẹn thêm một timer unmount.
    expect(nextDrawerPhase("closed", "close")).toBe("closed")
    expect(nextDrawerPhase("closing", "close")).toBe("closing")
  })
})

describe("panel còn trong DOM hay không", () => {
  it("closing vẫn còn trong DOM — không còn thì không có gì để chạy animation ra", () => {
    expect(drawerIsMounted("closing")).toBe(true)
  })

  it("open còn, closed thì không", () => {
    expect(drawerIsMounted("open")).toBe(true)
    expect(drawerIsMounted("closed")).toBe(false)
  })

  it("mọi pha đều kết thúc ở closed, nên e2e luôn chờ được state detached", () => {
    const phases: DrawerPhase[] = ["open", "closing", "closed"]
    for (const phase of phases) {
      let current = nextDrawerPhase(phase, "close")
      if (current === "closing") current = "closed"
      expect(drawerIsMounted(current)).toBe(false)
    }
  })
})

describe("chỉ drawer đang mở mới nhận thao tác", () => {
  it("closing không ăn click — 150ms đó bấm trúng menu đang biến đi là sai", () => {
    expect(drawerIsInteractive("closing")).toBe(false)
  })

  it("open thì nhận, closed thì không", () => {
    expect(drawerIsInteractive("open")).toBe(true)
    expect(drawerIsInteractive("closed")).toBe(false)
  })
})

describe("data-state cho CSS chọn animation", () => {
  it("chỉ open là 'open'; closing và closed đều là 'closed' để chạy animation ra", () => {
    expect(drawerDataState("open")).toBe("open")
    expect(drawerDataState("closing")).toBe("closed")
    expect(drawerDataState("closed")).toBe("closed")
  })
})

describe("chờ bao lâu rồi gỡ panel", () => {
  it("closing chờ đúng thời lượng animation ra", () => {
    expect(drawerExitDelay("closing", false)).toBe(ADMIN_MOTION_MS.EXIT)
  })

  it("người xin giảm chuyển động thì gỡ ngay, không để panel đứng chết trên màn hình", () => {
    expect(drawerExitDelay("closing", true)).toBe(0)
  })

  it("pha khác không hẹn timer nào", () => {
    expect(drawerExitDelay("open", false)).toBe(0)
    expect(drawerExitDelay("closed", false)).toBe(0)
  })
})

describe("thời lượng", () => {
  it("đóng nhanh hơn mở — người dùng đã quyết định xong thì đừng bắt chờ", () => {
    expect(ADMIN_MOTION_MS.EXIT).toBeLessThan(ADMIN_MOTION_MS.BASE)
  })

  it("mở nằm trong khoảng mắt thấy được mà không sốt ruột (120–300ms)", () => {
    expect(ADMIN_MOTION_MS.BASE).toBeGreaterThanOrEqual(120)
    expect(ADMIN_MOTION_MS.BASE).toBeLessThanOrEqual(300)
  })

  it("hover/màu phải gần như tức thì vì lặp hàng trăm lần mỗi phiên", () => {
    expect(ADMIN_MOTION_MS.FAST).toBeLessThanOrEqual(150)
  })
})

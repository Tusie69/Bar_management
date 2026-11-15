/**
 * TU-39 — Hợp đồng của khung Trang Quản trị.
 *
 * Test chạy ở môi trường Node, không có DOM (dự án chưa có jsdom hay
 * testing-library), nên chúng kiểm phần quyết định: registry, luật vào cửa,
 * nhãn cấp tài khoản và ngày kinh doanh. Layout 1440/768 được kiểm bằng mắt
 * trên trình duyệt; xem mục "Kiểm tra bằng tay" trong docs/frontend.md.
 */
import { describe, expect, it } from "vitest"
import { PERMISSION_MATRIX, type Permission } from "@/domain/access"
import { PORTAL_CONFIG, type AuthPortal } from "@/domain/auth-portal"
import type { RoleCode } from "@/domain/enums"
import {
  ADMIN_ROLES,
  adminLevelLabel,
  canEnterAdmin,
  canReadAdminPage,
  isReadOnlyAdmin,
  visibleAdminPages,
  type AdminAccessLevel,
} from "./admin-access"
import { adminBusinessDateLabel, fmtAdminBusinessDate } from "./admin-date"
import { ADMIN_HOME_PATH, ADMIN_PAGES, adminPageForPath, adminPagePath } from "./admin-pages"

/** Quyền hiệu dụng của một vai trò, đúng như backend suy ra từ ma trận. */
function permissionsOf(role: RoleCode): Permission[] {
  return (Object.keys(PERMISSION_MATRIX) as Permission[]).filter((permission) =>
    PERMISSION_MATRIX[permission].includes(role),
  )
}

/**
 * ADMIN READ_ONLY: backend lọc bỏ permission ghi. Danh sách đọc dưới đây là
 * các permission mà một trang admin có thể dựa vào.
 */
const READ_PERMISSIONS: Permission[] = ["customer.view_masked", "audit.read", "report.read", "user.read", "order.read"]

const can = (granted: readonly Permission[]) => (permission: Permission) => granted.includes(permission)

describe("sidebar quản trị", () => {
  it("có đúng 8 mục, đúng tên và đúng thứ tự Figma", () => {
    expect(ADMIN_PAGES.map((page) => page.label)).toEqual([
      "Tổng quan",
      "Báo cáo",
      "Đối soát",
      "Khách hàng",
      "Sổ lượt",
      "Tài khoản",
      "Cấu hình",
      "Nhật ký",
    ])
  })

  it("mỗi mục có một route riêng dưới /admin, không trùng nhau", () => {
    const paths = ADMIN_PAGES.map(adminPagePath)
    expect(new Set(paths).size).toBe(ADMIN_PAGES.length)
    for (const path of paths) expect(path.startsWith("/admin/")).toBe(true)
  })

  it("mở /admin thì vào mục đầu tiên, và cổng admin trỏ về đúng đó", () => {
    expect(ADMIN_HOME_PATH).toBe(adminPagePath(ADMIN_PAGES[0]))
    // Nếu hai giá trị lệch nhau, đăng nhập xong sẽ rơi vào màn của Lễ tân.
    expect(PORTAL_CONFIG.admin.home).toBe(ADMIN_HOME_PATH)
  })

  it("chỉ dùng permission có thật trong ma trận RBAC", () => {
    for (const page of ADMIN_PAGES) {
      if (!page.permission) continue
      expect(PERMISSION_MATRIX[page.permission]).toBeDefined()
    }
  })

  it("mục nào cũng có nội dung để hiện, không có màn trắng", () => {
    // Chưa có component nghiệp vụ thì placeholder phải nói được trang là gì.
    for (const page of ADMIN_PAGES) {
      expect(page.title.length).toBeGreaterThan(0)
      if (page.status !== "integrated") expect(page.note?.length ?? 0).toBeGreaterThan(0)
    }
  })
})

describe("điều hướng đang mở", () => {
  it("nhận đúng trang từ URL, kể cả URL con của màn chi tiết", () => {
    expect(adminPageForPath("/admin/accounts")?.label).toBe("Tài khoản")
    expect(adminPageForPath("/admin/accounts/12")?.label).toBe("Tài khoản")
    expect(adminPageForPath("/admin/audit/")?.label).toBe("Nhật ký")
  })

  it("không nhận nhầm URL ngoài Admin", () => {
    expect(adminPageForPath("/floor")).toBeUndefined()
    expect(adminPageForPath("/settings")).toBeUndefined()
    // Tiền tố giống nhau nhưng khác trang: không được coi là Tài khoản.
    expect(adminPageForPath("/admin/accounts-export")).toBeUndefined()
  })
})

describe("ai vào được Trang Quản trị", () => {
  it("OWNER và ADMIN ở cổng /admin vào được", () => {
    expect(canEnterAdmin("OWNER", "admin")).toBe(true)
    expect(canEnterAdmin("ADMIN", "admin")).toBe(true)
  })

  it.each<RoleCode>(["RECEPTIONIST", "CASHIER", "WAITER", "CUSTOMER_CARE"])("%s không vào được", (role) => {
    expect(canEnterAdmin(role, "admin")).toBe(false)
    expect(canEnterAdmin(role, null)).toBe(false)
  })

  it.each<AuthPortal>(["receptionist", "cashier", "waiter", "customer-care"])(
    "một phiên mở ở cổng %s không dùng được /admin",
    (portal) => {
      // Gõ thẳng URL trong khi đang đăng nhập ở cổng khác vẫn bị chặn.
      expect(canEnterAdmin("ADMIN", portal)).toBe(false)
    },
  )

  it("danh sách vai trò quản trị khớp cấu hình cổng", () => {
    expect([...ADMIN_ROLES]).toEqual([...PORTAL_CONFIG.admin.roles])
  })
})

describe("cấp tài khoản ở chân sidebar", () => {
  it.each<[RoleCode, AdminAccessLevel, string]>([
    ["OWNER", null, "SuperAdmin"],
    ["ADMIN", "WRITE", "Admin Edit"],
    ["ADMIN", "READ_ONLY", "Admin Read-Only"],
  ])("%s / %s hiện là %s", (role, level, label) => {
    expect(adminLevelLabel(role, level)).toBe(label)
  })

  it("chỉ ADMIN READ_ONLY bị coi là chỉ xem", () => {
    expect(isReadOnlyAdmin("ADMIN", "READ_ONLY")).toBe(true)
    expect(isReadOnlyAdmin("ADMIN", "WRITE")).toBe(false)
    expect(isReadOnlyAdmin("OWNER", null)).toBe(false)
  })
})

describe("menu theo quyền thật của phiên", () => {
  it("OWNER thấy cả 8 mục", () => {
    expect(visibleAdminPages(can(permissionsOf("OWNER")))).toHaveLength(8)
  })

  it("ADMIN không thấy Cấu hình vì venue.configure chỉ cấp cho OWNER", () => {
    const labels = visibleAdminPages(can(permissionsOf("ADMIN"))).map((page) => page.label)
    expect(labels).not.toContain("Cấu hình")
    expect(labels).toContain("Tài khoản")
    expect(labels).toContain("Nhật ký")
  })

  it("ADMIN READ_ONLY vẫn thấy các mục chỉ cần quyền đọc", () => {
    const labels = visibleAdminPages(can(READ_PERMISSIONS)).map((page) => page.label)
    expect(labels).toEqual(["Tổng quan", "Báo cáo", "Đối soát", "Khách hàng", "Sổ lượt", "Tài khoản", "Nhật ký"])
  })

  it("thiếu quyền thì gõ thẳng URL cũng không xem được", () => {
    const audit = ADMIN_PAGES.find((page) => page.path === "audit")!
    const settings = ADMIN_PAGES.find((page) => page.path === "settings")!
    const noPermissions = can([])
    expect(canReadAdminPage(audit, noPermissions)).toBe(false)
    expect(canReadAdminPage(settings, can(permissionsOf("ADMIN")))).toBe(false)
    // Trang không khai permission chỉ cần qua được cửa /admin.
    expect(canReadAdminPage(ADMIN_PAGES[0], noPermissions)).toBe(true)
  })
})

describe("ngày kinh doanh trên header", () => {
  // Giờ quán là UTC+7; Date dưới đây viết theo UTC để test không phụ thuộc máy.
  const at = (iso: string) => new Date(iso)

  it("23:00 ngày 12/11 vẫn là ngày kinh doanh 12/11", () => {
    expect(adminBusinessDateLabel(at("2026-11-12T16:00:00Z"))).toBe("T5 · 12/11/2026")
  })

  it("02:00 rạng sáng 13/11 vẫn là ngày kinh doanh 12/11", () => {
    // Đây là chỗ ngày lịch đơn thuần sẽ sai: nó đã nhảy sang 13/11 lúc 00:00.
    expect(adminBusinessDateLabel(at("2026-11-12T19:00:00Z"))).toBe("T5 · 12/11/2026")
  })

  it("sau mốc cắt 05:00 mới sang ngày kinh doanh mới", () => {
    expect(adminBusinessDateLabel(at("2026-11-12T22:30:00Z"))).toBe("T6 · 13/11/2026")
  })

  it("định dạng đúng kiểu Figma, có năm", () => {
    expect(fmtAdminBusinessDate("2026-11-12")).toBe("T5 · 12/11/2026")
    expect(fmtAdminBusinessDate("2027-01-03")).toBe("CN · 03/01/2027")
  })
})

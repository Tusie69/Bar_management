/**
 * TU-39 — Luật vào cửa của Trang Quản trị, viết thành hàm thuần để test được.
 *
 * Ở đây KHÔNG có hệ xác thực thứ hai. Mọi dữ liệu đầu vào đều lấy từ phiên
 * đăng nhập đã có (TU-32/TU-33): role của phiên, cổng đã đăng nhập, access
 * level của ADMIN và danh sách permission do backend trả về. UI chỉ ẩn/hiện
 * cho gọn mắt; API vẫn là nơi thực thi quyền.
 */
import type { Permission } from "@/domain/access"
import type { AuthPortal } from "@/domain/auth-portal"
import type { RoleCode } from "@/domain/enums"
import { ADMIN_PAGES, type AdminPage } from "./admin-pages"

export type AdminAccessLevel = "WRITE" | "READ_ONLY" | null

/** Hai vai trò duy nhất được vào `/admin`, khớp `PORTAL_CONFIG.admin.roles`. */
export const ADMIN_ROLES: readonly RoleCode[] = ["OWNER", "ADMIN"]

export type AdminEntry = "allowed" | "forbidden"

/**
 * Lễ tân, Thu ngân, Phục vụ không vào được Admin dù gõ thẳng URL.
 *
 * `portal` chỉ được kiểm khi phiên có cổng (chế độ HTTP). Chế độ mock của
 * prototype không có cổng, và chặn theo cổng ở đó sẽ khoá luôn bản demo.
 */
export function canEnterAdmin(role: RoleCode, portal: AuthPortal | null): boolean {
  if (!ADMIN_ROLES.includes(role)) return false
  return portal === null || portal === "admin"
}

/**
 * Nhãn cấp tài khoản hiện ở chân sidebar. Ba cấp trong biên bản là ba mức
 * QUYỀN trên cùng một cổng, không phải ba cổng khác nhau.
 */
export function adminLevelLabel(role: RoleCode, accessLevel: AdminAccessLevel): string {
  if (role === "OWNER") return "SuperAdmin"
  if (role !== "ADMIN") return "Không thuộc quản trị"
  return accessLevel === "READ_ONLY" ? "Admin Read-Only" : "Admin Edit"
}

/** ADMIN READ_ONLY xem được, nhưng không được gọi mutation. */
export function isReadOnlyAdmin(role: RoleCode, accessLevel: AdminAccessLevel): boolean {
  return role === "ADMIN" && accessLevel === "READ_ONLY"
}

export type PermissionCheck = (permission: Permission) => boolean

/** Trang không khai permission thì chỉ cần qua được cửa `/admin`. */
export function canReadAdminPage(page: AdminPage, can: PermissionCheck): boolean {
  return page.permission === undefined || can(page.permission)
}

/** Các mục sidebar mà phiên hiện tại được thấy. Thứ tự giữ nguyên registry. */
export function visibleAdminPages(can: PermissionCheck): AdminPage[] {
  return ADMIN_PAGES.filter((page) => canReadAdminPage(page, can))
}

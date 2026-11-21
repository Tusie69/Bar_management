export const AUTH_PORTALS = ["admin", "receptionist", "customer-care", "cashier", "waiter", "preparation"] as const

export type AuthPortal = (typeof AUTH_PORTALS)[number]

export type PortalRole = "OWNER" | "ADMIN" | "RECEPTIONIST" | "CUSTOMER_CARE" | "CASHIER" | "WAITER" | "BAR" | "KITCHEN"

export const DEFAULT_AUTH_PORTAL: AuthPortal = "receptionist"

/**
 * TU-32: URL công bố cho nhân viên là tiếng Việt, nhưng mã portal gửi lên API
 * và lưu trong `auth_sessions.portal` vẫn là tiếng Anh.
 *
 * Tách hai lớp này ra vì chúng thay đổi vì hai lý do khác nhau. URL là thứ dán
 * lên máy lễ tân và gõ bằng tay, nên nó theo ngôn ngữ người dùng. Giá trị
 * portal là dữ liệu đã nằm trong database dưới một CHECK constraint: đổi nó
 * nghĩa là mọi session đang mở không còn khớp constraint và toàn bộ nhân viên
 * bị đẩy ra khỏi hệ thống giữa ca.
 */
export const PORTAL_SLUGS: Readonly<Record<AuthPortal, string>> = {
  admin: "admin",
  receptionist: "letan",
  cashier: "thungan",
  waiter: "phucvu",
  preparation: "chebien",
  // Biên bản 15/11 không nhắc tới cổng chăm sóc khách hàng, nên nó giữ URL cũ
  // thay vì được đặt một tên tiếng Việt chưa ai chốt.
  "customer-care": "customer-care",
}

/**
 * URL cũ vẫn phải mở được: chúng đang nằm trong bookmark và trong tài liệu
 * hướng dẫn đã phát cho nhân viên. Alias chỉ ảnh hưởng tới việc chọn đúng
 * trang đăng nhập; backend vẫn kiểm portal-role mapping như cũ, nên một URL cũ
 * không cấp thêm quyền gì.
 */
const PORTAL_ALIASES: Readonly<Record<string, AuthPortal>> = {
  admin: "admin",
  letan: "receptionist",
  receptionist: "receptionist",
  thungan: "cashier",
  cashier: "cashier",
  phucvu: "waiter",
  waiter: "waiter",
  chebien: "preparation",
  preparation: "preparation",
  "customer-care": "customer-care",
}

const UNAVAILABLE_PORTALS: Readonly<Record<string, string>> = {
  "super-admin": "SuperAdmin",
  "admin-read-only": "Admin chỉ xem",
  bar: "Quầy bar",
  warehouse: "Kho",
}

export const PORTAL_CONFIG: Record<AuthPortal, { label: string; roles: readonly PortalRole[]; home: string }> = {
  // Một cổng /admin dùng chung cho ba cấp quản trị. Biên bản mô tả ba cấp
  // khác nhau về QUYỀN, không về cổng vào: SuperAdmin, Admin Edit và Admin
  // Read-Only cùng đăng nhập ở đây rồi backend phân quyền theo role và
  // access_level. Tách thành ba URL sẽ gợi ý rằng cổng quyết định quyền, mà
  // cổng thì người dùng tự gõ được.
  // TU-39: cổng quản trị có khung riêng ở /admin. Giá trị này phải khớp
  // ADMIN_HOME_PATH trong features/admin/admin-pages.ts (có test ràng buộc).
  admin: { label: "Quản trị", roles: ["OWNER", "ADMIN"], home: "/admin/overview" },
  receptionist: { label: "Lễ tân", roles: ["RECEPTIONIST"], home: "/floor" },
  "customer-care": { label: "Chăm sóc khách hàng", roles: ["CUSTOMER_CARE"], home: "/waitlist" },
  cashier: { label: "Thu ngân", roles: ["CASHIER"], home: "/floor" },
  // Module Phục vụ 1: Phục vụ có khu vực riêng ở /phucvu và KHÔNG dùng màn
  // Điều phối của Lễ tân. Giá trị này phải khớp WAITER_HOME_PATH trong
  // features/waiter/waiter-access.ts (có test ràng buộc).
  // L9: BAR cũng vào được cổng này (câu trả lời Q1 — Bartender lên đơn cho
  // khách gọi ở quầy). Phải khớp PORTAL_ROLE_CODES.waiter ở api/src/auth/
  // auth-portal.ts và WAITER_ROLES ở features/waiter/waiter-access.ts.
  waiter: { label: "Phục vụ", roles: ["WAITER", "BAR"], home: "/phucvu" },
  preparation: { label: "Chế biến", roles: ["BAR", "KITCHEN"], home: "/chebien" },
}

export function isAuthPortal(value: unknown): value is AuthPortal {
  return typeof value === "string" && (AUTH_PORTALS as readonly string[]).includes(value)
}

/** URL chuẩn của một cổng. Dùng cho mọi link và redirect do app tự sinh. */
export function portalLoginPath(portal: AuthPortal): string {
  return `/${PORTAL_SLUGS[portal]}/login`
}

function slugFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "login") return parts[1] ?? null
  if (parts[1] === "login" || parts.length === 1) return parts[0] ?? null
  // TU-39: một cổng có thể có nhiều trang dưới tiền tố của nó (/admin/audit).
  // Deep link vào trang con khi chưa đăng nhập phải ra form đăng nhập ĐÚNG
  // cổng đó; nếu không, người dùng rơi về form lễ tân và tưởng mình gõ sai URL.
  if (parts[0] && PORTAL_ALIASES[parts[0]]) return parts[0]
  return null
}

export function portalFromPath(pathname: string): AuthPortal | null {
  const slug = slugFromPath(pathname)
  return slug ? (PORTAL_ALIASES[slug] ?? null) : null
}

export function resolvePortalLoginDestination(
  portal: AuthPortal,
  currentPath?: string,
  explicitRedirect?: string | null,
): string {
  const defaultHome = PORTAL_CONFIG[portal].home
  if (portal !== "admin") return defaultHome
  const candidate = explicitRedirect ?? currentPath ?? ""
  if (!candidate.startsWith("/admin/")) return defaultHome
  const [pathnameOnly] = candidate.split(/[?#]/)
  if (
    pathnameOnly === "/admin" ||
    pathnameOnly === "/admin/" ||
    pathnameOnly === "/admin/login" ||
    pathnameOnly === "/admin/login/"
  ) {
    return defaultHome
  }
  return candidate
}

/**
 * Cổng đã có URL nhưng chưa có vai trò trong hệ thống. Trả về nhãn để hiện
 * trang "đang xây dựng" thay vì ném người dùng về cổng lễ tân, vì gõ /warehouse
 * rồi thấy form đăng nhập lễ tân là một cách hiểu sai rất dễ xảy ra.
 */
export function unavailablePortalFromPath(pathname: string): string | null {
  const slug = slugFromPath(pathname)
  if (!slug) return null
  if (PORTAL_ALIASES[slug]) return null
  return UNAVAILABLE_PORTALS[slug] ?? null
}

/** Cổng chuẩn tắc của một URL alias, để redirect về URL công bố. */
export function canonicalPortalPath(pathname: string): string | null {
  const portal = portalFromPath(pathname)
  if (!portal) return null
  const canonical = portalLoginPath(portal)
  if (pathname === canonical) return null
  // NA-32: URL đã dùng đúng slug công bố của cổng (ví dụ `/admin/turns`) thì không
  // phải alias, và đẩy nó về `/admin/login` sẽ làm mất deep link mà
  // `resolvePortalLoginDestination` cần để quay lại sau khi đăng nhập.
  if (pathname.startsWith(`/${PORTAL_SLUGS[portal]}/`)) return null
  return canonical
}

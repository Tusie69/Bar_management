export const AUTH_PORTALS = ["admin", "receptionist", "customer-care", "cashier"] as const

export type AuthPortal = (typeof AUTH_PORTALS)[number]

export const DEFAULT_AUTH_PORTAL: AuthPortal = "receptionist"

const UNAVAILABLE_PORTALS: Readonly<Record<string, string>> = {
  "super-admin": "SuperAdmin",
  "admin-read-only": "Admin chỉ xem",
  service: "Phục vụ",
  waiter: "Phục vụ",
  bar: "Quầy bar",
  warehouse: "Kho",
}

export const PORTAL_CONFIG: Record<
  AuthPortal,
  { label: string; roles: readonly ("OWNER" | "ADMIN" | "RECEPTIONIST" | "CUSTOMER_CARE" | "CASHIER")[]; home: string }
> = {
  admin: { label: "Quản trị", roles: ["OWNER", "ADMIN"], home: "/admin/overview" },
  receptionist: { label: "Lễ tân", roles: ["RECEPTIONIST"], home: "/floor" },
  "customer-care": { label: "Chăm sóc khách hàng", roles: ["CUSTOMER_CARE"], home: "/waitlist" },
  cashier: { label: "Thu ngân", roles: ["CASHIER"], home: "/floor" },
}

export function isAuthPortal(value: unknown): value is AuthPortal {
  return typeof value === "string" && (AUTH_PORTALS as readonly string[]).includes(value)
}

export function portalLoginPath(portal: AuthPortal): string {
  return `/${portal}/login`
}

export function portalFromPath(pathname: string): AuthPortal | null {
  const parts = pathname.split("/").filter(Boolean)
  if (parts[0] === "admin") return "admin"
  const candidate = parts[0] === "login" ? parts[1] : parts[1] === "login" || parts.length === 1 ? parts[0] : null
  return isAuthPortal(candidate) ? candidate : null
}

export function resolvePortalLoginDestination(
  portal: AuthPortal,
  currentPath?: string,
  explicitRedirect?: string | null,
): string {
  const defaultHome = PORTAL_CONFIG[portal].home
  if (portal !== "admin") return defaultHome
  const candidate = explicitRedirect ?? currentPath ?? ""
  if (!candidate.startsWith("/admin") || candidate.startsWith("//")) return defaultHome
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

export function unavailablePortalFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean)
  const candidate = parts[0] === "login" ? parts[1] : parts[1] === "login" || parts.length === 1 ? parts[0] : null
  return candidate ? (UNAVAILABLE_PORTALS[candidate] ?? null) : null
}

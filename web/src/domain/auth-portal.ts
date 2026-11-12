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
  { label: string; role: "OWNER_ADMIN" | "RECEPTIONIST" | "CUSTOMER_CARE" | "CASHIER"; home: string }
> = {
  admin: { label: "Quản trị", role: "OWNER_ADMIN", home: "/overview" },
  receptionist: { label: "Lễ tân", role: "RECEPTIONIST", home: "/floor" },
  "customer-care": { label: "Chăm sóc khách hàng", role: "CUSTOMER_CARE", home: "/waitlist" },
  cashier: { label: "Thu ngân", role: "CASHIER", home: "/floor" },
}

export function isAuthPortal(value: unknown): value is AuthPortal {
  return typeof value === "string" && (AUTH_PORTALS as readonly string[]).includes(value)
}

export function portalLoginPath(portal: AuthPortal): string {
  return `/${portal}/login`
}

export function portalFromPath(pathname: string): AuthPortal | null {
  const parts = pathname.split("/").filter(Boolean)
  const candidate = parts[0] === "login" ? parts[1] : parts[1] === "login" || parts.length === 1 ? parts[0] : null
  return isAuthPortal(candidate) ? candidate : null
}

export function unavailablePortalFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean)
  const candidate = parts[0] === "login" ? parts[1] : parts[1] === "login" || parts.length === 1 ? parts[0] : null
  return candidate ? (UNAVAILABLE_PORTALS[candidate] ?? null) : null
}

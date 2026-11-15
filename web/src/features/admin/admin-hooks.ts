import type { Permission } from "@/domain/access"
import { api } from "@/services"
import { useCan, useSession } from "@/state/session"
import { getAdminRoleLabel } from "./admin-config"

/**
 * Checks a permission using the existing `useCan` hook while also honoring
 * server-populated `state.permissions` whenever `state.principal` is present
 * (including unit tests that simulate HTTP sessions).
 */
export function useAdminCan(permission: Permission): boolean {
  const canFromHook = useCan(permission)
  const hasPrincipal = useSession((state) => state.principal !== null)
  const hasServerPermission = useSession((state) => state.permissions.includes(permission))
  if (api.mode === "http" || hasPrincipal) {
    return hasServerPermission
  }
  return canFromHook
}

/**
 * Resolves the current admin user's display role label from the centralized map:
 * OWNER -> "SuperAdmin"
 * ADMIN (WRITE) -> "Admin"
 * ADMIN (READ_ONLY) -> "Chỉ xem"
 */
export function useAdminRoleLabel(): string {
  const role = useSession((state) => state.user.role)
  const accessLevel = useSession((state) => state.principal?.accessLevel ?? null)
  return getAdminRoleLabel(role, accessLevel)
}

export function useIsReadOnlyAdmin(): boolean {
  const role = useSession((state) => state.user.role)
  const accessLevel = useSession((state) => state.principal?.accessLevel ?? null)
  const canManageUsers = useAdminCan("user.manage")
  const canConfigureVenue = useAdminCan("venue.configure")
  if (role === "OWNER") return false
  if (accessLevel === "READ_ONLY") return true
  if (accessLevel === "WRITE") return false
  return !canManageUsers && !canConfigureVenue
}

import { api, isApiError } from "@/services"
import { useCan, useSession } from "@/state/session"

/**
 * Checks `report.read` using both local role mapping (mock/dev fallback) and
 * server-granted permissions whenever HTTP mode or an authenticated principal is active.
 */
export function useCanReadShiftOverview(): boolean {
  const canFromRole = useCan("report.read")
  const hasPrincipal = useSession((state) => state.principal !== null)
  const hasServerPermission = useSession((state) => state.permissions.includes("report.read"))
  if (api.mode === "http" || hasPrincipal) {
    return hasServerPermission
  }
  return canFromRole
}

export function isForbiddenError(error: unknown): boolean {
  return isApiError(error) && (error.status === 403 || error.code === "PERMISSION_DENIED" || error.code === "FORBIDDEN")
}

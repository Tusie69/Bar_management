/**
 * TU-39 — Cầu nối giữa phiên đăng nhập hiện có và khung Admin.
 *
 * Không có store mới. Chế độ HTTP đọc permission do backend trả về; chế độ
 * mock của prototype suy ra từ ma trận role để bản demo vẫn chạy. Mọi quyết
 * định ẩn/hiện trong Admin đi qua đúng một chỗ này.
 */
import { useMemo } from "react"
import type { Permission } from "@/domain/access"
import { roleCan } from "@/domain/access"
import { api } from "@/services"
import { useSession } from "@/state/session"
import { adminLevelLabel, canEnterAdmin, isReadOnlyAdmin, type PermissionCheck } from "./admin-access"

export interface AdminSession {
  can: PermissionCheck
  /** Tên người đăng nhập thật, không hardcode. */
  displayName: string
  /** SuperAdmin / Admin Edit / Admin Read-Only. */
  levelLabel: string
  /** Vào được `/admin` hay không. */
  allowed: boolean
  /** Đang chờ bootstrap phiên: chưa được kết luận là thiếu quyền. */
  loading: boolean
  readOnly: boolean
}

export function useAdminSession(): AdminSession {
  const role = useSession((state) => state.user.role)
  const portal = useSession((state) => state.portal)
  const principal = useSession((state) => state.principal)
  const permissions = useSession((state) => state.permissions)
  const authStatus = useSession((state) => state.authStatus)
  const mockDisplayName = useSession((state) => state.user.displayName)

  const http = api.mode === "http"
  const accessLevel = principal?.accessLevel ?? null

  const can = useMemo<PermissionCheck>(
    () =>
      http
        ? (permission: Permission) => permissions.includes(permission)
        : (permission: Permission) => roleCan(role, permission),
    [http, permissions, role],
  )

  return {
    can,
    displayName: http ? (principal?.displayName ?? "Đã đăng nhập") : mockDisplayName,
    levelLabel: adminLevelLabel(role, accessLevel),
    allowed: canEnterAdmin(role, portal),
    loading: http && authStatus === "loading",
    readOnly: isReadOnlyAdmin(role, accessLevel),
  }
}

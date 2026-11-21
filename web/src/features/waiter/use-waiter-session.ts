/**
 * Module Phục vụ 1 — cầu nối giữa phiên đăng nhập hiện có và khung Phục vụ.
 *
 * Không có store mới và không có hệ xác thực thứ hai. Chế độ HTTP đọc
 * permission do backend trả về; chế độ mock của prototype suy ra từ ma trận
 * role để bản demo vẫn chạy. Mọi quyết định ẩn/hiện trong `/phucvu` đi qua
 * đúng một chỗ này — cùng quy ước mà `useAdminSession` đang dùng.
 */
import { useMemo } from "react"
import { roleCan, type Permission } from "@/domain/access"
import { api } from "@/services"
import { useSession } from "@/state/session"
import {
  canEnterWaiter,
  WAITER_ORDER_PERMISSION,
  WAITER_READ_PERMISSION,
  WAITER_REARRANGE_PERMISSIONS,
} from "./waiter-access"

export interface WaiterSession {
  can: (permission: Permission) => boolean
  /** Tên nhân viên đang đăng nhập, lấy từ phiên thật. */
  displayName: string
  /** Vào được `/phucvu` hay không. */
  allowed: boolean
  /** Đang chờ bootstrap phiên: chưa được kết luận là thiếu quyền. */
  loading: boolean
  canReadOrders: boolean
  canCreateOrders: boolean
  /** Đủ quyền cho ÍT NHẤT một trong ba thao tác đổi / ghép / tách. */
  canRearrange: boolean
  canMove: boolean
  canCombine: boolean
  canSplit: boolean
}

export function useWaiterSession(): WaiterSession {
  const role = useSession((state) => state.user.role)
  const portal = useSession((state) => state.portal)
  const principal = useSession((state) => state.principal)
  const permissions = useSession((state) => state.permissions)
  const authStatus = useSession((state) => state.authStatus)
  const mockDisplayName = useSession((state) => state.user.displayName)

  const http = api.mode === "http"
  const can = useMemo(
    () =>
      http
        ? (permission: Permission) => permissions.includes(permission)
        : (permission: Permission) => roleCan(role, permission),
    [http, permissions, role],
  )

  return {
    can,
    displayName: http ? (principal?.displayName ?? "Đã đăng nhập") : mockDisplayName,
    allowed: canEnterWaiter(role, portal),
    loading: http && authStatus === "loading",
    canReadOrders: can(WAITER_READ_PERMISSION),
    canCreateOrders: can(WAITER_ORDER_PERMISSION),
    canRearrange: WAITER_REARRANGE_PERMISSIONS.some(can),
    canMove: can("visit.move"),
    canCombine: can("visit.combine"),
    canSplit: can("visit.split"),
  }
}

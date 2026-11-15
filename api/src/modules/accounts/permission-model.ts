/**
 * TU-34 — Mô hình quyền riêng từng tài khoản, viết thuần để test không cần DB.
 *
 *   effective = base_role_permissions ∩ enabled_user_permissions
 *
 * Override chỉ TẮT bớt, không bao giờ cấp thêm. Trần quyền vẫn là vai trò cộng
 * access level, đúng như `role_permissions` và bộ lọc READ_ONLY trong
 * `auth.service.listPermissions`. Nếu override cấp thêm được thì một lần bấm
 * nhầm checkbox sẽ cho Lễ tân quyền thu tiền, và không ai còn đọc được "vai
 * trò này làm được gì" nếu không mở từng tài khoản ra xem.
 */
import { AppError } from '../../errors/app-error.js'

export type TargetKind = 'OWNER' | 'ADMIN' | 'STAFF' | 'UNKNOWN'
export type ActorRole = 'OWNER' | 'ADMIN'

/**
 * Quyền không bao giờ được tắt bằng override.
 *
 * `user.read` là cửa duy nhất để nhìn thấy màn tài khoản. Tắt nó cho một ADMIN
 * WRITE nghĩa là người đó không còn tự sửa lại được gì, và chỉ OWNER cứu được.
 * OWNER thì đã được chặn ở tầng mục tiêu, nên hệ thống không bao giờ mất sạch
 * người quản trị — nhưng chặn ở đây cho rẻ hơn một đêm gọi điện.
 */
export const PROTECTED_PERMISSIONS: ReadonlySet<string> = new Set(['user.read'])

export interface PermissionView {
  code: string
  /** Vai trò có cho phép quyền này không (trần cứng). */
  grantedByRole: boolean
  /** Checkbox đang bật hay tắt. Quyền ngoài trần luôn tắt và không sửa được. */
  enabled: boolean
  /** Có hàng override riêng cho tài khoản này. */
  overridden: boolean
  /** UI có được phép đổi checkbox này không. */
  editable: boolean
}

/** Giao điểm: chỉ giữ quyền vừa nằm trong trần vai trò, vừa chưa bị tắt. */
export function effectivePermissions(
  basePermissions: readonly string[],
  overrides: ReadonlyMap<string, boolean>,
): string[] {
  return basePermissions.filter((code) => overrides.get(code) !== false).sort()
}

/** Dựng danh sách checkbox cho một tài khoản. */
export function permissionViews(
  allPermissions: readonly string[],
  basePermissions: readonly string[],
  overrides: ReadonlyMap<string, boolean>,
): PermissionView[] {
  const base = new Set(basePermissions)
  return [...allPermissions].sort().map((code) => {
    const grantedByRole = base.has(code)
    return {
      code,
      grantedByRole,
      enabled: grantedByRole && overrides.get(code) !== false,
      overridden: overrides.has(code),
      editable: grantedByRole && !PROTECTED_PERMISSIONS.has(code),
    }
  })
}

/**
 * Ai được sửa quyền của ai.
 *
 * Trùng tinh thần với `assertTargetAllowed` của account.repository, nhưng chặt
 * hơn một bậc cho riêng việc đổi quyền: chỉ SuperAdmin (OWNER) được chạm vào
 * tài khoản ADMIN, theo đúng dòng chữ trên prototype.
 */
export function assertCanEditPermissions(
  actorUserId: number,
  actorRole: ActorRole,
  actorAccessLevel: 'WRITE' | 'READ_ONLY' | null,
  target: { id: number; kind: TargetKind },
): void {
  if (actorRole === 'ADMIN' && actorAccessLevel !== 'WRITE') {
    throw new AppError(403, 'READ_ONLY_ACCOUNT', 'Tài khoản chỉ có quyền xem, không thể thực hiện thay đổi.')
  }
  if (target.id === actorUserId) {
    throw new AppError(409, 'CANNOT_MANAGE_SELF', 'Không thể tự thay đổi quyền của chính mình.')
  }
  if (target.kind === 'OWNER') {
    throw new AppError(403, 'OWNER_PROTECTED', 'Không được phép đổi quyền của tài khoản SuperAdmin.')
  }
  if (target.kind === 'ADMIN' && actorRole !== 'OWNER') {
    throw new AppError(403, 'ADMIN_TARGET_DENIED', 'Chỉ SuperAdmin được đổi quyền của tài khoản Admin khác.')
  }
  if (target.kind === 'UNKNOWN') {
    throw new AppError(403, 'TARGET_ROLE_DENIED', 'Vai trò mục tiêu không thuộc phạm vi quản lý.')
  }
}

export interface OverrideChange {
  code: string
  from: boolean
  to: boolean
}

/**
 * Lọc yêu cầu của client xuống những thay đổi hợp lệ.
 *
 * Quyền ngoài trần vai trò bị từ chối thẳng (400) chứ không âm thầm bỏ qua:
 * một UI gửi lên quyền không thuộc vai trò là UI đang hiểu sai mô hình, và im
 * lặng ở đây sẽ biến nó thành lỗi "đã lưu mà không có tác dụng".
 */
export function planOverrideChanges(
  requested: ReadonlyMap<string, boolean>,
  basePermissions: readonly string[],
  overrides: ReadonlyMap<string, boolean>,
): OverrideChange[] {
  const base = new Set(basePermissions)
  const changes: OverrideChange[] = []
  for (const [code, enabled] of requested) {
    if (!base.has(code)) {
      throw new AppError(400, 'PERMISSION_NOT_IN_ROLE', `Quyền "${code}" không nằm trong vai trò của tài khoản này.`)
    }
    if (!enabled && PROTECTED_PERMISSIONS.has(code)) {
      throw new AppError(409, 'PERMISSION_PROTECTED', `Quyền "${code}" không thể tắt.`)
    }
    const current = overrides.get(code) !== false
    if (current !== enabled) changes.push({ code, from: current, to: enabled })
  }
  return changes
}

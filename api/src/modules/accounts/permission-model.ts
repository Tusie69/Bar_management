/**
 * TU-34/TU-32 — Mô hình quyền riêng từng tài khoản, viết thuần để test không
 * cần DB.
 *
 *   effective = (role_permissions ∪ override_bật) ∩ trần_của_tài_khoản
 *
 * SuperAdmin cấp thêm được quyền ngoài vai trò, đúng như biên bản 15/11 mô tả
 * cấp 1: "quyết định mọi cấu hình và phân quyền cho mọi vai". Nhưng "cấp thêm"
 * không có nghĩa là không còn giới hạn — ba chốt chặn ở dưới là thứ giữ cho
 * sáu cấp vẫn còn nghĩa:
 *
 *  1. `OWNER_ONLY_PERMISSIONS` không bao giờ cấp cho ai: đó là những việc định
 *     nghĩa ra cấp 1. Cấp được `venue.configure` cho Admin Edit thì câu "cấp 2
 *     KHÔNG cấu hình tính năng" trong biên bản thành vô nghĩa.
 *  2. Admin Read-Only chỉ nhận thêm quyền ĐỌC. Cấp 3 là "chỉ xem" — một
 *     override cấp quyền ghi cho nó là mâu thuẫn với chính định nghĩa của cấp.
 *  3. `PROTECTED_PERMISSIONS` không bao giờ bị tắt.
 *
 * Mọi quyền còn lại thì SuperAdmin tick là có. Đổi lại, "vai trò X làm được
 * gì" không còn đọc được từ riêng ma trận vai trò: phải đọc thêm bảng override
 * của từng tài khoản. Đó là cái giá của mô hình này, và nhật ký TU-35 ghi lại
 * từng lần tick để còn truy được ai đã cấp.
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
  /** Quyền có nằm trong trần của tài khoản không (cấp thêm được hay không). */
  grantable: boolean
}

/**
 * Việc chỉ cấp 1 được làm. Không cấp cho ai khác, kể cả khi SuperAdmin tick.
 *
 * `venue.configure` và `customer.anonymize` là ranh giới giữa cấp 1 và cấp 2
 * trong biên bản. Muốn ai đó cấu hình được quán thì nâng họ lên SuperAdmin,
 * đừng cấp lẻ từng quyền — như vậy còn đọc được ai là người chịu trách nhiệm.
 */
export const OWNER_ONLY_PERMISSIONS: ReadonlySet<string> = new Set(['venue.configure', 'customer.anonymize'])

/**
 * Trần quyền của một tài khoản: tập tối đa mà tài khoản đó có thể có sau khi
 * SuperAdmin cấp thêm.
 *
 * @param readOnlyPermissions danh sách quyền đọc dùng cho Admin Read-Only,
 *   truyền vào thay vì import để file này không phụ thuộc tầng auth.
 */
export function grantableCeiling(
  allPermissions: readonly string[],
  target: { kind: TargetKind; accessLevel: 'WRITE' | 'READ_ONLY' | null },
  readOnlyPermissions: readonly string[],
): Set<string> {
  if (target.kind === 'OWNER') return new Set(allPermissions)
  const readOnly = new Set(readOnlyPermissions)
  return new Set(
    allPermissions.filter((code) => {
      if (OWNER_ONLY_PERMISSIONS.has(code)) return false
      // Cấp 3 chỉ nhận thêm quyền đọc.
      if (target.kind === 'ADMIN' && target.accessLevel === 'READ_ONLY') return readOnly.has(code)
      return true
    }),
  )
}

/** Hợp rồi cắt theo trần: quyền hiệu dụng của một tài khoản. */
export function effectivePermissions(
  basePermissions: readonly string[],
  overrides: ReadonlyMap<string, boolean>,
  ceiling: ReadonlySet<string>,
): string[] {
  const result = new Set<string>()
  for (const code of basePermissions) {
    if (overrides.get(code) !== false) result.add(code)
  }
  for (const [code, enabled] of overrides) {
    if (enabled) result.add(code)
  }
  return [...result].filter((code) => ceiling.has(code)).sort()
}

/** Dựng danh sách checkbox cho một tài khoản. */
export function permissionViews(
  allPermissions: readonly string[],
  basePermissions: readonly string[],
  overrides: ReadonlyMap<string, boolean>,
  ceiling: ReadonlySet<string>,
): PermissionView[] {
  const base = new Set(basePermissions)
  const effective = new Set(effectivePermissions(basePermissions, overrides, ceiling))
  return [...allPermissions].sort().map((code) => ({
    code,
    grantedByRole: base.has(code),
    enabled: effective.has(code),
    overridden: overrides.has(code),
    // Trong trần thì tick được, kể cả quyền vai trò chưa có — đó chính là
    // việc "cấp thêm". Quyền được bảo vệ vẫn không tắt được.
    editable: ceiling.has(code) && !PROTECTED_PERMISSIONS.has(code),
    /** Có nằm trong trần không, để UI nói được vì sao một ô bị khóa. */
    grantable: ceiling.has(code),
  }))
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
  _actorAccessLevel: 'WRITE' | 'READ_ONLY' | null,
  target: { id: number; kind: TargetKind },
): void {
  // TU-32: phân quyền là việc của riêng SuperAdmin. Biên bản 15/11 mô tả cấp 2
  // là "dùng mọi tính năng vận hành, KHÔNG phân quyền cho người khác" — kể cả
  // với nhân viên. Dòng trên prototype ("Chỉ SuperAdmin được đổi quyền của
  // Admin khác") hẹp hơn, nhưng bảng sáu cấp mới là nguồn chuẩn.
  if (actorRole !== 'OWNER') {
    throw new AppError(403, 'PERMISSION_MANAGEMENT_DENIED', 'Chỉ SuperAdmin được đổi quyền của tài khoản khác.')
  }
  if (target.id === actorUserId) {
    throw new AppError(409, 'CANNOT_MANAGE_SELF', 'Không thể tự thay đổi quyền của chính mình.')
  }
  if (target.kind === 'OWNER') {
    throw new AppError(403, 'OWNER_PROTECTED', 'Không được phép đổi quyền của tài khoản SuperAdmin.')
  }
  if (target.kind === 'UNKNOWN') {
    throw new AppError(403, 'TARGET_ROLE_DENIED', 'Vai trò mục tiêu không thuộc phạm vi quản lý.')
  }
}

/** Xem bảng quyền cũng là chức năng phân quyền: cấp 2 và 3 không được thấy. */
export function assertCanViewPermissions(actorRole: ActorRole): void {
  if (actorRole !== 'OWNER') {
    throw new AppError(403, 'PERMISSION_MANAGEMENT_DENIED', 'Chỉ SuperAdmin xem được bảng phân quyền.')
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
  ceiling: ReadonlySet<string>,
): OverrideChange[] {
  const effective = new Set(effectivePermissions(basePermissions, overrides, ceiling))
  const changes: OverrideChange[] = []
  for (const [code, enabled] of requested) {
    if (!ceiling.has(code)) {
      throw new AppError(
        400,
        'PERMISSION_NOT_GRANTABLE',
        `Quyền "${code}" không cấp được cho tài khoản này.`,
      )
    }
    if (!enabled && PROTECTED_PERMISSIONS.has(code)) {
      throw new AppError(409, 'PERMISSION_PROTECTED', `Quyền "${code}" không thể tắt.`)
    }
    const current = effective.has(code)
    if (current !== enabled) changes.push({ code, from: current, to: enabled })
  }
  return changes
}

/**
 * TU-32: sáu cấp tài khoản, năm cổng đăng nhập.
 *
 * Giá trị portal ở đây là dữ liệu đã nằm trong `auth_sessions.portal` dưới
 * CHECK constraint `ck_auth_sessions_portal` (migration 0012, nới ở 0027). Đổi
 * một giá trị trong danh sách này mà không migrate constraint sẽ làm mọi lần
 * đăng nhập mới bị database từ chối.
 *
 * URL tiếng Việt (/letan, /thungan, /phucvu) là lớp định tuyến phía web, xem
 * `web/src/domain/auth-portal.ts`. API chỉ nhận mã portal tiếng Anh, nên một
 * URL alias không bao giờ cấp thêm quyền.
 */
export const AUTH_PORTALS = ['admin', 'receptionist', 'customer-care', 'cashier', 'waiter', 'preparation'] as const

export type AuthPortal = typeof AUTH_PORTALS[number]

/**
 * Cổng -> các role được phép đăng nhập tại cổng đó.
 *
 * Ba cấp quản trị dùng chung cổng `admin`: biên bản 15/11 phân biệt SuperAdmin,
 * Admin Edit và Admin Read-Only bằng QUYỀN chứ không bằng cổng. OWNER là
 * SuperAdmin; ADMIN mang thêm access_level WRITE (Admin Edit) hoặc READ_ONLY
 * (Admin Read-Only), và `listPermissions` lọc permission ghi theo access_level
 * đó trên từng request. Cổng do người dùng tự gõ nên không bao giờ được là
 * chốt phân quyền duy nhất.
 */
export const PORTAL_ROLE_CODES: Readonly<Record<AuthPortal, readonly string[]>> = {
  admin: ['OWNER', 'ADMIN'],
  receptionist: ['RECEPTIONIST'],
  'customer-care': ['CUSTOMER_CARE'],
  cashier: ['CASHIER'],
  // L9: Bartender lên đơn cho khách gọi ở quầy (câu trả lời Q1), nên BAR đăng
  // nhập được ở cổng Phục vụ. Nó KHÔNG phải một đường vòng: `listPermissions`
  // giao quyền với đúng các vai của cổng, nên ở đây BAR chỉ mang theo quyền của
  // chính vai BAR — sáu permission order/preparation.ready mà migration 0041
  // cấp — chứ không nhận thêm gì từ WAITER.
  waiter: ['WAITER', 'BAR'],
  preparation: ['BAR', 'KITCHEN'],
}

export function isAuthPortal(value: unknown): value is AuthPortal {
  return typeof value === 'string' && (AUTH_PORTALS as readonly string[]).includes(value)
}

export function rolesForPortal(portal: AuthPortal): readonly string[] {
  return PORTAL_ROLE_CODES[portal]
}

/**
 * Điều kiện SQL "role của membership này hợp lệ với cổng đã lưu trong session",
 * sinh từ PORTAL_ROLE_CODES.
 *
 * Trước TU-32 ánh xạ này được viết tay thành bốn dòng OR trong câu truy vấn
 * của `inspectSession`. Thêm cổng thứ năm vào bảng ở trên mà quên dòng thứ năm
 * dưới đó cho ra đúng một triệu chứng: đăng nhập thành công rồi mọi request
 * tiếp theo trả 401, vì login kiểm theo bảng còn session kiểm theo SQL. Sinh
 * câu lệnh từ bảng để hai chỗ không thể lệch nhau nữa.
 *
 * @param portalColumn tên cột portal trong câu truy vấn gọi hàm này
 */
export function portalRoleMatchSql(portalColumn: string): { sql: string; parameters: string[] } {
  const parameters: string[] = []
  const branches = AUTH_PORTALS.map((portal) => {
    const roles = PORTAL_ROLE_CODES[portal]
    parameters.push(portal, ...roles)
    return `(${portalColumn} = ? AND r.code IN (${roles.map(() => '?').join(', ')}))`
  })
  // ADMIN luôn phải có access_level hợp lệ, ở mọi cổng. Giữ điều kiện này
  // ngoài vòng OR để nó không thể bị bỏ sót khi thêm cổng mới.
  return {
    sql: `(${branches.join(' OR ')}) AND (r.code <> 'ADMIN' OR mr.access_level IN ('WRITE', 'READ_ONLY'))`,
    parameters,
  }
}

/**
 * TU-34 — Phần quyết định của màn "Tài khoản & phân quyền": lọc, tìm, đếm,
 * và cách đọc một tài khoản thành dòng trong bảng. Hàm thuần, test không cần
 * DOM.
 */
import { venueParts } from "@/lib/time"
import type { AccountSummary } from "@/services/contracts"

/**
 * Nhãn vai trò theo prototype, không phải theo `ROLE_LABEL` của Lễ tân.
 * Biên bản gọi OWNER là "SuperAdmin" và ADMIN là "Admin"; màn quản trị phải
 * dùng đúng chữ mà người ký biên bản sẽ đọc.
 */
export const ADMIN_ROLE_LABEL: Readonly<Record<string, string>> = {
  OWNER: "SuperAdmin",
  ADMIN: "Admin",
  RECEPTIONIST: "Lễ tân",
  CASHIER: "Thu ngân",
  WAITER: "Phục vụ",
  CUSTOMER_CARE: "CSKH",
}

/** Vai trò chính của một tài khoản: vai trò có quyền cao nhất. */
export function primaryRole(account: AccountSummary): string {
  const order = ["OWNER", "ADMIN", "RECEPTIONIST", "CASHIER", "WAITER", "CUSTOMER_CARE"]
  return order.find((role) => account.roles.includes(role)) ?? account.roles[0] ?? ""
}

export function roleLabel(account: AccountSummary): string {
  const role = primaryRole(account)
  return ADMIN_ROLE_LABEL[role] ?? role
}

/** Cổng đăng nhập của tài khoản, theo URL công bố cho nhân viên. */
export function portalPath(account: AccountSummary): string {
  switch (primaryRole(account)) {
    case "OWNER":
    case "ADMIN":
      return "/admin"
    case "RECEPTIONIST":
      return "/letan"
    case "CASHIER":
      return "/thungan"
    case "WAITER":
      return "/phucvu"
    case "CUSTOMER_CARE":
      return "/customer-care"
    default:
      return "—"
  }
}

export type AccountTone = "active" | "readonly" | "locked"

/**
 * Trạng thái hiện trong bảng. "Chỉ xem" là một TRẠNG THÁI trong prototype,
 * nhưng trong dữ liệu nó là access level của ADMIN — gộp ở đây để bảng đọc
 * đúng như bản vẽ mà không phát minh thêm trường trong database.
 */
export function accountState(account: AccountSummary): { label: string; tone: AccountTone } {
  if (account.status === "DISABLED") return { label: "Đã khóa", tone: "locked" }
  if (account.roles.includes("ADMIN") && account.accessLevel === "READ_ONLY") {
    return { label: "Chỉ xem", tone: "readonly" }
  }
  return { label: "Hoạt động", tone: "active" }
}

export interface AccountFilter {
  key: string
  label: string
  roles: readonly string[]
  /** Vai trò có trong prototype nhưng chưa có trong RBAC 6 cấp. */
  unsupported?: boolean
}

export const ACCOUNT_FILTERS: readonly AccountFilter[] = [
  { key: "all", label: "Tất cả", roles: [] },
  { key: "admin", label: "Admin", roles: ["OWNER", "ADMIN"] },
  { key: "receptionist", label: "Lễ tân", roles: ["RECEPTIONIST"] },
  { key: "waiter", label: "Phục vụ", roles: ["WAITER"] },
  { key: "cashier", label: "Thu ngân", roles: ["CASHIER"] },
  // Prototype có ô "Kho". RBAC sáu cấp (biên bản 15/11) không có vai trò này,
  // và TU-34 không được tự tạo vai trò hay cổng mới, nên ô này hiện ở trạng
  // thái chưa hỗ trợ thay vì bị bỏ đi — để lần rà soát sau còn thấy nó.
  { key: "warehouse", label: "Kho", roles: ["WAREHOUSE"], unsupported: true },
]

export function matchesSearch(account: AccountSummary, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase("vi-VN")
  if (!needle) return true
  return (
    account.displayName.toLocaleLowerCase("vi-VN").includes(needle) ||
    account.username.toLocaleLowerCase("vi-VN").includes(needle)
  )
}

export function filterAccounts(
  accounts: readonly AccountSummary[],
  filterKey: string,
  search: string,
): AccountSummary[] {
  const filter = ACCOUNT_FILTERS.find((item) => item.key === filterKey) ?? ACCOUNT_FILTERS[0]
  return accounts.filter(
    (account) =>
      (filter.roles.length === 0 || filter.roles.some((role) => account.roles.includes(role))) &&
      matchesSearch(account, search),
  )
}

/** Số đếm trên từng chip, tính trên toàn bộ danh sách chứ không theo ô tìm. */
export function filterCounts(accounts: readonly AccountSummary[]): Record<string, number> {
  return Object.fromEntries(
    ACCOUNT_FILTERS.map((filter) => [
      filter.key,
      filter.roles.length === 0
        ? accounts.length
        : accounts.filter((account) => filter.roles.some((role) => account.roles.includes(role))).length,
    ]),
  )
}

/**
 * Ai được bấm nút thao tác trên một dòng.
 *
 * Cùng luật với backend (`assertTargetAllowed` + `assertCanEditPermissions`),
 * chỉ để làm mờ nút cho đỡ bấm nhầm. Server vẫn là nơi quyết định.
 */
export function canActOn(actor: { userId: number; role: string; readOnly: boolean }, account: AccountSummary): boolean {
  if (actor.readOnly) return false
  if (account.id === actor.userId) return false
  if (account.roles.includes("OWNER")) return false
  if (account.roles.includes("ADMIN") && actor.role !== "OWNER") return false
  return true
}

/**
 * Giới hạn độ dài mật khẩu, phải khớp `PASSWORD_MIN` / `PASSWORD_MAX` trong
 * `api/src/modules/accounts/account.repository.ts`. Lệch nhau thì người dùng
 * gõ xong mới bị máy chủ từ chối, lúc đó không còn biết mình sai ở đâu.
 */
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 1024

/**
 * Lý do từ chối một mật khẩu tự nhập, hoặc `null` khi dùng được.
 *
 * Không kiểm độ mạnh: máy chủ cũng chỉ kiểm độ dài, và bịa thêm luật ở
 * trình duyệt sẽ chặn những chuỗi mà máy chủ chấp nhận.
 */
export function newPasswordIssue(password: string): string | null {
  if (password.length === 0) return "Chưa nhập mật khẩu."
  if (password.length < PASSWORD_MIN) return `Mật khẩu phải có ít nhất ${PASSWORD_MIN} ký tự.`
  if (password.length > PASSWORD_MAX) return `Mật khẩu không được dài quá ${PASSWORD_MAX} ký tự.`
  if (password.trim() !== password) return "Mật khẩu không được bắt đầu hoặc kết thúc bằng dấu cách."
  return null
}

/**
 * Mốc thời gian của một tài khoản (lần đăng nhập gần nhất), theo giờ quán.
 * Trả "Chưa đăng nhập lần nào" thay vì để trống, vì ô trống trong bảng đọc
 * như là dữ liệu chưa tải xong.
 */
export function fmtAccountTimestamp(iso: string | null): string {
  if (!iso) return "Chưa đăng nhập lần nào"
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "Không đọc được mốc thời gian"
  const p = venueParts(at)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(p.hour)}:${pad(p.minute)} · ${pad(p.day)}/${pad(p.month)}/${p.year}`
}

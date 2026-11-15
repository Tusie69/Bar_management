/**
 * TU-39 — Page registry của Trang Quản trị.
 *
 * Đây là NGUỒN DUY NHẤT quyết định sidebar, header và route của `/admin`.
 * Thêm một màn hình admin nghĩa là thêm một dòng ở đây rồi nối component vào
 * `admin-routes.tsx`; không ai phải sửa layout. Xem `docs/frontend.md`.
 *
 * Registry cố ý không import React hay icon: nó là dữ liệu thuần, nhờ đó test
 * chạy được mà không cần DOM, và thứ tự menu kiểm tra được bằng một assert.
 *
 * Thứ tự dưới đây là thứ tự sidebar trong prototype Figma
 * "21GAM — Prototype Trang Quản trị (Admin) v1.0" và không được đổi tuỳ tiện:
 * nhân viên đã học vị trí của từng mục.
 */
import type { Permission } from "@/domain/access"

/**
 * - `integrated`: màn đã có nội dung nghiệp vụ thật.
 * - `pending`: đã có điểm cắm, đang chờ task của người khác (NA-33, TU-34…).
 * - `phase2`: đợt 2 theo biên bản, chưa có task và chưa có dữ liệu backend.
 */
export type AdminPageStatus = "integrated" | "pending" | "phase2"

export interface AdminPage {
  /** Đường dẫn con, nối sau `/admin/`. Không có dấu `/` ở đầu. */
  readonly path: string
  /** Nhãn trong sidebar. Theo Figma, ngắn gọn. */
  readonly label: string
  /** Tiêu đề hiện ở header. Mặc định trùng `label`, dài hơn khi cần rõ nghĩa. */
  readonly title: string
  /**
   * Permission ĐỌC của trang, lấy từ `PERMISSION_MATRIX` thật của backend.
   * `undefined` = không có permission đọc riêng; trang chỉ cần quyền vào
   * `/admin`. Không tự bịa permission mới cho màn chưa có endpoint.
   */
  readonly permission?: Permission
  readonly status: AdminPageStatus
  /** Mã task sở hữu nội dung nghiệp vụ, hiện trên trang placeholder. */
  readonly owner?: string
  /** Câu mô tả ngắn cho trang placeholder, để người dùng biết sẽ có gì. */
  readonly note?: string
}

export const ADMIN_BASE_PATH = "/admin"

export const ADMIN_PAGES: readonly AdminPage[] = [
  {
    path: "overview",
    label: "Tổng quan",
    title: "Tổng quan",
    // Chưa có permission đọc riêng cho bảng điều hành ca: `report.read` là báo
    // cáo kinh doanh, không phải tình trạng bàn. Trang này do đó chỉ chặn ở
    // cửa `/admin`. Xem mục "Điểm còn thiếu" trong docs/frontend.md.
    status: "pending",
    owner: "NA-33",
    note: "Chỉ số ca, sơ đồ bàn chỉ xem, cảnh báo điều hành và tỷ lệ lấp bàn theo khu.",
  },
  {
    path: "reports",
    label: "Báo cáo",
    title: "Báo cáo kinh doanh",
    permission: "report.read",
    status: "phase2",
    note: "Doanh thu, bill trung bình, vòng quay bàn và chất lượng từng nguồn đặt.",
  },
  {
    path: "reconciliation",
    label: "Đối soát",
    title: "Đối soát cuối ngày",
    permission: "report.read",
    status: "phase2",
    note: "Đối chiếu tiền mặt, chuyển khoản, công nợ và duyệt giảm giá cuối ca.",
  },
  {
    path: "customers",
    label: "Khách hàng",
    title: "Khách hàng",
    permission: "customer.view_masked",
    status: "phase2",
    note: "Danh sách khách, hồ sơ chi tiêu và nhãn VIP / khách quen / nguy cơ mất khách.",
  },
  {
    path: "visits",
    label: "Sổ lượt",
    title: "Sổ lượt tới quán",
    permission: "customer.view_masked",
    status: "pending",
    owner: "NA-34",
    note: "Mọi lượt khách ngồi bàn, gán lượt khuyết danh và gợi ý gộp hồ sơ trùng.",
  },
  {
    path: "accounts",
    label: "Tài khoản",
    title: "Tài khoản & phân quyền",
    permission: "user.read",
    status: "pending",
    owner: "TU-34",
    note: "Danh sách tài khoản theo cổng đăng nhập, tạo tài khoản và đổi cấp truy cập.",
  },
  {
    path: "settings",
    label: "Cấu hình",
    title: "Cấu hình vận hành",
    // `venue.configure` hiện chỉ cấp cho OWNER, nên Admin không thấy mục này.
    // Đó là RBAC thật của backend, không phải thiếu sót của TU-39.
    permission: "venue.configure",
    status: "phase2",
    note: "Mốc giờ giữ bàn, khung nhận đặt, danh mục nguồn và mẫu text Zalo.",
  },
  {
    path: "audit",
    label: "Nhật ký",
    title: "Nhật ký thao tác",
    permission: "audit.read",
    status: "pending",
    owner: "TU-35",
    note: "Lưu vết thao tác nhạy cảm: hủy booking, xem SĐT đầy đủ, giảm giá, đổi quyền.",
  },
]

/** Màn mặc định khi mở `/admin`. Luôn là mục đầu tiên của sidebar. */
export const ADMIN_HOME_PATH = `${ADMIN_BASE_PATH}/${ADMIN_PAGES[0].path}`

export function adminPagePath(page: AdminPage): string {
  return `${ADMIN_BASE_PATH}/${page.path}`
}

/**
 * Trang ứng với một URL. Khớp cả URL con (`/admin/accounts/12`) để màn chi
 * tiết của Nam vẫn giữ đúng mục sidebar đang sáng và đúng tiêu đề header.
 */
export function adminPageForPath(pathname: string): AdminPage | undefined {
  const normalized = pathname.replace(/\/+$/, "")
  return ADMIN_PAGES.find((page) => {
    const full = adminPagePath(page)
    return normalized === full || normalized.startsWith(`${full}/`)
  })
}

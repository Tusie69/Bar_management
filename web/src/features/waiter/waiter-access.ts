/**
 * Module Phục vụ 1 — luật vào cửa và luật hành động của khu vực `/phucvu`,
 * viết thành dữ liệu và hàm thuần để test được mà không cần DOM.
 *
 * Ở đây KHÔNG có hệ xác thực thứ hai: mọi đầu vào lấy từ phiên đăng nhập đã có
 * (TU-32/TU-33) và từ phép chiếu sơ đồ mà máy chủ trả về. UI chỉ ẩn/hiện cho
 * gọn tay; API vẫn là nơi thực thi quyền, và dữ liệu khách thì không bao giờ
 * tới được trình duyệt của Phục vụ.
 */
import type { Permission } from "@/domain/access"
import type { AuthPortal } from "@/domain/auth-portal"
import type { RoleCode } from "@/domain/enums"
import type { ClaimView, FloorTableState, TableLiveState } from "@/domain/models"

/** URL công bố của khu vực Phục vụ. Phải khớp `PORTAL_CONFIG.waiter.home`. */
export const WAITER_BASE_PATH = "/phucvu"
export const WAITER_HOME_PATH = WAITER_BASE_PATH

/**
 * URL cũ bằng tiếng Anh. Nó chỉ chuyển hướng; nó KHÔNG cấp thêm quyền nào —
 * cửa vào vẫn là `canEnterWaiter`, và backend vẫn kiểm permission trên từng
 * endpoint bất kể người dùng gõ URL nào.
 */
export const WAITER_LEGACY_BASE_PATH = "/waiter"

/**
 * Route giàn giáo của module gọi món (Module 2).
 *
 * Module 1 cố ý KHÔNG tạo dữ liệu đơn, không lưu đơn hay giá vào localStorage
 * và không giả lập rằng đơn đã gửi thành công. Hai đường dẫn này dẫn tới một
 * empty state nói rõ module chưa có, chứ không tới một giỏ hàng trống trông
 * như đã dùng được.
 */
export const WAITER_ORDER_PATH = "phien/:visitId/goi-mon"
export const WAITER_ORDERS_VIEW_PATH = "orders"

export function waiterOrderPath(visitId: number): string {
  return `${WAITER_BASE_PATH}/phien/${visitId}/goi-mon`
}

export function waiterOrdersViewPath(visitId: number): string {
  return `${WAITER_BASE_PATH}/${WAITER_ORDERS_VIEW_PATH}/${visitId}`
}

/** Vai duy nhất vào được `/phucvu`, khớp `PORTAL_CONFIG.waiter.roles`. */
export const WAITER_ROLES: readonly RoleCode[] = ["WAITER"]

/**
 * Hai permission mà mọi màn của Phục vụ dựa vào. `order.read` để đọc sơ đồ và
 * đơn; `order.create` để gọi món (module sau).
 */
export const WAITER_READ_PERMISSION: Permission = "order.read"
export const WAITER_ORDER_PERMISSION: Permission = "order.create"

/** Ba permission dọn chỗ cho khách đang ngồi. */
export const WAITER_REARRANGE_PERMISSIONS: readonly Permission[] = ["visit.move", "visit.combine", "visit.split"]

/**
 * Những khu vực mà Phục vụ không được thấy, không được điều hướng tới và không
 * có dữ liệu để đọc. Danh sách này là dữ liệu cho test, không phải cho một
 * `if` ở runtime: cách chặn thật là `/phucvu` có khung riêng và không hề mount
 * navigation của Lễ tân, cộng với permission ở backend.
 */
export const WAITER_FORBIDDEN_PATHS: readonly string[] = [
  "/reservations",
  "/waitlist",
  "/guests",
  "/reports",
  "/settings",
  "/admin",
  "/floor",
]

/**
 * Lễ tân, Thu ngân, Quản trị không vào được `/phucvu` dù gõ thẳng URL.
 *
 * `portal` chỉ được kiểm khi phiên có cổng (chế độ HTTP). Chế độ mock của
 * prototype không có cổng, và chặn theo cổng ở đó sẽ khoá luôn bản demo —
 * cùng một quy ước mà `canEnterAdmin` đang dùng.
 */
export function canEnterWaiter(role: RoleCode, portal: AuthPortal | null): boolean {
  if (!WAITER_ROLES.includes(role)) return false
  return portal === null || portal === "waiter"
}

/**
 * Trạng thái của một ô bàn nhìn từ phía Phục vụ.
 *
 * - `empty`: trống hoặc sơ cua. Chạm vào chỉ xem thông tin cơ bản.
 * - `booked`: đã đặt nhưng khách chưa tới (kể cả tới muộn, no-show, đang giữ
 *   chỗ cho khách chờ). Phục vụ không thấy khách là ai và không gọi món được.
 * - `serving`: đang có khách, Phiên đang mở. Đây là trạng thái duy nhất mở ra
 *   gọi món và đổi/ghép/tách.
 * - `payment`: Phiên đã chuyển sang thanh toán. Chỉ xem.
 * - `out_of_service`: bàn ngừng phục vụ.
 */
export type WaiterTablePhase = "empty" | "booked" | "serving" | "payment" | "out_of_service"

export interface WaiterTableCapability {
  phase: WaiterTablePhase
  /** Nút chính `Gọi món`. */
  canOrder: boolean
  /** Nút `Xem đơn đã gọi`. */
  canViewOrders: boolean
  /** Menu `Đổi / Ghép / Tách bàn`. */
  canRearrange: boolean
  /**
   * Định danh nghiệp vụ của Phiên. Mọi hành động đi theo giá trị này, không
   * theo `tableId`: một cụm bàn ghép có nhiều ô bàn nhưng chỉ MỘT Phiên.
   */
  visitId: number | null
  /** Câu cần nói với Phục vụ khi thao tác bị khoá, hoặc `null`. */
  notice: string | null
}

/**
 * Biên bản 15/11: khi Phiên đã sang thanh toán, món mới phải đi qua Thu ngân.
 * Câu này hiện nguyên văn trên panel chi tiết bàn.
 */
export const WAITER_PAYMENT_NOTICE = "Phiên đang chờ thanh toán. Liên hệ Thu ngân nếu khách muốn gọi thêm."

const BOOKED_STATES: readonly TableLiveState[] = [
  "reserved",
  "upcoming",
  "late",
  "late_confirmed",
  "noshow",
  "hold",
  "hold_overdue",
]

/**
 * Hành động được phép trên một ô bàn.
 *
 * Hàm nhận TRẠNG THÁI ĐÃ CHIẾU từ máy chủ, không tự suy ra từ giờ trên máy
 * khách: hai thiết bị cùng nhìn một bàn phải thấy cùng một bộ nút.
 *
 * `claim.paid` là cờ duy nhất về thanh toán mà dữ liệu hiện có. Module thanh
 * toán chưa được xây, nên "chờ thu ngân" và "đã thu tiền xong" chưa phân biệt
 * được ở tầng dữ liệu; cả hai đều rơi vào `payment` và đều chỉ được xem. Đó là
 * giới hạn của dữ liệu, không phải một lựa chọn thiết kế — xem docs/api.md.
 */
export function waiterTableCapability(
  state: FloorTableState | undefined,
  options: { canOrder?: boolean; canRearrange?: boolean } = {},
): WaiterTableCapability {
  const allowOrder = options.canOrder !== false
  const allowRearrange = options.canRearrange !== false
  const base = { canOrder: false, canViewOrders: false, canRearrange: false, visitId: null, notice: null }

  if (!state) return { ...base, phase: "empty" }
  if (state.state === "oos") {
    return { ...base, phase: "out_of_service", notice: "Bàn đang ngừng phục vụ." }
  }

  const claim: ClaimView | null = state.claim
  const seated = state.state === "seated" && claim !== null && claim.kind === "visit" && claim.visitId !== null

  if (seated && claim.paid) {
    return {
      ...base,
      phase: "payment",
      canViewOrders: true,
      visitId: claim.visitId,
      notice: WAITER_PAYMENT_NOTICE,
    }
  }
  if (seated) {
    return {
      phase: "serving",
      canOrder: allowOrder,
      canViewOrders: true,
      canRearrange: allowRearrange,
      visitId: claim.visitId,
      notice: null,
    }
  }
  if (BOOKED_STATES.includes(state.state)) {
    return { ...base, phase: "booked", notice: "Bàn đã có khách đặt. Chưa gọi món được cho tới khi khách tới." }
  }
  return { ...base, phase: "empty", notice: "Bàn trống. Lễ tân sẽ xếp khách vào bàn này." }
}

/**
 * Ô bàn đại diện cho một Phiên: với cụm bàn ghép, mọi thành viên đều mở ĐÚNG
 * một Phiên chung. Chạm vào ô nào cũng phải ra cùng `visitId`, nếu không mỗi ô
 * sẽ thành một đơn riêng.
 */
export function waiterVisitTableIds(state: FloorTableState | undefined): number[] {
  if (!state?.claim) return state ? [state.tableId] : []
  const ids = state.claim.tableIds
  return ids.length ? [...ids].sort((left, right) => left - right) : [state.tableId]
}

/** "1 giờ 25 phút", "40 phút". Thời gian đã phục vụ, tính từ mốc của máy chủ. */
export function waiterServedDuration(startsAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - startsAt.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`
}

/** Nhãn trạng thái hiện trên panel, bằng từ mà nhân viên dùng. */
export const WAITER_PHASE_LABEL: Record<WaiterTablePhase, string> = {
  empty: "Trống",
  booked: "Đã đặt, khách chưa tới",
  serving: "Đang phục vụ",
  payment: "Chờ thanh toán",
  out_of_service: "Ngừng phục vụ",
}

/**
 * Chuyển động của Trang Quản trị, tách thành hàm thuần để test được mà không
 * cần DOM — cùng lối với `admin-focus.ts`.
 *
 * Vì sao cần state machine chỉ để mở một cái drawer: một phần tử bị
 * `unmount` ngay lúc đóng thì không có gì để chạy animation ra. Muốn mắt
 * thấy nó trượt về bên trái thì panel phải còn trong DOM suốt thời gian
 * animation, rồi mới biến mất. Đó là lý do có pha `closing`.
 *
 * Pha `closing` cũng là lý do panel phải tắt `pointer-events`: trong 150ms
 * đó nó vẫn nằm trên màn hình, và Lễ tân/Admin bấm tiếp vào chỗ cũ thì
 * không được trúng một cái menu đang biến đi.
 *
 * Thời lượng chọn theo nhịp làm việc của hai cổng, không theo cảm tính:
 *
 * - `BASE` 200ms cho việc mở drawer. Dưới ~100ms mắt không kịp thấy hướng
 *   chuyển động (đúng cái "xồ ra ngay" cần sửa), trên ~300ms thì người đang
 *   tra cứu phải chờ. 200ms là mức Material Design dùng cho panel cỡ này.
 * - `EXIT` 150ms cho việc đóng. Đóng luôn phải nhanh hơn mở: lúc mở, người
 *   dùng đang chờ xem có gì trong đó; lúc đóng, họ đã quyết định xong và chỉ
 *   muốn nó đi cho nhanh.
 * - `FAST` 120ms cho hover/nền/màu của mục menu. Đây là thứ xảy ra hàng trăm
 *   lần mỗi phiên tra cứu, nên phải gần như tức thì.
 *
 * Đường cong: vào dùng ease-out (lao vào rồi phanh mềm ở cuối, giống vật có
 * quán tính), ra dùng ease-in (rời đi nhanh dần). Không dùng `linear` —
 * chuyển động tốc độ đều là thứ làm giao diện trông như máy móc.
 */

/** Thời lượng, ms. Phải khớp với `--adm-dur-*` trong `admin-theme.css`. */
export const ADMIN_MOTION_MS = {
  FAST: 120,
  BASE: 200,
  EXIT: 150,
} as const

export type DrawerPhase = "closed" | "open" | "closing"

/**
 * Pha kế tiếp khi người dùng bấm mở / bấm đóng.
 *
 * Bấm mở trong lúc đang `closing` thì quay lại `open` ngay, không chờ hết
 * animation: người dùng bấm nút hai lần liên tiếp là chuyện thường, và bắt
 * họ chờ 150ms mới nhận lệnh thì cảm giác là "máy bị treo".
 */
export function nextDrawerPhase(phase: DrawerPhase, intent: "open" | "close"): DrawerPhase {
  if (intent === "open") return "open"
  // Đóng một drawer đã đóng (hoặc đang đóng) thì không tạo thêm pha mới,
  // nếu không mỗi lần Escape lại hẹn thêm một timer unmount.
  return phase === "open" ? "closing" : phase
}

/** Panel còn nằm trong DOM hay không. `closing` vẫn còn, để chạy animation ra. */
export function drawerIsMounted(phase: DrawerPhase): boolean {
  return phase !== "closed"
}

/**
 * Giá trị cho `data-state` — CSS chọn animation vào/ra theo thuộc tính này.
 * Dùng đúng tên `open` / `closed` như Radix để ai đọc CSS của dự án cũng
 * thấy quen, dù khung Admin không dùng Radix cho drawer.
 */
export function drawerDataState(phase: DrawerPhase): "open" | "closed" {
  return phase === "open" ? "open" : "closed"
}

/**
 * Drawer có đang nhận được thao tác chuột/cảm ứng hay không. Chỉ `open`.
 */
export function drawerIsInteractive(phase: DrawerPhase): boolean {
  return phase === "open"
}

/**
 * Bao lâu nữa thì gỡ panel khỏi DOM. `0` nghĩa là gỡ ngay.
 *
 * `reducedMotion` lấy từ thiết lập hệ thống của người dùng: khi họ đã xin
 * giảm chuyển động thì không có animation nào để chờ, và giữ panel thêm
 * 150ms chỉ làm nó đứng chết trên màn hình rồi mới mất.
 */
export function drawerExitDelay(phase: DrawerPhase, reducedMotion: boolean): number {
  if (phase !== "closing") return 0
  return reducedMotion ? 0 : ADMIN_MOTION_MS.EXIT
}

/** Người dùng có xin giảm chuyển động không. An toàn khi chạy ngoài trình duyệt. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

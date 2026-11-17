/**
 * TU-33 — mã thiết bị phía client.
 *
 * Một giá trị ngẫu nhiên, sinh một lần cho mỗi trình duyệt rồi gửi lên ở mỗi
 * lần đăng nhập để màn hình quản trị gọi tên được "máy nào đang đăng nhập".
 *
 * KHÔNG phải yếu tố xác thực. Giá trị này do client giữ và client gửi, nên nó
 * chỉ đáng tin ở mức "cùng một trình duyệt". Quyền truy cập vẫn do cookie
 * session quyết định, và backend không bao giờ cấp quyền dựa trên nó.
 *
 * Cố ý KHÔNG dùng fingerprinting: không đọc canvas, font, độ phân giải hay
 * danh sách plugin. Một số ngẫu nhiên lưu trong localStorage là đủ cho việc
 * phân biệt thiết bị, và không thu thập gì về người dùng.
 */

const STORAGE_KEY = "21gam.device.v1"

/** Cùng khuôn với DEVICE_ID_PATTERN phía API: API từ chối giá trị khác. */
const PATTERN = /^[A-Za-z0-9_-]{8,64}$/

let cached: string | null = null

function generate(): string {
  // randomUUID chỉ có trên secure context. Production chạy HTTPS nên luôn có,
  // nhưng http://<ip>:5173 lúc thử trong quán thì không — khi đó lùi về
  // getRandomValues, và cuối cùng là Math.random. Mã thiết bị không phải bí
  // mật nên một nguồn ngẫu nhiên yếu hơn ở đây không làm giảm bảo mật; nó chỉ
  // làm tăng khả năng hai máy trùng mã, và điều đó chỉ ảnh hưởng tới nhãn
  // hiển thị.
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
    }
  } catch {
    /* rơi xuống nhánh dưới */
  }
  return `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/**
 * Mã thiết bị của trình duyệt này, tạo mới nếu chưa có.
 *
 * localStorage bị chặn (chế độ ẩn danh, cookie bị tắt) thì vẫn trả về một mã
 * dùng trong phiên làm việc hiện tại: thiếu mã thiết bị không được phép chặn
 * nhân viên đăng nhập.
 */
export function deviceId(): string {
  if (cached) return cached
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && PATTERN.test(stored)) {
      cached = stored
      return cached
    }
  } catch {
    /* localStorage không dùng được: giữ mã trong bộ nhớ */
  }
  cached = generate()
  try {
    localStorage.setItem(STORAGE_KEY, cached)
  } catch {
    /* không lưu được thì mỗi lần tải lại trang sẽ là một "thiết bị" mới */
  }
  return cached
}

/** Chỉ dùng cho test. */
export function resetDeviceIdCache(): void {
  cached = null
}

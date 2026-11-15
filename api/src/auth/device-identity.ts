/**
 * TU-33 — định danh thiết bị cho quản lý phiên.
 *
 * Ba nguyên tắc, theo đúng thứ tự quan trọng:
 *
 * 1. `deviceId` KHÔNG BAO GIỜ là yếu tố xác thực. Client tự khai nó, nên nó chỉ
 *    đáng tin ở mức "cùng một trình duyệt". Nó phục vụ việc hiển thị và buộc
 *    đăng xuất; quyền truy cập vẫn do cookie session quyết định. Nếu một ngày
 *    nào đó có đoạn code nào tin `deviceId` để cấp quyền, đó là lỗ hổng.
 * 2. Không dùng IP làm định danh thiết bị. Ở quán, toàn bộ máy lễ tân, điện
 *    thoại và tablet đi ra ngoài bằng một IP NAT duy nhất nên IP không phân
 *    biệt được thiết bị; ngược lại một điện thoại chuyển wifi sang 4G lại đổi
 *    IP giữa ca.
 * 3. Thu thập tối thiểu. Không fingerprinting. Nhãn thiết bị được rút gọn về
 *    mức "Chrome trên Android" chứ không lưu nguyên User-Agent: nhân viên cần
 *    nhận ra máy nào là máy mình, và chuỗi UA đầy đủ mang nhiều thông tin hơn
 *    mức đó.
 */
import { randomUUID } from 'node:crypto'

/** Mã thiết bị client gửi lên. Chỉ nhận ký tự an toàn và độ dài có giới hạn. */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

export const DEVICE_ID_HEADER = 'x-device-id'

/**
 * Lấy mã thiết bị từ request, hoặc sinh mới nếu client chưa có.
 *
 * Giá trị không hợp lệ bị thay bằng mã mới chứ không gây lỗi đăng nhập: một
 * client cũ hoặc một giá trị rác trong localStorage không nên chặn nhân viên
 * vào hệ thống giữa ca.
 */
export function resolveDeviceId(headerValue: string | undefined): string {
  if (headerValue && DEVICE_ID_PATTERN.test(headerValue)) return headerValue
  return randomUUID()
}

export function isValidDeviceId(value: string | undefined): boolean {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value)
}

/**
 * Rút gọn User-Agent thành một nhãn người đọc được.
 *
 * Mục đích duy nhất: để nhân viên nhìn danh sách phiên và nhận ra đâu là máy
 * mình. Không nhằm nhận dạng chính xác thiết bị, và cố ý mất thông tin so với
 * chuỗi UA gốc.
 */
export function describeDevice(userAgent: string | undefined): string | null {
  if (!userAgent) return null
  const agent = userAgent.slice(0, 400)

  // Thứ tự quan trọng: Edge và Chrome đều tự nhận là 'Chrome', Chrome cũng tự
  // nhận là 'Safari'. Kiểm từ cái cụ thể nhất trở đi.
  const browser = /Edg\//.test(agent) ? 'Edge'
    : /OPR\/|Opera/.test(agent) ? 'Opera'
      : /SamsungBrowser/.test(agent) ? 'Samsung Internet'
        : /Firefox\//.test(agent) ? 'Firefox'
          : /Chrome\//.test(agent) ? 'Chrome'
            : /Safari\//.test(agent) ? 'Safari'
              : null

  // iPadOS 13+ khai mình là Macintosh, nên kiểm iPad qua cảm ứng trước Mac.
  const platform = /iPhone/.test(agent) ? 'iPhone'
    : /iPad/.test(agent) ? 'iPad'
      : /Android/.test(agent) ? 'Android'
        : /Windows/.test(agent) ? 'Windows'
          : /Macintosh|Mac OS X/.test(agent) ? 'macOS'
            : /Linux/.test(agent) ? 'Linux'
              : null

  if (browser && platform) return `${browser} trên ${platform}`
  if (platform) return platform
  if (browser) return browser
  return 'Thiết bị không xác định'
}

/**
 * Dạng hiển thị của mã thiết bị: 8 ký tự đầu.
 *
 * Danh sách phiên cần một thứ để người vận hành đối chiếu "máy này hay máy
 * khác" mà không cần in cả mã. Mã thiết bị không phải bí mật, nhưng in gọn thì
 * dễ đọc trên điện thoại hơn, và nó cũng nhắc rằng giá trị này chỉ để nhận
 * dạng, không để xác thực.
 */
export function shortDeviceId(deviceId: string | null): string | null {
  return deviceId ? deviceId.slice(0, 8) : null
}

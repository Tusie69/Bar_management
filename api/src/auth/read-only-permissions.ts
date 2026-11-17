/**
 * Quyền mà ADMIN Read-Only vẫn giữ.
 *
 * ADMIN WRITE và ADMIN READ_ONLY dùng CHUNG một bộ `role_permissions`; cái
 * phân biệt hai cấp là bộ lọc này, áp ở mọi nơi tính quyền. Trước TU-34 danh
 * sách nằm thẳng trong câu SQL của `listPermissions`; nó được tách ra đây vì
 * màn "Tài khoản & phân quyền" phải tính được quyền nền của một tài khoản
 * KHÁC, và hai bản sao của danh sách này sẽ lệch nhau vào một ngày nào đó.
 *
 * Tất cả đều là quyền ĐỌC. Thêm một mã có tác dụng ghi vào đây là cấp quyền
 * ghi cho Admin Read-Only ở mọi endpoint cùng lúc.
 */
export const READ_ONLY_ADMIN_PERMISSIONS: readonly string[] = [
  'customer.view_masked',
  'customer.phone.reveal',
  'booking.phone.reveal',
  'audit.read',
  'report.read',
  'user.read',
  // TU-33: xem danh sách phiên là chẩn đoán, cùng loại với audit.read.
  // session.revoke cố ý KHÔNG có ở đây: bước đăng xuất đẩy một nhân viên ra
  // khỏi hệ thống giữa ca, nên nó là mutation và Admin Read-Only không được làm.
  'session.read',
  // Ba permission order.* / payment.* của TU-32: Admin Read-Only chỉ được đọc.
  'order.read',
]

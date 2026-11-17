/**
 * Phần quyết định của chấm đỏ thông báo trên nút mở menu.
 *
 * Tách khỏi `ui.tsx` vì file đó kéo theo `session.ts`, mà `session.ts` chạm
 * `document` ngay lúc nạp module — test chạy ở môi trường Node không có DOM.
 */

/**
 * Nhãn trợ năng cho nút mở menu.
 *
 * Chấm đỏ là tín hiệu nhìn bằng mắt; trình đọc màn hình không thấy nó, nên số
 * thông báo phải nằm trong nhãn. Không có gì chưa xem thì giữ nhãn gốc, tránh
 * đọc thêm một mệnh đề thừa ở mọi lần lướt qua.
 */
export function menuButtonLabel(base: string, unread: number): string {
  if (unread <= 0) return base
  return `${base}, ${unread} thông báo chưa xem`
}

/**
 * Tiêu đề mục Thông báo trong menu.
 *
 * Chấm đỏ cố ý không mang số để nút menu khỏi chật; số đếm nằm ở đây, cách đó
 * đúng một lần bấm.
 */
export function alertSectionTitle(total: number): string {
  return total > 0 ? `Thông báo · ${total}` : "Thông báo"
}

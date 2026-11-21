-- migrate:up transaction:false
-- L9 — Bartender được chủ động lên đơn khi khách gọi ở quầy.
--
-- Câu trả lời Q1 trong báo cáo kiểm thử ngày 21/11: ở quầy bar, khách gọi trực
-- tiếp với Bartender và không có Phục vụ đứng giữa. Trước migration này vai BAR
-- chỉ có ba permission của hàng đợi chế biến, nên `/phucvu` từ chối đăng nhập
-- (PORTAL_ACCESS_DENIED) và không có đường nào để một ly khách gọi ở quầy trở
-- thành một đơn trong hệ thống.
--
-- Cổng đăng nhập là chuyện của code (`PORTAL_ROLE_CODES` trong
-- `api/src/auth/auth-portal.ts`): `auth_sessions.portal = 'waiter'` đã nằm
-- trong `ck_auth_sessions_portal` từ 0027, nên migration này KHÔNG phải nới
-- constraint nào. Ở đây chỉ có quyền.
--
-- Sáu permission dưới đây là ĐÚNG những gì cần để lên một đơn và theo nó tới
-- khi món xong — không hơn:
--
--   order.create                    gọi món, lên đơn cho bàn / ghế quầy
--   order.read                      xem đơn đã gọi và trạng thái của nó
--   order.line.adjust               sửa số lượng khi quầy chưa nhận phiếu
--   order.cancel.request            GỬI yêu cầu hủy món
--   preparation.ready.read          nhận thông báo món đã sẵn sàng
--   preparation.ready.acknowledge   xác nhận đã nhận thông báo đó
--
-- Và đây là những gì BAR CỐ Ý KHÔNG được cấp, viết ra để lần sau không ai phải
-- suy luận từ sự im lặng:
--
--   order.cancel.approve   phê duyệt hủy là việc của người khác — đó là toàn bộ
--                          điểm của việc phê duyệt. Bar vừa xin vừa duyệt thì
--                          bước duyệt không còn nghĩa gì.
--   order.cancel.ready     ghi hao món đã làm xong là quyết định về tiền của
--                          Thu ngân / quản lý (câu trả lời Q3).
--   payment.collect        Bar không thu tiền.
--   customer.view_masked   Bar không có việc gì với dữ liệu khách, kể cả 3 số
--   customer.phone.reveal  cuối số điện thoại.
--   venue.configure        cấu hình địa điểm và duyệt danh mục món là quản trị.
--   user.read / user.manage / audit.read / report.read / operation.undo
--                          toàn bộ phần quản trị.
--
-- Ba permission `preparation.bar.*` sẵn có của BAR không bị chạm tới: Bartender
-- vẫn vào `/chebien` bằng cổng preparation như trước.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN (
  'order.create',
  'order.read',
  'order.line.adjust',
  'order.cancel.request',
  'preparation.ready.read',
  'preparation.ready.acknowledge'
)
WHERE r.code = 'BAR'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions AS existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );

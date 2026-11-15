-- migrate:up transaction:false
-- TU-33: quản lý thiết bị cho Single Active Session.
--
-- Cơ chế Single Active Session đã có từ trước và migration này không đổi nó:
-- login vẫn thu hồi phiên cũ trong cùng transaction. Ở đây chỉ thêm phần còn
-- thiếu để NHÌN và ĐIỀU KHIỂN được các phiên đó.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------- định danh thiết bị ----

-- Mã thiết bị đục, do client sinh một lần rồi gửi lại ở mỗi lần đăng nhập.
--
-- KHÔNG phải yếu tố xác thực: nó không bao giờ được dùng thay token. Client
-- tự khai giá trị này nên nó chỉ đáng tin ở mức "cùng một trình duyệt", vừa đủ
-- cho việc hiển thị và buộc đăng xuất, và không đủ để cấp quyền.
--
-- Cố ý KHÔNG dùng IP: ở quán, toàn bộ máy lễ tân, điện thoại và tablet đi ra
-- ngoài bằng một IP NAT duy nhất, nên IP không phân biệt được thiết bị; ngược
-- lại một điện thoại chuyển từ wifi sang 4G lại đổi IP giữa ca. Cũng cố ý
-- không dùng browser fingerprinting: nó thu thập nhiều hơn mức cần cho việc
-- hiển thị "thiết bị nào đang đăng nhập".
ALTER TABLE auth_sessions
  ADD COLUMN device_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER device_label,
  ADD KEY ix_auth_sessions_device (organization_id, device_id);

-- ------------------------------------------------------------ quyền ---------

-- Hai quyền tách biệt, theo đúng yêu cầu "phân biệt quyền xem danh sách session
-- với quyền buộc logout". Xem danh sách là chẩn đoán; buộc đăng xuất đẩy một
-- nhân viên ra khỏi hệ thống giữa ca, nên nó phải cấp được riêng.
INSERT INTO permissions (code, description, is_sensitive) VALUES
  ('session.read',   'Xem các phiên đăng nhập đang hoạt động', 1),
  ('session.revoke', 'Buộc đăng xuất phiên của tài khoản khác', 1);

-- OWNER (SuperAdmin) giữ trọn bộ quyền như mọi lần trước.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN ('session.read', 'session.revoke')
WHERE r.code = 'OWNER';

-- ADMIN theo luật của 0024: mọi permission trừ venue.configure và
-- customer.anonymize. Phạm vi thực tế do repository chặn: ADMIN chỉ buộc đăng
-- xuất được tài khoản nhân viên, không bao giờ OWNER hay ADMIN khác.
-- READ_ONLY dùng chung grant của role nhưng `listPermissions` chỉ cho
-- READ_ONLY giữ các permission đọc, nên Admin Read-Only xem được danh sách
-- phiên mà không buộc đăng xuất được ai.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN ('session.read', 'session.revoke')
WHERE r.code = 'ADMIN';

-- --------------------------------------------------------- lý do thu hồi ----

-- `revoke_reason` là VARCHAR(30) không có CHECK constraint, nên giá trị mới
-- 'FORCED_LOGOUT' không cần nới gì. Ghi lại ở đây để lần sau không ai phải đi
-- tìm: các giá trị đang dùng là SESSION_REPLACED, SESSION_REVOKED,
-- ACCOUNT_LOCKED, ACCESS_LEVEL_CHANGED, PORTAL_MIGRATION và FORCED_LOGOUT.

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

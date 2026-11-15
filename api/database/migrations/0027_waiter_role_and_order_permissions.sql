-- migrate:up transaction:false
-- TU-32: sáu cấp tài khoản theo biên bản họp 15/11/2026.
--
-- Năm cấp đầu đã có sẵn trong mô hình hiện tại và migration này KHÔNG chạm vào
-- chúng: OWNER = SuperAdmin, ADMIN+WRITE = Admin Edit, ADMIN+READ_ONLY =
-- Admin Read-Only, RECEPTIONIST = Lễ tân, CASHIER = Thu ngân. Chỉ cấp thứ sáu
-- là mới: WAITER = Phục vụ.
--
-- CUSTOMER_CARE được giữ nguyên cùng toàn bộ membership của nó. Biên bản không
-- nhắc tới vai trò này, và "không nhắc tới" không phải là "bỏ đi".
--
-- Ba permission order.* / payment.* dưới đây là giàn giáo phân quyền, KHÔNG
-- phải nghiệp vụ đã có: module order chưa tồn tại trong repository này. Chúng
-- được tạo trước để route guard của module order tương lai có chỗ neo, và để
-- bảng role × permission trong docs/api.md phản ánh đúng sáu cấp. Không có
-- endpoint nào đang dùng chúng.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------- role ------

INSERT INTO roles (code, name, is_system)
VALUES ('WAITER', 'Phục vụ', 1);

-- --------------------------------------------------------- permissions ------

INSERT INTO permissions (code, description, is_sensitive) VALUES
  ('order.create',    'Gọi món, lên đơn cho bàn', 0),
  ('order.read',      'Xem đơn và trạng thái chờ thanh toán', 0),
  ('payment.collect', 'Thu tiền và in bill', 0);

-- ------------------------------------------------------------- grants -------

-- WAITER: gọi món và xem trạng thái chờ thanh toán. Không đặt bàn, không chốt
-- thanh toán, không thấy số điện thoại khách kể cả 3 số cuối — biên bản không
-- cấp cho Phục vụ quyền nào về khách hàng, nên không tự cấp.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN ('order.create', 'order.read')
WHERE r.code = 'WAITER';

-- CASHIER: bổ sung lên đơn, xem đơn và thu tiền. Vai trò này đã có sẵn
-- visit.end (nhả bàn), visit.mark_paid và customer.view_masked từ 0001.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN ('order.create', 'order.read', 'payment.collect')
WHERE r.code = 'CASHIER';

-- OWNER giữ trọn bộ permission như mọi lần trước.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN ('order.create', 'order.read', 'payment.collect')
WHERE r.code = 'OWNER';

-- ADMIN theo đúng luật của 0024: mọi permission trừ venue.configure và
-- customer.anonymize. Không nhắc lại luật này ở đây thì ADMIN sẽ âm thầm thiếu
-- ba permission mới, và Admin Edit mất quyền xem phần vận hành order.
-- READ_ONLY dùng chung grant của role; API lọc permission ghi theo
-- membership_roles.access_level trên từng request, nên ba permission này không
-- tự động biến Admin Read-Only thành người ghi được.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN ('order.create', 'order.read', 'payment.collect')
WHERE r.code = 'ADMIN';

-- ------------------------------------------------------------- portal -------

-- Cổng đăng nhập thứ năm. CHECK constraint của 0012 chỉ cho bốn giá trị, nên
-- một session 'waiter' sẽ bị database từ chối nếu không nới constraint ở đây.
--
-- Giá trị portal trong database giữ nguyên tiếng Anh. URL tiếng Việt (/letan,
-- /thungan, /phucvu) là lớp định tuyến ở web/API, không phải giá trị lưu trữ:
-- đổi giá trị đã lưu sẽ làm mọi session đang mở không khớp constraint và đẩy
-- toàn bộ nhân viên ra khỏi hệ thống giữa ca.
ALTER TABLE auth_sessions
  DROP CHECK ck_auth_sessions_portal;

ALTER TABLE auth_sessions
  ADD CONSTRAINT ck_auth_sessions_portal
    CHECK (portal IS NULL OR portal IN ('admin','receptionist','customer-care','cashier','waiter'));

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

-- migrate:up transaction:false
-- Module Phục vụ 1 — quyền đổi / ghép / tách PHIÊN ĐANG CÓ KHÁCH cho WAITER.
--
-- Biên bản 15/11 cho Phục vụ dọn chỗ cho khách đang ngồi: khách đổi sang bàn
-- khác, hai nhóm nhập lại thành một, một nhóm tách ra. Ba việc đó đã có
-- permission riêng từ 0001 (visit.move / visit.combine / visit.split) và đều
-- gắn vào một Visit đang mở, nên migration này chỉ cấp thêm grant, không tạo
-- permission mới và không sửa 0027.
--
-- KHÔNG cấp `table.group.manage`. Đó là quyền xếp mặt bằng trên CỤM BÀN TRỐNG
-- (0017/C1): nó không cần tới một khách nào, nên trao nó cho Phục vụ sẽ mở ra
-- việc sắp xếp sơ đồ quán — đúng cái mà biên bản giữ cho Lễ tân. Route
-- `/tables/groups/:id/split` chấp nhận `visit.split`, và chính vì thế nó phải
-- tự kiểm rằng cụm đang có khách khi người gọi không có
-- `table.group.manage`; xem api/src/modules/tables/table.route.ts.
--
-- Phục vụ vẫn KHÔNG có: reservation.*, waitlist.*, visit.checkin,
-- visit.walkin, visit.end, visit.mark_paid, payment.collect và mọi quyền
-- customer.* — kể cả customer.view_masked.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN ('visit.move', 'visit.combine', 'visit.split')
WHERE r.code = 'WAITER';

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

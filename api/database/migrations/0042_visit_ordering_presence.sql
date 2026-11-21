-- migrate:up transaction:false
-- Module Phục vụ 1 (v1.1) — dấu "đang gọi món" của một Phiên.
--
-- Tài liệu thiết kế lại luồng Phục vụ ngày 22/11 cho sơ đồ sáu trạng thái, và
-- trạng thái 2 "Đang gọi món" là cái duy nhất KHÔNG suy được từ dữ liệu đã có.
-- Năm trạng thái kia là hệ quả của những thứ đã nằm trong database — Phiên mở,
-- đơn đã gửi, phiếu Bar/Bếp đã mang ra, Phiên đã đánh dấu thanh toán — còn
-- "đang gọi món" là sự thật về NGƯỜI ĐANG CẦM MÁY, không về khách. Không một
-- bảng nào hôm nay ghi lại việc đó.
--
-- Hai cột thay vì một bảng presence riêng. Một bảng mới kéo theo khoá ngoại,
-- chỉ mục, và một job dọn rác, để cuối cùng chứa nhiều nhất vài chục dòng sống
-- vài phút. Hai cột trên `visits` đi chung vòng đời của Phiên: Phiên đóng là
-- dấu biến mất, không cần ai dọn.
--
-- `ordering_since` KHÔNG phải lịch sử. Nó bị xoá khi máy thoát màn Gọi món và
-- khi đơn được gửi; nó tồn tại để các máy KHÁC biết bàn đang được lên đơn.
-- Muốn biết ai đã gọi món lúc nào thì đọc `sales_orders`, nơi dữ liệu đó là
-- bất biến. Vì vậy ở đây không có chỉ mục nào: cột này luôn được đọc kèm một
-- hàng `visits` đã tìm thấy bằng khoá chính.
--
-- Hạn sống của dấu (3 phút) nằm ở tầng ứng dụng, không ở đây: database không
-- nên có một luật thời gian mà một câu SELECT vô tình bỏ qua được. Xem
-- `ORDERING_PRESENCE_TTL_MS` trong api/src/modules/tables/waiter-visit-phase.ts.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE visits
  ADD COLUMN ordering_since        DATETIME(3) NULL AFTER paid_marked_by_user_id,
  ADD COLUMN ordering_by_user_id   BIGINT UNSIGNED NULL AFTER ordering_since;

-- Hai cột đi cùng nhau hoặc cùng vắng. Một `ordering_since` không có người là
-- một bàn màu cam mà không ai trả lời được "ai đang gọi?", và đó đúng là câu
-- hỏi đầu tiên khi hai Phục vụ cùng chạm vào một bàn.
ALTER TABLE visits
  ADD CONSTRAINT ck_visits_ordering
    CHECK ((ordering_since IS NULL) = (ordering_by_user_id IS NULL));

ALTER TABLE visits
  ADD CONSTRAINT fk_visits_ordering_by FOREIGN KEY (ordering_by_user_id) REFERENCES users (id);

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

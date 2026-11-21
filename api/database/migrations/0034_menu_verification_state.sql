-- migrate:up transaction:false
-- Module Phục vụ 2 — giữ được kết quả đối chiếu khi import lại.
--
-- 0033 chỉ có ba trạng thái và không lưu dấu vết của lần duyệt nào. Hệ quả:
-- importer chạy lần hai đặt mọi món về PENDING_VERIFICATION, và toàn bộ món đã
-- đối chiếu biến mất khỏi menu production mà không ai được báo. Migration này
-- thêm đúng những gì cần để việc đó không xảy ra nữa, và để lần duyệt sau còn
-- biết mình đang duyệt thay đổi gì.
--
-- `import_digest` là vân tay của NỘI DUNG NGUỒN đang nằm trong bảng (tên, mô
-- tả, ghi chú, bếp/bar, phân loại, và toàn bộ biến thể kèm giá). Importer so
-- vân tay trước khi ghi: giống nhau thì không đụng gì tới dòng đó — không tăng
-- version, không đổi updated_at, không tăng venues.change_seq.
--
-- `verified_digest` là vân tay của nội dung ĐÃ ĐƯỢC DUYỆT. Nguồn đổi sau khi
-- duyệt thì hai vân tay lệch nhau, và món chuyển sang REVIEW_REQUIRED chứ
-- không âm thầm quay về PENDING_VERIFICATION: hai trạng thái đó khác nhau về
-- nghĩa (chưa ai xem bao giờ / đã duyệt rồi nhưng nguồn vừa đổi) và người đối
-- chiếu cần phân biệt được.
--
-- `verified_snapshot` giữ nguyên văn payload đã duyệt, để `menu:verify` in ra
-- được diff thật theo từng trường thay vì chỉ nói "có gì đó đã đổi". Không có
-- nó thì lần duyệt thứ hai lại phải đọc lại cả 178 món bằng mắt.
--
-- Cả bốn trạng thái trừ VERIFIED đều KHÔNG bán được: catalog production lọc
-- theo source_status = 'VERIFIED', nên REVIEW_REQUIRED tự động ẩn món khỏi
-- máy Phục vụ cho tới khi có người duyệt lại. Đó là hành vi mong muốn: nguồn
-- vừa đổi giá thì thà ẩn món còn hơn bán sai giá.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE menu_items
  ADD COLUMN import_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER import_key,
  ADD COLUMN verified_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER source_status,
  ADD COLUMN verified_snapshot JSON NULL AFTER verified_digest,
  ADD COLUMN verified_at DATETIME(3) NULL AFTER verified_snapshot,
  ADD COLUMN verified_by_user_id BIGINT UNSIGNED NULL AFTER verified_at;

ALTER TABLE menu_items
  ADD CONSTRAINT fk_menu_items_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES users (id);

-- VERIFIED phải đi kèm người duyệt và thời điểm duyệt. Nếu không ràng buộc ở
-- database thì một lần UPDATE tay sẽ tạo ra món đang bán mà không ai chịu
-- trách nhiệm, và nhật ký không dựng lại được.
ALTER TABLE menu_items
  ADD CONSTRAINT ck_menu_items_verified_audit CHECK (
    source_status <> 'VERIFIED'
    OR (verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL AND verified_digest IS NOT NULL)
  );

ALTER TABLE menu_items
  DROP CHECK ck_menu_items_source_status;

ALTER TABLE menu_items
  ADD CONSTRAINT ck_menu_items_source_status CHECK (
    source_status IN ('PENDING_VERIFICATION','REVIEW_REQUIRED','VERIFIED','REJECTED')
  );

-- Hàng đợi đối chiếu: "món nào đang chờ người duyệt ở địa điểm này".
CREATE INDEX ix_menu_items_verification_queue
  ON menu_items (venue_id, source_status, display_order, id);

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

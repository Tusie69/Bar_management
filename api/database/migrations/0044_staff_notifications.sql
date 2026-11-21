-- migrate:up transaction:false
-- Module Phục vụ (v1.1) — PV-20: báo kết quả duyệt hủy về đúng máy đã xin hủy.
--
-- Hôm nay Phục vụ chỉ biết yêu cầu của mình được duyệt hay bị từ chối khi họ
-- TỰ mở lại màn "Đơn của bàn" và nhìn thấy một dải đỏ trên dòng món. Đó là một
-- tin phải đi tìm; trong khi nó là tin quyết định việc họ nói gì với khách
-- đang ngồi đợi.
--
-- Vì sao một bảng mới thay vì mở rộng `preparation_ready_events`:
-- bảng kia có `ticket_id NOT NULL` với một UNIQUE trên nó, và cả vòng đời của
-- nó gắn vào phiếu chế biến. Nhét một sự kiện không có phiếu vào đó buộc phải
-- nới khoá ngoại và bỏ ràng buộc duy nhất — tức là phá chính những thứ đang
-- giữ cho thông báo "món đã xong" không bao giờ nhân đôi.
--
-- Bảng này cố ý CHÉP LẠI số liệu (số món, số tiền, lý do, người duyệt) thay vì
-- chỉ trỏ tới yêu cầu hủy. Một thông báo là ảnh chụp của một khoảnh khắc: đọc
-- lại nó sau ba tiếng phải ra đúng con số đã hiện lúc nó tới, kể cả khi đơn đã
-- đổi tiếp sau đó.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE staff_notifications (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id         BIGINT UNSIGNED NOT NULL,
  venue_id                BIGINT UNSIGNED NOT NULL,
  -- Mở sẵn cho các loại tin khác sau này; hôm nay chỉ có một loại.
  kind                    VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Người NHẬN. Thông báo này đi tới đúng máy đã gửi yêu cầu, không phát cho
  -- cả ca: người khác nhận một tin họ không hành động được là một tin họ học
  -- cách bỏ qua.
  target_user_id          BIGINT UNSIGNED NOT NULL,
  visit_id                BIGINT UNSIGNED NULL,
  order_id                BIGINT UNSIGNED NULL,
  -- Mã nhóm khi đây là một lần "Hủy đơn?"; NULL khi là yêu cầu hủy một món.
  cancellation_group_id   BIGINT UNSIGNED NULL,
  cancellation_id         BIGINT UNSIGNED NULL,
  decision                VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Ảnh chụp số liệu lúc quyết định.
  line_count              SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  quantity                SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  waste_quantity          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  amount_vnd              BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reason                  VARCHAR(200) NULL,
  decision_note           VARCHAR(200) NULL,
  decided_by_user_id      BIGINT UNSIGNED NULL,
  decided_at              DATETIME(3) NULL,
  acknowledged_at         DATETIME(3) NULL,
  created_at              DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  -- Truy vấn duy nhất của chuông: tin CHƯA xác nhận của MỘT người, mới nhất
  -- trước. `acknowledged_at` nằm trong khoá để tin đã đọc không phải quét qua.
  KEY ix_staff_notifications_inbox (venue_id, target_user_id, acknowledged_at, id),
  CONSTRAINT fk_staff_notifications_venue FOREIGN KEY (organization_id, venue_id)
    REFERENCES venues (organization_id, id),
  CONSTRAINT fk_staff_notifications_target FOREIGN KEY (target_user_id) REFERENCES users (id),
  CONSTRAINT fk_staff_notifications_visit FOREIGN KEY (venue_id, visit_id) REFERENCES visits (venue_id, id),
  CONSTRAINT fk_staff_notifications_order FOREIGN KEY (venue_id, order_id) REFERENCES sales_orders (venue_id, id),
  CONSTRAINT fk_staff_notifications_decided_by FOREIGN KEY (decided_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_staff_notifications_kind CHECK (kind IN ('CANCELLATION_DECIDED')),
  CONSTRAINT ck_staff_notifications_decision CHECK (decision IS NULL OR decision IN ('APPROVED','REJECTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

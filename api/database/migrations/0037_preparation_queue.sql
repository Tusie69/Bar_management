-- migrate:up transaction:false
-- Module 4 — hàng đợi chế biến điện tử cho Bar/Bếp.
-- Migration tiến tới; không sửa 0036 đã có thể được áp dụng ở môi trường thật.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 0036 gọi trạng thái đầu là QUEUED. Chuẩn nghiệp vụ Module 4 gọi cùng trạng
-- thái đó là SUBMITTED; đổi dữ liệu trước rồi mới siết CHECK mới.
ALTER TABLE preparation_tickets DROP CHECK ck_preparation_tickets_status;
UPDATE preparation_tickets SET status = 'SUBMITTED' WHERE status = 'QUEUED';
ALTER TABLE preparation_tickets
  ADD COLUMN accepted_by_user_id BIGINT UNSIGNED NULL AFTER item_count,
  ADD COLUMN accepted_at DATETIME(3) NULL AFTER accepted_by_user_id,
  ADD COLUMN started_by_user_id BIGINT UNSIGNED NULL AFTER accepted_at,
  ADD COLUMN started_at DATETIME(3) NULL AFTER started_by_user_id,
  ADD COLUMN ready_by_user_id BIGINT UNSIGNED NULL AFTER started_at,
  ADD COLUMN ready_at DATETIME(3) NULL AFTER ready_by_user_id,
  ADD CONSTRAINT fk_preparation_tickets_accepted_by FOREIGN KEY (accepted_by_user_id) REFERENCES users (id),
  ADD CONSTRAINT fk_preparation_tickets_started_by FOREIGN KEY (started_by_user_id) REFERENCES users (id),
  ADD CONSTRAINT fk_preparation_tickets_ready_by FOREIGN KEY (ready_by_user_id) REFERENCES users (id),
  ADD CONSTRAINT ck_preparation_tickets_status
    CHECK (status IN ('SUBMITTED','ACCEPTED','PREPARING','READY')),
  ADD CONSTRAINT ck_preparation_tickets_milestones CHECK (
    (status = 'SUBMITTED' AND accepted_by_user_id IS NULL AND accepted_at IS NULL
      AND started_by_user_id IS NULL AND started_at IS NULL AND ready_by_user_id IS NULL AND ready_at IS NULL)
    OR (status = 'ACCEPTED' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL
      AND started_by_user_id IS NULL AND started_at IS NULL AND ready_by_user_id IS NULL AND ready_at IS NULL)
    OR (status = 'PREPARING' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL
      AND started_by_user_id IS NOT NULL AND started_at IS NOT NULL
      AND ready_by_user_id IS NULL AND ready_at IS NULL)
    OR (status = 'READY' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL
      AND started_by_user_id IS NOT NULL AND started_at IS NOT NULL
      AND ready_by_user_id IS NOT NULL AND ready_at IS NOT NULL)
  );

-- Append-only, một dòng cho cả lúc tạo và từng transition. Đây là lịch sử
-- nghiệp vụ dễ truy vấn; operation_log vẫn là audit chung toàn hệ thống.
CREATE TABLE preparation_ticket_events (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id      BIGINT UNSIGNED NOT NULL,
  venue_id             BIGINT UNSIGNED NOT NULL,
  ticket_id            BIGINT UNSIGNED NOT NULL,
  station              VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_status           VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  to_status             VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ticket_version        INT UNSIGNED NOT NULL,
  actor_user_id         BIGINT UNSIGNED NOT NULL,
  actor_membership_id   BIGINT UNSIGNED NOT NULL,
  idempotency_key       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  occurred_at           DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_preparation_ticket_events_version (ticket_id, ticket_version),
  KEY ix_preparation_ticket_events_venue_cursor (venue_id, id),
  CONSTRAINT fk_preparation_ticket_events_ticket FOREIGN KEY (venue_id, ticket_id)
    REFERENCES preparation_tickets (venue_id, id),
  CONSTRAINT fk_preparation_ticket_events_user FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CONSTRAINT fk_preparation_ticket_events_membership FOREIGN KEY (actor_membership_id) REFERENCES memberships (id),
  CONSTRAINT ck_preparation_ticket_events_station CHECK (station IN ('BAR','KITCHEN')),
  CONSTRAINT ck_preparation_ticket_events_from CHECK
    (from_status IS NULL OR from_status IN ('SUBMITTED','ACCEPTED','PREPARING')),
  CONSTRAINT ck_preparation_ticket_events_to CHECK
    (to_status IN ('SUBMITTED','ACCEPTED','PREPARING','READY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Transactional outbox. Một ticket có đúng một yêu cầu PRINT_TICKET; retry chỉ
-- đổi số lần/yêu cầu lại trên dòng này, không tạo ticket/order/outbox thứ hai.
CREATE TABLE preparation_print_outbox (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  ticket_id             BIGINT UNSIGNED NOT NULL,
  station               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type             VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PRINT_TICKET',
  status                 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  attempt_count          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  retry_request_count    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at           DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  claimed_at             DATETIME(3) NULL,
  delivered_at           DATETIME(3) NULL,
  last_error_code        VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_preparation_print_outbox_ticket (ticket_id, event_type),
  KEY ix_preparation_print_outbox_dispatch (status, available_at, id),
  CONSTRAINT fk_preparation_print_outbox_ticket FOREIGN KEY (venue_id, ticket_id)
    REFERENCES preparation_tickets (venue_id, id),
  CONSTRAINT ck_preparation_print_outbox_station CHECK (station IN ('BAR','KITCHEN')),
  CONSTRAINT ck_preparation_print_outbox_event CHECK (event_type IN ('PRINT_TICKET')),
  CONSTRAINT ck_preparation_print_outbox_status CHECK (status IN ('PENDING','PROCESSING','DELIVERED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- READY được định tuyến theo visit + người đã gọi đơn, không theo mã bàn (bàn
-- có thể đã đổi). Lớp thông báo sau này consume bảng này theo adapter riêng.
CREATE TABLE preparation_ready_notifications (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       BIGINT UNSIGNED NOT NULL,
  venue_id              BIGINT UNSIGNED NOT NULL,
  ticket_id             BIGINT UNSIGNED NOT NULL,
  visit_id              BIGINT UNSIGNED NOT NULL,
  recipient_user_id     BIGINT UNSIGNED NOT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  acknowledged_at       DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_preparation_ready_notifications_ticket (ticket_id),
  KEY ix_preparation_ready_notifications_recipient (venue_id, recipient_user_id, acknowledged_at, id),
  CONSTRAINT fk_preparation_ready_notifications_ticket FOREIGN KEY (venue_id, ticket_id)
    REFERENCES preparation_tickets (venue_id, id),
  CONSTRAINT fk_preparation_ready_notifications_visit FOREIGN KEY (venue_id, visit_id)
    REFERENCES visits (venue_id, id),
  CONSTRAINT fk_preparation_ready_notifications_user FOREIGN KEY (recipient_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO roles (code, name, is_system) VALUES
  ('BAR', 'Quầy Bar', 1),
  ('KITCHEN', 'Bếp', 1);

INSERT INTO permissions (code, description, is_sensitive) VALUES
  ('preparation.bar.read', 'Xem hàng đợi Bar', 0),
  ('preparation.bar.transition', 'Xử lý phiếu Bar', 0),
  ('preparation.kitchen.read', 'Xem hàng đợi Bếp', 0),
  ('preparation.kitchen.transition', 'Xử lý phiếu Bếp', 0),
  ('preparation.print.retry', 'Yêu cầu in lại phiếu chế biến', 0);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON (r.code = 'BAR' AND p.code IN ('preparation.bar.read','preparation.bar.transition','preparation.print.retry'))
  OR (r.code = 'KITCHEN' AND p.code IN ('preparation.kitchen.read','preparation.kitchen.transition','preparation.print.retry'));

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('preparation.bar.read','preparation.bar.transition','preparation.kitchen.read',
                'preparation.kitchen.transition','preparation.print.retry')
WHERE r.code IN ('OWNER','ADMIN');

ALTER TABLE auth_sessions DROP CHECK ck_auth_sessions_portal;
ALTER TABLE auth_sessions ADD CONSTRAINT ck_auth_sessions_portal
  CHECK (portal IS NULL OR portal IN
    ('admin','receptionist','customer-care','cashier','waiter','preparation'));

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

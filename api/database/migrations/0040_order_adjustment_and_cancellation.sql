-- migrate:up transaction:false
-- Module Phục vụ 5 — theo dõi và điều chỉnh đơn đã gửi.
--
-- 0036 nói rằng dòng đơn là BẤT BIẾN và sửa một đơn đã gửi "sẽ là một bản ghi
-- mới chứ không phải một lần ghi đè". Nghiệp vụ của module này đổi lại một nửa
-- câu đó, nên nói rõ ở đây thay vì để hai file nói hai điều:
--
-- * Sửa SỐ LƯỢNG ghi đè `sales_order_lines.quantity`, nhưng chỉ khi phiếu của
--   quầy còn ở SUBMITTED — tức là chưa ai ở Bar/Bếp nhận việc. Trước mốc đó
--   dòng đơn chưa phải là một lời hứa với ai, và một dòng "bỏ 2 thêm 1" trên
--   phiếu đọc khó hơn hẳn một con số đã sửa. Sau mốc đó thì khóa cứng.
-- * MỌI lần ghi đè đều để lại một dòng `sales_order_line_changes` với số trước,
--   số sau và người sửa. Bản ghi cũ không mất, nó chỉ không còn là hiện tại.
-- * HỦY MÓN không bao giờ ghi đè và không bao giờ DELETE. Nó cộng vào
--   `cancelled_quantity`, giữ nguyên dòng gốc, và chỉ xảy ra sau khi một người
--   CÓ QUYỀN PHÊ DUYỆT đồng ý.
--
-- `sales_orders.total_amount_vnd` vẫn là tổng của đơn như lúc gửi; phần bị hủy
-- nằm riêng ở `cancelled_amount_vnd`. Số phải thu = total - cancelled. Trừ
-- thẳng vào total sẽ xoá mất con số mà khách đã nghe khi gọi món.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------ dòng đơn ------

ALTER TABLE sales_order_lines
  ADD COLUMN cancelled_quantity SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER quantity,
  -- `version` là chốt chống ghi đè mù: máy Phục vụ gửi số nó đang nhìn thấy, và
  -- một lần sửa từ máy khác xen vào giữa làm số đó cũ đi.
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3));

ALTER TABLE sales_order_lines
  ADD COLUMN net_quantity SMALLINT UNSIGNED AS (quantity - cancelled_quantity) STORED AFTER cancelled_quantity,
  ADD COLUMN net_total_vnd BIGINT UNSIGNED AS (unit_price_vnd * (quantity - cancelled_quantity)) STORED;

ALTER TABLE sales_order_lines
  ADD CONSTRAINT ck_sales_order_lines_cancelled CHECK (cancelled_quantity <= quantity),
  ADD CONSTRAINT ck_sales_order_lines_version CHECK (version >= 1);

-- "Còn phải làm bao nhiêu" là câu hỏi của Bar/Bếp và của màn Đơn của bàn.
CREATE INDEX ix_sales_order_lines_net ON sales_order_lines (venue_id, order_id, net_quantity);

-- ---------------------------------------------------------------- đơn -------

ALTER TABLE sales_orders
  ADD COLUMN cancelled_item_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER item_count,
  ADD COLUMN cancelled_amount_vnd BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER total_amount_vnd;

ALTER TABLE sales_orders
  ADD CONSTRAINT ck_sales_orders_cancelled CHECK (
    cancelled_item_count <= item_count AND cancelled_amount_vnd <= total_amount_vnd);

-- ------------------------------------------------------------- phiếu --------

-- Phiếu đã in không được viết lại, nhưng quầy cần biết phần nào đã bị hủy.
-- Hàng đợi đọc `item_count - cancelled_item_count`.
ALTER TABLE preparation_tickets
  ADD COLUMN cancelled_item_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER item_count;

ALTER TABLE preparation_tickets
  ADD CONSTRAINT ck_preparation_tickets_cancelled CHECK (cancelled_item_count <= item_count);

-- --------------------------------------------------- lịch sử sửa dòng -------

CREATE TABLE sales_order_line_changes (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id             BIGINT UNSIGNED NOT NULL,
  venue_id                    BIGINT UNSIGNED NOT NULL,
  order_id                    BIGINT UNSIGNED NOT NULL,
  line_id                     BIGINT UNSIGNED NOT NULL,
  line_no                     SMALLINT UNSIGNED NOT NULL,
  change_kind                 VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity_before             SMALLINT UNSIGNED NOT NULL,
  quantity_after              SMALLINT UNSIGNED NOT NULL,
  cancelled_before            SMALLINT UNSIGNED NOT NULL,
  cancelled_after             SMALLINT UNSIGNED NOT NULL,
  -- Âm khi đơn bớt tiền. Dùng BIGINT có dấu: một delta luôn dương là một delta
  -- mất dấu, và lúc đối chiếu doanh thu thì không biết nó cộng hay trừ.
  amount_delta_vnd            BIGINT NOT NULL,
  reason                      VARCHAR(200) NULL,
  cancellation_id             BIGINT UNSIGNED NULL,
  actor_user_id               BIGINT UNSIGNED NOT NULL,
  actor_membership_id         BIGINT UNSIGNED NOT NULL,
  created_at                  DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  KEY ix_sales_order_line_changes_line (venue_id, line_id, id),
  KEY ix_sales_order_line_changes_order (venue_id, order_id, id),
  KEY ix_sales_order_line_changes_actor (actor_user_id, created_at),
  CONSTRAINT fk_sales_order_line_changes_order FOREIGN KEY (venue_id, order_id)
    REFERENCES sales_orders (venue_id, id),
  CONSTRAINT fk_sales_order_line_changes_line FOREIGN KEY (line_id) REFERENCES sales_order_lines (id),
  CONSTRAINT fk_sales_order_line_changes_user FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CONSTRAINT fk_sales_order_line_changes_membership FOREIGN KEY (actor_membership_id) REFERENCES memberships (id),
  CONSTRAINT ck_sales_order_line_changes_kind CHECK (
    change_kind IN ('QUANTITY_ADJUSTED','CANCELLATION_APPROVED')),
  CONSTRAINT ck_sales_order_line_changes_moved CHECK (
    quantity_before <> quantity_after OR cancelled_before <> cancelled_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------- yêu cầu hủy món ----------

-- Phục vụ KHÔNG tự hủy món. Họ tạo một yêu cầu có lý do và tên mình trên đó;
-- người có quyền phê duyệt quyết định. Hai việc đó là hai dòng dữ liệu khác
-- nhau trong cùng một bảng, vì một yêu cầu không người quyết định và một quyết
-- định không ai yêu cầu đều là dữ liệu không truy được trách nhiệm.
CREATE TABLE sales_order_cancellations (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id             BIGINT UNSIGNED NOT NULL,
  venue_id                    BIGINT UNSIGNED NOT NULL,
  visit_id                    BIGINT UNSIGNED NOT NULL,
  order_id                    BIGINT UNSIGNED NOT NULL,
  line_id                     BIGINT UNSIGNED NOT NULL,
  line_no                     SMALLINT UNSIGNED NOT NULL,
  quantity                    SMALLINT UNSIGNED NOT NULL,
  reason                      VARCHAR(200) NOT NULL,
  -- STANDARD: món chưa làm xong. READY_WASTE: món đã READY/COLLECTED, hủy nghĩa
  -- là bỏ đi một ly đã pha. Đường thứ hai cần quyền riêng và nói thẳng ra rằng
  -- nó là một lần ghi hao, không phải một lần "bỏ món".
  policy                      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'STANDARD',
  status                      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  station                     VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Trạng thái phiếu lúc gửi yêu cầu: người duyệt cần biết món đang ở đâu khi
  -- Phục vụ bấm, không phải chỉ lúc họ mở hàng chờ.
  ticket_status_at_request    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_by_user_id        BIGINT UNSIGNED NOT NULL,
  requested_by_membership_id  BIGINT UNSIGNED NOT NULL,
  requested_at                DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  decided_by_user_id          BIGINT UNSIGNED NULL,
  decided_at                  DATETIME(3) NULL,
  decision_note               VARCHAR(200) NULL,
  version                     INT UNSIGNED NOT NULL DEFAULT 1,
  created_at                  DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at                  DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  -- Một dòng đơn chỉ có MỘT yêu cầu đang chờ. Hai yêu cầu cùng lúc trên cùng
  -- một dòng sẽ được duyệt hai lần và hủy gấp đôi số món.
  open_line_slot              BIGINT UNSIGNED AS (IF(status = 'PENDING', line_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_order_cancellations_open (open_line_slot),
  UNIQUE KEY uq_sales_order_cancellations_venue_id (venue_id, id),
  KEY ix_sales_order_cancellations_queue (venue_id, status, requested_at, id),
  KEY ix_sales_order_cancellations_order (venue_id, order_id, id),
  KEY ix_sales_order_cancellations_visit (venue_id, visit_id, id),
  KEY ix_sales_order_cancellations_requester (requested_by_user_id, requested_at),
  CONSTRAINT fk_sales_order_cancellations_order FOREIGN KEY (venue_id, order_id)
    REFERENCES sales_orders (venue_id, id),
  CONSTRAINT fk_sales_order_cancellations_visit FOREIGN KEY (venue_id, visit_id)
    REFERENCES visits (venue_id, id),
  CONSTRAINT fk_sales_order_cancellations_line FOREIGN KEY (line_id) REFERENCES sales_order_lines (id),
  CONSTRAINT fk_sales_order_cancellations_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_sales_order_cancellations_membership FOREIGN KEY (requested_by_membership_id)
    REFERENCES memberships (id),
  CONSTRAINT fk_sales_order_cancellations_decided_by FOREIGN KEY (decided_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_sales_order_cancellations_quantity CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT ck_sales_order_cancellations_policy CHECK (policy IN ('STANDARD','READY_WASTE')),
  CONSTRAINT ck_sales_order_cancellations_status CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT ck_sales_order_cancellations_station CHECK (station IN ('BAR','KITCHEN')),
  CONSTRAINT ck_sales_order_cancellations_ticket_status CHECK (
    ticket_status_at_request IN ('SUBMITTED','ACCEPTED','PREPARING','READY','COLLECTED')),
  -- Đã quyết định thì phải có người quyết định và thời điểm. Một dòng APPROVED
  -- thiếu hai thứ đó là một món bị hủy mà không ai chịu trách nhiệm.
  CONSTRAINT ck_sales_order_cancellations_decision CHECK (
    (status = 'PENDING' AND decided_by_user_id IS NULL AND decided_at IS NULL)
    OR (status <> 'PENDING' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT ck_sales_order_cancellations_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE sales_order_line_changes
  ADD CONSTRAINT fk_sales_order_line_changes_cancellation FOREIGN KEY (cancellation_id)
    REFERENCES sales_order_cancellations (id);

-- --------------------------------------------------------- permissions ------

INSERT INTO permissions (code, description, is_sensitive) VALUES
  ('order.line.adjust',   'Sửa số lượng món khi quầy chưa nhận phiếu', 0),
  ('order.cancel.request','Gửi yêu cầu hủy món', 0),
  ('order.cancel.approve','Phê duyệt hoặc từ chối yêu cầu hủy món', 1),
  ('order.cancel.ready',  'Yêu cầu hủy món đã làm xong (ghi hao)', 1);

-- Phục vụ: sửa số lượng trước khi quầy nhận, và GỬI yêu cầu hủy. Cố ý KHÔNG có
-- `order.cancel.approve`: người gọi món không phải người cho phép bỏ món, nếu
-- không thì "cần phê duyệt" chỉ là một cú bấm thêm. Cũng không có
-- `order.cancel.ready`: bỏ một ly đã pha là quyết định của quản lý.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('order.line.adjust','order.cancel.request')
WHERE r.code = 'WAITER';

-- Thu ngân: đang đứng ở quầy tính tiền nên duyệt được, và cũng sửa/gửi được.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('order.line.adjust','order.cancel.request','order.cancel.approve')
WHERE r.code = 'CASHIER';

-- OWNER và ADMIN theo luật của 0024: mọi permission trừ venue.configure và
-- customer.anonymize. Không nhắc lại luật này thì Admin Edit âm thầm thiếu bốn
-- quyền mới và màn hàng chờ phê duyệt trống trơn với chính người quản lý.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('order.line.adjust','order.cancel.request','order.cancel.approve','order.cancel.ready')
WHERE r.code IN ('OWNER','ADMIN');

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

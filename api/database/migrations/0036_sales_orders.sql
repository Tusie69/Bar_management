-- migrate:up transaction:false
-- Module Phục vụ 3 — giỏ gọi món đã gửi: đơn, dòng đơn và phiếu chế biến.
--
-- Ba bảng, ba việc khác nhau, cố ý không gộp:
--
-- `sales_orders` là MỘT LẦN BẤM "Gửi đơn". Một Phiên bàn có nhiều đơn vì khách
-- gọi thêm nhiều lượt trong một tối; mỗi lượt là một đơn riêng với người gọi
-- món và thời điểm riêng. Gộp mọi lượt vào một đơn duy nhất theo Phiên sẽ làm
-- mất đúng cái mà Bar cần biết: lượt nào vừa vào.
--
-- `sales_order_lines` là BẢN SAO GIÁ TẠI THỜI ĐIỂM GỬI, không phải một con trỏ
-- tới danh mục. Tên món, tên đơn vị, đơn giá và `price_id`/`price_version`
-- được chép vào dòng đơn. Lý do: `menu_variant_prices` đóng dòng giá cũ lại khi
-- có giá mới (0033), và `menu_items.name` đổi được sau mỗi lần import. Nếu dòng
-- đơn chỉ giữ `variant_id` thì một lần đổi giá lúc 23h sẽ viết lại hoá đơn của
-- những đơn đã gửi lúc 21h. Chúng vẫn giữ cả ID để đối chiếu kho và báo cáo.
--
-- `preparation_tickets` là ĐƯỜNG ĐI CỦA ĐƠN tới quầy. Một đơn vừa có đồ uống
-- vừa có đồ ăn sinh hai phiếu, vì Bar và Bếp là hai chỗ làm việc khác nhau.
-- Routing đọc `preparation_station` đã chép vào dòng đơn, không suy lại từ tên
-- nhóm món — nhóm món đổi được, phiếu đã in thì không.
--
-- Module này KHÔNG có hủy món, thanh toán, VAT, phụ phí hay trừ kho; những thứ
-- đó thuộc module sau. Vì thế `sales_orders.status` chỉ có một giá trị hợp lệ:
-- một trạng thái mà không dòng code nào đặt được là một lời hứa suông.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE sales_orders (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id           BIGINT UNSIGNED NOT NULL,
  venue_id                  BIGINT UNSIGNED NOT NULL,
  visit_id                  BIGINT UNSIGNED NOT NULL,
  -- Số thứ tự đơn TRONG Phiên: "đơn 1", "đơn 2" là cách nhân viên gọi tên lượt
  -- gọi món. Nó được cấp dưới khóa dòng visits, nên hai lần bấm đồng thời
  -- không thể cùng nhận số 2.
  visit_sequence            SMALLINT UNSIGNED NOT NULL,
  business_date             DATE NOT NULL,
  status                    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SUBMITTED',
  ordered_by_user_id        BIGINT UNSIGNED NOT NULL,
  ordered_by_membership_id  BIGINT UNSIGNED NOT NULL,
  submitted_at              DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  line_count                SMALLINT UNSIGNED NOT NULL,
  item_count                SMALLINT UNSIGNED NOT NULL,
  total_amount_vnd          BIGINT UNSIGNED NOT NULL,
  -- Mã chống trùng của lần bấm đã tạo ra đơn này. Hiệu lực chống trùng do
  -- idempotency_keys giữ (0001); cột này là để truy lại một đơn từ mã mà máy
  -- Phục vụ đã gửi khi có khiếu nại "em bấm một lần mà ra hai đơn".
  idempotency_key           VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version                   INT UNSIGNED NOT NULL DEFAULT 1,
  created_at                DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at                DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_orders_venue_id (venue_id, id),
  UNIQUE KEY uq_sales_orders_visit_sequence (venue_id, visit_id, visit_sequence),
  KEY ix_sales_orders_visit (venue_id, visit_id, id),
  KEY ix_sales_orders_venue_date (venue_id, business_date, id),
  KEY ix_sales_orders_actor (ordered_by_user_id, submitted_at),
  CONSTRAINT fk_sales_orders_venue FOREIGN KEY (organization_id, venue_id)
    REFERENCES venues (organization_id, id),
  CONSTRAINT fk_sales_orders_visit FOREIGN KEY (venue_id, visit_id) REFERENCES visits (venue_id, id),
  CONSTRAINT fk_sales_orders_user FOREIGN KEY (ordered_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_sales_orders_membership FOREIGN KEY (ordered_by_membership_id) REFERENCES memberships (id),
  CONSTRAINT ck_sales_orders_status CHECK (status IN ('SUBMITTED')),
  CONSTRAINT ck_sales_orders_sequence CHECK (visit_sequence >= 1),
  CONSTRAINT ck_sales_orders_counts CHECK (line_count BETWEEN 1 AND 50 AND item_count >= line_count),
  -- 50 dòng × 99 món × 1.000.000.000 VND là tổng lớn nhất một đơn hợp lệ đạt
  -- được. Vượt nó nghĩa là một trong ba trần đã bị phá, và chặn ở database là
  -- cách để một con số không còn chính xác không bao giờ được lưu.
  CONSTRAINT ck_sales_orders_total CHECK (total_amount_vnd <= 4950000000000),
  CONSTRAINT ck_sales_orders_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sales_order_lines (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id        BIGINT UNSIGNED NOT NULL,
  venue_id               BIGINT UNSIGNED NOT NULL,
  order_id               BIGINT UNSIGNED NOT NULL,
  line_no                SMALLINT UNSIGNED NOT NULL,
  -- Con trỏ tới danh mục: để đối chiếu kho, báo cáo và tra lịch sử giá.
  menu_item_id           BIGINT UNSIGNED NOT NULL,
  menu_item_variant_id   BIGINT UNSIGNED NOT NULL,
  price_id               BIGINT UNSIGNED NOT NULL,
  price_version          INT UNSIGNED NOT NULL,
  -- Bản sao bất biến: những gì đã in trên phiếu và sẽ in trên hoá đơn.
  item_code              VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_name              VARCHAR(255) NOT NULL,
  variant_display_name   VARCHAR(120) NOT NULL,
  unit_code              VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  preparation_station    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  unit_price_vnd         BIGINT UNSIGNED NOT NULL,
  quantity               SMALLINT UNSIGNED NOT NULL,
  line_total_vnd         BIGINT UNSIGNED AS (unit_price_vnd * quantity) STORED,
  note                   VARCHAR(255) NULL,
  created_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_order_lines_no (order_id, line_no),
  -- KHÔNG có unique trên (order_id, menu_item_variant_id).
  --
  -- Một bàn gọi "hai ly Macallan, một ly không đá" là hai dòng cùng biến thể
  -- với hai ghi chú khác nhau, và Bar phải nhận đúng hai dòng đó. Ép mỗi biến
  -- thể một dòng buộc hai customize khác nhau phải gộp lại, và lúc đó một
  -- trong hai lời nhắn biến mất trên đường tới quầy.
  --
  -- Định danh dòng là (order_id, line_no). Việc GỘP số lượng — chỉ khi cùng
  -- biến thể VÀ cùng ghi chú đã chuẩn hoá — là việc của giỏ ở máy Phục vụ
  -- (`web/src/features/waiter-menu/cart-model.ts`), và route từ chối đúng cặp
  -- trùng khít đó. Không đặt unique thay thế trên ghi chú: chuẩn hoá Unicode là
  -- việc của application, còn collation `utf8mb4_0900_ai_ci` coi "ít đá" và
  -- "IT DA" là một, nên một unique như vậy sẽ chặn hai lời nhắn thật sự khác.
  KEY ix_sales_order_lines_station (venue_id, preparation_station, order_id),
  KEY ix_sales_order_lines_variant (venue_id, menu_item_variant_id, id),
  CONSTRAINT fk_sales_order_lines_order FOREIGN KEY (venue_id, order_id)
    REFERENCES sales_orders (venue_id, id),
  CONSTRAINT fk_sales_order_lines_item FOREIGN KEY (venue_id, menu_item_id)
    REFERENCES menu_items (venue_id, id),
  CONSTRAINT fk_sales_order_lines_variant FOREIGN KEY (venue_id, menu_item_variant_id)
    REFERENCES menu_item_variants (venue_id, id),
  CONSTRAINT fk_sales_order_lines_price FOREIGN KEY (venue_id, price_id)
    REFERENCES menu_variant_prices (venue_id, id),
  CONSTRAINT ck_sales_order_lines_station CHECK (preparation_station IN ('BAR','KITCHEN')),
  CONSTRAINT ck_sales_order_lines_quantity CHECK (quantity BETWEEN 1 AND 99),
  -- Trần đơn giá 1.000.000.000 VND. Không phải vì một chai rượu một tỷ là vô
  -- lý (nó vô lý), mà vì tiền đi qua JSON dưới dạng `number`: trần này nhân với
  -- số lượng tối đa và số dòng tối đa vẫn nằm trong khoảng nguyên chính xác của
  -- JavaScript (4,95e12 < 9,007e15). BIGINT UNSIGNED thì chứa được 1,8e19, và
  -- một con số như thế khi về tới trình duyệt sẽ bị làm tròn âm thầm — hoá đơn
  -- lệch mà không ai thấy lỗi ở đâu.
  CONSTRAINT ck_sales_order_lines_price CHECK (unit_price_vnd BETWEEN 1 AND 1000000000),
  CONSTRAINT ck_sales_order_lines_no CHECK (line_no >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- `line_total_vnd` là cột sinh (STORED), không phải một con số do application
-- tính rồi ghi vào: hai nguồn sự thật cho cùng một phép nhân là cách để hoá đơn
-- lệch tổng mà không ai biết dòng nào sai.
--
-- Bản sao giá là BẤT BIẾN. Không có endpoint nào UPDATE bảng này; sửa một đơn
-- đã gửi (hủy món, đổi số lượng) thuộc module sau và sẽ là một bản ghi mới chứ
-- không phải một lần ghi đè. MySQL không có cách chặn UPDATE mà không cần
-- trigger (và trigger đòi quyền SUPER/log_bin_trust_function_creators mà deploy
-- của dự án cố ý không cấp), nên ràng buộc này nằm ở code và có test canh.

CREATE TABLE preparation_tickets (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id      BIGINT UNSIGNED NOT NULL,
  venue_id             BIGINT UNSIGNED NOT NULL,
  order_id             BIGINT UNSIGNED NOT NULL,
  visit_id             BIGINT UNSIGNED NOT NULL,
  station              VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'QUEUED',
  line_count           SMALLINT UNSIGNED NOT NULL,
  item_count           SMALLINT UNSIGNED NOT NULL,
  printed_at           DATETIME(3) NULL,
  version              INT UNSIGNED NOT NULL DEFAULT 1,
  created_at           DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at           DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_preparation_tickets_order_station (order_id, station),
  UNIQUE KEY uq_preparation_tickets_venue_id (venue_id, id),
  KEY ix_preparation_tickets_queue (venue_id, station, status, id),
  KEY ix_preparation_tickets_visit (venue_id, visit_id, id),
  CONSTRAINT fk_preparation_tickets_order FOREIGN KEY (venue_id, order_id)
    REFERENCES sales_orders (venue_id, id),
  CONSTRAINT fk_preparation_tickets_visit FOREIGN KEY (venue_id, visit_id)
    REFERENCES visits (venue_id, id),
  CONSTRAINT ck_preparation_tickets_station CHECK (station IN ('BAR','KITCHEN')),
  CONSTRAINT ck_preparation_tickets_status CHECK (status IN ('QUEUED')),
  CONSTRAINT ck_preparation_tickets_counts CHECK (line_count >= 1 AND item_count >= line_count),
  CONSTRAINT ck_preparation_tickets_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Phiếu đi theo ĐƠN, và đơn đi theo PHIÊN, không theo bàn. Một cụm bốn bàn
-- ghép là một Phiên; nếu phiếu mang `table_id` thì đổi bàn giữa tối sẽ làm
-- phiếu trỏ về một bàn mà đoàn khách không còn ngồi. Mã bàn để in lên phiếu
-- được đọc từ allocation USAGE đang mở của Phiên tại lúc in.

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

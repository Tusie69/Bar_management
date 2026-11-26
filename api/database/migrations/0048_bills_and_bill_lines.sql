-- migrate:up transaction:false
-- TU-45 — bill ĐÃ CHỐT: ba bảng, ba việc khác nhau, cố ý không gộp.
--
-- `bills` là MỘT LẦN BẤM "Chốt bill". Nó khoá con số khách phải trả lại một
-- thời điểm. Khác `GET /visits/:id/bill` (bill tạm tính, module trước) ở đúng
-- chỗ đó: tạm tính là một phép đọc, không ghi gì, bấm mười lần vẫn là mười lần
-- đọc; chốt bill là một phép ghi, và sau nó Phiên chuyển sang Chờ thanh toán.
--
-- `bill_lines` là BẢN SAO GIÁ LẦN THỨ HAI. Dòng đơn (`sales_order_lines`, 0036)
-- đã chép giá lúc gửi đơn, nên có người sẽ hỏi vì sao chép lại. Lý do: dòng đơn
-- trả lời "khách đã gọi gì", còn dòng bill trả lời "tờ giấy này in gì". Hai câu
-- đó khác nhau kể từ lúc có hủy món: `listVisitItems` GỘP theo (biến thể, ghi
-- chú, giá) và bỏ dòng `net_quantity = 0`, nên một dòng bill thường là tổng của
-- nhiều dòng đơn. Dựng lại phép gộp đó mỗi lần in là dựng lại một con số đã
-- chốt, và nó sẽ đổi vào ngày ai đó sửa câu SQL gộp.
--
-- `bill_charge_lines` là SỔ TÍNH TIỀN (ledger), append-only theo `sequence_no`.
-- Hiện chỉ có ba hàng: tạm tính, VAT, làm tròn. Nó không phải một policy engine
-- — `docs/module-6-billing-decisions.md` đề xuất một cái, nhưng 90% các bước nó
-- mô tả (phí phục vụ, phụ thu, voucher) đang chờ HU-43, và xây một cái máy chạy
-- công thức khi chưa ai nói công thức là gì thì rẻ nhất là đừng xây. Ledger này
-- là đường thoát rẻ: thêm phí phục vụ sau này là thêm MỘT HÀNG, không phải sửa
-- công thức đã in ra những tờ bill cũ.
--
-- TIỀN LÀ SỐ NGUYÊN ĐỒNG, `BIGINT UNSIGNED`, đúng như `0036` và `0033`. Không
-- `DECIMAL`: đồng Việt Nam không có đơn vị nhỏ hơn, nên `DECIMAL(13,0)` biểu
-- diễn đúng cùng một tập giá trị mà không chính xác hơn một chút nào. Cái nguy
-- hiểm thật là TRỘN hai kiểu — `mysql2` trả `DECIMAL` về Node dạng chuỗi và
-- `BIGINT` dạng số, nên một phép cộng giữa `bill_lines.amount_vnd` (DECIMAL) và
-- `sales_order_lines.net_total_vnd` (BIGINT) sẽ là chỗ một đồng biến mất mà
-- không ai truy được.
--
-- Module này KHÔNG có thanh toán, QR, giảm giá, phí phục vụ hay tách bill.
-- Thanh toán là 0049. Ba thứ còn lại chờ HU-43, và vì thế `bill_charge_lines`
-- chỉ nhận ba `charge_code`: một trạng thái mà không dòng code nào đặt được là
-- một lời hứa suông.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE bills (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id          BIGINT UNSIGNED NOT NULL,
  venue_id                 BIGINT UNSIGNED NOT NULL,
  visit_id                 BIGINT UNSIGNED NOT NULL,
  business_date            DATE NOT NULL,
  -- `B261126-0412`. Mockup hiện `B0412` cho ngắn, nhưng mã này đi vào nội dung
  -- chuyển khoản rồi vào sao kê ngân hàng: bốn chữ số lặp lại mỗi ngày, và một
  -- sao kê tháng có ba mươi dòng `B0412` là một cuộc đối soát không làm xong
  -- được. Bản ngắn dựng lại từ `daily_seq` ở phía ứng dụng khi cần đọc to.
  bill_code                VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Số thứ tự trong NGÀY KINH DOANH, không phải ngày dương lịch: quán mở
  -- 17:00–05:00, nên đánh số theo ngày dương lịch sẽ cắt một ca thành hai dãy
  -- số lúc nửa đêm. Số được cấp dưới khóa dòng `venues` (xem bill.repository),
  -- nên hai máy cùng bấm Chốt không thể cùng nhận số 412.
  daily_seq                SMALLINT UNSIGNED NOT NULL,
  -- Lần chốt thứ mấy của Phiên. Khách gọi thêm sau khi đã chốt thì bill cũ
  -- thành SUPERSEDED và lần chốt sau là revision 2 — bill đã chốt BẤT BIẾN,
  -- không sửa tại chỗ, vì một con số khách đã nhìn thì phải còn đọc lại được.
  -- Endpoint mở lại Phiên chưa có (nó gần "hủy bill đã thanh toán", đang chờ
  -- HU-43); cột này có trước để lần đó không phải migration lại bảng.
  revision                 SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  status                   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'AWAITING_PAYMENT',
  -- Thuế suất CHÉP LẠI, không đọc `venues.vat_rate_basis_points` lúc in: kế
  -- toán đổi thuế suất tháng sau thì tờ bill tháng này vẫn phải cộng đúng.
  vat_rate_basis_points    SMALLINT UNSIGNED NOT NULL,
  subtotal_vnd             BIGINT UNSIGNED NOT NULL,
  vat_vnd                  BIGINT UNSIGNED NOT NULL,
  -- `subtotal + vat`, TRƯỚC làm tròn. Con số này tồn tại riêng vì kế toán cần
  -- thấy quán đã làm tròn lên bao nhiêu, và vì gộp nó vào VAT là làm sai một
  -- dòng thuế.
  pre_round_total_vnd      BIGINT UNSIGNED NOT NULL,
  rounding_adjustment_vnd  SMALLINT UNSIGNED NOT NULL,
  -- Số khách phải trả. TN-06 (anh Luân, 18/11): làm tròn LÊN nghìn, là bước
  -- cuối. 230.560đ → 231.000đ.
  total_vnd                BIGINT UNSIGNED NOT NULL,
  line_count               SMALLINT UNSIGNED NOT NULL,
  item_count               SMALLINT UNSIGNED NOT NULL,
  -- Luật tiền đã dùng cho CHÍNH bill này: thuế inclusive/exclusive, VAT tính
  -- trên tổng hay từng dòng, làm tròn ở đâu. Tập khóa cố định và có test canh
  -- (`bill-total.test.ts`) — một JSON tự do là chỗ sớm muộn sẽ có người nhét số
  -- điện thoại khách vào "cho chắc".
  pricing_policy_snapshot  JSON NOT NULL,
  closed_by_user_id        BIGINT UNSIGNED NOT NULL,
  closed_at                DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  paid_by_user_id          BIGINT UNSIGNED NULL,
  paid_at                  DATETIME(3) NULL,
  -- Mã chống trùng của lần bấm đã tạo ra bill này. Hiệu lực chống trùng do
  -- `idempotency_keys` (0001) giữ; cột này là để truy lại một bill từ mã mà máy
  -- đã gửi khi có khiếu nại "em bấm một lần mà ra hai bill".
  idempotency_key          VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version                  INT UNSIGNED NOT NULL DEFAULT 1,
  created_at               DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at               DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  -- MỘT PHIÊN MỘT BILL ĐANG MỞ, do database bảo đảm. Hai máy cùng bấm "Chốt
  -- bill" trên cùng một bàn: máy thứ hai nhận ER_DUP_ENTRY và route dịch thành
  -- 409 kèm `billId`, nên nó mở đúng bill vừa được chốt thay vì tạo bill thứ
  -- hai. Cột sinh NULL-khi-không-mở là cách duy nhất ép được luật này mà không
  -- cần trigger (deploy của dự án cố ý không cấp SUPER).
  open_visit_slot          BIGINT UNSIGNED AS (IF(status = 'AWAITING_PAYMENT', visit_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bills_venue_id (venue_id, id),
  UNIQUE KEY uq_bills_one_open_per_visit (venue_id, open_visit_slot),
  UNIQUE KEY uq_bills_code (venue_id, bill_code),
  UNIQUE KEY uq_bills_daily_seq (venue_id, business_date, daily_seq),
  UNIQUE KEY uq_bills_visit_revision (venue_id, visit_id, revision),
  -- Index FK chính xác khai trước các index rộng hơn (MySQL 9.7.2 FK-skip, doc 07).
  KEY fx_bills_venue (organization_id, venue_id),
  KEY fx_bills_visit (venue_id, visit_id),
  KEY ix_bills_visit_id (venue_id, visit_id, id),
  KEY ix_bills_venue_date_status (venue_id, business_date, status, id),
  KEY ix_bills_closed_by (closed_by_user_id, closed_at),
  CONSTRAINT fk_bills_venue FOREIGN KEY (organization_id, venue_id) REFERENCES venues (organization_id, id),
  CONSTRAINT fk_bills_visit FOREIGN KEY (venue_id, visit_id) REFERENCES visits (venue_id, id),
  CONSTRAINT fk_bills_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_bills_paid_by FOREIGN KEY (paid_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_bills_status CHECK (status IN ('AWAITING_PAYMENT','PAID','VOIDED','SUPERSEDED')),
  -- Không có bill đã thanh toán mà không biết ai thu lúc nào, và không có dấu
  -- "đã thu" trên một bill chưa ở trạng thái PAID.
  CONSTRAINT ck_bills_paid CHECK (
    (status = 'PAID') = (paid_at IS NOT NULL AND paid_by_user_id IS NOT NULL)),
  -- Bốn ràng buộc số học. Chúng không kiểm được `subtotal` có bằng tổng các
  -- dòng hay không (CHECK không đọc bảng khác) — việc đó do
  -- `bill-close.mysql.test.ts` canh. Nhưng ba bước làm tròn thì ép được ở đây,
  -- và một tổng không khớp các bước của nó là tờ bill không ai cãi lại được.
  CONSTRAINT ck_bills_pre_round CHECK (pre_round_total_vnd = subtotal_vnd + vat_vnd),
  CONSTRAINT ck_bills_total CHECK (total_vnd = pre_round_total_vnd + rounding_adjustment_vnd),
  CONSTRAINT ck_bills_rounding CHECK (rounding_adjustment_vnd <= 999),
  CONSTRAINT ck_bills_total_thousand CHECK (total_vnd % 1000 = 0),
  -- Cùng trần với `ck_sales_orders_total` (0036): tiền đi qua JSON dưới dạng
  -- `number`, và 4,95e12 là con số lớn nhất còn nằm trong khoảng nguyên chính
  -- xác của JavaScript. Vượt nó nghĩa là một tổng sẽ bị làm tròn âm thầm khi về
  -- tới trình duyệt — hoá đơn lệch mà không ai thấy lỗi ở đâu.
  CONSTRAINT ck_bills_total_ceiling CHECK (total_vnd <= 4950000000000),
  CONSTRAINT ck_bills_vat_rate CHECK (vat_rate_basis_points <= 10000),
  CONSTRAINT ck_bills_counts CHECK (line_count <= 500 AND item_count >= line_count),
  CONSTRAINT ck_bills_daily_seq CHECK (daily_seq BETWEEN 1 AND 9999),
  CONSTRAINT ck_bills_revision CHECK (revision >= 1),
  CONSTRAINT ck_bills_version CHECK (version >= 1),
  CONSTRAINT ck_bills_policy_json CHECK (JSON_TYPE(pricing_policy_snapshot) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bill_lines (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id        BIGINT UNSIGNED NOT NULL,
  venue_id               BIGINT UNSIGNED NOT NULL,
  bill_id                BIGINT UNSIGNED NOT NULL,
  line_no                SMALLINT UNSIGNED NOT NULL,
  -- Con trỏ đối soát: `MIN(sales_order_lines.id)` của nhóm đã gộp. KHÔNG phải
  -- khóa duy nhất của dòng bill, vì một dòng bill thường gộp nhiều dòng đơn
  -- (cùng biến thể, cùng ghi chú, cùng giá, gọi ở hai lượt khác nhau).
  source_order_line_id   BIGINT UNSIGNED NOT NULL,
  item_code              VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_name              VARCHAR(255) NOT NULL,
  variant_display_name   VARCHAR(120) NOT NULL,
  unit_code              VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Ghi chú ĐÃ ĐƯỢC LƯỢC số điện thoại trước khi ghi vào đây (note-privacy.ts).
  -- Ô ghi chú là chỗ nhân viên gõ tự do và đã có lần mang theo tên hay số điện
  -- thoại khách; một tờ bill in ra là thứ ra khỏi hệ thống.
  note                   VARCHAR(255) NULL,
  quantity               SMALLINT UNSIGNED NOT NULL,
  unit_price_vnd         BIGINT UNSIGNED NOT NULL,
  -- Cột SINH, không phải con số do application tính rồi ghi vào: hai nguồn sự
  -- thật cho cùng một phép nhân là cách để hoá đơn lệch tổng mà không ai biết
  -- dòng nào sai. Giống `sales_order_lines.line_total_vnd` (0036).
  amount_vnd             BIGINT UNSIGNED AS (unit_price_vnd * quantity) STORED,
  created_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bill_lines_no (bill_id, line_no),
  KEY fx_bill_lines_bill (venue_id, bill_id),
  KEY fx_bill_lines_source (source_order_line_id),
  KEY ix_bill_lines_source_venue (venue_id, source_order_line_id),
  CONSTRAINT fk_bill_lines_bill FOREIGN KEY (venue_id, bill_id) REFERENCES bills (venue_id, id),
  CONSTRAINT fk_bill_lines_source FOREIGN KEY (source_order_line_id) REFERENCES sales_order_lines (id),
  CONSTRAINT ck_bill_lines_no CHECK (line_no >= 1),
  CONSTRAINT ck_bill_lines_quantity CHECK (quantity BETWEEN 1 AND 9999),
  -- Cùng trần đơn giá với `0036`, cùng một lý do.
  CONSTRAINT ck_bill_lines_price CHECK (unit_price_vnd BETWEEN 1 AND 1000000000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- `bill_lines` BẤT BIẾN: không endpoint nào UPDATE hay DELETE bảng này. Sửa một
-- bill đã chốt là một bill mới (revision), không phải một lần ghi đè. MySQL
-- không chặn được UPDATE mà không cần trigger, nên ràng buộc nằm ở code và có
-- test canh — y như `sales_order_lines`.

CREATE TABLE bill_charge_lines (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     BIGINT UNSIGNED NOT NULL,
  venue_id            BIGINT UNSIGNED NOT NULL,
  bill_id             BIGINT UNSIGNED NOT NULL,
  sequence_no         SMALLINT UNSIGNED NOT NULL,
  charge_code         VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Nền đã dùng để tính khoản này: VAT tính trên `subtotal`, làm tròn tính
  -- trên `pre_round_total`. Lưu lại để đọc ledger từ trên xuống là ra tổng mà
  -- không phải suy lại thứ tự từ UI.
  basis_amount_vnd    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rate_basis_points   SMALLINT UNSIGNED NULL,
  -- CÓ DẤU, dù cả ba loại hiện tại đều không âm: giảm giá (chờ HU-43) sẽ là một
  -- hàng âm, và đổi kiểu một cột đã có dữ liệu là migration không ai muốn làm
  -- vào một tối thứ Sáu.
  signed_amount_vnd   BIGINT NOT NULL,
  explanation         VARCHAR(255) NOT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bill_charges_seq (bill_id, sequence_no),
  UNIQUE KEY uq_bill_charges_code (bill_id, charge_code),
  KEY fx_bill_charges_bill (venue_id, bill_id),
  CONSTRAINT fk_bill_charges_bill FOREIGN KEY (venue_id, bill_id) REFERENCES bills (venue_id, id),
  -- Ba loại, và chỉ ba. Giảm giá, phí phục vụ, phụ thu và voucher chờ HU-43;
  -- nới CHECK này là việc của migration sau khi có quyết định, không phải việc
  -- của một lần "tạm thêm cho đủ".
  CONSTRAINT ck_bill_charges_code CHECK (charge_code IN ('ITEM_SUBTOTAL','VAT','FINAL_ROUNDING')),
  CONSTRAINT ck_bill_charges_rate CHECK ((charge_code = 'VAT') = (rate_basis_points IS NOT NULL)),
  CONSTRAINT ck_bill_charges_seq CHECK (sequence_no >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Phân quyền: KHÔNG có permission mới.
--
-- Quyết định nghiệp vụ nói "Phục vụ bấm Chốt bill & thanh toán", nhưng phân
-- quyền 15/11 đã nằm trong `0027`: `payment.collect` thuộc OWNER, ADMIN và
-- CASHIER; WAITER không có, và `0041` còn ghi thẳng "Bar không thu tiền".
-- Mockup NA-44 cũng đánh dấu điểm này là CHỜ BA CHỐT với hai phương án.
--
-- Cấp quyền thu tiền là việc một chiều: cấp rồi mà BA đổi ý thì phải thu hồi
-- quyền của người đang dùng giữa ca. Nên tuần này chỉ Thu ngân chốt bill, bằng
-- permission đã có sẵn. Chuyển sang "Phục vụ chốt bill" về sau là MỘT migration
-- `INSERT INTO role_permissions` và một nhãn trên màn hình, không phải viết lại
-- module này.

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

-- migrate:up transaction:false
-- HU-44 v1.1 (V12) — MỘT PHIÊN CÓ NHIỀU BILL, và hoá đơn mang sẵn mã QR.
--
-- Bản 22/11 mà `0048` làm theo nói: một Phiên một bill, chốt bill xong thì khoá
-- gọi món. Bản v1.1 (26/11) nói ngược lại: khách gọi thêm sau khi đã Xuất hóa
-- đơn thì bill cũ GIỮ NGUYÊN và món mới vào một BILL MỚI của cùng Phiên; Phiên
-- chỉ đóng khi bill cuối đã thu và không còn món nào chưa lên bill (TN-13-K3/K4).
--
-- Ba thay đổi, và cái thứ hai là cái quan trọng:
--
-- 1. BỎ `uq_bills_one_open_per_visit`. Bill 1 "Chưa thu" và bill 2 vừa xuất
--    phải cùng tồn tại được. Cột sinh `open_visit_slot` được giữ lại dưới dạng
--    index thường: nó vẫn là cách nhanh nhất để hỏi "Phiên này còn bill nào
--    chưa thu".
--
-- 2. THÊM `bill_line_sources`. Không có bảng này, câu SQL dựng bill lấy MỌI món
--    của Phiên, nên bill thứ hai sẽ lặp lại toàn bộ món của bill thứ nhất —
--    khách bị thu tiền hai lần. Đó là lỗi tiền thật, không phải lỗi hiển thị.
--
--    Vì sao không dùng `bill_lines.source_order_line_id` đang có: một dòng bill
--    là KẾT QUẢ GỘP của nhiều dòng đơn (gộp theo biến thể + ghi chú + giá), và
--    cột đó chỉ giữ `MIN(id)` của nhóm. Nó là con trỏ để tra ngược, không phải
--    quan hệ đầy đủ. Muốn trừ ra phần đã lên bill thì phải biết TỪNG dòng đơn
--    đã góp BAO NHIÊU — và đó cũng chính là dữ liệu mà tách bill (TN-11) sẽ cần.
--
--    Không đặt cột `billed_quantity` lên `sales_order_lines`: bảng đó bất biến
--    từ `0036` ("không có endpoint nào UPDATE bảng này"), và phá một bất biến để
--    tiết kiệm một bảng là cách mất nó vĩnh viễn.
--
-- 3. THÊM mã QR lên chính `bills`. v1.1 đặt QR TRÊN HOÁ ĐƠN chứ không ở màn thu
--    tiền: Phục vụ bấm Xuất hóa đơn là có ngay QR đúng số tiền để đưa khách cầm
--    ra quầy (TN-02-K4). Ở `0049` nó nằm trên giao dịch, tức là khách phải đứng
--    tại quầy mới thấy QR — đúng luồng 22/11, sai luồng v1.1.
--    `bill_payments.qr_payload` GIỮ NGUYÊN: nó là bản sao của chuỗi đã dùng tại
--    thời điểm thu, để đối soát đọc đúng cái khách đã quét.
--
-- Quyền "Xuất hóa đơn" cho Phục vụ và Bartender KHÔNG nằm trong migration này:
-- mã quyền đang chờ O16 (Hưng → anh Luân). Đặt tên một permission rồi đổi sau
-- là việc phải thu hồi quyền của người đang dùng giữa ca.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------- 1. một Phiên nhiều bill --

ALTER TABLE bills DROP INDEX uq_bills_one_open_per_visit;

-- Giữ cột sinh, chỉ hạ từ UNIQUE xuống index thường.
CREATE INDEX ix_bills_open_visit ON bills (venue_id, open_visit_slot);

-- ------------------------------------------------ 2. món nào lên bill nào --

CREATE TABLE bill_line_sources (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  venue_id        BIGINT UNSIGNED NOT NULL,
  bill_id         BIGINT UNSIGNED NOT NULL,
  bill_line_id    BIGINT UNSIGNED NOT NULL,
  order_line_id   BIGINT UNSIGNED NOT NULL,
  -- Số lượng của DÒNG ĐƠN NÀY đã góp vào dòng bill kia. Không phải số lượng của
  -- dòng bill: một dòng bill gộp nhiều dòng đơn, nên tổng các `quantity` ở đây
  -- mới bằng `bill_lines.quantity`.
  quantity        SMALLINT UNSIGNED NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (id),
  -- Một dòng đơn góp vào một dòng bill đúng một lần. Góp vào HAI dòng bill khác
  -- nhau thì được (tách bill sau này), nên unique là cặp chứ không phải một cột.
  UNIQUE KEY uq_bill_line_sources_pair (bill_line_id, order_line_id),
  KEY fx_bill_line_sources_bill (venue_id, bill_id),
  KEY fx_bill_line_sources_line (bill_line_id),
  KEY fx_bill_line_sources_order_line (order_line_id),
  -- Câu hỏi nóng nhất của bảng này: "dòng đơn X đã lên bill bao nhiêu?"
  KEY ix_bill_line_sources_billed (venue_id, order_line_id, quantity),
  CONSTRAINT fk_bill_line_sources_bill FOREIGN KEY (venue_id, bill_id) REFERENCES bills (venue_id, id),
  CONSTRAINT fk_bill_line_sources_line FOREIGN KEY (bill_line_id) REFERENCES bill_lines (id),
  CONSTRAINT fk_bill_line_sources_order_line FOREIGN KEY (order_line_id) REFERENCES sales_order_lines (id),
  CONSTRAINT ck_bill_line_sources_quantity CHECK (quantity BETWEEN 1 AND 9999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Ràng buộc KHÔNG ép được ở đây: tổng `quantity` của một `order_line_id` (qua
-- các bill chưa huỷ) phải ≤ `sales_order_lines.net_quantity`. Một CHECK không
-- đọc được bảng khác và deploy cố ý không cấp quyền tạo trigger, nên luật này
-- nằm ở repository — trong transaction đang giữ khóa dòng Phiên — và có test
-- canh (`bill-multi.mysql.test.ts`).

-- ------------------------------------------- 3. hoá đơn mang sẵn mã QR --

ALTER TABLE bills
  ADD COLUMN qr_provider       VARCHAR(30)  CHARACTER SET ascii COLLATE ascii_bin NULL AFTER pricing_policy_snapshot,
  ADD COLUMN qr_payload        VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER qr_provider,
  ADD COLUMN qr_payload_sha256 CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NULL AFTER qr_payload,
  ADD COLUMN qr_transfer_note  VARCHAR(25)  CHARACTER SET ascii COLLATE ascii_bin NULL AFTER qr_payload_sha256;

-- QR là TUỲ CHỌN trên hoá đơn, và đó là một quyết định chứ không phải sơ suất.
-- Quán chưa cung cấp số tài khoản Techcombank (HD-06), và nếu thiếu cấu hình mà
-- chặn luôn việc Xuất hóa đơn thì luồng TIỀN MẶT cũng chết theo. Hoá đơn vẫn
-- xuất được, phần QR để trống kèm lý do; thẻ Chuyển khoản ở màn Thu ngân khoá.
ALTER TABLE bills
  ADD CONSTRAINT ck_bills_qr CHECK ((qr_payload IS NULL) = (qr_payload_sha256 IS NULL));

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

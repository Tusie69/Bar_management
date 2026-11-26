-- migrate:up transaction:false
-- TU-46 — giao dịch thu tiền của một bill.
--
-- MỘT BẢNG, và cột quan trọng nhất của nó là một cột SINH:
--
--   settled_bill_slot = IF(status = 'CAPTURED', bill_id, NULL)   UNIQUE
--
-- Đó là lời hứa "một bill thu đúng một lần", và nó do DATABASE giữ chứ không
-- phải do code. Lý do: ba lớp chống trùng ở trên nó đều có thể thủng theo một
-- cách khác nhau. Nút khoá ở UI không chặn được hai thiết bị. Mã chống trùng
-- không chặn được hai mã khác nhau cho cùng một bill. Kiểm "đã thu chưa?" rồi
-- mới INSERT là một khoảng hở giữa hai câu lệnh. Cột sinh + unique thì đúng kể
-- cả khi cả ba lớp kia sai, và nó đúng với cả một lần INSERT tay vòng qua ứng
-- dụng.
--
-- `bills.paid_at` KHÔNG phải khoá đó. Nó là một cột được UPDATE, và một UPDATE
-- không chặn được một INSERT song song. Nó tồn tại để đọc nhanh, không để ép luật.
--
-- GHI NỢ BỊ CHẶN Ở ĐÂY, không chỉ ở màn hình (CH-05). `ck_bill_payments_method`
-- cho `method` có ba giá trị nhưng `ck_bill_payments_not_credit` từ chối thẳng
-- CREDIT. Hai CHECK thay vì một enum hai giá trị, vì ngày HU-43 mở Ghi nợ thì
-- việc cần làm là BỎ một CHECK — không phải sửa một enum đang có dữ liệu, và
-- không phải đi tìm xem còn chỗ nào khác cũng liệt kê phương thức.
--
-- TIỀN KHÁCH ĐƯA và TIỀN THỪA được lưu (quyết định 26/11, Q6). Mockup Màn 5 đặc
-- tả đủ cả ô nhập, các mệnh giá nhanh và hai trạng thái thiếu/thừa, nên đây
-- không phải suy đoán. Và "tiền thừa" là số nhân viên phải trả lại khách: thiếu
-- nó trong đối soát thì một ca lệch 69.000đ mà không ai biết nó đi đâu.
-- `change_amount_vnd` là cột SINH, không phải con số frontend gửi lên.
--
-- CỔNG THANH TOÁN CHƯA CÓ (CH-02, anh Luân chưa duyệt chi phí). Tuần này mọi
-- giao dịch mang `confirmation_mode = 'MANUAL'` và tên người đã tick "đã thấy
-- tiền về" (TN-09). Giá trị `GATEWAY` đã nằm trong CHECK để ngày có webhook
-- không phải migration lại bảng — chừa chỗ, không giả lập.
--
-- `qr_payload` lưu NGUYÊN CHUỖI khách đã quét, không lưu ảnh và không dựng lại
-- từ cấu hình lúc đối soát: cấu hình đổi được, chuỗi đã quét thì không.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE bill_payments (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id        BIGINT UNSIGNED NOT NULL,
  venue_id               BIGINT UNSIGNED NOT NULL,
  bill_id                BIGINT UNSIGNED NOT NULL,
  business_date          DATE NOT NULL,
  method                 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status                 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Bằng `bills.total_vnd` tại thời điểm thu. Chép lại thay vì JOIN mỗi lần:
  -- báo cáo ca cộng cột này, và một bill bị sửa (revision) không được làm đổi
  -- con số đã thu.
  amount_vnd             BIGINT UNSIGNED NOT NULL,
  tendered_amount_vnd    BIGINT UNSIGNED NULL,
  change_amount_vnd      BIGINT UNSIGNED AS (IFNULL(tendered_amount_vnd, amount_vnd) - amount_vnd) STORED,
  confirmation_mode      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MANUAL',
  qr_provider            VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Chuỗi EMVCo đầy đủ. 512 là thừa thãi có chủ đích: một chuỗi VietQR thực tế
  -- dài chừng 140 ký tự, và cột chật là thứ sẽ cắt mất đuôi CRC vào đúng tối
  -- quán đông nhất.
  qr_payload             VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL,
  qr_payload_sha256      CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  qr_transfer_note       VARCHAR(25) CHARACTER SET ascii COLLATE ascii_bin NULL,
  collected_by_user_id   BIGINT UNSIGNED NOT NULL,
  -- Ai tick "đã thấy tiền về". Với tiền mặt là chính người thu; với chuyển
  -- khoản có thể là người khác, và đó là lý do nó là một cột riêng.
  confirmed_by_user_id   BIGINT UNSIGNED NULL,
  confirmed_at           DATETIME(3) NULL,
  failure_code           VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_key        VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version                INT UNSIGNED NOT NULL DEFAULT 1,
  created_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  updated_at             DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  -- MỘT BILL, MỘT LẦN THU. Xem khối comment đầu file.
  settled_bill_slot      BIGINT UNSIGNED AS (IF(status = 'CAPTURED', bill_id, NULL)) STORED,
  -- Một bill cũng chỉ có MỘT giao dịch chuyển khoản đang chờ: bấm "Chuyển khoản
  -- QR" ba lần không được sinh ba mã QR khác nhau cho cùng một số tiền, vì lúc
  -- đối soát sẽ không biết khách đã quét mã nào.
  pending_bill_slot      BIGINT UNSIGNED AS (IF(status = 'PENDING', bill_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bill_payments_venue_id (venue_id, id),
  UNIQUE KEY uq_bill_payments_settled (venue_id, settled_bill_slot),
  UNIQUE KEY uq_bill_payments_pending (venue_id, pending_bill_slot),
  -- Index FK chính xác khai trước các index rộng hơn (MySQL 9.7.2 FK-skip, doc 07).
  KEY fx_bill_payments_venue (organization_id, venue_id),
  KEY fx_bill_payments_bill (venue_id, bill_id),
  KEY ix_bill_payments_bill_id (venue_id, bill_id, id),
  -- Báo cáo ca: bao nhiêu tiền mặt, bao nhiêu chuyển khoản, trong ngày nào.
  KEY ix_bill_payments_shift (venue_id, business_date, method, status, id),
  -- "Ai thu khoản này" — câu hỏi của mọi lần bàn giao tiền cuối ca.
  KEY ix_bill_payments_collector (collected_by_user_id, confirmed_at),
  CONSTRAINT fk_bill_payments_venue FOREIGN KEY (organization_id, venue_id)
    REFERENCES venues (organization_id, id),
  CONSTRAINT fk_bill_payments_bill FOREIGN KEY (venue_id, bill_id) REFERENCES bills (venue_id, id),
  CONSTRAINT fk_bill_payments_collector FOREIGN KEY (collected_by_user_id) REFERENCES users (id),
  CONSTRAINT fk_bill_payments_confirmer FOREIGN KEY (confirmed_by_user_id) REFERENCES users (id),
  CONSTRAINT ck_bill_payments_method CHECK (method IN ('CASH','BANK_TRANSFER','CREDIT')),
  -- CH-05: Ghi nợ hiện trên màn hình ở trạng thái khoá, và không ghi được vào
  -- database. Bỏ CHECK này là việc của migration sau khi HU-43 chốt.
  CONSTRAINT ck_bill_payments_not_credit CHECK (method <> 'CREDIT'),
  CONSTRAINT ck_bill_payments_status CHECK (status IN ('PENDING','CAPTURED','FAILED','CANCELLED')),
  CONSTRAINT ck_bill_payments_confirmation CHECK (confirmation_mode IN ('MANUAL','GATEWAY')),
  -- Mọi khoản ĐÃ THU đều biết ai xác nhận lúc nào. Không có ngoại lệ, kể cả
  -- khi sau này có webhook: cổng xác nhận thì người bấm "dùng cổng" là người
  -- chịu trách nhiệm.
  CONSTRAINT ck_bill_payments_captured CHECK (
    (status = 'CAPTURED') = (confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL)),
  -- Tiền mặt luôn có số khách đưa; chuyển khoản thì không có khái niệm đó.
  CONSTRAINT ck_bill_payments_tendered CHECK ((method = 'CASH') = (tendered_amount_vnd IS NOT NULL)),
  -- Không bao giờ CAPTURED một khoản khách đưa thiếu. Màn hình đã khoá nút,
  -- nhưng màn hình không phải chỗ giữ luật về tiền.
  CONSTRAINT ck_bill_payments_enough CHECK (
    tendered_amount_vnd IS NULL OR tendered_amount_vnd >= amount_vnd),
  -- Chuyển khoản luôn lưu lại chuỗi QR khách đã quét, để đối soát đọc được.
  CONSTRAINT ck_bill_payments_qr CHECK ((method = 'BANK_TRANSFER') = (qr_payload IS NOT NULL)),
  CONSTRAINT ck_bill_payments_qr_hash CHECK ((qr_payload IS NULL) = (qr_payload_sha256 IS NULL)),
  -- Khớp `ck_bills_total_thousand`: số thu phải là số bill đã chốt.
  CONSTRAINT ck_bill_payments_amount CHECK (amount_vnd > 0 AND amount_vnd % 1000 = 0),
  CONSTRAINT ck_bill_payments_amount_ceiling CHECK (amount_vnd <= 4950000000000),
  CONSTRAINT ck_bill_payments_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tài khoản nhận tiền cho VietQR.
--
-- Nằm trong `venue_settings` (0010), KHÔNG trong biến môi trường và KHÔNG viết
-- thẳng vào code. Ba lý do, theo thứ tự quan trọng:
--
-- 1. Đổi được trong ca, bằng màn Quản trị, không cần deploy. Một số tài khoản
--    sai vào tối thứ Bảy không phải là việc chờ tới thứ Hai.
-- 2. Mọi lần đổi đi qua `operation_log`, nên biết ai đổi lúc nào.
-- 3. Không đi vào git, nên GitGuardian không phải quét nó.
--
-- Migration này KHÔNG chèn số liệu thật: quán chưa cung cấp (mockup để ô "[Chờ
-- quán cung cấp]"). Thiếu cấu hình thì API trả 409 PAYMENT_QR_NOT_CONFIGURED và
-- màn hình khoá thẻ QR kèm lý do — Tiền mặt vẫn dùng được. Đặt một số tài khoản
-- mặc định ở đây là cách để tiền của khách chạy vào một tài khoản không ai kiểm.
--
-- `payment.vietqr.is_demo` mặc định true: chừng nào chưa có số thật, chuỗi QR
-- vẫn đúng chuẩn nhưng màn hình phủ nhãn "DEMO – KHÔNG CHUYỂN TIỀN".

INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`)
SELECT v.organization_id, v.id, 'payment.vietqr.is_demo', CAST('true' AS JSON)
FROM venues AS v;

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

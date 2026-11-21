-- migrate:up transaction:false
-- Module Phục vụ (v1.1) — PV-18: thuế suất của bill tạm tính.
--
-- Mockup P13 ghi "VAT 10% [?]" và CH-01 chốt TẠM dùng 10% cho mọi món. Chữ
-- "tạm" là lý do cột này tồn tại: một con số thuế viết thẳng vào code là thứ
-- sẽ phải sửa gấp vào một tối nào đó, bằng một lần build và một lần deploy,
-- cho một thay đổi mà kế toán báo trước hàng tháng.
--
-- Đơn vị là ĐIỂM CƠ BẢN (1/100 của 1%), không phải phần trăm dạng số thực:
-- 1000 = 10,00%. Thuế suất 8% của một kỳ giảm thuế là 800, và 10,5% là 1050 —
-- cả hai đều là số nguyên. Lưu 0.1 dạng DECIMAL hay DOUBLE rồi nhân với tiền
-- là mở đường cho một hoá đơn lệch một đồng mà không ai truy được.
--
-- Mặc định 1000 (10%) để dữ liệu đang có không đổi hành vi.
--
-- Cột này mới chỉ phục vụ BILL TẠM TÍNH — một con số để khách xem trước. Hoá
-- đơn thật và việc xuất thuế thuộc luồng thanh toán, chưa được xây (Pha 5b).

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE venues
  ADD COLUMN vat_rate_basis_points SMALLINT UNSIGNED NOT NULL DEFAULT 1000 AFTER group_symbol_count;

-- Trần 10000 = 100%. Không phải để chặn thuế suất thật, mà để chặn một lần
-- nhập nhầm "10" thành "10000" hay một đơn vị bị hiểu sai.
ALTER TABLE venues
  ADD CONSTRAINT ck_venues_vat_rate CHECK (vat_rate_basis_points <= 10000);

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

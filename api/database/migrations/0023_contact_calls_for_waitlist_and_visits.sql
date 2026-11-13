-- Cho phép lễ tân gọi cả khách chờ và khách đang ngồi chưa có booking.
--
-- booking_call_logs.reservation_id là NOT NULL, nên mọi cuộc gọi đều phải gắn
-- với một booking. Hệ quả ngoài quán: một đơn chờ Walk-in có số điện thoại
-- (bàn A4 - "Giữ từ danh sách chờ", SĐT ••• 852) hay một lượt ghé Walk-in
-- không hề gọi được, dù đó đúng là những người lễ tân phải gọi nhất khi bàn
-- trống ra hoặc khi quá hạn giữ. Cách duy nhất là nhờ chủ quán mở số.
--
-- Nới ràng buộc chứ không tách bảng mới: lịch sử gọi là một dòng thời gian,
-- người xem chỉ cần biết ai đã gọi và kết quả ra sao, không quan tâm số đó
-- đến từ booking, từ đơn chờ hay từ lượt ghé. Mỗi dòng gắn với đúng MỘT
-- trong ba đối tượng; dòng cũ giữ nguyên reservation_id nên không phải
-- chuyển đổi dữ liệu.

ALTER TABLE booking_call_logs
  MODIFY COLUMN reservation_id BIGINT UNSIGNED NULL,
  ADD COLUMN waitlist_entry_id BIGINT UNSIGNED NULL AFTER reservation_id,
  ADD COLUMN visit_id BIGINT UNSIGNED NULL AFTER waitlist_entry_id,
  ADD KEY ix_booking_call_logs_waitlist (organization_id, venue_id, waitlist_entry_id, initiated_at),
  ADD KEY ix_booking_call_logs_visit (organization_id, venue_id, visit_id, initiated_at),
  ADD CONSTRAINT fk_booking_call_logs_waitlist FOREIGN KEY (waitlist_entry_id)
    REFERENCES waitlist_entries (id),
  ADD CONSTRAINT fk_booking_call_logs_visit FOREIGN KEY (visit_id)
    REFERENCES visits (id),
  ADD CONSTRAINT ck_booking_call_logs_one_target CHECK (
    (reservation_id IS NOT NULL AND waitlist_entry_id IS NULL AND visit_id IS NULL)
    OR (reservation_id IS NULL AND waitlist_entry_id IS NOT NULL AND visit_id IS NULL)
    OR (reservation_id IS NULL AND waitlist_entry_id IS NULL AND visit_id IS NOT NULL)
  );

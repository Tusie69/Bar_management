-- Cho phép hệ thống tự nhả hold khi ngày kinh doanh đã kết thúc.
--
-- Migration 0006 đã mở đường này cho visits và table_allocations: thêm lý do
-- BUSINESS_DAY_END, và riêng lý do đó thì người thực hiện để NULL vì không có
-- ai bấm nút cả. table_holds bị bỏ sót, nên worker cuối ngày không đụng được
-- vào hold: nó chỉ đóng được visit (allocation kind USAGE).
--
-- Hậu quả đo được trên database dev ngày 13/11/2026: 9 hold từ 24/10 đến 08/11
-- vẫn ACTIVE, giữ 16 allocation trên 12 bàn (A1..A7, BAR10, BAR11, BAR12,
-- BAR16, BAR18). Sơ đồ hôm nay không hiện chúng vì khác ngày kinh doanh, nên
-- bàn trông trống; nhưng lệnh ghép bàn đọc table_allocations không lọc theo
-- ngày, thấy hai hold khác nhau trên cùng hai bàn và từ chối bằng
-- TABLE_GROUP_MULTIPLE_CLAIMS. Nghĩa là mỗi đêm có booking không ai check-in
-- cũng không ai huỷ là thêm một bàn vĩnh viễn không ghép được.
--
-- Chỉ nới ràng buộc, không đổi dòng nào đang có. Hold do người nhả vẫn phải
-- ghi rõ ai nhả như cũ.

ALTER TABLE table_holds
  DROP CHECK ck_table_holds_released,
  DROP CHECK ck_table_holds_release_reason,
  ADD CONSTRAINT ck_table_holds_released CHECK (
    (status = 'RELEASED') = (released_at IS NOT NULL AND release_reason_code IS NOT NULL)
    AND (
      release_reason_code IS NULL
      OR (release_reason_code = 'BUSINESS_DAY_END' AND released_by_user_id IS NULL)
      OR (release_reason_code <> 'BUSINESS_DAY_END' AND released_by_user_id IS NOT NULL)
    )
  ),
  ADD CONSTRAINT ck_table_holds_release_reason CHECK (
    release_reason_code IS NULL OR release_reason_code IN
    ('CUSTOMER_NO_SHOW','CUSTOMER_CANCELLED','RESERVATION_CANCELLED','STAFF_REASSIGNED',
     'ENTRY_ERROR','UNDO','OTHER','BUSINESS_DAY_END')
  );

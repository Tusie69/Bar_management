-- Khu C nhận đặt bàn (biên bản 09/11, mục C4.1).
--
-- Khu C được seed là khu chờ (is_bookable=0, is_waiting_area=1), nên mọi lệnh gán
-- bàn vào booking đều bị lockAndValidateAssignableTables() chặn bằng
-- ZONE_NOT_BOOKABLE. Ràng buộc ck_zones_waiting_not_bookable cấm is_waiting_area=1
-- cùng is_bookable=1, nên phải đổi cả hai cờ trong một lần, không thể bật một cờ.
--
-- Không có logic nghiệp vụ nào ở backend phụ thuộc is_waiting_area: cờ này chỉ được
-- đọc để trả projection (table.repository.ts). Luồng Bàn chờ / waitlist không lọc
-- theo cờ, nên 21GAM mất nhãn "khu chờ" trên sơ đồ nhưng không mất chức năng nào.
-- Các hàng waitlist_table_preferences đang trỏ zone_id của Khu C vẫn hợp lệ: đó là
-- nguyện vọng khu của khách, không phải trạng thái khu.
--
-- Đổi cờ là nới lỏng, không làm hàng nào đang có trở thành không hợp lệ, nên
-- migration này chỉ đổi cờ: không xóa, không chuyển bàn, không bỏ booking nào.
-- Trình chạy migration không in kết quả SELECT, nên muốn xem trước ảnh hưởng trên
-- DB thật thì chạy tay ba câu sau trước khi migrate:
--
--   SELECT z.id, z.is_bookable, z.is_waiting_area FROM zones z
--     JOIN venues v ON v.id = z.venue_id WHERE v.code = '21GAM' AND z.code = 'C';
--   SELECT dt.code, dt.is_spare, dt.status FROM dining_tables dt
--     JOIN zones z ON z.venue_id = dt.venue_id AND z.id = dt.zone_id
--     JOIN venues v ON v.id = dt.venue_id WHERE v.code = '21GAM' AND z.code = 'C';
--   SELECT COUNT(*) FROM waitlist_table_preferences p
--     JOIN zones z ON z.venue_id = p.venue_id AND z.id = p.zone_id
--     JOIN venues v ON v.id = p.venue_id WHERE v.code = '21GAM' AND z.code = 'C';
--
-- Hai câu UPDATE đổi cờ đều có điều kiện trạng thái hiện tại, nên chạy lại không
-- đổi gì thêm; câu cuối cố ý đẩy change_seq mỗi lần chạy. Muốn quay lại khu chờ:
-- đổi ngược hai cờ của zones (phải đổi cùng lúc vì ràng buộc).

UPDATE zones AS z
  JOIN venues AS v ON v.organization_id = z.organization_id AND v.id = z.venue_id
   SET z.is_bookable = 1,
       z.is_waiting_area = 0,
       z.version = z.version + 1
 WHERE v.code = '21GAM'
   AND z.code = 'C'
   AND (z.is_bookable = 0 OR z.is_waiting_area = 1);

-- C4 và C5 được seed là bàn sơ cua, nên nếu chỉ mở cờ khu thì hai bàn này vẫn rơi
-- vào SPARE_TABLE_NOT_BOOKABLE và Khu C chỉ đặt được C1, C2. Mục 3.7 của biên bản
-- ghi mặt bằng Khu C là C1, C2, C4, C5 - không bàn nào sơ cua - và layout frontend
-- (web/src/domain/venue-layout.ts, HU-32) cũng vẽ C4/C5 là bàn thường. is_spare là
-- cờ vận hành, sửa được lại bằng API cấu hình bàn nếu quán muốn giữ bàn sơ cua.
UPDATE dining_tables AS dt
  JOIN zones AS z ON z.venue_id = dt.venue_id AND z.id = dt.zone_id
  JOIN venues AS v ON v.organization_id = dt.organization_id AND v.id = dt.venue_id
   SET dt.is_spare = 0,
       dt.version = dt.version + 1,
       dt.updated_at = UTC_TIMESTAMP(3)
 WHERE v.code = '21GAM'
   AND z.code = 'C'
   AND dt.code IN ('C4','C5')
   AND dt.is_spare = 1;

-- Đẩy change_seq để floor-change-stream thấy thay đổi và các máy lễ tân đang mở
-- tải lại catalog ngay, không phải khởi động lại API.
UPDATE venues
   SET change_seq = change_seq + 1,
       version = version + 1,
       updated_at = UTC_TIMESTAMP(3)
 WHERE code = '21GAM';

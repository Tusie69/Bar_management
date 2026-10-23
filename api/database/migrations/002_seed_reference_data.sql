INSERT INTO roles (code, name) VALUES
  ('ADMIN', 'Chủ quán / Admin'),
  ('RECEPTIONIST', 'Lễ tân'),
  ('WAITER', 'Phục vụ'),
  ('CASHIER', 'Thu ngân')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO business_settings (setting_key, setting_value, description) VALUES
  ('business_day', JSON_OBJECT('startsAt', '17:00', 'endsAt', '05:00'), 'Khung ngày làm việc của quán'),
  ('booking_lateness', JSON_OBJECT('lateAfterMinutes', 15, 'noShowAfterMinutes', 30), 'Mốc trạng thái booking đã chốt ngày 19/10'),
  ('reservation_buffer', JSON_OBJECT('minutes', 30, 'enabled', false), 'Đề xuất ngày 23/10, chờ PO duyệt trước khi bật'),
  ('booking_assignment', JSON_OBJECT('mode', 'ASSIGN_AT_SHIFT_START'), 'Hứa sắp xếp bàn; gán bàn cụ thể đầu ca, trừ yêu cầu bàn cụ thể')
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  description = VALUES(description);

INSERT INTO areas (code, name, floor_number, sort_order) VALUES
  ('A', 'Khu A', 1, 10),
  ('B', 'Khu B', 1, 20),
  ('BAR', 'Quầy Bar', 1, 30),
  ('C', 'Khu C', 2, 40)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  floor_number = VALUES(floor_number),
  sort_order = VALUES(sort_order);

INSERT INTO tables (area_id, code, display_name, table_type, capacity, position_x, position_y, default_visible, is_reservable, sort_order)
SELECT a.id, seed.code, seed.display_name, seed.table_type, seed.capacity, seed.position_x, seed.position_y, seed.default_visible, seed.is_reservable, seed.sort_order
FROM areas a
JOIN (
  SELECT 'A' area_code, 'A0' code, 'A0' display_name, 'TABLE' table_type, NULL capacity, 10.0 position_x, 90.0 position_y, TRUE default_visible, TRUE is_reservable, 10 sort_order
  UNION ALL SELECT 'A','A1','A1','TABLE',4,10,82,TRUE,TRUE,20
  UNION ALL SELECT 'A','A2','A2','TABLE',4,10,72,TRUE,TRUE,30
  UNION ALL SELECT 'A','A3','A3','TABLE',4,10,62,TRUE,TRUE,40
  UNION ALL SELECT 'A','A4','A4','TABLE',4,10,52,TRUE,TRUE,50
  UNION ALL SELECT 'A','A5','A5','TABLE',4,10,42,TRUE,TRUE,60
  UNION ALL SELECT 'A','A6','A6','TABLE',6,10,32,TRUE,TRUE,70
  UNION ALL SELECT 'A','A7','A7','TABLE',NULL,10,24,TRUE,TRUE,80
  UNION ALL SELECT 'A','A10','A10','TABLE',NULL,40,90,TRUE,TRUE,90
  UNION ALL SELECT 'B','B1','B1','TABLE',8,68,28,FALSE,TRUE,10
  UNION ALL SELECT 'B','B11','B11','TABLE',4,68,36,TRUE,TRUE,11
  UNION ALL SELECT 'B','B12','B12','TABLE',4,68,44,TRUE,TRUE,12
  UNION ALL SELECT 'B','B2','B2','TABLE',NULL,68,18,FALSE,TRUE,20
  UNION ALL SELECT 'B','B21','B21','TABLE',NULL,68,22,TRUE,TRUE,21
  UNION ALL SELECT 'B','B22','B22','TABLE',NULL,68,28,TRUE,TRUE,22
  UNION ALL SELECT 'B','B3','B3','TABLE',NULL,44,28,TRUE,TRUE,30
  UNION ALL SELECT 'B','B4','B4','TABLE',NULL,44,38,TRUE,TRUE,40
  UNION ALL SELECT 'B','B5','B5','TABLE',NULL,24,46,TRUE,TRUE,50
  UNION ALL SELECT 'B','B6','B6','TABLE',NULL,24,38,TRUE,TRUE,60
  UNION ALL SELECT 'B','B7','B7','TABLE',NULL,24,28,TRUE,TRUE,70
  UNION ALL SELECT 'B','B8','B8','TABLE',NULL,16,38,TRUE,TRUE,80
  UNION ALL SELECT 'C','C1','C1','WAITING',NULL,54,8,TRUE,TRUE,10
  UNION ALL SELECT 'C','C2','C2','WAITING',NULL,64,8,TRUE,TRUE,20
  UNION ALL SELECT 'C','C4','C4','WAITING',NULL,44,8,TRUE,TRUE,40
  UNION ALL SELECT 'C','C5','C5','WAITING',NULL,44,15,TRUE,TRUE,50
) seed ON seed.area_code = a.code
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  capacity = VALUES(capacity),
  position_x = VALUES(position_x),
  position_y = VALUES(position_y),
  default_visible = VALUES(default_visible),
  is_reservable = VALUES(is_reservable),
  sort_order = VALUES(sort_order);

INSERT INTO tables (area_id, code, display_name, table_type, capacity, position_x, position_y, default_visible, is_reservable, sort_order)
SELECT a.id, CAST(n.n AS CHAR), CONCAT('Ghế Bar ', n.n), 'BAR_SEAT', 1,
       75 + MOD(n.n - 1, 2) * 7,
       90 - FLOOR((n.n - 1) / 2) * 7.5,
       TRUE, TRUE, 100 + n.n
FROM areas a
JOIN (
  SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
  UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10
  UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15
  UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20
  UNION ALL SELECT 21
) n
WHERE a.code = 'BAR'
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  position_x = VALUES(position_x),
  position_y = VALUES(position_y),
  sort_order = VALUES(sort_order);

INSERT INTO table_combinations (code, display_name, capacity) VALUES
  ('A6_A7', 'A6 + A7', 6),
  ('B11_B12', 'B11 + B12', 8)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  capacity = VALUES(capacity);

INSERT IGNORE INTO table_combination_members (combination_id, table_id, sort_order)
SELECT c.id, t.id, CASE t.code WHEN 'A6' THEN 1 WHEN 'A7' THEN 2 ELSE 1 END
FROM table_combinations c
JOIN tables t ON (c.code = 'A6_A7' AND t.code IN ('A6', 'A7'));

INSERT IGNORE INTO table_combination_members (combination_id, table_id, sort_order)
SELECT c.id, t.id, CASE t.code WHEN 'B11' THEN 1 WHEN 'B12' THEN 2 ELSE 1 END
FROM table_combinations c
JOIN tables t ON (c.code = 'B11_B12' AND t.code IN ('B11', 'B12'));


-- Căn lại tọa độ sơ đồ bàn theo ảnh mặt bằng thực tế đã được cung cấp.
-- Trạng thái bàn vẫn được lấy từ table_daily_states; migration này chỉ đổi vị trí hiển thị.

UPDATE tables
SET
  position_x = CASE code
    WHEN 'A0' THEN 11 WHEN 'A1' THEN 11 WHEN 'A2' THEN 11
    WHEN 'A3' THEN 11 WHEN 'A4' THEN 11 WHEN 'A5' THEN 11
    WHEN 'A6' THEN 11 WHEN 'A7' THEN 11 WHEN 'A10' THEN 39
    ELSE position_x
  END,
  position_y = CASE code
    WHEN 'A0' THEN 96 WHEN 'A1' THEN 90 WHEN 'A2' THEN 83
    WHEN 'A3' THEN 76 WHEN 'A4' THEN 70 WHEN 'A5' THEN 63
    WHEN 'A6' THEN 55 WHEN 'A7' THEN 50 WHEN 'A10' THEN 95
    ELSE position_y
  END
WHERE area_id = (SELECT id FROM areas WHERE code = 'A')
  AND code IN ('A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A10');

UPDATE tables
SET
  position_x = CASE code
    WHEN 'B7' THEN 16 WHEN 'B8' THEN 9 WHEN 'B6' THEN 16 WHEN 'B5' THEN 16
    WHEN 'B3' THEN 42 WHEN 'B4' THEN 42
    WHEN 'B21' THEN 66 WHEN 'B22' THEN 66 WHEN 'B11' THEN 66 WHEN 'B12' THEN 66
    ELSE position_x
  END,
  position_y = CASE code
    WHEN 'B7' THEN 25 WHEN 'B8' THEN 31 WHEN 'B6' THEN 31 WHEN 'B5' THEN 38
    WHEN 'B3' THEN 26 WHEN 'B4' THEN 35
    WHEN 'B21' THEN 23 WHEN 'B22' THEN 29 WHEN 'B11' THEN 36 WHEN 'B12' THEN 42
    ELSE position_y
  END
WHERE area_id = (SELECT id FROM areas WHERE code = 'B')
  AND code IN ('B7', 'B8', 'B6', 'B5', 'B3', 'B4', 'B21', 'B22', 'B11', 'B12');

UPDATE tables
SET
  position_x = CASE code
    WHEN 'C4' THEN 49 WHEN 'C1' THEN 58 WHEN 'C2' THEN 68 WHEN 'C5' THEN 49
    ELSE position_x
  END,
  position_y = CASE code
    WHEN 'C4' THEN 5 WHEN 'C1' THEN 4 WHEN 'C2' THEN 4 WHEN 'C5' THEN 14
    ELSE position_y
  END
WHERE area_id = (SELECT id FROM areas WHERE code = 'C')
  AND code IN ('C1', 'C2', 'C4', 'C5');

UPDATE tables
SET
  position_x = CASE code
    WHEN '1' THEN 61 WHEN '2' THEN 66 WHEN '3' THEN 61 WHEN '4' THEN 66
    WHEN '5' THEN 61 WHEN '6' THEN 66 WHEN '7' THEN 61 WHEN '8' THEN 66
    WHEN '9' THEN 61 WHEN '10' THEN 66 WHEN '11' THEN 61 WHEN '12' THEN 66
    WHEN '13' THEN 61 WHEN '14' THEN 66 WHEN '15' THEN 72 WHEN '16' THEN 75
    WHEN '17' THEN 78 WHEN '18' THEN 81 WHEN '19' THEN 85 WHEN '20' THEN 88
    WHEN '21' THEN 91
    ELSE position_x
  END,
  position_y = CASE code
    WHEN '1' THEN 96 WHEN '2' THEN 93 WHEN '3' THEN 89 WHEN '4' THEN 86
    WHEN '5' THEN 82 WHEN '6' THEN 78 WHEN '7' THEN 75 WHEN '8' THEN 71
    WHEN '9' THEN 67 WHEN '10' THEN 64 WHEN '11' THEN 60 WHEN '12' THEN 57
    WHEN '13' THEN 53 WHEN '14' THEN 49 WHEN '15' THEN 46 WHEN '16' THEN 50
    WHEN '17' THEN 46 WHEN '18' THEN 50 WHEN '19' THEN 46 WHEN '20' THEN 50
    WHEN '21' THEN 46
    ELSE position_y
  END
WHERE area_id = (SELECT id FROM areas WHERE code = 'BAR')
  AND table_type = 'BAR_SEAT';

INSERT INTO tables (code, name, zone, capacity, position_x, position_y, display_order, is_backup)
VALUES
  ('B1', 'Bàn B1', 'Khu bàn', 4, 80, 80, 1, FALSE),
  ('B2', 'Bàn B2', 'Khu bàn', 4, 220, 80, 2, FALSE),
  ('B3', 'Bàn B3', 'Khu bàn', 6, 360, 80, 3, FALSE),
  ('B9', 'Bàn B9', 'Khu bàn', 6, 80, 240, 9, FALSE),
  ('B10', 'Bàn B10', 'Khu bàn', 6, 220, 240, 10, FALSE),
  ('BAR1', 'Ghế Bar 1', 'Quầy bar', 1, 80, 400, 11, FALSE),
  ('BAR2', 'Ghế Bar 2', 'Quầy bar', 1, 140, 400, 12, FALSE),
  ('SC1', 'Bàn sơ cua 1', 'Kho bàn', 4, 500, 400, 90, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), zone = VALUES(zone), capacity = VALUES(capacity),
  position_x = VALUES(position_x), position_y = VALUES(position_y),
  display_order = VALUES(display_order), is_backup = VALUES(is_backup)

-- Bàn sơ cua là thuộc tính cố định của bàn, không phải trạng thái theo ngày.
-- Giữ table_daily_states.is_backup trong giai đoạn chuyển tiếp để rollback an toàn.

ALTER TABLE tables
  ADD COLUMN is_spare BOOLEAN NOT NULL DEFAULT FALSE AFTER is_reservable,
  ADD KEY idx_tables_spare (is_active, is_spare);

-- Bảo toàn mọi bàn từng được đánh dấu sơ cua trong dữ liệu cũ.
UPDATE tables AS t
SET t.is_spare = TRUE
WHERE EXISTS (
  SELECT 1
  FROM table_daily_states AS ds
  WHERE ds.table_id = t.id
    AND ds.is_backup = TRUE
);

-- Danh sách bàn sơ cua cố định theo sơ đồ đã được duyệt.
UPDATE tables
SET is_spare = TRUE
WHERE code IN ('A10', 'C4', 'C5');

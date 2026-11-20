-- migrate:up transaction:false
-- Đủ ký hiệu ghép bàn cho mọi bàn trong quán.
--
-- 0001 đặt `group_symbol_count` mặc định 12 và chặn trần ở 50. Con số 12 là
-- số hình vẽ mà bộ ký hiệu có lúc đó, không phải một giới hạn nghiệp vụ. Quán
-- hiện có 23 bàn và 21 ghế bar, nên lễ tân chạm trần ngay trong một ca đông:
-- ghép tới nhóm thứ 13 là nhận "Đã dùng hết ký hiệu nhóm trong ngày nghiệp vụ"
-- và phải đi tách một nhóm đang phục vụ để lấy chỗ.
--
-- Ký hiệu được cấp lại khi nhóm tan, nên trần chỉ cần phủ số nhóm TỒN TẠI
-- CÙNG LÚC. Một nhóm luôn có ít nhất hai bàn (createLayoutGroup từ chối một
-- bàn, và mọi đường ghép khác cũng vậy), nên trần thật là một nửa số bàn.
-- Dù vậy migration này đặt bằng ĐÚNG số bàn: nó không phụ thuộc vào luật "ít
-- nhất hai bàn" còn đúng hay không, và nếu sau này một bàn được phép thành
-- một nhóm thì không ai phải nhớ quay lại sửa con số này.
--
-- Trần CHECK nới tới 255 — hết tầm của TINYINT UNSIGNED. Giữ 50 thì một quán
-- lớn hơn lại vướng đúng bức tường này, chỉ là muộn hơn.
--
-- Giá trị mỗi venue tính từ chính bảng bàn của nó, không hardcode 44: venue
-- khác có số bàn khác, và quán có thể thêm bàn sau. Sàn 12 giữ nguyên hành vi
-- cho venue chưa khai báo bàn nào (fixture test, venue mới tạo).

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE venues
  DROP CHECK ck_venues_symbols;

ALTER TABLE venues
  ADD CONSTRAINT ck_venues_symbols CHECK (group_symbol_count BETWEEN 1 AND 255);

ALTER TABLE venues
  ALTER COLUMN group_symbol_count SET DEFAULT 48;

UPDATE venues AS v
SET v.group_symbol_count = GREATEST(
      v.group_symbol_count,
      12,
      (SELECT COUNT(*) FROM dining_tables AS dt
        WHERE dt.organization_id = v.organization_id AND dt.venue_id = v.id AND dt.status <> 'RETIRED')
    ),
    v.version = v.version + 1,
    v.updated_at = UTC_TIMESTAMP(3)
WHERE v.status = 'ACTIVE';

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

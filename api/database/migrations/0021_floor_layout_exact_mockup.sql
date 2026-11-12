-- Sơ đồ bàn đặt đúng theo mockup đã duyệt 12/11/2026, khung 374 x 732.
--
-- Migration 0020 đã đồng bộ database theo bản Hưng code. Bản đó bám mockup
-- nhưng có sửa tay: dịch cả sơ đồ +20, nới phòng thêm 28 về bên phải, đẩy khối
-- quầy sang phải 14, giãn bước hàng Khu A/B từ 44/42 lên 46 và thu ghế quầy
-- còn 18. Hệ quả là khung thành 442 x 752, rộng hơn mockup 15%, và khoảng cách
-- giữa các khu không còn khớp bản vẽ ở chỗ nào cả.
--
-- Bản này đưa toạ độ về đúng con số đọc thẳng từ mockup, cùng lúc với
-- web/src/domain/venue-layout.ts. Nhờ vậy luật co giãn trong bản vẽ
-- (k = min(rộng / 374, cao / 732)) đúng theo nghĩa đen.
--
-- Chỉ đụng pos_x, pos_y, width, height của venue 1. Không đổi id, zone, sức
-- chứa hay trạng thái, nên booking, visit và lượt khách đang có không hề gì.
-- Giá trị tuyệt đối nên chạy lại nhiều lần vẫn an toàn.

-- 23 bàn Khu A, B, C (toạ độ là TÂM ô bàn)
UPDATE dining_tables SET pos_x=44, pos_y=319, width=56, height=34
  WHERE venue_id = 1 AND code = 'A7';
UPDATE dining_tables SET pos_x=44, pos_y=363, width=56, height=34
  WHERE venue_id = 1 AND code = 'A6';
UPDATE dining_tables SET pos_x=44, pos_y=407, width=56, height=34
  WHERE venue_id = 1 AND code = 'A5';
UPDATE dining_tables SET pos_x=44, pos_y=451, width=56, height=34
  WHERE venue_id = 1 AND code = 'A4';
UPDATE dining_tables SET pos_x=44, pos_y=495, width=56, height=34
  WHERE venue_id = 1 AND code = 'A3';
UPDATE dining_tables SET pos_x=44, pos_y=539, width=56, height=34
  WHERE venue_id = 1 AND code = 'A2';
UPDATE dining_tables SET pos_x=44, pos_y=583, width=56, height=34
  WHERE venue_id = 1 AND code = 'A1';
UPDATE dining_tables SET pos_x=44, pos_y=627, width=56, height=34
  WHERE venue_id = 1 AND code = 'A0';
UPDATE dining_tables SET pos_x=111, pos_y=627, width=54, height=34
  WHERE venue_id = 1 AND code = 'A10';
UPDATE dining_tables SET pos_x=63, pos_y=147, width=46, height=34
  WHERE venue_id = 1 AND code = 'B7';
UPDATE dining_tables SET pos_x=39, pos_y=187, width=46, height=34
  WHERE venue_id = 1 AND code = 'B8';
UPDATE dining_tables SET pos_x=89, pos_y=187, width=46, height=34
  WHERE venue_id = 1 AND code = 'B6';
UPDATE dining_tables SET pos_x=63, pos_y=227, width=46, height=34
  WHERE venue_id = 1 AND code = 'B5';
UPDATE dining_tables SET pos_x=163, pos_y=147, width=46, height=34
  WHERE venue_id = 1 AND code = 'B3';
UPDATE dining_tables SET pos_x=163, pos_y=203, width=46, height=34
  WHERE venue_id = 1 AND code = 'B4';
UPDATE dining_tables SET pos_x=257, pos_y=147, width=46, height=34
  WHERE venue_id = 1 AND code = 'B21';
UPDATE dining_tables SET pos_x=257, pos_y=189, width=46, height=34
  WHERE venue_id = 1 AND code = 'B22';
UPDATE dining_tables SET pos_x=257, pos_y=231, width=46, height=34
  WHERE venue_id = 1 AND code = 'B11';
UPDATE dining_tables SET pos_x=257, pos_y=273, width=46, height=34
  WHERE venue_id = 1 AND code = 'B12';
UPDATE dining_tables SET pos_x=176, pos_y=26, width=40, height=32
  WHERE venue_id = 1 AND code = 'C4';
UPDATE dining_tables SET pos_x=176, pos_y=64, width=40, height=32
  WHERE venue_id = 1 AND code = 'C5';
UPDATE dining_tables SET pos_x=220, pos_y=26, width=40, height=32
  WHERE venue_id = 1 AND code = 'C1';
UPDATE dining_tables SET pos_x=264, pos_y=26, width=40, height=32
  WHERE venue_id = 1 AND code = 'C2';

-- 21 ghế quầy Bar, đường kính 20 như mockup vẽ (bước dọc 24, hở 4)
UPDATE dining_tables SET pos_x=156, pos_y=662, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR01';
UPDATE dining_tables SET pos_x=156, pos_y=638, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR02';
UPDATE dining_tables SET pos_x=156, pos_y=614, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR03';
UPDATE dining_tables SET pos_x=156, pos_y=590, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR04';
UPDATE dining_tables SET pos_x=156, pos_y=566, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR05';
UPDATE dining_tables SET pos_x=156, pos_y=542, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR06';
UPDATE dining_tables SET pos_x=156, pos_y=518, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR07';
UPDATE dining_tables SET pos_x=156, pos_y=494, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR08';
UPDATE dining_tables SET pos_x=156, pos_y=470, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR09';
UPDATE dining_tables SET pos_x=156, pos_y=446, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR10';
UPDATE dining_tables SET pos_x=156, pos_y=422, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR11';
UPDATE dining_tables SET pos_x=156, pos_y=398, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR12';
UPDATE dining_tables SET pos_x=156, pos_y=374, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR13';
UPDATE dining_tables SET pos_x=156, pos_y=350, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR14';
UPDATE dining_tables SET pos_x=180, pos_y=326, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR15';
UPDATE dining_tables SET pos_x=209, pos_y=326, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR16';
UPDATE dining_tables SET pos_x=239, pos_y=326, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR17';
UPDATE dining_tables SET pos_x=268, pos_y=326, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR18';
UPDATE dining_tables SET pos_x=297, pos_y=326, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR19';
UPDATE dining_tables SET pos_x=327, pos_y=326, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR20';
UPDATE dining_tables SET pos_x=356, pos_y=326, width=20, height=20
  WHERE venue_id = 1 AND code = 'BAR21';

UPDATE venues
   SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
 WHERE id = 1;

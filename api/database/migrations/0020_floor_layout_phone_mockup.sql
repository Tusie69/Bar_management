-- Sơ đồ bàn vẽ lại theo mockup điện thoại 374x732 (e8d7803, e30e1cb).
--
-- Hai commit đó đổi toạ độ ở HAI nơi: `web/src/domain/venue-layout.ts` cho chế
-- độ mock, và `api/database/seeds/demo.sql` cho database. Nhưng seed chỉ chạy
-- khi dựng database mới. Mọi database đã có sẵn - máy dev và cả production -
-- vẫn giữ toạ độ cũ, trong khi web chạy chế độ `http` lấy pos_x/pos_y từ
-- dining_tables chứ không lấy từ file layout.
--
-- Hậu quả nhìn thấy được: khung phòng, quầy bar và panel "Khách quầy bar" vẽ
-- theo toạ độ mới trong code, còn bàn và ghế vẫn nằm chỗ cũ. Ghế Bar 15-21 cũ
-- ở x=409..514 nên tràn hẳn ra ngoài khung phòng (khung chỉ tới x=422), C1/C2
-- cũ ở x=337..391 nên chui xuống dưới nút ngày, nút Bàn chờ đè lên B5.
--
-- Migration này đồng bộ toạ độ của venue 1 theo đúng seed, khớp theo `code` để
-- chạy được trên database đã có dữ liệu thật. Chỉ đụng pos_x, pos_y, width,
-- height; không đổi id, zone, sức chứa hay trạng thái bàn, nên không ảnh hưởng
-- booking, visit hay lượt khách đang có.
--
-- Chạy lại nhiều lần vẫn an toàn: UPDATE đặt giá trị tuyệt đối, không cộng dồn.
-- Venue 2 (dữ liệu giả cho test cô lập) cố ý không đụng tới.

-- 23 bàn Khu A, B, C
UPDATE dining_tables SET pos_x=64, pos_y=339, width=56, height=34
  WHERE venue_id = 1 AND code = 'A7';
UPDATE dining_tables SET pos_x=64, pos_y=385, width=56, height=34
  WHERE venue_id = 1 AND code = 'A6';
UPDATE dining_tables SET pos_x=64, pos_y=431, width=56, height=34
  WHERE venue_id = 1 AND code = 'A5';
UPDATE dining_tables SET pos_x=64, pos_y=477, width=56, height=34
  WHERE venue_id = 1 AND code = 'A4';
UPDATE dining_tables SET pos_x=64, pos_y=523, width=56, height=34
  WHERE venue_id = 1 AND code = 'A3';
UPDATE dining_tables SET pos_x=64, pos_y=569, width=56, height=34
  WHERE venue_id = 1 AND code = 'A2';
UPDATE dining_tables SET pos_x=64, pos_y=615, width=56, height=34
  WHERE venue_id = 1 AND code = 'A1';
UPDATE dining_tables SET pos_x=64, pos_y=661, width=56, height=34
  WHERE venue_id = 1 AND code = 'A0';
UPDATE dining_tables SET pos_x=131, pos_y=661, width=54, height=34
  WHERE venue_id = 1 AND code = 'A10';
UPDATE dining_tables SET pos_x=83, pos_y=160, width=46, height=34
  WHERE venue_id = 1 AND code = 'B7';
UPDATE dining_tables SET pos_x=59, pos_y=206, width=46, height=34
  WHERE venue_id = 1 AND code = 'B8';
UPDATE dining_tables SET pos_x=109, pos_y=206, width=46, height=34
  WHERE venue_id = 1 AND code = 'B6';
UPDATE dining_tables SET pos_x=83, pos_y=252, width=46, height=34
  WHERE venue_id = 1 AND code = 'B5';
UPDATE dining_tables SET pos_x=183, pos_y=160, width=46, height=34
  WHERE venue_id = 1 AND code = 'B3';
UPDATE dining_tables SET pos_x=183, pos_y=216, width=46, height=34
  WHERE venue_id = 1 AND code = 'B4';
UPDATE dining_tables SET pos_x=277, pos_y=160, width=46, height=34
  WHERE venue_id = 1 AND code = 'B21';
UPDATE dining_tables SET pos_x=277, pos_y=206, width=46, height=34
  WHERE venue_id = 1 AND code = 'B22';
UPDATE dining_tables SET pos_x=277, pos_y=252, width=46, height=34
  WHERE venue_id = 1 AND code = 'B11';
UPDATE dining_tables SET pos_x=277, pos_y=298, width=46, height=34
  WHERE venue_id = 1 AND code = 'B12';
UPDATE dining_tables SET pos_x=196, pos_y=46, width=40, height=32
  WHERE venue_id = 1 AND code = 'C4';
UPDATE dining_tables SET pos_x=196, pos_y=90, width=40, height=32
  WHERE venue_id = 1 AND code = 'C5';
UPDATE dining_tables SET pos_x=240, pos_y=46, width=40, height=32
  WHERE venue_id = 1 AND code = 'C1';
UPDATE dining_tables SET pos_x=284, pos_y=46, width=40, height=32
  WHERE venue_id = 1 AND code = 'C2';

-- 21 ghế quầy Bar: 1-14 dọc cạnh trái, 15-21 dọc cạnh trên, ôm lấy quầy
UPDATE dining_tables SET pos_x=190, pos_y=682, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR01';
UPDATE dining_tables SET pos_x=190, pos_y=658, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR02';
UPDATE dining_tables SET pos_x=190, pos_y=634, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR03';
UPDATE dining_tables SET pos_x=190, pos_y=610, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR04';
UPDATE dining_tables SET pos_x=190, pos_y=586, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR05';
UPDATE dining_tables SET pos_x=190, pos_y=562, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR06';
UPDATE dining_tables SET pos_x=190, pos_y=538, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR07';
UPDATE dining_tables SET pos_x=190, pos_y=514, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR08';
UPDATE dining_tables SET pos_x=190, pos_y=490, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR09';
UPDATE dining_tables SET pos_x=190, pos_y=466, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR10';
UPDATE dining_tables SET pos_x=190, pos_y=442, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR11';
UPDATE dining_tables SET pos_x=190, pos_y=418, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR12';
UPDATE dining_tables SET pos_x=190, pos_y=394, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR13';
UPDATE dining_tables SET pos_x=190, pos_y=370, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR14';
UPDATE dining_tables SET pos_x=214, pos_y=346, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR15';
UPDATE dining_tables SET pos_x=243, pos_y=346, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR16';
UPDATE dining_tables SET pos_x=273, pos_y=346, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR17';
UPDATE dining_tables SET pos_x=302, pos_y=346, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR18';
UPDATE dining_tables SET pos_x=331, pos_y=346, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR19';
UPDATE dining_tables SET pos_x=361, pos_y=346, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR20';
UPDATE dining_tables SET pos_x=390, pos_y=346, width=18, height=18
  WHERE venue_id = 1 AND code = 'BAR21';

-- Đẩy change_seq lên để bộ phát SSE thấy sơ đồ đã đổi, theo đúng cách
-- nextVenueChangeSequence trong booking.repository.ts làm khi ghi dữ liệu.
-- Máy nào không nhận được thì tải lại trang là có sơ đồ mới.
UPDATE venues
   SET change_seq = change_seq + 1, version = version + 1, updated_at = UTC_TIMESTAMP(3)
 WHERE id = 1;

-- migrate:up transaction:false
-- Hàng đợi Bar/Bếp — lùi một bước có lý do.
--
-- Cho tới đây luồng phiếu chỉ đi tới: SUBMITTED → ACCEPTED → PREPARING →
-- READY → COLLECTED, và mọi yêu cầu khác nhận 409. Quầy thật thì có lúc phải
-- lùi: bartender bấm nhầm "Tiếp nhận", hoặc một bàn VIP chen vào nên phiếu
-- đang nhận phải trả về hàng chờ cho người khác cầm.
--
-- Lùi là một SỬA SAI, không phải một bước của quy trình, nên nó phải nói được
-- VÌ SAO. Cột này giữ câu đó ngay trên dòng sự kiện: `preparation_ticket_events`
-- là nơi duy nhất đọc được toàn bộ đời của một phiếu theo thứ tự, và một dòng
-- "PREPARING → ACCEPTED" không kèm lý do thì một tháng sau không ai đọc ra
-- được chuyện gì đã xảy ra.
--
-- NULL với mọi bước đi tới: bước tiến không cần giải thích, và bắt nhập lý do
-- cho nó sẽ chỉ sinh ra những câu "ok" gõ cho xong.
--
-- Không có cột nào bị xoá và không dòng nào bị sửa, nên dữ liệu đang có giữ
-- nguyên ý nghĩa.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE preparation_ticket_events
  ADD COLUMN reason VARCHAR(200) NULL AFTER to_status;

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

-- migrate:up transaction:false
-- Module Phục vụ (v1.1) — "Hủy đơn?": một yêu cầu hủy CẢ ĐƠN.
--
-- Ý 4 của anh Hưng ngày 21/11: từ màn "Đơn vừa đặt", Phục vụ bấm "Hủy đơn?" và
-- yêu cầu đi tới Thu ngân / Admin Edit. Hôm nay hệ thống chỉ có yêu cầu hủy
-- TỪNG DÒNG, nên một đơn bốn món sẽ thành bốn yêu cầu rời rạc trong hàng chờ,
-- và Thu ngân phải bấm duyệt bốn lần cho một quyết định duy nhất.
--
-- KHÔNG dựng bảng cha. Một cột nhóm là đủ, và đổi lại ta giữ nguyên toàn bộ
-- luật đã chạy của yêu cầu từng dòng:
--
--   * `policy` vẫn tính theo TỪNG dòng, nên một đơn có ba món chưa làm và một
--     món đã xong sinh ra ba dòng STANDARD và một dòng READY_WASTE. Đó đúng là
--     câu trả lời cho V7 ngày 22/11: cho gửi hủy cả đơn, nhưng tách rõ phần
--     phải ghi hao để người duyệt nhìn thấy trước khi gật.
--   * `uq_sales_order_cancellations_open` vẫn chặn hai yêu cầu chồng nhau trên
--     cùng một dòng, kể cả khi một cái lẻ và một cái thuộc nhóm.
--   * Người duyệt vẫn quyết định được từng dòng nếu muốn; nhóm chỉ thêm một
--     đường "duyệt cả đơn một lần".
--
-- `group_id` mang chính `id` của dòng ĐẦU TIÊN trong nhóm. Không cần sequence
-- riêng, không cần bảng riêng, và một nhóm luôn truy ngược được về yêu cầu đã
-- sinh ra nó. NULL nghĩa là yêu cầu lẻ của một dòng — đúng hình dạng dữ liệu
-- đang có, nên không cần backfill.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE sales_order_cancellations
  ADD COLUMN group_id BIGINT UNSIGNED NULL AFTER order_id;

ALTER TABLE sales_order_cancellations
  ADD KEY ix_sales_order_cancellations_group (venue_id, group_id, id);

-- Nhóm không bắc qua hai đơn: "hủy cả đơn" là một đơn. Ràng buộc này không
-- diễn đạt được bằng CHECK trên một hàng, nên nó được giữ ở tầng ứng dụng
-- (api/src/modules/orders/order-adjustment.repository.ts) — ghi ra đây để lần
-- sau ai đọc lược đồ cũng biết nó tồn tại và biết nó nằm ở đâu.

-- migrate:down
-- irreversible: migrations are forward-only. Restore a backup or fix forward.

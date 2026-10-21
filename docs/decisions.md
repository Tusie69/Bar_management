# Nhật ký quyết định kỹ thuật

## 21/10/2026 — Web trước, đóng gói ứng dụng sau

- Giao diện: React + Vite + JavaScript.
- Máy chủ: Express + JavaScript.
- Dữ liệu: MySQL 8.
- Bản web responsive chạy trên tablet trong giai đoạn đầu.
- Khi cần APK, frontend sẽ được đóng gói bằng Capacitor; Express/MySQL vẫn chạy trên máy chủ riêng.
- Scaffold Android cũ được thay thế trên nhánh `codex/web-foundation`; lịch sử vẫn còn trong Git.

## Phạm vi ba ngày đầu

- Khung monorepo và hướng dẫn chạy.
- Hợp đồng API v1 và mock JSON.
- Migration/seed cho bàn và trạng thái bàn theo ngày.
- `GET /api/v1/tables?date=`.
- `PATCH /api/v1/tables/:id/status` có kiểm tra chuyển trạng thái.
- Chưa triển khai API booking hoặc màn hình sơ đồ bàn.

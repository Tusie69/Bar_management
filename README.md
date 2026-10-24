# 21GAM Bar Management

Phần mềm quản lý vận hành nội bộ 21GAM. Sprint 0 dựng nền tảng cho Module Lễ tân và Đặt bàn.

Tài liệu tổng hợp trạng thái, phần đã hoàn thành, điểm chặn và lộ trình gần nhất: [Báo cáo dự án ngày 24/10/2026](docs/PROJECT_STATUS_2026-10-24.md).

## Công nghệ

- Web: React, Vite, TypeScript
- API: Node.js 24 LTS, Express 5, TypeScript
- Database: MySQL 9.7.2 LTS, mysql2
- Package manager: pnpm 11

## Cấu trúc

```text
api/       Express API
docs/      Tài liệu kỹ thuật và hợp đồng API
web/       React web app
compose.yaml
```

## Trạng thái database

Dự án dùng schema GAM-APP v1.2 gồm 26 bảng trong `api/database/migrations/0001_initial_schema.sql`.
Seed tổng hợp tại `api/database/seeds/demo.sql` chỉ được phép chạy trên database trống có hậu tố `_dev` hoặc `_test`; file có guard và tự rollback nếu dữ liệu nền không đúng.

## Chạy lần đầu với Docker (khuyên dùng cho môi trường dev)

Yêu cầu Node.js 24 LTS, pnpm 11 và Docker Desktop.

```powershell
Copy-Item .env.example .env
Copy-Item api/.env.example api/.env
Copy-Item web/.env.example web/.env
docker compose up -d mysql
pnpm install
pnpm --filter @21gam/api db:migrate
pnpm --filter @21gam/api db:seed
pnpm dev
```

Không chạy lại `db:seed` trên database đã có dữ liệu. Seed cố ý từ chối chạy lần hai.

Mở `http://localhost:5173`. API health nằm tại `http://localhost:3000/api/v1/health`.

## Chạy với MySQL cài trực tiếp

Docker không bắt buộc. Có thể dùng MySQL Community Server 9.7.2 cài trực tiếp hoặc một máy chủ MySQL 9.7.x riêng. Không dùng XAMPP/MariaDB cho schema chính thức:

1. Tạo database và tài khoản theo giá trị mong muốn.
2. Sao chép `api/.env.example` thành `api/.env`, rồi sửa `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
3. Chạy `pnpm --filter @21gam/api db:migrate`.
4. Chạy `pnpm dev`.

Không dùng dữ liệu khách thật trong môi trường phát triển.

## Lệnh kiểm tra

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```


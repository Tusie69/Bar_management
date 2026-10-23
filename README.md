# 21GAM Bar Management

Phần mềm quản lý vận hành nội bộ 21GAM. Sprint 0 dựng nền tảng cho Module Lễ tân và Đặt bàn.

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

Cấu hình server đã khóa theo MySQL 9.7.2 LTS và dbmate 2.36.0. Bộ migration 0001–0011 chính thức chưa có trong tài liệu được bàn giao, vì vậy các migration trong `api/database/migrations` hiện chỉ là prototype Sprint 0 và không phải GAM-APP Database v1.2.

Xem ma trận đối chiếu tại `docs/mysql-setup.md` trước khi dựng lại database.

## Chạy lần đầu với Docker (khuyên dùng cho môi trường dev)

Yêu cầu Node.js 24 LTS, pnpm 11 và Docker Desktop.

```powershell
Copy-Item .env.example .env
Copy-Item api/.env.example api/.env
Copy-Item web/.env.example web/.env
docker compose up -d mysql
pnpm install
pnpm --filter @21gam/api db:migrate
pnpm dev
```

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


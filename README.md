# 21GAM Bar Management

Phần mềm quản lý vận hành nội bộ 21GAM. Giao diện canonical hỗ trợ desktop, tablet và Mobile V1; API HTTP xử lý đặt bàn, sơ đồ bàn, waitlist, check-in và Move/Merge.

Tài liệu tổng hợp trạng thái và lộ trình: [Báo cáo dự án ngày 24/10/2026](docs/PROJECT_STATUS_2026-10-24.md).

## Công nghệ

- Web: React 19, Vite 8, TypeScript
- API: Node.js 24, Express 5, TypeScript
- Database: MySQL 9.7, mysql2
- Package manager: pnpm 11 (workspace)

## Cấu trúc

```text
api/       Express API, migrations, seeds và tests
db/        Thư mục dành cho tài nguyên database
docs/      Tài liệu kỹ thuật và hợp đồng API
web/       React web app
compose.yaml
```

## Chạy giao diện demo (mock)

Yêu cầu: Node.js 24 LTS và pnpm 11. Giao diện mặc định dùng dữ liệu mock trong bộ nhớ; không cần Docker, MySQL hay API để chạy thử.

```powershell
pnpm install
pnpm dev:web
```

Nếu dependencies đã được cài, có thể chỉ chạy web bằng `npm --prefix web run dev`.

Mở `http://localhost:5173`. Dữ liệu mock được tạo lại khi tải lại trang. Dừng máy chủ bằng `Ctrl+C`.

Có thể chạy cả hai tiến trình web và API bằng `pnpm dev`, nhưng cần cấu hình và khởi động MySQL trước (xem phần tiếp theo). Web dùng mock theo mặc định khi chưa cấu hình HTTP mode.

## Chạy API với MySQL trong Docker

Yêu cầu: Node.js 24 LTS, pnpm 11 và Docker Desktop đang chạy.

```powershell
Copy-Item .env.example .env
Copy-Item api\.env.example api\.env
pnpm --dir api secrets:init
Copy-Item web\.env.example web\.env
docker compose up -d mysql
pnpm install
pnpm --filter @21gam/api db:migrate
pnpm --filter @21gam/api db:seed
pnpm dev:api
```

API health: `http://localhost:3000/api/v1/health`. Để chạy thêm giao diện HTTP, mở terminal khác và chạy `pnpm dev:web`; `web\.env` đặt `VITE_API_MODE=http` và `VITE_API_BASE_URL=http://localhost:3000`.

HTTP adapter là luồng tích hợp chính. Production build từ chối mock mode và yêu cầu `VITE_API_MODE=http` cùng `VITE_API_BASE_URL` hợp lệ.

## Database và seed

Schema GAM-APP v1.2 được quản lý bằng các migration trong `api/database/migrations/`. Seed demo tại `api/database/seeds/demo.sql` chỉ dành cho database trống có hậu tố `_dev` hoặc `_test`; file có guard và từ chối chạy lại khi dữ liệu đã tồn tại.

Không chạy seed trên database có dữ liệu vận hành và không dùng dữ liệu khách thật trong môi trường phát triển. Docker Compose chỉ khởi động MySQL; API và web chạy riêng bằng các lệnh pnpm ở trên.

## Chạy với MySQL cài trực tiếp

Docker không bắt buộc. Có thể dùng MySQL Community Server 9.7.x; không dùng XAMPP/MariaDB cho schema chính thức.

1. Tạo database và tài khoản phát triển.
2. Sao chép `api\.env.example` thành `api\.env`, rồi cấu hình `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
3. Chạy `pnpm --dir api secrets:init` để tạo các khóa local còn thiếu.
4. Chạy `pnpm --filter @21gam/api db:migrate`.
5. Chạy `pnpm dev:api`.

## Kiểm tra

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --dir api build
$env:VITE_API_MODE='http'; $env:VITE_API_BASE_URL='/api/v1'; pnpm --dir web build
```

# 21GAM Bar Management — bàn giao cho AI tiếp quản

> Cập nhật: 15/11/2026 (Asia/Ho_Chi_Minh)  
> Repository: `Bar_management`  
> Nhánh tại thời điểm bàn giao: `develop`  
> Commit đã kiểm tra: `d459128` — `feat(reception): complete mobile floor updates and manual counts`  
> Working tree lúc lập tài liệu: sạch

## Prompt khởi động cho AI mới

Sao chép nguyên khối này vào cuộc trò chuyện mới, rồi gửi kèm repository:

```text
Bạn đang tiếp quản dự án 21GAM Bar Management. Hãy đọc AI_HANDOFF.md trước,
sau đó đọc README.md, package.json, api/src/app.ts,
web/src/services/contracts.ts và các file trực tiếp liên quan đến yêu cầu của tôi.

Source code và migration hiện tại là nguồn chuẩn. Các audit/report cũ chỉ là
lịch sử và có thể đã lỗi thời. Không đọc hoặc in nội dung file .env; chỉ dùng
.env.example để biết tên biến. Không chạy seed/migration trên database thật.
Mọi mutation phải giữ RBAC, CSRF, idempotency, optimistic concurrency,
transaction/row lock, operation_log và quy tắc business date hiện có.

Trước khi sửa: kiểm tra git status, nêu ngắn gọn phạm vi ảnh hưởng, tìm test
gần nhất. Sau khi sửa: chạy test tập trung, typecheck và lint; không xóa hay
ghi đè thay đổi chưa commit của người dùng. Trả lời bằng tiếng Việt trừ khi
tôi yêu cầu ngôn ngữ khác.
```

## 1. Dự án là gì

21GAM là hệ thống vận hành nội bộ cho một quán bar/venue, tập trung vào lễ tân
và điều phối sàn:

- đặt bàn, sửa/hủy, phân bàn, check-in, xác nhận tới muộn/không tới;
- walk-in, danh sách chờ, giữ bàn và liên hệ khách;
- sơ đồ bàn, trạng thái bàn theo thời gian thực, đổi/ghép/tách/nhả bàn;
- lượt sử dụng bàn, số khách thực tế do lễ tân nhập;
- gọi khách nhưng che số điện thoại theo quyền;
- hoàn tác/làm lại, audit log, báo cáo;
- đăng nhập theo portal, RBAC và quản lý tài khoản;
- giao diện desktop/tablet và một Mobile V1 riêng cho màn hình dưới 768 px.

Tên thư mục cha là `AndroidStudioProjects`, nhưng đây **không phải ứng dụng
Android**. Đây là pnpm monorepo TypeScript gồm React web, Express API và MySQL.

## 2. Stack và ranh giới hệ thống

| Phần | Công nghệ | Vị trí |
| --- | --- | --- |
| Web | React 19, React Router 8, Vite 8, TypeScript 6, TanStack Query, Zustand, Tailwind 4/Radix | `web/` |
| API | Node 24, Express 5, TypeScript, mysql2 | `api/` |
| Database | MySQL 9.7.2, forward-only SQL migrations | `api/database/` |
| Test | Vitest, Supertest; Playwright scripts cho E2E/a11y | `api/test/`, `web/src/**/*.test.ts`, `web/e2e/` |
| Deploy | Nginx, systemd, shell scripts backup/restore/auto-deploy | `deploy/` |

Luồng production:

```text
Browser -> Nginx/HTTPS -> React static bundle
                     -> /api/v1 -> Express -> mysql2 -> MySQL
                                  -> SSE /tables/stream -> các máy lễ tân
```

Web có hai adapter dữ liệu:

- `mock`: in-memory, chỉ dùng development/test;
- `http`: adapter production gọi `/api/v1`.

Production cố ý từ chối mock mode. Interface chung là `GamApi` trong
`web/src/services/contracts.ts`; đây là bản đồ tốt nhất để hiểu toàn bộ hành vi
frontend mong đợi.

## 3. Cấu trúc cần biết

```text
Bar_management/
├─ api/
│  ├─ database/migrations/     # schema 0001..0026, forward-only
│  ├─ database/seeds/demo.sql  # chỉ database dev/test trống
│  ├─ scripts/                 # sinh local secrets, phone verification
│  ├─ src/
│  │  ├─ auth/                 # login/session/CSRF/RBAC/bootstrap
│  │  ├─ config/env.ts         # parse và fail-fast cấu hình
│  │  ├─ database/             # pool, migrate, seed
│  │  ├─ middleware/           # error, not-found, idempotency
│  │  ├─ modules/              # repository + route theo domain
│  │  ├─ app.ts                # mount toàn bộ router
│  │  └─ server.ts             # HTTP server + workers + graceful shutdown
│  └─ test/                    # unit, route, MySQL integration
├─ web/
│  ├─ e2e/                     # Playwright/Node acceptance scripts
│  ├─ src/
│  │  ├─ app/                  # router, shell, navigation
│  │  ├─ components/           # shared UI và booking pickers
│  │  ├─ domain/               # model, enum, rules, access matrix
│  │  ├─ features/             # auth/floor/mobile/reservations/...
│  │  ├─ hooks/                # data/action/realtime/responsive hooks
│  │  ├─ services/http/        # HTTP client và adapters
│  │  ├─ services/mock/        # executable mock specification
│  │  └─ state/                # session và UI stores
│  └─ docs/                    # design và handoff lịch sử
├─ docs/                       # API/DB/deploy/security/review documents
├─ deploy/                     # nginx, systemd, backup/restore/deploy
├─ fix-reports/, merge-reports/# bằng chứng lịch sử, không phải source of truth
├─ compose.yaml                # chỉ chạy MySQL local
└─ package.json                # workspace commands
```

Quy mô snapshot: khoảng 63 file/13.4k dòng API, 200 file/47.7k dòng web và 96
file test TypeScript.

## 4. Những file nên đọc theo loại công việc

| Muốn hiểu/sửa | Bắt đầu từ |
| --- | --- |
| Toàn bộ API route | `api/src/app.ts`, rồi `*.route.ts` trong module tương ứng |
| Contract giữa web và API | `web/src/services/contracts.ts`, `web/src/services/http/http-api.ts` |
| Kiểu domain | `web/src/domain/models.ts`, `schema.ts`, `enums.ts` |
| Quy tắc đặt bàn | `web/src/domain/booking-rules.ts`, `api/src/modules/bookings/` |
| Sơ đồ/trạng thái bàn | `web/src/features/floor/`, `api/src/modules/tables/` |
| Mobile | `web/src/features/mobile/` (app riêng, không chỉ CSS responsive) |
| Waitlist | `web/src/features/waitlist/`, `api/src/modules/waitlist/` |
| Auth/RBAC | `api/src/auth/`, `web/src/state/session.ts`, `web/src/domain/access.ts` |
| Tài khoản | `api/src/modules/accounts/`, `web/src/features/settings/accounts-section.tsx` |
| SĐT/gọi khách | `api/src/modules/bookings/phone-*`, `booking-call.ts`, `api/src/modules/contacts/` |
| Realtime | `api/src/modules/tables/floor-change-stream.ts`, `web/src/services/http/floor-stream.ts` |
| Undo/redo | `api/src/modules/operations/`, `web/src/features/operations/` |
| Business day/worker | `api/src/modules/visits/business-day.worker.ts`, `bookings/no-show.worker.ts` |
| Schema thật | toàn bộ `api/database/migrations/*.sql`, theo thứ tự tên |
| Deploy/VPS | `docs/deploy.md`, `deploy/` |
| Thiết kế UI | `web/docs/DESIGN.md`, `web/src/index.css` |

## 5. Frontend hiện tại

### Router và layout

Routes: `/home`, `/overview`, `/floor`, `/reservations`, `/waitlist`, `/guests`,
`/reports`, `/settings`. Route không hợp lệ quay về `/floor`.

- Dưới 768 px: tải `MobileApp`, có luồng thao tác riêng.
- Desktop/tablet: `AppShell`; `/floor` là màn hình chính.
- Tài khoản `RECEPTIONIST` bị giới hạn về `/floor` ở router hiện tại.
- Page lớn được lazy-load, riêng Floor được tải trực tiếp.

`AuthBoundary` bọc toàn app. `GlobalLayer` chứa dialog conflict, override và
confirm. TanStack Query quản lý dữ liệu server; Zustand giữ session/UI state.
`useRealtimeSync()` nghe SSE và invalidate query liên quan.

### Các feature chính

- `floor`: canvas sơ đồ, booking list, timeline, guest count, availability,
  table detail, walk-in, reception controls, group/split và trạng thái trực quan.
- `mobile`: home/map/list/form/detail/wait/overlays/actions/context riêng.
- `reservations`: danh sách, form/sheet, detail, trạng thái, xuất text Zalo.
- `waitlist`: queue và phân bàn cho khách chờ.
- `bookings`: gọi khách và lịch sử cuộc gọi.
- `settings`: cấu hình quán và quản lý account.
- `overview`, `guests`, `reports`: tổng quan/khách/báo cáo.

### Chọn adapter

`web/src/config/runtime.ts` đọc:

- `VITE_API_MODE=mock|http`;
- `VITE_API_BASE_URL`;
- `VITE_VENUE_ID`;
- `VITE_E2E_FIXED_NOW` chỉ cho test loopback.

`web/src/services/index.ts` chọn `MockGamApi` hoặc HTTP adapter. Không thêm logic
nghiệp vụ chỉ vào một adapter: nếu behavior cần giống nhau, cập nhật contract,
mock, HTTP adapter và test tương ứng.

## 6. Backend hiện tại

Prefix chung: `/api/v1`. Các nhóm route được mount trong `api/src/app.ts`:

| Prefix | Chức năng |
| --- | --- |
| `/health` | health check |
| `/auth` | login, current session, logout |
| `/tables` | floor state/catalog/SSE, table status, group/member/split/dissolve |
| `/bookings` | list/detail/search/export/source, create/direct/update, assign, call, phone reveal, walk-in, merge, cancel/no-show/late/check-in |
| `/accounts` | list/create, đổi mật khẩu, reset, status, ADMIN access level |
| `/operations` | undo state, undo, redo |
| `/visits` | allocations, move/merge/close và contact calls |
| `/waitlist` | list/create/cancel/contact/seat và contact calls |
| `/settings` | venue settings hiện hành |
| `/venues/:id/settings` | settings theo venue |
| `/reception` | guest count theo ca/ngày |

Danh sách endpoint phía client được duy trì tại hằng `REST_ENDPOINTS` trong
`web/src/services/contracts.ts`. Khi đổi endpoint, phải sửa route, adapter,
contract test và tài liệu cùng lúc.

Kiến trúc backend chủ yếu là `route -> repository -> mysql2`. Repository chứa
transaction và quy tắc nhất quán; không có ORM. Đừng đưa mutation nhiều bước
ra khỏi transaction.

`server.ts` khởi động hai worker:

- no-show worker: mặc định tắt và policy hiện chỉ cho `MANUAL`;
- business-day-end worker: mặc định bật, tự đóng visit/nhả tài nguyên theo giờ
  business day cấu hình (tài liệu deploy hiện dùng 05:00 Asia/Ho_Chi_Minh).

## 7. Auth, quyền và bảo mật

### Portal và role

| Portal | Role hợp lệ |
| --- | --- |
| `admin` | `OWNER`, `ADMIN` |
| `receptionist` | `RECEPTIONIST` |
| `customer-care` | `CUSTOMER_CARE` |
| `cashier` | `CASHIER` |

`OWNER_ADMIN` là tên cũ; migration `0024` đổi thành `OWNER`. Không tạo code mới
dựa trên tên cũ. `ADMIN` có `WRITE` hoặc `READ_ONLY`; backend lọc quyền mutation,
frontend chỉ hỗ trợ hiển thị/disable và không phải authority.

### Chuỗi bảo vệ request

- Cookie session lưu token; DB chỉ lưu hash token.
- Route ghi yêu cầu đúng `Origin`, đăng nhập, CSRF header và permission.
- `WEB_ORIGIN` phải là một origin cụ thể.
- Mutation quan trọng dùng `Idempotency-Key`.
- Bản ghi nghiệp vụ dùng `version` để chống ghi đè lạc quan; conflict trả 409.
- Các allocation/assignment quan trọng dùng transaction + row lock + unique DB
  constraints để chống hai máy chiếm cùng bàn.
- `operation_log` là audit/undo ledger; đừng bỏ qua khi thêm mutation.

Ma trận UI nằm ở `web/src/domain/access.ts`, nhưng backend/DB mới là authority.
Các quyền đáng chú ý: reservation, table assign/override/spare, visit lifecycle,
waitlist, hold, masked/reveal phone, call, audit/report, venue configure,
user read/manage và operation undo.

### Số điện thoại

- Số được mã hóa AES/key-ring và có HMAC để dò/trùng; danh sách chỉ lộ last 3.
- Key encryption/HMAC phải sinh độc lập, không commit và phải backup riêng DB.
- Lễ tân có thể có `booking.phone.call` nhưng không có quyền reveal.
- API call trả `telUri`; người có DevTools vẫn có thể thấy số trong Network. Muốn
  kín tuyệt đối cần dịch vụ click-to-call/tổng đài trung gian.
- Reveal có rate limit in-memory và `Cache-Control: no-store`.
- Không ghi plaintext phone vào log, note hoặc fixture production.

## 8. Data model và bất biến nghiệp vụ

Migration hiện tạo 32 bảng nghiệp vụ, cộng `schema_migrations` do migrator tạo.
Các cụm quan trọng:

- tenant/RBAC: organizations, venues, users, memberships, roles, permissions,
  role_permissions, membership_roles, auth_sessions;
- layout: floors, zones, dining_tables, table_adjacencies,
  table_combinations/members, table_groups/members;
- customer/booking: customers, booking_sources, reservations;
- visit/floor: visits, table_holds, table_allocations, table_turns;
- waitlist: waitlist_entries/preferences/contact_attempts;
- audit/runtime: operation_log, idempotency_keys, booking_call_logs,
  venue_settings, reception_guest_counts.

Các quy tắc không được phá:

1. Mọi query/mutation phải scope theo organization + venue từ actor/session,
   không tin ID tenant do client gửi.
2. `business_date` không đơn giản là ngày lịch: ca có thể chạy qua nửa đêm và
   kết thúc theo cutoff của venue.
3. Trạng thái bàn là projection từ table, holds, allocations, reservations,
   visits và thời điểm hiện tại; không thêm một cột status tùy tiện để làm chuẩn.
4. Allocation là lịch sử/ledger; kết thúc allocation cũ và thêm record mới khi
   đổi trạng thái, không sửa lịch sử theo kiểu mất dấu.
5. Một bàn/ngày không được có nhiều open claim xung đột. Giữ unique constraints
   và locking hiện có.
6. `version` phải được kiểm tra trên update; lỗi concurrent không được silently
   overwrite.
7. Idempotency key cùng key/cùng payload trả lại kết quả cũ; cùng key/khác
   payload phải bị từ chối.
8. No-show hiện là xác nhận thủ công; worker tự động fail-closed và mặc định tắt.
9. Ghép bàn khác zone mặc định tắt (`ALLOW_CROSS_ZONE_TABLE_MERGE=false`).
10. Migrations forward-only, checksum-guarded và MySQL DDL auto-commit. Không sửa
    migration đã chạy; thêm migration mới để fix-forward.

## 9. Cấu hình

Không đọc/commit `.env`. Dùng `.env.example`, `api/.env.example`,
`web/.env.example` và `deploy/env/*.example`.

Nhóm biến API chính:

- server/tenant: `NODE_ENV`, `PORT`, `WEB_ORIGIN`, `TRUST_PROXY_HOPS`,
  `ORGANIZATION_ID`, `VENUE_ID`;
- DB: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`;
- session: `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`, `SESSION_CSRF_SECRET`,
  `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_SAME_SITE`;
- phone: `PHONE_ENCRYPTION_KEYS`, `PHONE_ACTIVE_ENCRYPTION_KEY_ID`,
  `PHONE_HMAC_KEYS`, `PHONE_ACTIVE_HMAC_KEY_ID`, rate-limit pair;
- workers: `NO_SHOW_*`, `BUSINESS_DAY_WORKER_*`;
- realtime: `REALTIME_POLL_INTERVAL_MS`, `REALTIME_HEARTBEAT_MS`;
- rules/test: `ALLOW_CROSS_ZONE_TABLE_MERGE`, `E2E_FIXED_NOW`.

`api/src/config/env.ts` là nguồn chuẩn và fail-fast nếu cấu hình production thiếu
hoặc không an toàn.

## 10. Chạy local

Yêu cầu chính thức: Node `>=24 <25`, pnpm `11.25.0`, Docker Desktop nếu dùng
MySQL container.

### Chỉ xem UI mock

```powershell
pnpm install
$env:VITE_API_MODE='mock'
pnpm dev:web
```

### Full HTTP local

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
# terminal khác
pnpm dev:web
```

Health: `http://localhost:3000/api/v1/health`; web: `http://localhost:5173`.

Seed chỉ được phép trên DB trống có hậu tố `_dev` hoặc `_test`. Tuyệt đối không
seed DB vận hành. Muốn tạo account đầu tiên, dùng lệnh tương tác
`pnpm --dir api auth:bootstrap -- ...`; xem `docs/deploy.md` và script để biết
tham số hiện hành.

## 11. Baseline kiểm tra ngày bàn giao

Đã chạy trên working tree sạch ngày 15/11/2026:

| Lệnh | Kết quả |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS, 14 warning frontend (Fast Refresh, set-state-in-effect, exhaustive-deps), 0 error |
| `pnpm test` | PASS: API 237, Web 632; tổng 869 test |
| MySQL integration trong lần chạy trên | 377 test API skipped vì không cấp DB test |

Máy kiểm tra đang chạy Node `25.8.0`, nên pnpm cảnh báo lệch engine root yêu cầu
Node 24. Đừng coi cảnh báo này là lỗi source; CI/deploy nên dùng Node 24.

Các gate chuẩn sau khi sửa:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --dir api build
$env:VITE_API_MODE='http'
$env:VITE_API_BASE_URL='/api/v1'
pnpm --dir web build
```

Với thay đổi DB/transaction/security, phải chạy test MySQL trên database riêng
kết thúc bằng `_test` và migrate DB đó trước. Với thay đổi UI luồng chính, chạy
script E2E liên quan trong `web/e2e/`; unit test xanh không thay thế acceptance
HTTP thật.

## 12. Deploy và vận hành

Production dự kiến là Linux VPS:

- Nginx phục vụ `web/dist` và reverse proxy API;
- systemd chạy API, backup timer và deploy timer;
- SSE location phải tắt buffering/gzip và có timeout dài;
- backup MySQL lúc 06:00, giữ 14 bản; business day kết thúc trước đó;
- auto-deploy theo `develop`, tránh giờ mở cửa, test trước migration, backup rồi
  migrate và health check;
- rollback code không đồng nghĩa rollback schema; migration chỉ fix-forward;
- backup cùng ổ không chống hỏng ổ, cần đồng bộ offsite.

Nguồn chi tiết: `docs/deploy.md` và `deploy/`. Luôn đối chiếu script thực tế trước
khi chạy vì tài liệu có thể đi sau code.

## 13. Tài liệu nào đáng tin

Thứ tự ưu tiên khi có mâu thuẫn:

1. source code + migration hiện tại;
2. test hiện tại;
3. `.env.example` và deploy scripts hiện tại;
4. README/tài liệu có ngày mới;
5. `fix-reports`, `merge-reports`, review/audit cũ.

Đặc biệt:

- `docs/21GAM_PROJECT_CONTEXT.md` và `docs/PROJECT_STATUS_2026-10-24.md` là audit
  lịch sử. Nhiều kết luận P0 lúc đó (chưa auth, chưa close visit, thiếu realtime,
  ít test) đã được triển khai sau này.
- `web/docs/BACKEND-HANDOFF.md` bắt đầu từ thời prototype; hữu ích về ý tưởng
  contract nhưng endpoint đề xuất/câu “chưa có backend” có thể không còn đúng.
- Review/merge report chỉ chứng minh trạng thái ở commit/ngày ghi trong file.
- `docs/deploy.md` khá sát production nhưng vẫn phải kiểm tra migration, role name
  và CLI hiện tại trước thao tác thật.

## 14. Rủi ro và bẫy thường gặp

- Sửa desktop mà quên Mobile V1, hoặc ngược lại.
- Sửa mock nhưng không sửa HTTP adapter/backend, khiến demo xanh nhưng production
  sai; hoặc chỉ sửa backend mà contract mock test không phản ánh.
- Dùng ngày lịch thay cho business date/cutoff 05:00.
- Gọi mutation không gửi credentials, CSRF hoặc idempotency key.
- Tin quyền frontend thay vì enforce ở API.
- Trả plaintext phone trong list/detail/log/error.
- Bỏ `version`, row lock hay unique constraint để “sửa nhanh” conflict.
- Sửa migration cũ làm checksum fail trên server đã migrate.
- Chạy seed/migration/test tích hợp nhầm vào DB dev có dữ liệu thật.
- SSE chạy tốt local nhưng trễ production vì Nginx buffering.
- Dùng role cũ `OWNER_ADMIN` thay vì `OWNER`.
- Coi lint warning hiện có là do thay đổi mới: hãy so diff và tránh tăng warning.

## 15. Quy trình tiếp quản một yêu cầu mới

1. `git status --short`, `git branch --show-current`, xem commit gần nhất.
2. Đọc file feature + contract + adapter + route/repository + migration/test trực
   tiếp liên quan; không đọc toàn bộ report cũ trước source.
3. Viết rõ invariant: tenant, permission, version, idempotency, transaction,
   audit, business date, phone privacy, desktop/mobile.
4. Tìm test gần nhất bằng `rg`; thêm regression test ở lớp thấp nhất có thể và
   contract/E2E nếu thay đổi vượt ranh giới.
5. Sửa nhỏ, giữ API tương thích nếu không có yêu cầu đổi contract.
6. Chạy test tập trung, rồi typecheck/lint/test phù hợp rủi ro.
7. Kiểm tra `git diff` để không lẫn file người dùng hoặc artifact sinh ra.
8. Bàn giao: nêu kết quả, file đổi, test đã chạy, test bị skip và rủi ro còn lại.

## 16. Những câu cần hỏi chủ dự án khi chưa rõ

Chỉ dừng hỏi khi lựa chọn thay đổi nghiệp vụ hoặc dữ liệu thật, ví dụ:

- thay đổi cutoff business day/giờ mở cửa;
- cho phép ghép bàn khác zone;
- thay đổi role/permission hoặc phạm vi ADMIN;
- tự động no-show/nhả bàn thay vì xác nhận thủ công;
- chính sách bàn sơ cua, vượt sức chứa hoặc booking ngoài giờ;
- thay sơ đồ bàn/zone/toạ độ production;
- xóa/ẩn danh dữ liệu khách hoặc rotate/mất phone keys;
- migration phá vỡ tương thích hay phục hồi backup production.

Với chi tiết triển khai thông thường, hãy tự đọc source/test và tiếp tục thay vì
hỏi lại những gì repository đã trả lời.

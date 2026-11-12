# PR #10 — Final Regression Report

## Môi trường

- Node 24.19.0, pnpm 11.25.0.
- MySQL 9.7.2 trong container `21gam-pr10-disposable-f96db720`.
- Container chỉ bind loopback `127.0.0.1:57764`.
- `/var/lib/mysql` dùng tmpfs, không mount volume dev hoặc production.
- Database `gam21_platform_it_test`, user riêng `pr10_it`.
- Browser HTTP E2E dùng Microsoft Edge.

## Kết quả

| Suite | Kết quả | Phân loại |
|---|---:|---|
| Typecheck API + web | PASS | VERIFIED |
| Lint API + web | PASS, còn warning web đã có | VERIFIED |
| Production build với HTTP mode | PASS | VERIFIED |
| Web unit tests | 286 PASS / 286 | VERIFIED |
| API MySQL full suite | 386 PASS, 11 FAIL, 13 SKIP | 11 lỗi PRE_EXISTING |
| NA-11 HTTP E2E | 11 nhóm PASS trên 5 viewport | VERIFIED |
| Phase 2B HTTP E2E | 17/17 PASS | VERIFIED |
| Q06 targeted MySQL | PASS | FIXED |
| Q03 web/API validation | PASS | FIXED |
| Git diff check | PASS | VERIFIED |

## Bằng chứng Q03

- Backend chấp nhận 19:15 và 00:45, từ chối 20:17, giây khác 0 và millisecond khác 0.
- Web sinh đúng 25 slot và keyboard ArrowRight chuyển 19:00 → 19:15.
- Test lịch sử xác nhận booking 21:17 có thể đổi tên mà giữ giờ. Đổi lịch sang 21:18 bị từ chối.
- Build và hai HTTP E2E dùng backend thật sau thay đổi.

## Bằng chứng Q06

Targeted MySQL test xác minh:

1. Bàn đang được booking giữ trả 409 và không tạo Visit.
2. Sau khi booking giải phóng bàn, hai request `arrived: true` đồng thời trả đúng một 200 và một 409.
3. Chỉ một Visit được tạo.
4. Allocation đang mở có kind USAGE.
5. Waitlist chuyển SEATED, có visitId và version tăng.
6. Floor projection trả IN_USE và change_seq bằng audit sequence.

## HTTP/browser coverage

NA-11 PASS gồm:

- Single-floor responsive và không overflow trên năm viewport.
- Booking tương lai và direct table assignment.
- Tìm tên không dấu và tìm trùng ba số cuối.
- Search highlight không biến thành selected state.
- Không lộ số điện thoại đầy đủ.
- Polling/cache invalidation giữa hai browser.
- Ngày xa hơn bảy ngày.
- Draft desktop giữ dữ liệu qua Escape.
- Check-in, Walk-in, move và merge.
- Concurrent allocation, capacity, forbidden phone reveal và route redirect.

Phase 2B PASS gồm login, single-floor, search, create, detail, assign, reassign, persistence, update, classification, export statistics, two-browser sync, cancel, reload, floor refetch, waitlist polling và logout.

## 11 lỗi PRE_EXISTING

Full MySQL suite tái hiện cùng 11 lỗi baseline:

- 3 lỗi `allocation-concurrency.mysql.test.ts` ở booking assign đối đầu Walk-in.
- 3 lỗi call-customer trong `booking-lifecycle.mysql.test.ts`.
- 1 lỗi concurrent idempotency trong `booking-lifecycle.mysql.test.ts`.
- 4 lỗi fake-clock/check-in trong `wave2.mysql.test.ts`.

Baseline trước tích hợp có 379 PASS, 11 FAIL, 13 SKIP. Bản cuối có 386 PASS, 11 FAIL, 13 SKIP. Bảy ca tăng thêm là test Q03/Q06 và contract liên quan. Danh sách failure không có nhóm mới.

## Phân loại cuối

- FIXED: Q03 quarter-hour write validation và UI.
- FIXED: Q06 Walk-in đang có mặt từ Bàn chờ tạo Visit/OCCUPIED atomically.
- FIXED: availability adapter chặn upcoming và late_confirmed.
- FIXED: tên không dấu và ba số cuối đều có UI reception search.
- PRE_EXISTING: 11 MySQL failures nêu trên.
- NOT_VERIFIED: hiệu năng tải thật nhiều thiết bị và NFR realtime vì Q09 chưa có đặc tả.
- NEW_REGRESSION: không ghi nhận.

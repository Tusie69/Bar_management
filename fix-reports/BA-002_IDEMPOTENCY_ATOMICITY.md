# BA-002 — Idempotency Atomicity

## 1. Git baseline

- Branch: `develop`.
- Baseline và `origin/develop`: `9621856daf15362d54e7be029dbce37753ebcc93`.
- Source/test commit: `83dea371b602e5cccb7d1e8649420098326348a5` (`fix(api): make idempotent mutations durable`).
- Không push, rebase, reset hoặc thay đổi branch/worktree khác.
- `audit-reports/` và các `.env` local không được sửa hoặc đưa vào commit.

## 2. Root cause

`idempotency.ts` tạo một connection/transaction và chèn `idempotency_keys` ở trạng thái chưa có response. Tuy nhiên bốn domain mutation được bảo vệ lại dùng connection riêng:

1. Middleware chèn idempotency row nhưng chưa commit.
2. Domain repository mở transaction khác, ghi domain/audit/allocation và commit.
3. Route gọi `response.json`.
4. Middleware mới UPDATE `response_status`/`response_body` và commit idempotency transaction.

Nếu bước 4 thất bại, middleware cũ rollback idempotency row nhưng domain effect ở bước 2 đã durable. Retry không tìm thấy completed result và chạy domain mutation lần nữa. `createBooking` còn dùng autocommit trực tiếp, nên có cùng failure window dù không tự mở transaction.

### Existing scope and concurrency contract

- Primary identity: `(organization_id, idem_key)`.
- Owner isolation: stored `user_id` phải trùng actor hiện tại.
- Endpoint scope: `<logical-scope>@venue:<venueId>`.
- Fingerprint: SHA-256 của `endpoint + "\n" + JSON.stringify(body ?? null)`.
- Hai request cùng key đồng thời tranh unique primary key. Request sau chờ transaction đầu; sau commit nó đọc và replay result, sau rollback nó có thể thực thi như request mới.
- Khi mutation bắt đầu, idempotency row đã tồn tại nhưng vẫn uncommitted và `response_status/body` là NULL.
- TTL là 24 giờ. Thiết kế mới không commit processing row chưa hoàn tất, nên không tạo stale durable processing record; lock sống theo transaction/connection MySQL.

Unique constraints của allocation, active waitlist reservation và customer phone giảm một số duplicate, nhưng không tạo operation identity chung và không bảo vệ booking thường. Chúng không khắc phục BA-002.

## 3. Reproduction

Regression test thêm CHECK constraint tạm thời `response_status IS NULL` vào bảng test để MySQL thật từ chối UPDATE completion. Test xác minh response lỗi, sau đó đọc database:

- 0 reservation;
- 0 HOLD/allocation;
- 0 operation log;
- `change_seq` không tăng;
- 0 idempotency row;
- retry cùng key/payload thành công đúng một lần.

Trên control flow cũ, domain transaction đã commit trước UPDATE này, middleware nuốt lỗi UPDATE rồi vẫn gửi response thành công; do đó assertion rollback domain sẽ fail. Không checkout/chạy executable baseline cũ để tránh thay đổi worktree đang được bảo vệ; đây là phần counterfactual NOT_RUN, còn failure injection trên implementation mới chạy bằng MySQL thật và PASS.

## 4. Solution options

### Option A — Shared transaction context (chọn)

Middleware cung cấp chính connection đang giữ idempotency row cho đúng bốn domain mutation. Idempotency response, domain rows, allocation, audit và `change_seq` commit/rollback cùng nhau.

- Atomicity: đầy đủ trong một InnoDB transaction.
- Connection usage: giảm từ hai connection xuống một cho request có key.
- Deadlock: không thêm lock order giữa hai transaction; same-key request vẫn serialize tại primary key.
- Migration: không cần.
- Compatibility: response status/body và replay header giữ nguyên.
- Testability: có fault injection được guard bởi `NODE_ENV=test` và DB `_test`.

### Option B — Durable mutation identity

Cần token/unique identity trên từng aggregate và logic dựng lại response cho booking, direct booking, Walk-in và waitlist. Migration và compatibility cost lớn hơn, dễ lệch response contract.

### Option C — Operation journal/outbox

Thích hợp cho asynchronous/external side effects, nhưng quá lớn cho bốn mutation DB đồng bộ. Journal vẫn phải được ghi atomic trong từng domain transaction và cần recovery/replay subsystem mới.

Option A là thay đổi nhỏ nhất giải quyết nguyên nhân gốc, không chỉ giảm xác suất lỗi.

## 5. Fix applied

- Middleware giữ một `WeakMap<Response, PoolConnection>` cho active idempotency transaction.
- Route truyền connection này vào repository khi request có `Idempotency-Key`; request không có key giữ behavior cũ.
- Repository chỉ begin/commit/rollback/release khi tự sở hữu connection. Với shared connection, middleware sở hữu transaction lifecycle.
- UPDATE response snapshot và domain mutation nằm trên cùng transaction.
- Lỗi completion trả `500 IDEMPOTENCY_FINALIZATION_FAILED` sau rollback, thay vì gửi 2xx cho mutation không durable.
- Nếu commit đã thành công nhưng socket/response bị mất, retry đọc completed row và replay cùng status/body với `Idempotent-Replayed: true`.
- Không giữ transaction qua external network call; bốn endpoint chỉ thực hiện validation và MySQL work trước commit.

## 6. Files changed

Source/test commit chỉ gồm:

- `api/src/middleware/idempotency.ts`
- `api/src/modules/bookings/booking.repository.ts`
- `api/src/modules/bookings/booking.route.ts`
- `api/src/modules/waitlist/waitlist.repository.ts`
- `api/src/modules/waitlist/waitlist.route.ts`
- `api/test/booking-lifecycle.mysql.test.ts`

Báo cáo này được commit riêng.

## 7. Schema/migration impact

- Không có migration mới.
- Không đổi schema production.
- CHECK constraint dùng cho fault injection chỉ tồn tại tạm thời trong disposable test DB và được drop trong `finally`.
- Existing primary key, FK và checks của `idempotency_keys` được giữ nguyên.

## 8. APIs affected

Chỉ bốn endpoint hiện đã dùng middleware idempotency:

- `POST /api/v1/bookings`
- `POST /api/v1/bookings/direct`
- `POST /api/v1/bookings/walk-ins`
- `POST /api/v1/waitlist`

Không thêm idempotency cho endpoint khác và không đổi public success payload.

## 9. Before/after behavior

| Scenario | Trước | Sau |
|---|---|---|
| Completion UPDATE fail | Domain có thể đã commit; idempotency rollback; retry có thể duplicate | Cả domain và idempotency rollback; retry sạch |
| Connection fail trước shared commit | Hai transaction có thể lệch trạng thái | Một transaction; không có partial durable effect |
| Response mất sau commit | Completion có thể chưa durable | Domain + replay snapshot đã cùng commit; retry replay |
| Concurrent same key | Serialize bằng unique key | Giữ nguyên, nhưng result và domain commit atomic |
| Same key, different payload/user/endpoint | 422 | Giữ nguyên 422 |

## 10. Fault-injection results

- Completion failure trên cả booking, direct booking, Walk-in và waitlist: PASS; mọi domain row/idempotency row rollback, retry thành công.
- MySQL CHECK constraint từ chối response UPDATE: PASS; reservation/HOLD/allocation/audit/change_seq đều rollback.
- Connection bị destroy trước commit: PASS; response 500, database không có partial effect, retry tạo đúng một booking.
- HTTP response/socket bị drop sau commit: PASS; retry trả 201 replay, chỉ một reservation/HOLD/allocation/audit và một lần tăng `change_seq`.
- Targeted booking lifecycle: **71/71 PASS**.

## 11. Concurrency and IDEM-01–14

| ID | Evidence | Result |
|---|---|---|
| IDEM-01/02 | success + retry giữ cùng ID | PASS |
| IDEM-03 | same key/different payload hoặc endpoint trả 422 | PASS |
| IDEM-04 | 2–3 request đồng thời replay một effect | PASS |
| IDEM-05 | validation/domain failure không persist idempotency hoặc partial rows | PASS |
| IDEM-06 | real MySQL completion UPDATE failure | PASS |
| IDEM-07 | dropped response after commit | PASS |
| IDEM-08 | connection destroyed before commit, then retry | PASS |
| IDEM-09 | cross-user result không replay; endpoint bind venue | PASS trong deployment scope hiện tại |
| IDEM-10 | direct booking retry/concurrency | PASS |
| IDEM-11 | Walk-in retry/concurrency, không duplicate Visit/USAGE | PASS |
| IDEM-12 | waitlist retry/concurrency, không duplicate entry | PASS |
| IDEM-13 | audit/allocation/change_seq counts giữ đúng một | PASS |
| IDEM-14 | organization là namespace DB; cùng org/key cố ý collision qua user/venue/endpoint để chống replay sai | VERIFIED theo schema; cross-org HTTP NOT_APPLICABLE vì runtime hiện bind một organization/venue |

## 12. Full regression results

Môi trường: MySQL 9.7.2 container `21gam-ba002-disposable`, port loopback `127.0.0.1:60007`, `/var/lib/mysql` trên tmpfs, không mount volume.

| Gate | Result |
|---|---:|
| Typecheck API + web | PASS |
| Lint API + web | PASS, 0 error; 11 warning web đã có |
| Production build HTTP mode | PASS |
| API unit | 205 PASS |
| Web unit | 286/286 PASS |
| Full MySQL | 401 PASS, 0 FAIL; 13 opt-in skip |
| Manual no-show opt-in | 13/13 PASS |
| Targeted idempotency/lifecycle | 71/71 PASS |
| Phase 2B HTTP E2E | 17/17 PASS; cleanup = 0 |
| NA-11 HTTP E2E | 11/11 nhóm PASS; 5 viewport; errors = `[]`; cleanup = 0 |

Baseline MySQL là 397 PASS; bốn test BA-002 mới nâng active count lên 401. Không có regression mới.

## 13. Regression assessment

- Q03, Q06, Q10, Q13 không đổi.
- Auth, RBAC, CSRF, phone masking và venue binding được giữ.
- Booking direct, Walk-in, waitlist, allocation, check-in, visit lifecycle, floor projection, polling/change_seq và concurrency đều đi qua full MySQL/HTTP regression.
- Không có external call trong transaction.
- Không có nested transaction: repository được truyền shared connection sẽ không begin/commit/rollback riêng.
- Không có PII hoặc secret mới trong source/commit.

## 14. Remaining risks and NOT_VERIFIED

- Fingerprint vẫn dựa trên `JSON.stringify`; hai JSON object tương đương nhưng khác thứ tự property có thể bị xem là payload khác. Đây là contract hiện hữu, không thuộc atomicity fix.
- Replay lưu status/body, không lưu arbitrary response headers. Bốn endpoint bị ảnh hưởng không có custom success header cần replay; header `Idempotent-Replayed` được tạo khi replay.
- Cross-organization HTTP không chạy được trong một process vì deployment hiện bind organization/venue bằng env. Schema namespace `(organization_id, idem_key)` đã được review nhưng scenario HTTP cross-org là NOT_APPLICABLE trong kiến trúc hiện tại.
- Không chạy executable test trên source baseline cũ; failure trên code cũ được chứng minh bằng control-flow/source review và assertion mà implementation cũ không thể thỏa mãn.

## 15. Git status

- Source/test commit: `83dea371b602e5cccb7d1e8649420098326348a5`.
- Báo cáo sẽ được commit riêng sau khi nội dung này được hoàn tất.
- Local `develop` ahead `origin/develop`; không push.
- `audit-reports/` vẫn untracked và được bảo toàn.

## Verdict

**FIXED_AND_VERIFIED**

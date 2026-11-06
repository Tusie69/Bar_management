# PR #10 — Full UI Integration Report

## Phạm vi và Git

- Baseline local: `1efcb53e0ff97c5e98f1ed24b8bac369cbae4e20`.
- PR head đã đánh giá: `b3d84a811e20e43bf6bb5d7285f21f1d68120429`.
- Nhánh thử: `codex/pr10-selective-trial`.
- HEAD tích hợp: `fdbb27b`.
- Worktree gốc `develop` không bị sửa. Không có push hoặc merge chính thức.
- So với baseline, bản tích hợp thay đổi 32 file gồm 3 file backend runtime, 6 file test/E2E API và 23 file web/E2E.

## Phần Sprint 2 đã hoàn thiện

| Phạm vi | Quyết định | Kết quả |
|---|---|---|
| Floor canvas và navigation | COMBINE | Lễ tân luôn nhìn toàn sàn. Camera fit tính cả khung và bàn ngoài biên. Chủ quán vẫn có lọc khu. Giữ pan, zoom, keyboard, search highlight và group visuals local. |
| Visual rules và status legend | COMBINE | Thêm chú giải dựa trên trạng thái thực tế, giữ riêng late, late_confirmed, no-show và hold quá hạn. Không nhận cách gộp tất cả thành “Không tới” của PR. |
| Reception controls | COMBINE | Giữ ngày làm việc, Bàn chờ, Đếm khách và highlight. Bổ sung chuyển đổi tìm theo tên không dấu hoặc ba số cuối. |
| Desktop table-first booking | KEEP_LOCAL + COMBINE | Giữ draft và availability validation local vốn đã hỗ trợ chọn bàn trực tiếp. Thêm whole-floor layout và polling availability 15 giây. |
| Mobile table-first booking | COMBINE | Form booking có sơ đồ availability theo đúng ngày, giờ và số khách. Snapshot placeholder/error không được dùng để cho phép chọn bàn. |
| Mobile floor/map | COMBINE | Lễ tân nhìn toàn sàn, giữ tìm kiếm/highlight và thêm legend. Luồng chọn bàn, move/merge và detail hiện có được giữ. |
| Waitlist interaction | COMBINE | Walk-in đang có mặt yêu cầu xác nhận “Mở bàn”, kiểm quyền `visit.walkin`, sau đó tạo Visit và USAGE trong một transaction. Advance reservation vẫn giữ bàn rồi check-in. |
| API adapters và shared state | COMBINE | Adapter gửi `arrived: true` rõ ràng cho Walk-in có mặt. Production vẫn dùng HTTP mode. Mock không được đưa vào đường production. |
| Responsive layout | COMBINE | Đạt smoke HTTP ở 360×800, 375×812, 390×844, 768×1024 và 1280×800. |

Các điểm chính nằm tại:

- `web/src/features/floor/floor-canvas.tsx:158` và `floor-visual-rules.ts:61`.
- `web/src/features/floor/status-legend.tsx:8`.
- `web/src/features/floor/reception-controls.tsx:51` và `hooks/use-reception-search.ts:33`.
- `web/src/features/mobile/form.tsx:560` và `mobile/booking-table-selection.ts:3`.
- `web/src/features/waitlist/waitlist-page.tsx:972` và `mobile/wait.tsx:141`.

## Quyết định PO đã áp dụng

### Q03

- UI tạo mới dùng 25 mốc từ 19:00 đến 01:00, bước 15 phút.
- Backend từ chối write mới lệch mốc bằng `EXPECTED_AT_OFF_SLOT` tại `api/src/modules/bookings/business-date.ts:179`.
- Booking lịch sử lệch mốc vẫn có thể sửa thông tin khác mà không đổi `expected_at`.
- `quickTimes` lệch mốc vẫn được giữ trong cấu hình, nhưng không xuất hiện như lựa chọn tạo booking mới.
- Late +15 và No-show +30 giữ nguyên từ venue settings hiện hành.

### Q06

- `POST /waitlist/:id/seat` nhận `arrived: true` cho Walk-in đang có mặt.
- Server kiểm thêm quyền `visit.walkin`.
- Trong cùng transaction, server khóa entry và bàn, kiểm version/capacity/conflict, tạo Visit origin WAITLIST, tạo USAGE allocations, chuyển entry thành SEATED, tăng change_seq và ghi audit WAITLIST_SEATED.
- Logic bắt đầu tại `api/src/modules/waitlist/waitlist.repository.ts:521`.

### Q10, Q13 và Q01/Q02

- Không thêm adjacency validation. Các quy tắc transaction, cùng loại bàn, chống trùng và sức chứa vẫn được giữ.
- Queue database tiếp tục ưu tiên ADVANCE_RESERVATION trước WALK_IN.
- DTO tìm kiếm và floor projection chỉ cung cấp phoneLast3. NA-11 xác minh Lễ tân bị cấm reveal số đầy đủ.

## Phần PR vẫn KEEP_LOCAL

- Không port nguyên khối `quick-form.tsx`, `floor-page.tsx`, `floor-canvas.tsx`, `mobile/form.tsx` và `mobile/map.tsx`. Các file này được ghép theo function để giữ search highlight, business date, API contract và accessibility local.
- Giữ state labels local vì PR gộp late, late_confirmed, no-show và hold_overdue làm mất nghĩa nghiệp vụ.
- Giữ reception search summary và waitlist badge local.
- Giữ auth shell, portal binding, RBAC, CSRF và phone masking local.
- Giữ mock server semantics local. HTTP production không phụ thuộc mock.
- Giữ booking/waitlist E2E local, chỉ cập nhật assertions liên quan bước 15 phút và UI mới.
- Không nhận fixture `set-quick-times` của PR vì fixture đó ghi trực tiếp settings bằng organization/venue cố định.

## Phần chưa triển khai do thiếu đặc tả

- Q04 và Q05: chưa mở quyền chỉnh cờ bàn sơ cua hoặc override chính sách sức chứa.
- Q07: chưa mở rộng Undo/Redo.
- Q08: chưa thay đổi role matrix.
- Q09: giữ polling, chưa chuyển transport realtime.
- Q11: chưa đổi thống kê xuất text.
- Q12: chưa thay đổi chính sách đặt trùng ngoài validation hiện tại.

Các phần này không chặn luồng Sprint 2 đã tích hợp vì code mới không tự quyết định chúng.

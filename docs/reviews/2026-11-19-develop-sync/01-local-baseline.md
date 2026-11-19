# 01 — Baseline code local cần bảo vệ

## 1. Quan hệ nhánh

| Thành phần | Giá trị |
|---|---|
| Nhánh làm việc | `feature/TU-38-turn-statistics-api` |
| HEAD | `ceb6aa7b4e4e85f9b58c48b34eef6343bcb52c9f` |
| Remote tracking của nhánh | `origin/feature/TU-38-turn-statistics-api` |
| Merge-base với develop | `46f071d6fd7cc63ac8517f264b48e06e1afb5704` |
| Develop mới nhất | `1ccf73ca4e7be5661097236fa0added989b95471` |
| Khoảng cách | local có 5 commit riêng; develop có 1 commit riêng |

## 2. Năm commit local sau merge-base

| Commit | Thời gian | Nội dung |
|---|---|---|
| `98da5dc` | 19/11/2026 07:42 | API thống kê số lượt tới quán TU-38 |
| `99d6dbe` | 19/11/2026 08:03 | Frontend đọc ca vận hành từ cấu hình trên các màn Lễ tân |
| `15834f0` | 19/11/2026 08:28 | API đọc ca vận hành từ bảng venues, bỏ hằng số 17:00/05:00 |
| `3a8077a` | 19/11/2026 08:59 | Sửa ca vận hành qua API cấu hình quán |
| `ceb6aa7` | 19/11/2026 19:12 | Thêm script seed tài khoản OWNER an toàn cho kiểm thử màn Cấu hình |

Phần đã commit thay đổi 61 file, +3.445/−183 dòng. Danh sách đầy đủ nằm trong [05-local-branch-file-inventory.md](05-local-branch-file-inventory.md).

## 3. Mười bốn file đã sửa nhưng chưa commit

Đây là trạng thái được ghi nhận trước khi tạo bộ tài liệu này.

| File | + | − | Nhận định phạm vi |
|---|---:|---:|---|
| `web/.gitignore` | 2 | 0 | Thêm ignore cục bộ cho web. |
| `web/package.json` | 2 | 0 | Thêm script/dependency local; đồng thời là file develop cũng sửa. |
| `web/src/features/floor/bar-guest-list.test.ts` | 45 | 0 | Bổ sung test danh sách khách/bar. |
| `web/src/features/floor/bar-guest-list.tsx` | 31 | 3 | Điều chỉnh render/interaction danh sách khách bar. |
| `web/src/features/floor/floor-canvas.tsx` | 5 | 0 | Bổ sung logic/render trên sơ đồ bàn. |
| `web/src/features/floor/spare-button.tsx` | 3 | 3 | Điều chỉnh nút bàn chờ/spare. |
| `web/src/features/floor/status-legend.test.ts` | 114 | 6 | Mở rộng đáng kể coverage chú giải trạng thái. |
| `web/src/features/floor/status-legend.tsx` | 166 | 151 | Viết lại đáng kể UI/logic chú giải. |
| `web/src/features/floor/table-icons.tsx` | 3 | 13 | Thu gọn/thay đổi icon bàn. |
| `web/src/features/floor/turn-badge.tsx` | 2 | 7 | Điều chỉnh badge lượt. |
| `web/src/features/floor/use-floor-model.ts` | 10 | 1 | Bổ sung dữ liệu/logic cho model sơ đồ. |
| `web/src/features/mobile/actions.test.ts` | 39 | 10 | Mở rộng test action mobile. |
| `web/src/features/mobile/booking-table-selection.test.ts` | 25 | 30 | Điều chỉnh test chọn bàn của booking. |
| `web/src/features/mobile/seen-keys.ts` | 1 | 4 | Thu gọn/cập nhật quy tắc seen keys. |

Tổng chưa commit: +448/−228 dòng. Không có file staged.

## 4. File code mới chưa track

| File | Vai trò theo tên/phạm vi |
|---|---|
| `web/e2e/mobile-layout.mjs` | Kịch bản E2E kiểm tra layout mobile. |

`api/scripts/seed-e2e-owner.ts` đã được bảo vệ trong commit `ceb6aa7`. File `web/e2e/mobile-layout.mjs` vẫn cần được thêm vào checkpoint một cách có chủ đích.

## 5. Phạm vi chức năng local quan trọng

Local không chỉ là thay đổi UI. Năm commit TU-38 có các phần backend và hợp đồng dữ liệu cần được coi là nguồn chuẩn:

- Migration `0031_turn_statistics_visit_range_index.sql` tối ưu truy vấn thống kê.
- Repository/route thống kê lượt và business date theo ca vận hành.
- Đọc/ghi cấu hình ca từ venue settings.
- Hợp đồng frontend, mock server và utility thời gian được cập nhật theo API mới.
- Các màn Lễ tân, Tổng quan ca, Sổ lượt và Cài đặt chuyển khỏi hằng số ca cũ.
- Test MySQL, benchmark và báo cáo bằng chứng TU-38 đã được bổ sung.

## 6. Trạng thái sau khi lập hồ sơ

Bộ tài liệu trong thư mục này là file mới do yêu cầu hiện tại tạo ra. Chúng không thuộc baseline 14 + 2 phía trên và không thay đổi bất kỳ file code chức năng nào.

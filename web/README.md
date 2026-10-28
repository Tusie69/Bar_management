# 21GAM Service - prototype quản lý vận hành quán

Prototype web mới cho lễ tân, chủ quán, CSKH và thu ngân của 21GAM: sơ đồ bàn, đặt bàn, danh sách chờ, khách hàng, báo cáo và phân quyền. Thiết kế lại từ đầu (không reskin giao diện cũ), ưu tiên **tablet ngang trong ánh sáng yếu**, vẫn dùng tốt trên desktop, tablet dọc và điện thoại.

> **Đây là bản mô phỏng.** Mọi dữ liệu là dữ liệu giả, nằm trong bộ nhớ trình duyệt và mất khi tải lại trang. Ứng dụng không gọi mạng, không ghi xuống MySQL, không gửi dữ liệu khách ra dịch vụ bên ngoài. Giao diện luôn hiện nhãn "Dữ liệu mô phỏng" và mọi thông báo thành công đều ghi rõ "chưa gửi máy chủ".

## Chạy thử

Yêu cầu: Node.js `^20.19.0` hoặc `>=22.12.0`.

```bash
npm install
npm run dev          # http://localhost:5173 (đã bật --host để mở từ iPad cùng mạng LAN)
```

Mẹo khi demo:

- **Đổi vai trò** ở góc phải trên cùng: Lễ tân 1, Chủ quán, CSKH, Thu ngân. Mỗi vai trò thấy đúng quyền của mình (nút bị khóa vẫn hiện kèm lý do).
- **Đồng hồ mô phỏng** (nút giờ trên thanh trên cùng): ca bắt đầu lúc 21:30 của ngày kinh doanh hiện tại. Tua +5', +15', +30' để xem cảnh báo trễ 15' / không đến 30', bấm "Về 21:30" để quay lại kịch bản hoặc "Giờ thật" để dùng giờ máy. Không có gì bị tự hủy hay tự nhả bàn.
- **Công cụ demo** trong menu đồng hồ: giả lập "Lễ tân 2 · iPad cửa" thao tác song song, hoặc cài sẵn một xung đột để thấy luồng xử lý khi hai máy cùng giữ một bàn.
- **Hoàn tác / làm lại**: nút trên thanh trên cùng hoặc `Ctrl/Cmd + Z`, `Ctrl/Cmd + Shift + Z`.
- **Giao diện sáng / tối**: "Service" (tối, mặc định cho quầy) và "Daylight" (sáng, cho văn phòng).

## Lệnh

| Lệnh              | Việc                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| `npm run dev`     | Chạy dev server                                                           |
| `npm run build`   | Kiểm tra kiểu + build production vào `dist/`                              |
| `npm run preview` | Chạy thử bản build                                                        |
| `npm run check`   | typecheck + oxlint + prettier --check + unit test (chạy trước mỗi commit) |
| `npm run test`    | Unit test nghiệp vụ của mock backend (Vitest)                             |
| `npm run e2e`     | 14 luồng end-to-end trên trình duyệt thật (cần `npm run dev` đang chạy)   |
| `npm run a11y`    | Kiểm tra truy cập axe-core (WCAG 2 A/AA) cho mọi trang + hộp thoại chính  |
| `npm run format`  | Định dạng toàn bộ mã nguồn bằng Prettier                                  |

Lần đầu chạy `e2e`/`a11y` cần tải Chromium: `npx playwright install chromium`. Có thể trỏ tới Chromium có sẵn bằng biến `PW_CHROMIUM_PATH`, đổi địa chỉ bằng `E2E_BASE_URL`.

## Màn hình

| Màn hình                 | Nội dung chính                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sơ đồ bàn** (`/floor`) | SVG dựng lại từ bảng tọa độ 589 × 754: 23 bàn A/B/C + 21 ghế Bar = 44 vị trí. Kéo, thu phóng, vừa khung, chụm 2 ngón. Hai chế độ: **Live** (trạng thái tối nay) và **Khả dụng** (theo ngày, giờ, số khách muốn đặt). Panel chi tiết bàn: check-in, mở bàn walk-in, đổi bàn, ghép, tách, nhả bàn, giữ chỗ, ghế Bar. |
| **Ca vận hành**          | KPI ca tính từ dữ liệu mock: booking, sắp đến 60', khách đang ngồi, bàn đang dùng, cần chú ý, danh sách chờ; nhịp ca theo giờ; việc cần xử lý; nhật ký thao tác.                                                                                                                                                   |
| **Đặt bàn**              | Danh sách + **Lịch bàn** (timeline từ lịch sử phân bàn). Tìm theo tên không dấu hoặc 3 số cuối SĐT, lọc trạng thái và nguồn. Luồng tạo: ngày giờ → số khách → khả dụng → vị trí → thông tin → xác nhận. Bắt buộc có tên hoặc SĐT.                                                                                  |
| **Danh sách chờ**        | Hai loại tách biệt: Đặt trước (ADVANCE_RESERVATION) và Walk-in. Nhận xử lý (claim có hạn), ghi lần liên hệ, giữ bàn, xếp chỗ. Chỉ gợi ý, không tự xếp, không áp thứ tự ưu tiên khi PO chưa duyệt.                                                                                                                  |
| **Khách hàng**           | Lễ tân chỉ thấy tên + 3 số cuối. Chủ quán xem số đầy đủ phải nhập lý do, có ghi nhật ký. Không gán doanh thu bàn cho cá nhân.                                                                                                                                                                                      |
| **Báo cáo**              | Lượt ghé, tổng khách, lượt sử dụng bàn tách bạch, không đếm trùng; ghép / đổi / tách / nhả lấy từ lịch sử.                                                                                                                                                                                                         |
| **Cài đặt**              | Thông số quán (ngưỡng trễ, không đến, lease, chính sách giữ bàn, số ký hiệu ghép), danh mục khu và bàn, ma trận quyền theo vai trò.                                                                                                                                                                                |

## Quy tắc nghiệp vụ đã hiện thực

- Ngày kinh doanh 17:00 → 05:00 giờ Việt Nam: `business_date = DATE(giờ địa phương − 5h)`, cố định múi +07:00 bất kể máy đặt múi giờ nào.
- Không giới hạn thời gian ngồi. Bàn chỉ được nhả khi nhân viên bấm, có xác nhận và ghi nhật ký.
- Trễ 15' chỉ **cảnh báo**, 30' mới cho phép xác nhận "không đến"; không bao giờ tự hủy, tự nhả.
- Walk-in mở lượt ghé (visit) trực tiếp, không cần booking. Bàn sơ cua (A10, C4, C5) và thiếu chỗ cần Chủ quán duyệt kèm lý do.
- Ghép bàn dùng chung một **ký hiệu** (12 hình: nơ, sao, thoi...). Các nhóm cùng lúc luôn khác ký hiệu, lấy ký hiệu trống nhỏ nhất.
- Đổi, tách bàn **không ghi đè**: mỗi lần là một bản ghi `table_allocations` mới, lịch sử giữ nguyên.
- Chống đặt trùng: máy chủ mô phỏng kiểm tra lại khi xác nhận; nếu máy khác vừa lấy bàn thì hiện hộp thoại xung đột với lựa chọn rõ ràng.
- Hoàn tác bằng thao tác bù (compensation) theo `operation_log`; bị chặn nếu dữ liệu đã bị máy khác sửa sau đó.
- Ghi chú không được chứa số điện thoại (8 chữ số trở lên).

## Kiến trúc

```
src/
  app/            Shell (sidebar, thanh trên, điều hướng mobile), router, lớp dialog toàn cục
  features/       Một thư mục mỗi miền: floor, reservations, waitlist, guests, reports, settings, overview
  components/     Thành phần dùng chung (trạng thái, ký hiệu ghép, biểu đồ, dialog xác nhận) + ui/ (shadcn)
  domain/         Enum đúng DDL, kiểu 26 bảng (schema.ts), view model, ma trận quyền, sơ đồ quán (venue-layout.ts)
  services/       contracts.ts (GamApi + mã lỗi + REST_ENDPOINTS), mock/ (backend trong bộ nhớ), http/ (bản phác REST)
  hooks/          TanStack Query (use-data), useAction (xung đột, duyệt vượt quyền, hoàn tác), media query
  state/          Zustand: phiên đăng nhập demo, trạng thái giao diện, ngăn xếp hoàn tác
  lib/            Thời gian ngày kinh doanh, xử lý tiếng Việt, che SĐT
e2e/              Kịch bản end-to-end và kiểm tra truy cập (Playwright)
docs/             DESIGN.md (hướng thiết kế), BACKEND-HANDOFF.md (ánh xạ DDL / API cho backend)
```

Công nghệ: React 19, Vite 8, TypeScript 6, Tailwind CSS 4, shadcn/ui (Radix), Lucide, React Hook Form + Zod, TanStack Query, Zustand, date-fns, SVG thuần cho sơ đồ.

**Mock và thật.** Mặc định `VITE_API_MODE=mock`: toàn bộ nghiệp vụ chạy trong `src/services/mock` (giao dịch có rollback, version, nhật ký thao tác, đồng hồ mô phỏng). Khi backend Express + MySQL sẵn sàng, đặt `VITE_API_MODE=http`, `VITE_API_BASE_URL`, `VITE_VENUE_ID`; giao diện không phải đổi vì chỉ phụ thuộc interface `GamApi`. `src/services/http/http-api.ts` là bản phác, các endpoint đánh dấu `PROPOSED` cần thống nhất với backend trước. Chi tiết trong [docs/BACKEND-HANDOFF.md](docs/BACKEND-HANDOFF.md).

**Số điện thoại.** API mock không bao giờ trả số gốc cho lễ tân: chỉ có `phoneLast3`. Số đầy đủ chỉ có qua lời gọi `revealPhone` riêng (Chủ quán, kèm lý do, ghi nhật ký), không có chuyện tải số thật rồi dùng CSS che.

## Kiểm thử hiện có

- **17 unit test** cho mock backend: 44 vị trí, ngày kinh doanh qua nửa đêm, không tự hủy, khả dụng ngày mai không lẫn tối nay, ẩn SĐT, giữ bàn tuần tự, bàn sơ cua cần duyệt, check-in giữ lịch sử, ký hiệu ghép, hoàn tác bị chặn khi có thay đổi khác, claim độc quyền, báo cáo không đếm trùng...
- **14 luồng E2E** chạy như người dùng thật trên viewport 1280 × 800: walk-in + hoàn tác, walk-in 2 chạm, check-in, ghép rồi tách, đặt bàn ngày mai, kiểm tra hợp lệ, xung đột giữa hai máy, hoàn tác bị chặn, tua giờ, danh sách chờ đến lúc xếp chỗ, phân quyền xem SĐT, hủy booking có xác nhận.
- **axe-core**: 0 vi phạm WCAG 2 A/AA trên mọi trang và các hộp thoại chính, ở cả hai giao diện.

## Việc còn chờ PO duyệt

Giao diện gắn nhãn "Chờ PO duyệt" ở đúng chỗ. Các giá trị dưới đây đang là đề xuất kỹ thuật, **không phải mặc định production**:

- Chính sách giữ bàn cho booking: `SEQUENTIAL` hay `WINDOWED` (và độ dài cửa sổ).
- Thứ tự ưu tiên giữa khách đặt trước và Walk-in trong danh sách chờ.
- Ngưỡng xác nhận "không đến" (DR-05), thời hạn claim danh sách chờ.
- Cấu hình ghép sẵn B1 (B11 + B12), B2 (B21 + B22), A6 dài (A6 + A7).
- Danh mục bàn chính thức (18 hay 20 bàn dùng thường xuyên), vai trò khu C (đang là khu chờ, chưa nhận khách ngồi).
- Cách tính KPI khi gộp hai lượt ghé.
- Ma trận quyền (vai trò `TECH_PROPOSED`).

## Giả định và giới hạn

- **Ảnh mặt bằng gốc chưa được đính kèm.** Vị trí 44 bàn/ghế lấy đúng bảng tọa độ; kích thước mặt bàn được nới cho dễ chạm. Tường, quầy bar, cửa, hai khối nội thất phụ là **ước lượng** (`estimated: true` trong `src/domain/venue-layout.ts`) và cần đối chiếu với ảnh khảo sát. Chỉ cần sửa file đó, phần vẽ tự cập nhật.
- Dữ liệu khách, booking, lịch sử 45 ngày đều là dữ liệu giả sinh cố định (deterministic), không có dữ liệu thật.
- Không tạo Supabase/Firebase, không sửa schema, không tạo migration, không chạm vào MySQL hiện có.
- Chưa có PWA (cài lên màn hình chính iPad) và chế độ offline; nên làm khi có backend thật.

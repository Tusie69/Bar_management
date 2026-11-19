# Phụ lục B — Kiểm kê code đã commit trên nhánh local

> Phạm vi: merge-base `46f071d` đến HEAD `ceb6aa7`  
> Tổng: 61 file · +3.445/−183 dòng · 5 commit TU-38.

| Trạng thái | File | + | − | Thay đổi/ý nghĩa |
|---|---|---:|---:|---|
| A | `api/database/migrations/0031_turn_statistics_visit_range_index.sql` | 33 | 0 | Migration thêm index tối ưu truy vấn thống kê lượt. |
| A | `api/scripts/seed-e2e-owner.ts` | 159 | 0 | Script seed OWNER E2E có guard database/test environment, credential từ biến môi trường và upsert idempotent. |
| M | `api/src/modules/bookings/booking.repository.ts` | 8 | 5 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/src/modules/bookings/booking.route.ts` | 6 | 2 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/src/modules/bookings/business-date.ts` | 39 | 21 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/src/modules/tables/floor-projection.repository.ts` | 8 | 3 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/src/modules/tables/table-group.repository.ts` | 11 | 3 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/src/modules/tables/table-occupancy.ts` | 3 | 1 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/src/modules/venues/venue-settings.repository.ts` | 119 | 2 | API/repository cấu hình venue và ca vận hành. |
| M | `api/src/modules/venues/venue-settings.route.ts` | 54 | 3 | API/repository cấu hình venue và ca vận hành. |
| A | `api/src/modules/venues/venue-shift.ts` | 148 | 0 | Logic/test ca vận hành lấy từ cấu hình venue. |
| M | `api/src/modules/visits/table-turn.repository.ts` | 129 | 11 | Repository/route lượt khách và thống kê. |
| M | `api/src/modules/visits/visit.route.ts` | 6 | 0 | Repository/route lượt khách và thống kê. |
| M | `api/src/modules/waitlist/waitlist.repository.ts` | 5 | 3 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/test/business-date.test.ts` | 105 | 0 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/test/selective-na14.mysql.test.ts` | 3 | 0 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/test/support/integration-fixture.ts` | 4 | 0 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `api/test/table-turn-route.test.ts` | 20 | 0 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| A | `api/test/tu38-evidence.mysql.test.ts` | 120 | 0 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| A | `api/test/tu38-turn-statistics-benchmark.mysql.test.ts` | 190 | 0 | API/test/benchmark cho thống kê số lượt TU-38. |
| A | `api/test/tu38-turn-statistics.mysql.test.ts` | 275 | 0 | API/test/benchmark cho thống kê số lượt TU-38. |
| A | `api/test/tu38-venue-shift.mysql.test.ts` | 194 | 0 | Logic/test ca vận hành lấy từ cấu hình venue. |
| M | `api/test/venue-settings.mysql.test.ts` | 115 | 1 | Điều chỉnh backend hoặc kiểm thử để dùng ca vận hành cấu hình. |
| M | `docs/api.md` | 182 | 4 | Tài liệu API/bằng chứng triển khai TU-38. |
| A | `fix-reports/TU-38_TURN_STATISTICS.md` | 537 | 0 | Tài liệu API/bằng chứng triển khai TU-38. |
| M | `web/src/app/shell-alerts-bell.test.ts` | 2 | 0 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/app/shell.tsx` | 12 | 5 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/domain/booking-rules.test.ts` | 54 | 0 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/domain/booking-rules.ts` | 73 | 10 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/domain/models.ts` | 17 | 0 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/admin/admin-date.ts` | 26 | 7 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/admin/admin-shell.test.ts` | 12 | 1 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/admin/admin-shell.tsx` | 6 | 5 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/floor/floor-page.tsx` | 6 | 4 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/floor/floor-timeline.tsx` | 23 | 12 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/floor/floor-toolbar.tsx` | 9 | 3 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/floor/quick-form.tsx` | 5 | 3 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/floor/shift-panel.tsx` | 6 | 4 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/floor/table-detail.tsx` | 15 | 4 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/mobile/list.tsx` | 17 | 3 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/mobile/mobile-app.tsx` | 5 | 3 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/overview/overview-page.tsx` | 5 | 3 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/reservations/booking-sheet.tsx` | 5 | 3 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/reservations/reservation-detail.tsx` | 16 | 5 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/reservations/reservations-page.tsx` | 36 | 12 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/settings/settings-page.tsx` | 69 | 8 | UI/test chỉnh ca vận hành trong Cài đặt. |
| A | `web/src/features/settings/settings-shift.test.ts` | 123 | 0 | UI/test chỉnh ca vận hành trong Cài đặt. |
| M | `web/src/features/shift-overview/shift-overview-selectors.test.ts` | 1 | 1 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/shift-overview/shift-overview-selectors.ts` | 17 | 4 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/turns/turn-ledger-page.test.ts` | 28 | 1 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/turns/turn-ledger-page.tsx` | 5 | 3 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/turns/turns-daily-chart.tsx` | 4 | 2 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/turns/turns-helpers.test.ts` | 5 | 0 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/features/waitlist/waitlist-page.tsx` | 5 | 3 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/hooks/use-data.ts` | 20 | 2 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/lib/time.test.ts` | 89 | 1 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/lib/time.ts` | 68 | 6 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/services/contracts.ts` | 7 | 0 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/services/mock/server.test.ts` | 79 | 0 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/services/mock/server.ts` | 59 | 2 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |
| M | `web/src/services/mock/table-turns.ts` | 43 | 4 | Frontend chuyển logic ngày/ca và thống kê sang hợp đồng TU-38. |


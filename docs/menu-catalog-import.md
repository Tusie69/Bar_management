# Module Phục vụ 2: danh mục món và giá

## Phạm vi

Module này cung cấp catalog chỉ đọc cho một Phiên bàn đang mở. Nó chưa tạo giỏ, số lượng, tùy chỉnh, order line, price snapshot hoặc gửi đơn tới Bar/Bếp.

Nguồn Excel `21GAM_Danh_muc_mon_Menu_v1.0.xlsx` là menu marketing, không phải danh mục iPOS. Món MỚI được ghi ở trạng thái `PENDING_VERIFICATION`; catalog production chỉ trả `VERIFIED`. Món đã có giữ nguyên trạng thái của nó — xem “Chạy lại importer” bên dưới.

`MENU_ALLOW_PENDING_DEMO=true` cho phép xem dữ liệu đang chờ xác minh trong development. Cấu hình này bị từ chối khi `NODE_ENV=production`.

## Chạy importer

Dry-run là mặc định và không mở giao dịch ghi:

```powershell
pnpm --filter @21gam/api menu:import -- --file="C:\path\menu.xlsx" --dry-run
```

Chỉ dùng `--apply` với database staging/test và venue đã chọn rõ:

```powershell
pnpm --filter @21gam/api menu:import -- --file="C:\path\menu.xlsx" --apply --organization-id=1 --venue-id=1
```

Toàn bộ validation chạy trước khi ghi. Nếu có lỗi, importer không ghi gì. Khi ghi, category, item, variant, price và `venues.change_seq` nằm trong một transaction. `import_key` và code ổn định giúp chạy lại không nhân đôi dữ liệu.

Giá nguồn dùng nghìn đồng và được nhân `1.000` thành số nguyên VND. Ô trống không tạo variant; giá 0 bị từ chối.

## Kết quả dry-run nguồn ngày 18/11/2026

| Chỉ tiêu | Số lượng |
| --- | ---: |
| Nhóm lớn | 7 |
| Phân loại | 24 |
| Bản ghi category (nhóm + phân loại) | 31 |
| Món | 178 |
| Biến thể | 226 |
| Giá | 226 |
| Cảnh báo | 8 |
| Lỗi validation | 0 |
| Dòng cần xác minh | 9 |
| Giá bằng 0 | 0 |

## Chạy lại importer

Chạy lại trên nguồn KHÔNG đổi không ghi một dòng nào: không tăng `version`, không đổi `updated_at`, không tăng `venues.change_seq`, và trên hết là không hạ trạng thái của món đã đối chiếu.

Cơ chế là `menu_items.import_digest` (migration 0034): vân tay của nội dung nguồn gồm tên, mô tả, ghi chú, bếp/bar, phân loại và toàn bộ biến thể kèm giá. Importer so vân tay trước khi ghi.

| Tình huống | Kết quả |
| --- | --- |
| Món mới | Tạo mới, `PENDING_VERIFICATION` |
| Nguồn không đổi | Không chạm vào dòng |
| Nguồn đổi, đang `PENDING_VERIFICATION` / `REVIEW_REQUIRED` | Cập nhật, giữ nguyên trạng thái |
| Nguồn đổi, đang `VERIFIED` | Cập nhật, chuyển `REVIEW_REQUIRED`, giữ `verified_snapshot` của lần duyệt trước |
| Nguồn đổi, đang `REJECTED` | Cập nhật nội dung, giữ `REJECTED` |
| Món không còn trong file | Không xoá, không ẩn; báo mã món ở `orphanedItemCodes` |

`VERIFIED` không bao giờ bị hạ thẳng về `PENDING_VERIFICATION`. Hai trạng thái đó khác nghĩa nhau: một cái là “chưa ai xem bao giờ”, cái kia là “đã duyệt rồi nhưng nguồn vừa đổi”. Cả hai đều bị catalog production lọc ra, nên món tự ẩn cho tới khi có người duyệt lại — thà ẩn còn hơn bán sai giá.

Những cột KHÔNG thuộc về file Excel và không bị importer ghi đè: `menu_items.is_active`, `menu_item_variants.is_active`, `menu_item_variants.availability_status`. Đó là trạng thái vận hành (tắt món, hết hàng), không phải thuộc tính của nguồn.

`summary.written` in ra số lần ghi thật của mỗi lượt chạy; chạy lại trên nguồn không đổi phải cho `changed: false` và mọi ô `*Created` / `*Updated` bằng 0.

### Lịch sử giá

Importer ghi giá qua `applyVariantPriceWithinTransaction` — đúng ranh giới mà API quản trị dùng — thay vì INSERT thẳng. Hệ quả:

- Giá không đổi thì không sinh dòng mới.
- Giá đổi thì dòng cũ được **đóng lại** tại `effective_from` của giá mới và giữ nguyên làm lịch sử; dòng mới mở ra. Bản trước UPDATE thẳng lên dòng cũ, nên mỗi lần đổi giá là một lần xoá mất giá đã bán.
- Khoảng hiệu lực chồng nhau bị từ chối (`MENU_PRICE_WINDOW_OVERLAP`). Unique key `uq_menu_prices_one_open_active` chỉ chặn hai giá cùng mở vô thời hạn, không chặn hai khoảng hữu hạn chồng nhau — luật đó nằm trong repository.
- `--effective-from` lùi trước giá đang áp dụng bị từ chối (`MENU_PRICE_BACKDATED`) thay vì tạo một khoảng giá âm.

## Đối chiếu và duyệt món: `menu:verify`

Sau import, toàn bộ món mới đều ẩn khỏi máy Phục vụ. Lệnh này là đường duy nhất để mở, và nó ghi tên người chịu trách nhiệm.

Dry-run in ra diff và danh sách chặn, không ghi gì:

```powershell
pnpm --filter @21gam/api menu:verify -- --venue-id=1 --source=21GAM_MARKETING_MENU_V1
```

Duyệt thật:

```powershell
pnpm --filter @21gam/api menu:verify -- --venue-id=1 --source=21GAM_MARKETING_MENU_V1 --verified-by=3 --apply
```

- `--verified-by` bắt buộc khi `--apply`. Tài khoản phải thuộc organization và có `venue.configure` tại địa điểm đó, kiểm bằng đúng `hasPermission` mà API dùng.
- `--item-code=A,B` giới hạn vào một số món.
- `--allow-duplicate-name=CODE` mở khoá đúng một món trùng tên, sau khi đã đối chiếu.

Điều kiện chặn (không có cờ nào bỏ qua được, trừ trùng tên):

| Mã | Ý nghĩa |
| --- | --- |
| `VARIANT_NOT_SELLABLE` | Biến thể đang khoá bán — dòng `300++` và sáu dòng `lon / chai` |
| `AMBIGUOUS_UNIT` | `unit_code = OTHER`: nguồn ghi hai đơn vị nhưng chỉ có một giá |
| `MISSING_PRICE` | Biến thể chưa có giá hiện hành |
| `NO_VARIANT` | Món không có biến thể nào |
| `ITEM_INACTIVE` | Món đang tắt |
| `DUPLICATE_NAME` | Trùng `normalized_name` với món khác, chưa nêu đích danh |

Với món `REVIEW_REQUIRED`, lệnh in diff theo từng trường giữa `verified_snapshot` và nội dung hiện tại, nên người duyệt thấy giá đi từ bao nhiêu lên bao nhiêu chứ không chỉ thấy “có gì đó đã đổi”.

Khi `--apply`:

- Cả lô bị từ chối nếu còn món bị chặn (`MENU_VERIFICATION_BLOCKED`).
- Mỗi món được đọc lại `FOR UPDATE` và so `import_digest` với lúc dựng plan; lệch nghĩa là có một lần import xen vào giữa, và món đó bị bỏ qua (`skippedStale`) thay vì duyệt nhầm một thay đổi chưa ai nhìn.
- Mỗi món duyệt được ghi một dòng `operation_log` với `action = MENU_ITEM_VERIFIED`, người duyệt, trạng thái trước và danh sách trường đã đổi.
- `ck_menu_items_verified_audit` buộc mọi dòng `VERIFIED` phải có người duyệt, thời điểm duyệt và vân tay đã duyệt, nên một lệnh `UPDATE` tay thiếu ba thứ đó bị database từ chối.

Chạy apply hai lần trên database integration test vẫn giữ đúng `31 / 178 / 226 / 226`.

## Mapping đơn vị bán

| Giá trị Excel | `unit_code` | Quy tắc |
| --- | --- | --- |
| `ly` | `GLASS` | Chỉ tạo khi có giá ly-shot |
| `shot` | `SHOT` | Dùng giá ly-shot |
| `chai` | `BOTTLE` | Dùng giá chai, hoặc cột giá duy nhất nếu nguồn ghi chai |
| `ly / chai` | `GLASS`, `BOTTLE` | Tạo độc lập theo ô giá; ô trống không sinh giá 0 |
| `phần` | `PORTION` | Mặc định cho Food |
| `bình chia` | `SHARING_JUG` | Sharing Cocktails |
| `combo 6 shot` | `SHOT_COMBO_6` | `quantity_in_unit = 6` |
| `combo 12 shot` | `SHOT_COMBO_12` | `quantity_in_unit = 12` |
| `lon / chai` có một giá | `OTHER` | Khóa bán và chờ xác minh; không nhân thành hai variant |

Nhóm `Đồ ăn` được nhập với `preparation_station=KITCHEN`; các nhóm còn lại là `BAR`. Routing runtime đọc trường này, không suy lại từ tên nhóm.

## Dòng cần đối chiếu iPOS

- Dòng 31: `(SPECIAL COCKTAIL)` có giá `300++`. Variant lưu giá nguồn `300.000 VND` để đối chiếu nhưng `is_sellable=false`; ghi chú nêu rõ đây không phải giá cuối cùng.
- Dòng 202–207: `COCA-COLA`, `SODA`, `TONIC`, `SPRITE`, `RED BULL`, `LAVIE` ghi `lon / chai` nhưng chỉ có một giá. Mỗi dòng tạo một variant `OTHER`, `is_sellable=false`.
- Dòng 162 và 172: `VIGNERONS ARDECHOIS LES CLASSIQUES` trùng tên nhưng khác phân loại/mô tả (Red Wine và White Wine). Importer giữ hai item riêng.

Quản trị viên phải đối chiếu mã hàng, đơn vị bán, giá cuối cùng và trạng thái bán trong iPOS, rồi duyệt bằng `menu:verify`. Chín dòng trên đều nằm trong danh sách bị chặn: dòng `300++` và sáu dòng `lon / chai` vướng `VARIANT_NOT_SELLABLE` / `AMBIGUOUS_UNIT`, hai dòng trùng tên vướng `DUPLICATE_NAME`. Mở khoá chúng cần sửa nguồn (hoặc `--allow-duplicate-name` cho đúng mã món), không có cờ nào bỏ qua hàng loạt.

## API catalog

- `GET /api/v1/waiter/menu?visitId=<id>`
- `GET /api/v1/waiter/menu/items/:itemId?visitId=<id>`
- Filter tùy chọn: `categoryId`, `search`, `availability=AVAILABLE|TEMPORARILY_UNAVAILABLE`.

Endpoint yêu cầu session hợp lệ và `order.read`. Venue lấy từ session, không đọc `venueId` từ client. Phiên phải thuộc venue, chưa kết thúc, chưa đánh dấu thanh toán và còn allocation `USAGE` đang mở.

Projection chỉ trả item active, verified, variant active/sellable, không discontinued và có giá hiện hành. Response không chứa giá vốn, nhà cung cấp, công thức kho, import key, ghi chú nội bộ hoặc lịch sử giá.

Mỗi variant trả `variantId`, `unitCode`, `displayName`, `amountVnd`, `priceId`, `priceVersion`, `effectiveFrom`. Module 3/4 phải tra lại `priceId` + `priceVersion` và chốt snapshot; không tin `amountVnd` do client gửi.

## Module 3 đã dùng catalog này như thế nào

Giỏ gọi món, số lượng, ghi chú từng dòng, chọn variant, kiểm lại
`priceId`/`priceVersion` ở server, price snapshot vào order line, gửi đơn và
routing Bar/Bếp đã xong — migration `0036_sales_orders.sql`, API ở
`docs/api.md` → “Waiter ordering — cart and submitted orders (Module 3)”, màn
hình ở `docs/frontend-phucvu.md` mục 7.

Hai vị từ quyết định “món nào được bán” và “giá nào đang áp dụng” được tách ra
`api/src/modules/menu/menu-catalog-sql.ts` và dùng CHUNG cho catalog (Module 2)
và cho lúc tạo order line (Module 3). Hai bản sao của cùng một luật sẽ lệch nhau
ở lần sửa đầu tiên, và lúc đó máy Phục vụ bán được một món mà catalog đã ẩn —
hoặc báo lỗi một món đang hiện rõ trên màn hình.

`menu_item_variants.availability_status` và `is_sellable` là chốt duy nhất cho
“tạm hết” / “khóa bán” ở cả hai đường. Đổi chúng bằng tay trên database có hiệu
lực ngay với cả catalog và việc gửi đơn.

### Còn lại cho module sau

- Trạng thái chế biến và in phiếu (`preparation_tickets.status` hiện chỉ có `QUEUED`).
- Hủy món và sửa đơn đã gửi: phải là bản ghi mới, không ghi đè snapshot giá.
- Thanh toán, VAT/phí/phụ thu và trừ kho.


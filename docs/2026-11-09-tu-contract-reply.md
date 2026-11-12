# Tú phản hồi đề nghị contract backend - 09/11/2026

Đối chiếu biên bản v1.1 ngày 08/11 (cả mục 3.7 và bảng đầu việc mục 4) với mã nguồn `origin/develop@2c50941`.

- **A** - phần kỹ thuật tôi tự quyết và cam kết.
- **B1-B3** - câu hỏi cần anh Luân / Hưng chốt, kèm phương án mặc định để không việc nào bị treo.
- **B4** - bảy điểm trong biên bản mà bản đề nghị contract chưa nêu, gồm **task 7 deploy** và **inventory bàn lệch mục 3.7**.
- **B5** - đối chiếu với bảng 4.1 chính thức để Hưng điền đúng ô.
- **C** mốc giao · **D** error code cho Nam · **E** ca kiểm chứng.

---

## A. Phần kỹ thuật tôi tự quyết

### A0. Phát hiện quan trọng: C1 không phải nới validation mà là đổi mô hình lưu trữ

Membership nhóm hiện nằm ở `table_allocations.group_id` (`0001_initial_schema.sql:667`), và CHECK `ck_alloc_owner` buộc **mọi allocation phải có `hold_id` hoặc `visit_id`**:

```sql
CONSTRAINT ck_alloc_owner CHECK (
  (kind = 'HOLD'  AND hold_id IS NOT NULL AND visit_id IS NULL) OR
  (kind = 'USAGE' AND visit_id IS NOT NULL AND hold_id IS NULL))
```

Nghĩa là **không thể tồn tại membership nhóm mà không có khách** - đây không phải chỗ thiếu route, mà là ràng buộc schema. Thêm nữa `table_groups.business_date NOT NULL` và `uq_table_groups_active_symbol (venue_id, business_date, active_symbol)` làm vòng đời nhóm gắn cứng vào một ngày vận hành, cộng với worker tự giải thể ở migration `0007_auto_dissolve_business_day_groups.sql`.

Vì vậy C1 cần migration `0015` tách membership khỏi allocation:

```sql
CREATE TABLE table_group_members (
  id BIGINT UNSIGNED AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  venue_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  table_id BIGINT UNSIGNED NOT NULL,
  joined_at DATETIME(3) NOT NULL,
  joined_by_user_id BIGINT UNSIGNED NOT NULL,
  left_at DATETIME(3) NULL,
  active_table_key BIGINT UNSIGNED AS (IF(left_at IS NULL, table_id, NULL)) STORED,
  UNIQUE KEY uq_group_member_active (venue_id, active_table_key),
  ...
);
ALTER TABLE table_groups ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
```

`uq_group_member_active` là thứ đảm bảo một bàn chỉ thuộc một nhóm active - khóa ở DB, không phải ở application. `table_allocations.group_id` giữ nguyên cho tương thích luồng merge BA-021 và cho audit, nhưng floor projection đọc membership từ bảng mới.

### A1. Contract C1 tôi cam kết

| Route | Body | Ghi chú |
| --- | --- | --- |
| `POST /api/v1/tables/groups` | `{tableIds: [101,102], name?}` | Không cần booking/visit/tên/SĐT/số khách. Tên server sinh ổn định từ `symbol_no` (`groupDisplayCode` hiện có) nếu không truyền. |
| `POST /api/v1/tables/groups/:id/split` | `{keepTableIds}` **hoặc** `{version, mode:"ALL_TO_SINGLE"}` | Giữ nguyên caller BA-021 đang dùng `keepTableIds` (`table.route.ts:127`), chỉ thêm nhánh mode. Một namespace `/tables/groups`, không thêm `/table-layout/groups`. |
| `POST /api/v1/tables/groups/:id/members` | `{version, tableIds}` | Ghép thêm bàn vào nhóm sẵn có, thay vì buộc tách rồi ghép lại. |
| `GET /api/v1/tables?date=` | - | Thêm `groups[]` cho cả nhóm trống và nhóm có khách. |

Payload `groups[]` tôi chốt như đề xuất trong tài liệu, giữ `changeSeq` dạng chuỗi (`floor-projection.repository.ts:565` đang `String(venue.change_seq)`):

```json
{"groups":[{"id":15,"version":4,"symbolNo":7,"displayCode":"N7",
  "name":"Bar 7+8","zoneId":4,"tableIds":[207,208],"totalSeats":2,
  "displayState":"EMPTY","isOutOfService":false,"claim":null,
  "completedTurnCount":2,"currentTurnNo":3,"businessDate":"2026-11-11"}],
 "changeSeq":"122"}
```

Kiểu đầy đủ và ý nghĩa `claim` khi nhóm có khách ở **A1b** bên dưới.

Quyền: thêm `table.group.manage` cho create/add-member, không tái dùng `visit.split` vì thao tác layout trống không nên đòi quyền trên khách. Giữ auth, tenant, CSRF, idempotency, version, audit/changeSeq như hiện có.

Booking/check-in/move/assign: tôi chọn **server tự mở rộng toàn bộ membership trong cùng transaction** khi nhận một `tableId` thuộc nhóm, thay vì bắt frontend gửi group ID + version. Lý do: Nam không phải biết bàn nào đang trong nhóm, và không có cửa sổ race giữa lúc client đọc membership và lúc gửi lệnh. Xung đột trả `409 TABLE_GROUP_VERSION_CONFLICT` kèm `{currentVersion, changeSeq}` để client tải snapshot mới.

### A1b. Hình dạng `claim` của nhóm

Nguyên tắc tôi chọn: **claim của nhóm dùng đúng `FloorClaimProjection` đã có** (`floor-projection.repository.ts:17`), không phát minh kiểu mới. Nam đang render claim cho ô bàn rồi, nên ô nhóm dùng lại cùng một renderer, cùng tên field, cùng ý nghĩa.

```ts
export interface FloorGroupProjection {
  id: number
  version: number              // version của layout nhóm (table_groups.version) - KHÔNG phải version khách
  symbolNo: number
  displayCode: string
  name: string
  zoneId: number
  tableIds: number[]
  totalSeats: number
  displayState: TableDisplayState
  isOutOfService: boolean      // true nếu CÓ bàn thành viên ngừng phục vụ
  claim: FloorClaimProjection | null
  completedTurnCount: number
  currentTurnNo: number | null
  businessDate: string
}
```

**Bất biến: một nhóm có nhiều nhất một claim.** Đây là thứ làm cho `claim` ở cấp nhóm là một object chứ không phải mảng, và nó phải được bảo đảm lúc **tạo nhóm**, không phải lúc đọc. Tôi chặn ở `POST /tables/groups` và `/members`: mọi bàn thành viên phải **cùng một claim, hoặc đều không có claim**. Hai bàn có hai booking khác nhau thì trả `409 TABLE_GROUP_MULTIPLE_CLAIMS` kèm danh sách `conflictingTableIds` để Nam chỉ ra bàn nào vướng.

Đây là chỗ **phương án mặc định B1.6 của tôi còn hở**, tôi tự sửa lại: "đồng trạng thái" là chưa đủ, vì hai bàn cùng `BOOKED` vẫn có thể là hai booking khác nhau. Điều kiện đúng là **cùng claim hoặc cùng rỗng**.

Ý nghĩa từng field khi hoist lên cấp nhóm - những chỗ **không** phải copy thẳng:

| Field | Ở cấp nhóm |
| --- | --- |
| `partySize` | Số khách của claim đó, **không phải** tổng sức chứa. Tổng ghế là `totalSeats` ở ngoài claim. |
| `turnNo` | Hiện luôn `null` (`floor-projection.repository.ts:26`). Tôi **không** dùng nó cho badge; badge đọc `completedTurnCount` / `currentTurnNo` ở cấp nhóm, theo A3. Giữ `turnNo: null` để không phá client cũ. |
| `groupId`, `groupDisplayCode`, `groupMemberTableIds` | Dư thừa trong ngữ cảnh nhóm nhưng **giữ nguyên** để claim của bàn và của nhóm cùng một kiểu. Nam đọc được từ đâu cũng ra cùng kết quả. |
| `version` | Của visit/reservation, **khác** `version` của nhóm. Hai cái cùng tên ở hai cấp là bẫy dễ nhầm nhất ở đây: lệnh ghép/tách dùng `group.version`, lệnh trên khách dùng `claim.version`. |
| `canCall` | Theo đúng A5/C4.3, cộng điều kiện `phone_is_dialable=1`. |
| `reservedExpectedAt`, `contactedAt`, `contactStatus`, `iconKeys`, `honorific` | Các field mới ở A4, thêm vào `FloorClaimProjection` nên có ở cả hai cấp. |

`displayState` của nhóm dẫn xuất bằng **đúng `deriveTableDisplayState` hiện có**, truyền claim duy nhất của nhóm; không có claim thì `EMPTY`. Không thêm nhánh logic riêng cho nhóm - nếu màu của nhóm và của bàn thành viên lệch nhau thì đó là bug, không phải quy tắc.

**Bàn thành viên trả gì.** Để không vẽ claim hai lần, mỗi `FloorTableProjection` trong nhóm thêm:

```ts
claimOwner: 'GROUP' | 'TABLE' | null
```

`claim` trên bàn thành viên **giữ nguyên như hiện tại** (client cũ không vỡ), nhưng `claimOwner: 'GROUP'` nói với Nam rằng ô nhóm là nơi hiển thị, ô bàn chỉ là thành viên. Bàn không thuộc nhóm thì `claimOwner: 'TABLE'` khi có claim, `null` khi trống.

**Một điểm cần Nam xác nhận** (không chặn tôi, tôi làm theo mặc định này nếu không có phản hồi): nhóm đang có khách thì ô nhóm hiện một khối gộp, hay vẫn vẽ từng ô bàn kèm viền nhóm? Tôi trả dữ liệu đủ cho cả hai cách, nên đây thuần là lựa chọn UI - chỉ cần Nam nói để tôi biết có phải tối ưu payload hay không.

### A2. Chặn sức chứa - tôi làm được ngay mà không cần chờ đáp án SPL-01

Thay vì xóa kiểm tra capacity ở 6 chỗ (`booking.repository.ts:422,1139,1277,1763`, `visit.repository.ts:440`, `table-split.repository.ts:206`), tôi đổi từ `409` cứng thành field cảnh báo mềm trong response:

```json
{"capacityWarning": {"requestedGuests": 8, "totalSeats": 6}}
```

Thao tác vẫn thành công, UI hiện cảnh báo. Nếu sau này anh Luân muốn chặn lại ở một luồng nào thì bật lại từng luồng, không phải viết lại. Cách này thỏa 3.1 (bỏ chặn) mà không mất thông tin.

### A3. C2 - ledger lượt

Migration 0001-0014 không có bảng nào đếm lượt; `floor-projection.repository.ts:26,250,287,316` luôn trả `turnNo: null`. Tôi thêm ở `0015`:

```sql
CREATE TABLE table_turns (
  id, organization_id, venue_id, business_date DATE NOT NULL,
  scope VARCHAR(10) NOT NULL,              -- 'TABLE' | 'GROUP'
  table_id NULL, group_id NULL,
  member_table_ids JSON NOT NULL,          -- snapshot membership lúc mở lượt
  visit_id BIGINT UNSIGNED NOT NULL,
  turn_no SMALLINT UNSIGNED NOT NULL,
  seated_at DATETIME(3) NOT NULL, released_at DATETIME(3) NULL,
  guest_count, guest_name, source_code, honorific NULL,
  payment_source VARCHAR(10) NULL,         -- NULL = chưa xác nhận, KHÔNG phải đã trả
  payment_confirmation_id BIGINT UNSIGNED NULL,
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uq_turn_visit (visit_id),                       -- chống cộng đôi khi retry / hai máy
  UNIQUE KEY uq_turn_ordinal (venue_id, business_date, scope, table_id, group_id, turn_no)
);
```

Điểm quan trọng để tôi **không phải chờ anh Luân**: "lượt có được tính hay không" là **projection đọc lúc query**, không phải cái tôi ghi vào DB. Tôi ghi đủ vòng đời (giờ vào/ra, membership snapshot, nguồn, trạng thái thanh toán), còn công thức đếm badge là một biểu thức SQL đổi được trong 10 phút sau khi có quyết định. Nên mâu thuẫn 3.3.5 vs 3.4 **không chặn tôi**, chỉ chặn con số cuối cùng hiện trên badge.

Xác nhận thanh toán: `POST /api/v1/visits/:id/payment-confirmations` body `{source:"APP"|"IPOS", reference, amount?}`, ghi actor + thời điểm + reference, có idempotency. Giữ `POST /api/v1/visits/:id/close` hiện tại (`visit.route.ts:28`) và chỉ mở `AFTER_PAYMENT` khi đã có hàng confirmation - tức là bỏ `PAYMENT_VERIFICATION_UNAVAILABLE` ở `visit.repository.ts:128` một cách có căn cứ, không coi boolean từ browser là bằng chứng.

### A4. C3 - mapping 8 trạng thái sang 5

Đây là mapping tôi đề xuất, anh Luân duyệt ý nghĩa:

| Hiện có | Hiển thị sơ đồ |
| --- | --- |
| `EMPTY` | Trống |
| `BOOKED`, `UPCOMING` | Đã đặt |
| *(mới)* `CONTACTED` | Đã liên hệ |
| `LATE`, `LATE_CONFIRMED`, `NO_SHOW` | Tới muộn |
| `IN_USE` | Đã tới |
| `OUT_OF_SERVICE` | **không nằm trong 5 trạng thái khách** |

`OUT_OF_SERVICE` tôi tách thành flag riêng `isOutOfService: true` trên mỗi ô bàn, giữ nguyên khóa bàn ngừng phục vụ ở backend. Nó là trạng thái thiết bị, không phải trạng thái khách; nhồi vào 5 trạng thái thì mất khóa hoặc mất một trạng thái khách.

"Vừa quá giờ hẹn phải đỏ": trong `table-display-state.ts`, nhánh `elapsedMs > lateAfterMs` đổi thành `elapsedMs > 0`. `late_warning_minutes` / `no_show_warning_minutes` (`booking-timing.ts:23`, mặc định 15/30) **giữ lại nhưng chỉ dùng cho thông báo/escalation**, không còn quyết định màu. `NO_SHOW` và `arrivalPhase` giữ nguyên trong dữ liệu và lịch sử, chỉ không hiện thành trạng thái thứ 6 trên sơ đồ. Worker `no-show.worker.ts:158` giữ nguyên hành vi ghi cảnh báo, không tự hủy booking.

`CONTACTED` dựa trên outcome nhân viên ghi qua route đã có (`booking.route.ts:244`), không suy từ việc bấm Gọi. Tôi thêm `contacted_at` + `contact_status` vào `reservations` và trả `contactedAt`/`contactStatus` trong claim; `booking.repository.ts:1018` hiện chỉ xử lý `LATE_CONFIRMED`, tôi mở cho `CONTACTED`/`NO_ANSWER`.

Giờ hẹn giữ sau check-in: floor projection **đã có** join `LEFT JOIN reservations AS vr ... AND vr.visit_id = v.id`, nên thêm `reservedExpectedAt` vào claim của visit gần như không tốn gì. `arrivalTime` hiện chỉ có cho `RESERVATION` (`floor-projection.repository.ts:544`); tôi giữ `arrivalTime` là giờ vào thực tế và thêm `reservedExpectedAt` là giờ hẹn, walk-in thuần thì `null`.

Icon: lưu `iconKeys: ["star","pin"]` dạng mã trung tính, không gắn mã với vai khách, nên tôi **làm được lưu trữ + projection ngay** không cần chờ ý nghĩa star/fire/pin. `cake` dùng `is_birthday` hiện có. Thêm `honorific` (`MR` | `MS`) vào reservation + visit liên kết, không nhét vào tên/note/source.

Nguồn đặt: tái dùng `GET /api/v1/bookings/sources`, không thêm `/booking-sources`.

### A5. C4 - các điểm còn lại

**C4.1 Khu C.** `ck_zones_waiting_not_bookable` cấm đồng thời `is_waiting_area=1 AND is_bookable=1`, nên không thể chỉ bật cờ.

Tôi đã kiểm toàn bộ `api/src`: `is_waiting_area` chỉ được **đọc để trả ra projection** (`table.repository.ts:237,293`), không có logic nghiệp vụ nào ở backend phụ thuộc vào nó - luồng Bàn chờ / waitlist không lọc theo cờ này. Nên phương án đơn giản nhất là đủ: migration đổi Khu C (`zones.id=1`) thành `is_bookable=1, is_waiting_area=0`, **không cần thêm cột mới**. Việc Khu C còn hiển thị như khu chờ hay không là quyết định của frontend ở `web/src/domain/venue-layout.ts:147`, phần của Nam.

Di trú dữ liệu: ở seed thì Khu C `is_bookable=0` nên theo ràng buộc không thể có reservation nào trỏ vào bàn Khu C. **Trên DB thật tôi chưa kiểm được** (xem B2.16) - có thể đang có `waitlist_entries` hoặc `table_holds` gắn bàn Khu C. Migration của tôi sẽ `SELECT` đếm các hàng đó trước, in ra, và chỉ đổi cờ; không xóa hay chuyển hàng nào. Nếu có hàng thì tôi báo lại trước khi chạy tiếp.

**C4.2 SĐT không chuẩn.** Chỉ nới regex ở `phone-security.ts:22` là không đủ vì `0002_booking_phone_calling.sql:9` buộc bộ field cùng null/cùng có và `last3` phải đúng 3 chữ số. Tôi tách hai khái niệm:

- `phone_raw_ciphertext` + `phone_raw_encryption_key_id`: giá trị y như nhân viên nhập, vẫn AES-256-GCM, không bao giờ vào note hay payload công khai.
- `phone_e164_ciphertext` + HMAC + `last3`: chỉ có khi giá trị chuẩn hóa được.
- `phone_is_dialable TINYINT(1)`: cờ duy nhất quyết định có tạo `tel:` hay không.

Dò và chống trùng: HMAC tính trên dạng chuẩn khi gọi được, trên chuỗi digits-only khi không - vẫn chống trùng, vẫn không lưu plaintext. Dò 3 số cuối: giá trị có dưới 3 chữ số thì `last3 = NULL` và không tìm được bằng 3 số cuối (tôi nới CHECK thành `last3 IS NULL OR 3 chữ số`, giữ nguyên quy tắc cùng-null-cùng-có cho bộ field mã hóa). Quyền reveal và quyền gọi giữ nguyên, kể cả `0005_revoke_receptionist_phone_reveal.sql`. Dữ liệu cũ đều chuẩn nên backfill là `phone_is_dialable=1`, không mất gì.

**C4.3 Gọi trước ca.** Hai chỗ chặn độc lập, tôi sửa cả hai:

1. `booking-call.ts:30` trả `true` chỉ với `UPCOMING`/`LATE`/`LATE_CONFIRMED` - thêm `BOOKED` vào danh sách. Mirror ở `floor-projection.repository.ts:491` (`claim.canCall`) để hai nguồn không lệch.
2. `booking.repository.ts:939` gọi `currentBusinessDate`, hàm này ném `WALK_IN_OUTSIDE_BUSINESS_HOURS` trong khoảng 05:00-17:00 (`business-date.ts:78`). Luồng gọi điện không phải walk-in, nên tôi đổi sang `businessDateAt` - hàm này đã có sẵn ngay bên trên và **không ném lỗi ngoài ca**. Không sửa `currentBusinessDate` để không ảnh hưởng luồng walk-in.

Giữ nguyên audit, chống lạm dụng, `no-store` (`booking.route.ts:221`), và nối với C4.2: `canCall` thêm điều kiện `phone_is_dialable=1`.

**C4.4 Bước giờ.** Chỉ là `local.minute % 15 !== 0` ở `business-date.ts:179`. Bước 5 hay 15 **chi phí như nhau với tôi**, nên đây thuần là quyết định nghiệp vụ. Lưu ý giúp quyết định: hạ xuống 5 không làm sai dữ liệu cũ (mọi mốc 15 phút đều là mốc 5 phút), còn nâng từ 5 lên 15 về sau thì sẽ có booking cũ không khớp. Khung nhận booking 19:00-01:00 (`business-date.ts:172`) tôi giữ nguyên nếu không có chỉ đạo khác.

---

## B. Câu hỏi tôi cần chốt, kèm phương án mặc định

Tôi đề nghị cách làm việc này: **nếu đến hết 10/11 không có câu trả lời, tôi triển khai theo phương án mặc định bên dưới** và ghi rõ trong code là tạm; đổi về sau tốn thêm công nhưng không phải viết lại. Như vậy không có việc nào bị treo chờ họp.

### B1. Anh Luân - nghiệp vụ

| # | Câu hỏi | Phương án mặc định của tôi |
| --- | --- | --- |
| 1 | **Mâu thuẫn 3.3.5 vs 3.4**: lượt tăng khi đón khách thành công, hay sau khi thanh toán và giải phóng bàn? Badge "2/3" là lượt đang phục vụ hay số lượt hoàn tất? | Badge = `completedTurnCount / currentTurnNo`: tử số đếm lượt đã có `completed_at`, mẫu số là thứ tự lượt đang mở. Khớp cả hai mục: 3.3.5 làm mẫu số, 3.4 làm tử số. |
| 2 | Xanh lá nhưng khách bỏ về / quán mời / dồn bill - có tính lượt không? (4.1 câu 1) | Ghi là lượt có `released_at` nhưng `completed_at = NULL`, không vào tử số. Dữ liệu vẫn đủ để đổi quyết định sau. |
| 3 | Payment căn cứ app hay IPOS? (4.1 câu 2) | Làm route nhận cả hai `source`, bật `APP` trước. IPOS cần tích hợp riêng, không nằm trong sprint này. |
| 4 | Cutoff reset lượt? (4.1 câu 5) | Theo `business_date` sẵn có, mốc 05:00 (`bookingDayCutoffHour` trong `business-date.ts`). Không thêm mốc mới. |
| 5 | Chuyển bàn / ghép / tách thì lượt thuộc về đâu? | Một lượt gắn một `visit_id`; move/merge/split cập nhật `member_table_ids` chứ **không mở lượt mới**. Nhóm sau khi ghép thừa hưởng lượt của nhóm có số thứ tự lớn nhất. |
| 6 | **Ghép bàn trống với bàn đang có khách hoặc đang giữ** có được không, khách / bill / lịch sử thuộc nhóm nào? | Sprint này chỉ cho ghép khi **mọi bàn thành viên cùng một claim, hoặc đều không có claim** (xem A1b). Trộn trống với có khách trả `409 TABLE_GROUP_MIXED_STATE`; hai bàn hai booking khác nhau trả `409 TABLE_GROUP_MULTIPLE_CLAIMS`. Đây là phần tôi **không** đoán, vì đoán sai thì mất bill. |
| 7 | **Bàn sơ cua** có được vào nhóm không? Hiện chặn ở `table-group.repository.ts:38` (`SPARE_TABLE_NOT_BOOKABLE`) | Giữ chặn. Đoạn 9 vẫn giữ quy tắc sơ cua không đặt trực tiếp, nới ra là đổi nghiệp vụ. |
| 8 | **Nhóm có tồn tại qua ngày vận hành không?** | Giữ **không** qua ngày. Đây không phải lựa chọn tùy ý: `table_groups.business_date NOT NULL` và `uq_table_groups_active_symbol(venue_id, business_date, active_symbol)` làm ngày vận hành thành phần của danh tính nhóm, cộng worker `0007`. Muốn nhóm qua ngày thì phải bỏ `business_date` khỏi unique key, đổi cách sinh mã nhóm, bỏ worker 0007 - khoảng **+1,5 ngày** và rủi ro cho đúng phần đang chạy ổn. Nếu quán thật cần thì xin đưa sang sprint sau. |
| 9 | Hôm nay ghép nhóm mà một bàn thành viên đã có booking ngày tương lai? | Vì mặc định nhóm không qua ngày (B1.8), nhóm hôm nay **không ảnh hưởng** booking tương lai - booking đó vẫn ở bàn đơn. Không chặn ghép, không tự đổi booking tương lai. |
| 10 | Ghép liên khu (4.1 câu 3) | Giữ giới hạn cùng khu và cùng loại hiện có. Đây là giữ nguyên hiện trạng, không phải quyết định mới. |
| 11 | **Ưu tiên "Đã liên hệ" so với "Tới muộn" / "Đã tới"** | `Đã tới` > `Đã liên hệ` > `Tới muộn` > `Đã đặt`. Lý do: đã gọi được khách là thông tin mới hơn và hữu ích hơn cho nhân viên so với việc biết khách muộn. |
| 12 | Ý nghĩa **star / fire / pin**, có độc lập với O/N, có áp cho walk-in? | Lưu mã trung tính, nhiều icon cùng lúc, độc lập O/N, áp cho cả walk-in. Ý nghĩa là việc của UI và hướng dẫn nhân viên, backend không cần biết. Phần này **không chặn tôi**. |
| 13 | Bộ tên và mapping nguồn: WK/Walk-in, Social/Facebook/Fanpage/Zalo, Nhân sự/Nhân viên (4.1 câu 4) | Danh mục hiện có đúng 7 mã (`demo.sql:138`): `HOTLINE`, `FANPAGE`, `ZALO`, `SHAREHOLDER`, `STAFF`, `SOCIAL`, `OTHER`. **Không có `WK`/`WALK_IN`** - đó là lý do `web/src/domain/enums.ts:72` thiếu. Mặc định của tôi: **không thêm `WK` vào `booking_sources`**, vì walk-in đã có `visits.origin='WALK_IN'` riêng; thêm mã nguồn trùng nghĩa sẽ cho ra hai đường đếm walk-in lệch nhau. Nếu anh Luân muốn `WK` xuất hiện trong danh sách nguồn thì nói rõ, tôi thêm một hàng và quy ước rõ quan hệ với `origin` (khoảng +0,5 ngày, gồm backfill). `FANPAGE` vs `SOCIAL` đang cùng tồn tại - cần biết hai mã này khác nhau ra sao hay nên gộp; tôi không tự gộp và không sửa bản ghi cũ. |
| 14 | **Bước 5 hay 15 phút** (3.7 / C4.4) | Đề xuất **5 phút**, lý do ở A5. Chi phí sửa như nhau, nên chỉ cần một câu trả lời. |
| 15 | Có giới hạn gọi booking ngày tương lai, hoặc booking chưa gán bàn? | Mặc định: cho gọi mọi booking `BOOKED` **đã gán bàn**, mọi ngày. Bỏ luôn điều kiện đã-gán-bàn thì phải đổi thêm cả luồng floor, xin chốt riêng nếu cần. |

### B2. Hưng - acceptance và môi trường

| # | Cần | Vì sao |
| --- | --- | --- |
| 16 | Có DB thật hay chỉ seed demo? Ai chạy migration trên môi trường quán, và cửa sổ thời gian nào? | C4.1 và C4.2 đều cần migration trên dữ liệu thật. Tôi cần biết trước khi hứa ngày. |
| 17 | Danh mục bàn sơ cua thật tại quán | Để đối chiếu với quyết định B1.7 trước khi kiểm thử tại quán. |
| 18 | Ca nghiệm thu nào là bắt buộc để P1/P5 được đánh dấu xong | Tôi có ca kiểm chứng ở phần E, cần Hưng xác nhận là đủ hay thiếu. |

### B3. Điểm tôi cần nói rõ về tiến độ

Tổng khối lượng A1-A5 khoảng **6 ngày làm việc**, **cộng task 7 deploy khoảng 1 ngày** (B4.1) là **7 ngày**. Từ 09/11 đến mốc kiểm thử nội bộ 12/11 chỉ có 3 ngày. **Không thể giao đủ C1-C4 trước 12/11.** Tôi không nhận mốc mà tôi biết là không đạt được; thứ tự ưu tiên ở phần C là đề xuất của tôi, xin anh Luân và Hưng duyệt hoặc đổi thứ tự.

### B4. Rà soát biên bản v1.1 - điểm lệch và điểm chưa ai nhận

Tôi đọc lại biên bản gốc v1.1 (gồm mục 3.7 và bảng đầu việc mục 4) thay vì chỉ bản đề nghị contract. Bảy điểm sau chưa có trong bản đề nghị đó.

**B4.1 - Task 7 deploy bị bỏ khỏi mọi tính toán tiến độ.** Bảng mục 4 giao tôi **task 7 "[DevOps] Cấu hình server & Deploy công khai", hạn 11/11, trạng thái "Chờ task 6"**. Bản đề nghị contract chỉ nói về C1-C4 nên không đếm việc này, và ước lượng 6 ngày của tôi lúc đầu cũng bỏ sót. Hiện tôi đã có `deploy/nginx/21gam.conf.example` và `deploy/systemd/21gam-api.service` (chưa commit), nhưng **không thể trỏ tên miền trước khi Hưng bàn giao** (task 6, hạn 10/11). Nếu task 6 trượt thì task 7 trượt theo, và kiểm thử tại quán 12-14/11 **không có môi trường công khai để chạy** - đây là rủi ro lớn hơn mọi câu hỏi nghiệp vụ trong bảng B1. Xin Hưng xác nhận ngày bàn giao tên miền.

**B4.2 - Inventory bàn trong dữ liệu lệch mục 3.7.** Mục 3.7 ghi mặt bằng chuẩn là Khu A (A0-A6, A10), Khu B (B1-B8), Khu C (C1, C2, C4, C5), Bar 1-21. Dữ liệu hiện tại (`api/database/seeds/demo.sql`):

| Khu | Mục 3.7 | Trong dữ liệu | Lệch |
| --- | --- | --- | --- |
| A | A0-A6, A10 | A0-A7, A10 | **thừa A7** |
| B | B1-B8 | B3-B8, B11, B12, B21, B22 | **thiếu B1, B2; thừa B11, B12, B21, B22** |
| C | C1, C2, C4, C5 | C1, C2, C4, C5 | khớp |
| Bar | 1-21 | BAR01-BAR21 | khớp |

Mục 3.7 nói danh mục này là chuẩn đối chiếu **khi nghiệm thu**, nên nếu không chốt thì buổi kiểm thử tại quán sẽ báo lỗi mặt bằng. Lưu ý Đoạn 12 trong chính biên bản lại demo trên "bàn B12" - tức bản thân biên bản không nhất quán. Đây là **dữ liệu, không phải code**: cần Hưng hoặc anh Luân xác nhận mặt bằng thật của quán rồi tôi sửa seed và viết migration, khoảng 0,5 ngày. Tôi **không tự thêm/xóa bàn** vì đụng tới booking đang có.

**B4.3 - Ô "Đếm khách" đã tính sẵn ở backend, chưa ai nhận phần trả ra.** Mục 3.7 yêu cầu ô Đếm khách gồm Trước 21:30 / Sau 21:30, Tổng đã tới, Tổng bàn đặt, Tổng khách đặt, Khách quen O, Khách mới N, kèm nút Copy. Toàn bộ các số này **đã được tính** trong `api/src/modules/bookings/booking-export.ts` (mốc 21:30 ở `arrivalCounts` dòng 178, các dòng tổng ở 242-249) và trả qua `GET /api/v1/bookings/export` - nhưng chỉ dưới dạng **văn bản để Copy**, không phải JSON để Nam dựng ô trên màn hình. Bảng mục 4 không giao việc này cho ai. Tôi nhận: thêm `GET /api/v1/bookings/daily-counters` trả đúng các số đó dạng JSON, dùng lại hàm hiện có nên **khoảng 0,5 ngày**, giao 12/11. Nút Copy giữ nguyên endpoint cũ, không làm hai nguồn số.

Lưu ý thêm: Đoạn 24 anh Luân nói các chỉ số này "để lễ tân nhập trực tiếp hoặc tự đếm linh hoạt", nghĩa là **có thể anh Luân muốn ô này cho sửa tay**, trái với việc server tự tính. Xin anh Luân chốt: số do hệ thống tính (không sửa được) hay cho lễ tân ghi đè? Nếu cho ghi đè thì cần thêm bảng lưu giá trị ghi đè, khoảng +0,5 ngày.

**B4.4 - "Đã nhập bill x/y" không có dữ liệu nguồn và chưa ai nhận.** Mục 3.7 liệt kê ô KPI "Đã nhập bill x/y" trên Trang Danh sách. Trong backend chỉ có `visits.paid_marked_at`, không có khái niệm "đã nhập bill" cũng không có số `y`. Tôi **chưa nhận việc này** vì chưa rõ: "bill" là hóa đơn IPOS hay thao tác trong app, `x/y` đếm trên bàn hay trên lượt. Phụ thuộc trực tiếp đáp án B1.3 (app hay IPOS). Nếu chỉ là "số bàn đã đánh dấu thanh toán / tổng bàn có khách" thì tôi làm cùng B4.3 gần như không thêm công - xin anh Luân xác nhận cách hiểu này.

**B4.5 - Ràng buộc 30 phút khi hủy booking: backend chưa từng có.** Mục 3.2 và Đoạn 21 yêu cầu bỏ điều kiện chờ 30 phút mới được hủy. Tôi đã grep toàn bộ `api/src`: `POST /api/v1/bookings/:id/cancel` (`booking.route.ts:335`) **không có bất kỳ kiểm tra thời gian nào** - ràng buộc 30 phút chỉ nằm ở frontend (Đoạn 3 Nam demo "chỉ được sử dụng sau 30 phút"). Nên **đây là việc của Nam, không phải việc backend**, tôi không nhận. Nếu Hưng đã ghi nó vào checklist cho tôi thì xin chuyển sang Nam.

**B4.6 - Route `POST /bookings/:id/no-show` còn giữ hay bỏ?** Đoạn 23 nói trạng thái "Khách không tới" không cần thể hiện; A4 của tôi đã bỏ nó khỏi 5 trạng thái hiển thị nhưng giữ dữ liệu lịch sử. Tuy nhiên route đánh dấu thủ công vẫn tồn tại (`booking.route.ts:351`, quyền `reservation.mark_no_show`), và Đoạn 22 cho thấy anh Luân muốn **chỉ còn một nút Hủy**. Mặc định của tôi: **giữ route** (để worker và lịch sử không vỡ) nhưng Nam bỏ nút khỏi UI. Nếu anh Luân muốn bỏ hẳn khả năng đánh dấu no-show thủ công thì nói rõ, vì đó là xóa một đường ghi dữ liệu, không chỉ ẩn nút.

**B4.7 - "Dò số" xung đột với C4.2.** Mục 3.7 liệt kê nút **"Dò số" (tra 3 số cuối SĐT)** là điều khiển **bắt buộc** khi nghiệm thu. Nhưng C4.2 cho phép nhập giá trị nội bộ không chuẩn, và giá trị như `ban A - 12` thì không có 3 số cuối để tra (A5). Nghĩa là: cho nhập tự do **làm giảm khả năng của một chức năng bắt buộc**. Hai yêu cầu này do cùng anh Luân đưa ra ở hai chỗ khác nhau nên cần chốt một hướng:

- (a) Giá trị không chuẩn **không tìm được** bằng Dò số - đơn giản nhất, tôi làm theo mặc định này; hoặc
- (b) Dò số tìm cả theo **chuỗi con bất kỳ** trong giá trị thô, cần index/HMAC khác và phải cân nhắc bảo mật vì dò chuỗi con trên dữ liệu mã hóa khó hơn nhiều - khoảng +1 ngày và tôi phải xem lại rủi ro lộ số.

### B5. Đối chiếu với bảng 4.1 chính thức

Bảng 4.1 trong biên bản có **đúng 5 câu** cho anh Luân. Để Hưng điền vào đúng ô, đây là chỗ tôi trả lời từng câu:

| 4.1 | Nội dung | Trả lời của tôi ở |
| --- | --- | --- |
| 1 | Xanh lá mà không thanh toán - tính lượt hay không | B1.2 (kèm B1.1 về công thức badge) |
| 2 | Căn cứ thanh toán app hay IPOS | B1.3 (liên quan B4.4) |
| 3 | Ghép bàn liên khu | B1.10 |
| 4 | Bộ tên Nguồn đặt | B1.13 |
| 5 | Mốc cắt ngày để reset badge | B1.4 |

Mười câu còn lại trong B1 (6-9, 11, 12, 14, 15) là câu **chưa có trong bảng 4.1** mà tôi phát sinh khi đọc code - đề nghị Hưng bổ sung vào bảng, đặc biệt B1.6 và B1.8 vì hai câu đó quyết định phạm vi sprint.

---

## C. Mốc giao đề xuất

| Việc | Giao | Phụ thuộc |
| --- | --- | --- |
| **Task 7 - cấu hình server và deploy công khai** | **11/11** | **Chờ task 6** (Hưng bàn giao tên miền, hạn 10/11). Xem B4.1. |
| C4.3 gọi trước ca | **10/11** | Không. Sửa nhỏ nhất, làm trước để Nam có việc nối sớm. |
| C4.1 Khu C | **10/11** | Cần trả lời B2.16 về cửa sổ chạy migration. |
| C1 nhóm trống: migration + create/split/add-member + `groups[]` trong projection | **11/11** (trễ 1 ngày so với mục 4 việc 1) | Lý do trễ: A0, phải thêm bảng membership. Nếu bỏ phần ghép/tách nhóm **có khách** thì không có gì phải chờ anh Luân. |
| C1 capacity thành cảnh báo mềm | **11/11** | Không, theo A2. |
| C2 ledger + badge + `completedTurnCount` trên floor | **12/11** (trễ 1 ngày so với mục 4 việc 2) | Không chặn bởi B1.1-B1.5, theo A3. |
| C2 route payment-confirmation | **13/11** | Cần B1.3. |
| C3 mapping 5 trạng thái + "quá giờ là đỏ" + `contactedAt` + `reservedExpectedAt` | **13/11** | Cần B1.11 để chốt precedence. Phần còn lại tôi làm theo A4. |
| C3 `iconKeys` + `honorific` | **13/11** | Không, theo A4. |
| C4.2 SĐT không chuẩn | **14/11** | Cần B2.16. |
| C4.4 bước giờ/phút | **trong ngày có đáp án B1.14** | Chỉ cần một câu trả lời. |
| Ghép/tách nhóm **có khách**, trộn trạng thái | **sprint sau** | Cần B1.6. Không đoán. |
| Nhóm tồn tại qua ngày | **sprint sau** | Cần B1.8. +1,5 ngày, xem lý do. |
| Ô "Đếm khách" dạng JSON (B4.3) | **12/11** | Không. Backend đã tính sẵn, xem B4.3. |
| Màn thống kê ngày/tháng/năm | **sprint sau** (đúng như 3.4) | - |
| "Đã nhập bill x/y" (B4.4) | **chưa nhận** | Chưa có ai được giao, chưa có dữ liệu nguồn. Xem B4.4. |

Mốc 14/11 trùng ngày cuối kiểm thử tại quán, nghĩa là C4.2 gần như không có thời gian sửa lỗi trước go-live 16/11. Nếu cần biên an toàn thì xin hạ ưu tiên C4.2 hoặc C3 icon xuống sau go-live.

---

## D. Error code và version - bảng tra cho Nam

Mã lỗi ổn định, Nam nối đúng theo bảng này. Mọi lỗi giữ nguyên định dạng `AppError(status, code, message)` hiện có.

| Route | Mã lỗi | Status | Khi nào |
| --- | --- | --- | --- |
| `POST /tables/groups` | `MERGE_REQUIRES_MULTIPLE_TABLES` | 400 | ít hơn 2 bàn (dùng lại mã có ở `table-group.repository.ts:24`) |
| | `TABLE_NOT_FOUND` | 400 | bàn không tồn tại hoặc không `ACTIVE` |
| | `TABLE_ALREADY_GROUPED` | 409 | bàn đang thuộc nhóm active khác (vi phạm `uq_group_member_active`) |
| | `SPARE_TABLE_NOT_BOOKABLE` | 409 | có bàn sơ cua, theo B1.7 |
| | `TABLE_KIND_MISMATCH` | 409 | trộn bàn thường với ghế Bar |
| | `TABLE_ZONE_MISMATCH` | 409 | khác khu, theo B1.10 |
| | `TABLE_GROUP_MIXED_STATE` | 409 | trộn bàn trống với bàn có khách, theo B1.6 |
| | `TABLE_GROUP_MULTIPLE_CLAIMS` | 409 | các bàn thành viên có hai claim khác nhau, kèm `conflictingTableIds` (A1b) |
| `POST /tables/groups/:id/split` | `INVALID_GROUP_ID` | 400 | giữ nguyên |
| | `TABLES_REQUIRED` | 400 | giữ nguyên, chỉ cho nhánh `keepTableIds` |
| | `INVALID_SPLIT_MODE` | 400 | `mode` không phải `ALL_TO_SINGLE`, và không có `keepTableIds` |
| | `TABLE_GROUP_VERSION_CONFLICT` | 409 | `version` không khớp, kèm `{currentVersion, changeSeq}` |
| `POST /tables/groups/:id/members` | như `POST /tables/groups` | | cộng thêm `TABLE_GROUP_VERSION_CONFLICT` |
| `POST /visits/:id/payment-confirmations` | `PAYMENT_SOURCE_INVALID` | 400 | `source` ngoài `APP`/`IPOS` |
| | `PAYMENT_ALREADY_CONFIRMED` | 409 | đã có confirmation cho visit này |
| | `VISIT_NOT_OPEN` | 409 | visit đã `ended_at` |
| `POST /visits/:id/close` | `PAYMENT_VERIFICATION_UNAVAILABLE` | 409 | **giữ lại** nhưng chỉ khi `AFTER_PAYMENT` mà chưa có confirmation |
| `POST /bookings` | `EXPECTED_AT_OFF_SLOT` | 400 | giữ nguyên mã, chỉ đổi bước theo B1.14 |
| | `INVALID_PHONE_NUMBER` | 422 | **chỉ còn** khi giá trị rỗng hoặc quá dài; giá trị nội bộ không chuẩn không còn trả lỗi này (C4.2) |
| `POST /bookings/:id/call` | `PHONE_NOT_DIALABLE` | 409 | `phone_is_dialable=0`, thay cho việc tạo `tel:` sai |
| | ~~`WALK_IN_OUTSIDE_BUSINESS_HOURS`~~ | - | **biến mất khỏi luồng này** sau C4.3 |

Version: chỉ `table_groups` có `version` mới. Booking/check-in/move/assign **không nhận group version** - server tự mở rộng membership (A1), nên Nam không phải quản version nhóm ở các luồng đó. `changeSeq` vẫn là chuỗi, vẫn là thứ duy nhất Nam dùng để biết cần tải lại snapshot.

## E. Ca kiểm chứng tôi sẽ chạy (HTTP và DB)

1. **Nhóm trống bền vững**: tạo nhóm 2 bàn trống, `GET /api/v1/tables` có `groups[]`, reload vẫn còn. Đặt khách vào nhóm, thanh toán, nhả khách, **nhóm vẫn còn** (đây là chỗ hiện tại đang giải thể: `visit.repository.ts:192`, `booking.repository.ts:1370`, `table-group.repository.ts:167`). Bấm Tách thì thành bàn đơn.
2. **Hai máy, retry, xung đột**: hai request ghép cùng một bàn vào hai nhóm khác nhau, một thành công, một `409`, DB chỉ có một membership active (chứng minh bằng `uq_group_member_active`). Gửi lại cùng idempotency key thì không tạo nhóm thứ hai.
3. **Một nhóm một claim**: hai bàn có hai booking khác nhau, ghép thành nhóm thì trả `409 TABLE_GROUP_MULTIPLE_CLAIMS` kèm `conflictingTableIds`. Nhóm 2 bàn trống, đặt khách vào thì `groups[].claim` có đúng một object, `claimOwner='GROUP'` trên cả hai bàn thành viên, và `displayState` của nhóm khớp với của từng bàn thành viên.
4. **Đếm lượt**: 3 lượt liên tiếp trên cùng bàn, `turn_no` 1-2-3 không trùng. Gọi `close` hai lần và gửi lại payment-confirmation, `completedTurnCount` không nhảy đôi. Chuyển bàn giữa lượt, vẫn một hàng `table_turns`.
5. **Khu C**: `POST /api/v1/bookings` vào bàn Khu C thành công, không còn lỗi zone không bookable.
6. **SĐT nội bộ**: nhập `ban A - 12` thì lưu được, `phone_is_dialable=0`, không có `tel:`, `SELECT` trên DB không thấy plaintext. Nhập `0901234567` thì `phone_is_dialable=1`, dò 3 số cuối `567` ra đúng booking. Hai booking cùng giá trị không chuẩn thì phát hiện trùng.
7. **Gọi trước ca**: tạo booking 22:00 ngày mai, gọi lúc 10:00 hôm nay, `canCall=true` ở cả `GET /api/v1/tables` và `POST /api/v1/bookings/:id/call`, không còn `WALK_IN_OUTSIDE_BUSINESS_HOURS`.
8. **Trạng thái**: booking 20:00, giả lập 20:01 thì đỏ ngay, không đợi 15 phút. Ghi outcome `CONTACTED` thì chuyển "Đã liên hệ". Quá 30 phút thì vẫn "Tới muộn" trên sơ đồ, `NO_SHOW` còn trong dữ liệu.
9. **Giờ/phút**: `expectedAt` 20:05 được chấp nhận (nếu chốt bước 5); 20:03 trả `400 EXPECTED_AT_OFF_SLOT`.

Mock và unit xanh không được tính là xong - tôi sẽ chạy các ca trên qua HTTP thật và kiểm chứng bằng query DB, có log để Hưng đối chiếu.

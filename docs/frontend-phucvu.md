# Frontend — Khu vực Phục vụ (`/phucvu`)

> Cập nhật: 21/11/2026 · Phạm vi: Module Phục vụ 1 (đăng nhập, phân quyền, sơ
> đồ bàn), 2 (danh mục món), 3 (giỏ gọi món, gửi đơn) và 5 (theo dõi và điều
> chỉnh đơn)
> Code: `web/src/features/waiter/`, `web/src/features/waiter-menu/` · Backend:
> `docs/api.md` → “Floor projection for WAITER”, “Waiter menu catalog (Module 2)”,
> “Waiter ordering — cart and submitted orders (Module 3)”

Tài liệu này dành cho người làm tiếp các module của vai Phục vụ (Bar/Bếp, hủy
món, thanh toán). Nó nói ba thứ: khu vực này đã có gì, vì sao nó KHÔNG dùng lại
khung của Lễ tân, và chỗ nào để cắm module tiếp theo.

---

## 1. Vào cửa và định tuyến

| URL                            | Ai vào được          | Ghi chú                                                       |
| ------------------------------ | -------------------- | ------------------------------------------------------------- |
| `/phucvu/login`                | tài khoản `WAITER`   | Trang đăng nhập dùng chung, chọn cổng theo URL                |
| `/phucvu`                      | `WAITER`             | Sơ đồ bàn ca hiện tại                                         |
| `/phucvu/phien/:visitId/goi-mon` | `WAITER`           | Điểm cắm module gọi món                                       |
| `/waiter`, `/waiter/login`     | — (chỉ redirect)     | URL cũ bằng tiếng Anh, chuyển về URL tiếng Việt               |

- `PORTAL_CONFIG.waiter.home` (`web/src/domain/auth-portal.ts`) = `/phucvu` và
  phải khớp `WAITER_HOME_PATH` trong `waiter-access.ts`. Có test ràng buộc; lệch
  nhau nghĩa là đăng nhập xong rơi vào màn của Lễ tân.
- `waiterRoute` đứng **trước** route `"/"` trong `web/src/app/app.tsx`. Route đó
  có `path: "*"` đẩy mọi URL còn lại về `/floor` và sẽ nuốt `/phucvu` — cùng lý
  do mà `adminRoute` đứng trước nó.
- Vai khác gõ thẳng `/phucvu` gặp `WaiterGuard`: màn “Không có quyền truy cập”
  kèm link về home của chính họ. Không đẩy im lặng về `/floor`, vì người dùng sẽ
  tưởng mình gõ sai URL.
- Tài khoản `WAITER` đi lạc ra một URL của vai khác được `Root` đưa về `/phucvu`.
- URL alias **không** cấp thêm quyền: cửa vào vẫn là `canEnterWaiter`, và backend
  vẫn kiểm permission trên từng endpoint.

## 2. Vì sao có khung riêng, không dùng `AppShell` hay `MobileApp`

Lý do không phải thẩm mỹ. Hai khung kia mount navigation của Lễ tân (Đặt bàn,
Chờ, Khách, Báo cáo, Cài đặt) cùng các sheet booking/walk-in của nó. Dùng lại
chúng rồi ẩn từng mục bằng `if` là cách để một mục quay lại sau một lần refactor
mà không ai nhận ra. Trong `WaiterShell` những mục đó **không tồn tại trong cây
component**, nên không có gì để sót.

Ngược lại, phần vẽ sơ đồ thì dùng lại nguyên `FloorCanvas`:
`web/src/features/waiter/waiter-floor.tsx` chỉ là một lớp mỏng truyền props.
Sơ đồ là thứ nhân viên đã học vị trí từng ô; hai bản vẽ song song sẽ lệch nhau
ngay lần đầu có ai kê lại bàn, và lúc đó không ai biết bản nào đúng.

## 3. Dữ liệu: endpoint riêng, không phải cờ hiển thị

`useWaiterFloor` gọi `api.getWaiterFloor(businessDate)` → `GET /tables/service`.
Nó **không** dùng `useFloorModel` của Lễ tân: hook đó gọi `GET /tables` bằng
`customer.view_masked`, nên với tài khoản Phục vụ sẽ trả 403 và màn hình trắng.

Phép chiếu của Phục vụ không mang tên khách, số điện thoại, nguồn đặt, ghi chú
booking hay cờ nhận dạng khách — máy chủ đã lược chúng trước khi payload rời
server (xem `docs/api.md`). `hideGuestNames` trên `FloorCanvas` vẫn được bật,
nhưng nó **không** phải chốt bảo mật: không có gì để ẩn.

`redactFloorForWaiter` (`web/src/domain/waiter-privacy.ts`) chỉ dùng cho hai
việc: chế độ mock của prototype (không có máy chủ nên phải tự lược, nếu không
bản demo sẽ hiện tên khách và người xem demo sẽ tin đó là thiết kế), và làm chỗ
duy nhất mô tả “trường nào là dữ liệu khách” để test kiểm bằng một assert. Nếu
một màn hình của Phục vụ phải lược dữ liệu ở trình duyệt thì nó đang gọi sai
endpoint.

## 4. Trạng thái bàn và hành động

`waiterTableCapability` (`waiter-access.ts`) là chỗ duy nhất quyết định nút nào
bật. Nó nhận trạng thái ĐÃ CHIẾU từ máy chủ, không tự suy từ giờ máy khách, nên
hai thiết bị cùng nhìn một bàn thấy cùng một bộ nút.

| `phase`          | Khi nào                           | Gọi món | Xem đơn | Đổi/Ghép/Tách |
| ---------------- | --------------------------------- | ------- | ------- | ------------- |
| `empty`          | trống, sơ cua, Phiên đã đóng      | không   | không   | không         |
| `booked`         | đã đặt / tới muộn / no-show / giữ | không   | không   | không         |
| `serving`        | Phiên đang mở, chưa thanh toán    | **có**  | có      | **có**        |
| `payment`        | `claim.paid`                      | không   | có      | không         |
| `out_of_service` | bàn ngừng phục vụ                 | không   | không   | không         |

Ở `payment`, panel hiện nguyên văn câu đã chốt:
“Phiên đang chờ thanh toán. Liên hệ Thu ngân nếu khách muốn gọi thêm.”

**Giới hạn còn lại cho Module 2:** dữ liệu hiện chỉ có một cờ `paid`, nên “chờ
Thu ngân” và “đã thu tiền xong” chưa phân biệt được; cả hai rơi vào `payment` và
đều chỉ được xem.

## 5. Bàn ghép: một Phiên, nhiều ô bàn

Mọi thao tác đi theo `visitId`, không theo `tableId`. `claim.groupMemberTableIds`
giống nhau trên mọi ô của cụm, nên `buildWaiterSheetView` cho ra cùng một
`capability.visitId` dù chạm ô nào. Các ô bàn vẫn hiển thị riêng trên sơ đồ theo
quy tắc hiện tại; panel liệt kê chúng ở dòng “Gồm các bàn …”.

Đừng dùng `tableId` làm chủ sở hữu đơn. Nếu làm vậy, một cụm bốn bàn sẽ sinh bốn
đơn cho cùng một đoàn khách.

## 6. Đổi / Ghép / Tách

Luật nằm trong `waiter-rearrange.ts` (hàm thuần, có test), component chỉ render:

- **Đổi bàn** → `POST /visits/:id/move`, `tableIds` là **bộ bàn cuối cùng**.
- **Ghép bàn** → `POST /visits/:id/merge`, cũng là bộ bàn cuối cùng.
- **Tách bàn** → `POST /tables/groups/:id/split` với `keepTableIds` (bàn GIỮ LẠI).

Hai thao tác đầu đi qua `api.updateWaiterVisitTables`, **không** qua
`moveClaim`/`combineTables`: hai hàm đó đọc lại sơ đồ đầy đủ của Lễ tân để tìm
claim và tài khoản Phục vụ nhận 403 ở đó. Phép chiếu của Phục vụ đã mang
`visitId` và `version`, nên không cần đọc gì thêm.

Bàn đích chỉ gồm bàn **trống và đang hoạt động**. Bàn sơ cua bị loại (dùng bàn
sơ cua là quyết định mặt bằng cần người xác nhận), bàn đang có khách cũng bị
loại (ghép hai đoàn khách là nghiệp vụ của Lễ tân).

Máy chủ vẫn là nơi kiểm Phiên còn mở, sức chứa, bàn còn trống, venue và
`version`. Những gì chặn ở frontend chỉ để Phục vụ không gửi một yêu cầu mà họ
đã biết trước là sai.

## 7. Giỏ gọi món và gửi đơn (Module 3)

Code: `web/src/features/waiter-menu/`. Hai màn, hai route đã có từ Module 1:

| URL                              | Màn                                   |
| -------------------------------- | ------------------------------------- |
| `/phucvu/phien/:visitId/goi-mon` | Danh mục + giỏ + gửi đơn              |
| `/phucvu/orders/:visitId`        | Đơn đã gọi của Phiên, mở ra xem từng dòng |

`waiter-order-scaffold.tsx` của Module 1 đã được xoá: nó tồn tại để nói “module
chưa có”, và giữ lại một empty state như thế bên cạnh một màn đã chạy chỉ gây
nhầm.

### Luật của giỏ nằm ở hàm thuần

`cart-model.ts` giữ toàn bộ luật và có test (`cart-model.test.ts`) chạy không
cần DOM — cùng quy ước với `waiter-rearrange.ts`. Component chỉ render.

- **Định danh dòng là `cartLineId`, không phải `variantId`.** Sửa số lượng, sửa
  ghi chú và xóa đều đi theo `cartLineId`. Một bàn gọi “hai ly Macallan, một ly
  không đá” là hai dòng cùng biến thể; nếu thao tác đi theo `variantId` thì chạm
  vào dòng nào cũng sửa cả hai, và một trong hai lời nhắn không tới được Bar.
- **Gộp số lượng chỉ khi cùng biến thể VÀ cùng ghi chú đã chuẩn hoá**
  (`customizationKey`: cắt và gộp khoảng trắng, bỏ dấu, hạ chữ thường). “Ít  Đá”
  và “it da” là một customize; “không đá” là một customize khác. Máy chủ dùng
  đúng luật này, nên giỏ không bao giờ gửi lên một cặp mà máy chủ coi là trùng
  (`ORDER_DUPLICATE_LINE`).
- Sửa ghi chú thành trùng một dòng khác thì hai dòng **được gộp** ngay trong giỏ.
  Không gộp thì payload mang một cặp trùng khít và cả đơn bị từ chối vì một lần
  sửa ghi chú.
- Nhãn trợ năng của dòng mang theo ghi chú (“Bỏ MACALLAN 12 Ly · ít đá khỏi
  giỏ”), vì hai nút giống nhau thì không ai biết nút nào bỏ dòng nào.
- Nút trừ cuối cùng của dòng giỏ là nút **bỏ món**, không phải một dòng “0 ly”.
- `cartPayload()` chỉ sinh đúng bảy trường được phép gửi. Không có `amountVnd`,
  tên món hay quầy chế biến: máy chủ đọc chúng từ danh mục.
- Giới hạn (50 dòng, số lượng 1–99, ghi chú 200 ký tự, đơn giá tối đa
  1.000.000.000đ, tổng đơn tối đa 4.950.000.000.000đ) khớp
  `order.repository.ts`. Lệch nhau nghĩa là UI hứa điều máy chủ từ chối.
- Trần tiền tồn tại vì tiền đi qua JSON dưới dạng `number`: ba trần nhân với
  nhau vẫn nằm trong khoảng nguyên chính xác của JavaScript. Biến thể có giá
  ngoài khoảng không thêm vào giỏ được, và giỏ vượt trần thì nút gửi bị khóa kèm
  câu giải thích — thay vì gửi lên để nhận lỗi, hoặc tệ hơn, hiện một tổng đã bị
  làm tròn.

### Giá đổi: hỏi lại, không tự sửa

Máy chủ trả MỘT lỗi cho cả giỏ, mang cả hai loại vấn đề: `details` luôn có đủ
`variants` (món hết) và `changes` (giá đổi), dù mã là `MENU_ITEM_UNAVAILABLE`,
`MENU_PRICE_CHANGED` hay `ORDER_LINES_REJECTED` (có cả hai). Màn hình xử lý cả
hai trong một nhánh: bỏ món hết khỏi giỏ, rồi mở hộp xác nhận giá. Trước đây món
hết báo trước, giá đổi báo sau, nên nhân viên phải bấm gửi hai lần mới biết hết
chuyện.

`PriceChangeDialog` in ra “380.000đ → 420.000đ” cho từng món (giá cũ lấy từ giỏ,
giá mới từ máy chủ — `describePriceChanges`), vì nhân viên phải nói lại con số đó
với khách.

Bấm “Xác nhận giá mới” **không** gửi đơn: nó chỉ cập nhật giỏ, rồi nhân viên bấm
“Gửi đơn” lần nữa. `reconcileCart` cũng không tự sửa giá — nó chỉ bỏ dòng mà món
không còn trong danh mục hoặc đang tạm hết, và màn hình **nói ra** những dòng đã
bỏ. Một dòng tự biến mất là một món khách đã gọi và sẽ không bao giờ tới.

### Chống double submit, và giữ giỏ khi lỗi

- `submittingRef` chặn lần bấm thứ hai trước khi React kịp render lại; nút đổi
  thành “Đang gửi đơn…” và bị khóa.
- `cart.submitKey` là mã chống trùng của **nội dung** giỏ: nó đổi mỗi lần giỏ
  đổi, và chỉ khi đó. Nhờ vậy gửi lại cùng một giỏ được máy chủ trả lại đúng đơn
  cũ, còn sửa giỏ rồi gửi lại là một đơn mới chứ không phải một lần dùng lại mã
  với payload khác (máy chủ trả 422 cho việc đó).
- Mọi lỗi giữ nguyên giỏ và hiện câu lỗi ngay trên nút gửi. `cart.clear()` chỉ
  được gọi **sau** khi máy chủ trả về đơn.

### Nháp giỏ: sessionStorage, phân vùng ba tầng

`web/src/domain/waiter-cart-storage.ts`, khóa
`21gam.waiter-cart.v1:<userId>:<venueId>:<visitId>`.

`sessionStorage` chứ không `localStorage`: máy Phục vụ là máy dùng chung, và một
giỏ còn sót lại sau khi người khác đăng nhập sẽ được gửi cho sai bàn. Thiếu một
trong ba thành phần khóa thì hai nhân viên dùng chung một máy, hoặc hai Phiên mở
trong hai tab, ghi lên nháp của nhau — `visitId` không đủ vì id Phiên lặp lại
giữa hai địa điểm.

`clearWaiterCartDrafts()` được gọi trên **mọi** đường mất xác thực trong
`state/session.ts`: `logout` thành công, `expire` (phiên bị thu hồi), `bootstrap`
nhận 401 (mở app khi phiên đã chết) và handler CSRF thất bại. Cả bốn để lại cùng
một trạng thái — không `principal`, không `permissions`, không nháp — vì một
phiên không ghi được gì nữa mà màn hình vẫn bật đủ nút là cách để nhân viên gõ
xong cả giỏ rồi mới biết. Lỗi mạng ở `bootstrap` thì KHÔNG dọn nháp: mạng quán
rớt một nhịp không phải lý do để nhân viên gõ lại mười món. File storage cố ý không biết hình dạng của giỏ,
nên `state/` gọi được nó mà không phải import một module của feature. Nháp đọc
vào được kiểm lại từng trường (`parseCart`): nó là dữ liệu người dùng sửa được.

### Chế độ mock không giả lập gửi đơn

`waiter-order-api.ts` trả `501 ORDER_REQUIRES_HTTP` khi không có `httpClient` —
giống `waiter-menu-api.ts` của Module 2. Bản prototype không có máy chủ và không
có danh mục món, nên một đơn “đã gửi” ở đó là một đơn không tồn tại ở Bar.
`waiter-order-api.test.ts` canh rằng không ai thêm một đường giả thành công vào
sau.

## 8. Kiểm tra bằng tay (layout)

Dự án chưa có jsdom / testing-library, nên test tự động phủ phần logic
(`waiter-access.test.ts`, `cart-model.test.ts`, `waiter-cart-storage.test.ts`)
và phần HTML đã render bằng `react-dom/server` (`waiter-ui.test.ts`,
`menu-components.test.tsx`). Hình học sơ đồ ở các viewport bắt buộc được kiểm
bằng số, giống cách `web/src/app/app.test.ts` làm.

Luồng giỏ gọi món được kiểm bằng E2E thật trên bốn viewport bắt buộc:

```bash
cd web && pnpm e2e:waiter-menu && pnpm e2e:waiter-order
```

`e2e/waiter-order.mjs` chạy ở 360×800, 390×844, 768×1024, 1280×800 và kiểm:
chọn biến thể + số lượng + ghi chú; cùng biến thể hai ghi chú khác nhau thành
hai dòng, cùng ghi chú thì gộp; giá đổi hỏi lại bằng số cụ thể và xác nhận giá
KHÔNG tự gửi đơn; lỗi giữ nguyên giỏ; bấm thêm trong lúc đang gửi không thành
đơn thứ hai; payload chỉ mang bảy trường; nháp nằm đúng khóa phân vùng và chỉ bị
dọn sau khi gửi thành công; không tràn ngang.

Phần nhìn vẫn phải tự kiểm ở 360×800, 390×844, 768×1024 và 1280×800:

- cả sơ đồ nằm trong khung, không có thanh cuộn ngang;
- bottom sheet (điện thoại) không che header; trên màn ≥ 768px panel mở dạng
  drawer bên phải;
- không có mục navigation nào của Lễ tân, không có lịch chọn ngày, không có
  timeline, không có Bàn chờ, không có nút tạo booking hay mở Walk-in;
- thanh giỏ dính đáy không che dòng món cuối, và không hiện khi giỏ trống;
- không có tên hay số điện thoại khách ở bất kỳ đâu.

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test
```

## 9. Module 5 — "Đơn của bàn", sửa số lượng và xin hủy

Code: `web/src/features/waiter-menu/order-board*.tsx`, `web/src/features/orders/`.
Backend: `docs/api.md` → "Waiter order tracking and adjustment (Module 5)".

### Trạng thái món đọc theo phiếu, không đoán

`line.preparationStatus` là trạng thái PHIẾU của quầy mang dòng đó. Module 4
nhận việc theo phiếu (một phiếu cho mỗi quầy của một đơn), không theo từng dòng,
nên đó là mức chi tiết thật sự có. Màn hình không tự suy ra gì từ giờ máy khách:
`lineCapability` (`order-board-model.ts`, hàm thuần có test) nhận trạng thái đã
chiếu và trả về đúng bộ nút, nên hai thiết bị cùng mở một bàn thấy giống nhau.

| Trạng thái phiếu | Sửa số lượng | Xin hủy |
| --- | --- | --- |
| `SUBMITTED` | **có** | có |
| `ACCEPTED`, `PREPARING` | không | có |
| `READY`, `COLLECTED` | không | có, nhưng là **ghi hao** |
| đang chờ phê duyệt | không | không |
| đã hủy hết | không | không |

Mỗi lần khóa đều kèm một câu nói lý do. Một cái nút biến mất không giải thích là
cách để nhân viên bấm lại ba lần rồi gọi điện cho quản lý.

### Sửa số lượng gửi kèm `expectedLineVersion`

Stepper chỉ hiện khi `canAdjustQuantity` và người dùng có `order.line.adjust`.
Mỗi lần bấm gửi `expectedLineVersion` mà màn hình đang nhìn thấy; máy chủ từ
chối nếu một máy khác vừa sửa dòng đó (`ORDER_LINE_VERSION_CONFLICT`). Lỗi nào
cũng tải lại đơn, vì con số đúng lúc đó nằm ở máy chủ chứ không ở màn hình.

### Phục vụ KHÔNG tự hủy món

Nút là "Xin hủy món", không phải "Hủy". Nó mở một hộp buộc nhập lý do — người
duyệt chỉ có câu đó để quyết định, và nhật ký sau một tháng cũng chỉ còn nó. Với
món đã làm xong, hộp đổi tên thành "Xin ghi hao", nói thẳng rằng duyệt nghĩa là
bỏ phần đã pha, và buộc một lần tick riêng. Cả hai điều kiện đó máy chủ kiểm
lại, cộng thêm quyền `order.cancel.ready`.

### Màn phê duyệt nằm ngoài khu vực Phục vụ

`/duyet-huy-mon` là route riêng ở gốc, cùng lý do như `/chebien`: người mở nó là
người có `order.cancel.approve`, và Phục vụ không có quyền đó. Trang tự nói một
câu rõ ràng cho người vào sai chỗ, nhưng cửa thật là máy chủ — mọi endpoint ở đó
canh theo permission, nên gõ thẳng URL không mở được gì.

Mỗi thẻ nói đủ: bàn, đơn, dòng, số phần, số tiền, lý do, người xin, và trạng thái
món LÚC XIN HỦY. Thiếu cái cuối thì người duyệt đọc một yêu cầu "hủy một ly" mà
không biết ly đó đã pha chưa.

### Badge thông báo món đã xong

`WaiterNotificationsButton` đọc `GET /preparation/ready-notifications` của Module
4, vốn đã lọc theo audience ở máy chủ (`ORDERED_BY_USER`), nên mọi dòng tới đây
là phiếu của chính người đang đăng nhập. Badge chỉ đếm thông báo CHƯA xác nhận
(`readyBadgeCount`): một badge không bao giờ về 0 là một badge không ai còn nhìn.
Bấm vào mở đúng Phiên của thông báo mới nhất.

### Mock vẫn từ chối

`waiter-order-api.ts` trả `501 ORDER_REQUIRES_HTTP` cho cả năm lệnh mới khi
không có `httpClient`. Một "đã hủy" trong bản demo là một món vẫn đang được làm ở
Bar, và một "đã duyệt" là một quyết định không ai chịu trách nhiệm.

### Kiểm thử

```bash
cd web && pnpm test && pnpm e2e:waiter-order-board
```

`e2e/waiter-order-board.mjs` chạy ở 360×800, 390×844, 768×1024, 1280×800 và
kiểm: badge trạng thái từng dòng; stepper chỉ có ở dòng quầy chưa nhận; món đã
xong đổi nút thành "Xin ghi hao"; payload sửa số lượng mang
`expectedLineVersion` và mã chống trùng; hộp xin hủy khóa nút gửi khi chưa có lý
do; màn phê duyệt nói rõ khi thiếu quyền và gửi `expectedVersion` khi duyệt;
không tràn ngang.

# Frontend — Trang Quản trị (Admin Portal)

> Cập nhật: 16/11/2026 · Phạm vi: TU-39 (khung Admin)
> Code: `web/src/features/admin/`

Tài liệu này dành cho người phát triển một **màn hình con** của Trang Quản trị
(NA-33 Tổng quan ca, NA-34 Sổ lượt, TU-34 Tài khoản, TU-35 Nhật ký…). Mục tiêu:
viết trang của mình trong một file riêng, ghép vào khung bằng một dòng, và
không phải chạm vào sidebar, header hay router.

---

## 1. Khung đã có sẵn những gì

```text
/admin                      → AdminGuard (chỉ OWNER / ADMIN ở cổng admin)
  └─ AdminShell             → sidebar 232px + header 75px + <Outlet/>
       └─ AdminPageGuard    → kiểm permission đọc của từng trang
            └─ trang của bạn
```

| File                   | Việc của nó                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `admin-pages.ts`       | **Registry**: 8 mục sidebar, đường dẫn, tiêu đề, permission. Dữ liệu thuần, không React. |
| `admin-routes.tsx`     | Sinh route từ registry và **map path → component** của bạn.                              |
| `admin-shell.tsx`      | Layout, sidebar, header, drawer cho tablet, context tiêu đề.                             |
| `admin-guard.tsx`      | Cửa `/admin` và cửa từng trang.                                                          |
| `admin-access.ts`      | Luật quyền dạng hàm thuần (test được, không phụ thuộc React).                            |
| `use-admin-session.ts` | Lấy quyền + danh tính từ phiên đăng nhập hiện có.                                        |
| `admin-date.ts`        | Ngày kinh doanh cho header.                                                              |
| `admin-theme.css`      | Token màu / chữ theo Figma, phạm vi `.admin-portal`.                                     |

Khung **không** động vào giao diện Lễ tân: `app/shell.tsx` và `app/nav.ts` giữ
nguyên, 8 mục Admin không nằm trong nav của Lễ tân.

---

## 2. Tạo một trang mới

Tạo file trong `web/src/features/admin/pages/`. Export **default** để
`lazy()` nạp được.

```tsx
// web/src/features/admin/pages/overview-page.tsx
export default function AdminOverviewPage() {
  return (
    <div className="grid gap-4">
      <section className="adm-card p-5">
        <h2 className="adm-h2">Chỉ số ca</h2>
        <p className="adm-body text-[var(--adm-text-muted)]">
          Luỹ kế trong ca hiện tại.
        </p>
      </section>
    </div>
  );
}
```

Quy ước nội dung:

- Trang chỉ render **phần thân**. Sidebar và header đã có, đừng dựng lại.
- Vùng nội dung đã có `padding` và vùng cuộn riêng; không tự đặt `h-dvh` hay
  `overflow` ở gốc trang, sẽ sinh hai thanh cuộn lồng nhau.
- Dùng class và biến của Admin để khỏi lệch Figma:
  `adm-h1 adm-h2 adm-h3 adm-body adm-label adm-card`,
  `var(--adm-canvas|surface|border|text|text-muted|action|tint-blue|tint-amber|tint-red)`,
  trạng thái bàn: `var(--adm-state-booked|soon|late|inuse|empty)`.

---

## 3. Đăng ký route vào Admin Shell

Mở `admin-routes.tsx`, thêm **một dòng** vào `ADMIN_PAGE_COMPONENTS` với khoá
là `path` trong registry:

```tsx
const ADMIN_PAGE_COMPONENTS: Partial<Record<string, ComponentType>> = {
  overview: lazy(() => import("./pages/overview-page")), // NA-33
  visits: lazy(() => import("./pages/visits-page")), // NA-34
};
```

Xong. Mục sidebar tự trỏ tới trang thật thay vì placeholder.

Cần **route con** (ví dụ `/admin/visits/L-1044`)? Không phải khai báo ở tầng
này: mỗi trang đã được mount dưới dạng `path: "visits/*"`, nên bạn tự đặt
`<Routes>` bên trong trang của mình. Sidebar vẫn sáng đúng mục và header vẫn
giữ đúng tiêu đề nhờ `adminPageForPath` khớp cả URL con.

Thêm một **mục sidebar mới** (hiếm — 8 mục là chốt theo Figma): thêm một phần
tử vào `ADMIN_PAGES` đúng vị trí mong muốn, rồi làm bước trên. Test
`admin-shell.test.ts` chốt số lượng và thứ tự, nên sửa registry là phải sửa
test — đó là chủ ý.

---

## 4. Tiêu đề header

Mặc định header lấy `title` trong registry. Trang không cần làm gì.

Muốn đổi theo ngữ cảnh (đang mở hồ sơ một khách, một tài khoản…):

```tsx
import { useAdminPageTitle } from "../admin-shell";

export default function AdminAccountsPage() {
  const account = useAccount(id);
  useAdminPageTitle(account ? `Tài khoản · ${account.displayName}` : null);
  // null = dùng lại tiêu đề mặc định
}
```

Tiêu đề tự trả về mặc định khi rời trang. `Ca 17:00 → 05:00` và ngày kinh
doanh do header tự lo — **đừng tự tính ngày**: dùng `businessDateOf` của
`@/lib/time` nếu trong thân trang cũng cần ngày, vì ngày kinh doanh đổi lúc
05:00 chứ không phải 00:00.

---

## 5. Khai báo permission

Permission đọc của trang nằm trong registry, không nằm trong component:

```ts
{
  path: "audit",
  label: "Nhật ký",
  title: "Nhật ký thao tác",
  permission: "audit.read",   // phải là Permission có thật trong domain/access.ts
  status: "pending",
  owner: "TU-35",
}
```

Khung tự làm hai việc: ẩn mục khỏi sidebar, và chặn khi người dùng gõ thẳng
URL (hiện "Không đủ quyền xem trang này", không phải màn trắng).

Trong thân trang, kiểm quyền cho từng nút bằng phiên hiện có:

```tsx
const { can, readOnly } = useAdminSession()

<button disabled={readOnly || !can("user.manage")}>Đổi quyền</button>
```

Ba điều cần nhớ:

1. **Không tự thêm permission mới.** Danh sách là `Permission` trong
   `web/src/domain/access.ts`, và backend mới là nơi thực thi. Ẩn nút chỉ để
   đỡ bấm nhầm.
2. **ADMIN READ_ONLY** xem được mọi trang có quyền đọc nhưng không được gọi
   mutation. Dùng `readOnly` để `disabled` nút, và vẫn phải chịu được lỗi 403
   từ API.
3. Trang chưa có permission đọc riêng thì để trống `permission` — trang đó chỉ
   cần qua cửa `/admin`.

---

## 6. Tích hợp NA-33 và NA-34

Hai mục đã có sẵn chỗ trong registry:

| Màn                            | `path`     | Tiêu đề header         | Permission đọc                     | Khoá trong `ADMIN_PAGE_COMPONENTS` |
| ------------------------------ | ---------- | ---------------------- | ---------------------------------- | ---------------------------------- |
| 01 Tổng quan ca (NA-33)        | `overview` | Tổng quan              | _(chưa có — chỉ cần vào `/admin`)_ | `overview`                         |
| 08 Sổ lượt tới quán (NA-34)    | `visits`   | Sổ lượt tới quán       | `customer.view_masked`             | `visits`                           |
| 02 Tài khoản (TU-34 — đã ghép) | `accounts` | Tài khoản & phân quyền | `user.read`                        | `accounts`                         |
| 03 Nhật ký (TU-35 — đã ghép)   | `audit`    | Nhật ký thao tác       | `audit.read`                       | `audit`                            |

Các bước cho Nam:

1. `git pull` nhánh có TU-39.
2. Tạo `web/src/features/admin/pages/overview-page.tsx` (hoặc `visits-page.tsx`),
   export default một component **không** chứa sidebar/header.
3. Thêm một dòng vào `ADMIN_PAGE_COMPONENTS`.
4. Mở `/admin/overview`, kiểm bằng tài khoản OWNER và tài khoản ADMIN READ_ONLY.
5. Không sửa `admin-shell.tsx`, `admin-guard.tsx`, `admin-routes.tsx` (ngoài
   một dòng ở bước 3) và `app/app.tsx`. Cần đổi khung thì nói trước, vì mọi
   màn con dùng chung nó.

Dữ liệu lấy qua `GamApi` (`web/src/services/contracts.ts`) như mọi màn khác.
**Không** đổ số liệu mẫu của Figma vào backend hay vào mock để màn trông như
đã xong: số trong prototype là số minh hoạ.

---

## 6b. Màn Tài khoản & phân quyền (TU-34) — tham khảo khi làm màn mới

Màn đầu tiên ghép vào khung này là `pages/accounts-page.tsx`. Nó là ví dụ sống cho ba việc mọi màn admin đều phải làm:

1. **Dữ liệu qua `api` (GamApi), không fetch thẳng.** Ở đây là `api.listAccounts()`, `api.getAccountPermissions(id)`,
   `api.updateAccountPermissions(id, version, { [code]: boolean })`.
2. **Bốn trạng thái, không màn trắng:** `isPending` → dòng "Đang tải…", `isError` → hộp đỏ kèm nút "Thử lại", danh
   sách rỗng → câu giải thích khác nhau cho "rỗng vì bộ lọc" và "rỗng thật", và trạng thái đang lưu làm mờ nút.
3. **Quyền:** `useAdminSession().can(...)` cho permission, `readOnly` cho Admin Read-Only, và `canActOn()` trong
   `accounts-model.ts` cho luật "ai sửa được ai". Tất cả chỉ để làm mờ nút — server vẫn từ chối nếu bấm được.

Bảy checkbox của prototype ánh xạ sang permission thật trong `permission-groups.ts`. Một dòng chữ có thể ứng với nhiều
mã (sửa và hủy booking là hai permission), và nhóm "Duyệt giảm giá, hủy món" chưa có mã nào nên hiện ở trạng thái
"chưa hỗ trợ". Khi module gọi món có permission thật, chỉ cần điền `codes` cho nhóm đó.

Mật khẩu tạm: tạo tài khoản và đặt lại mật khẩu đều để server sinh chuỗi, hiện đúng một lần. Tài khoản đó đăng nhập
được nhưng mọi API nghiệp vụ trả 403 cho tới khi đổi mật khẩu; `AuthBoundary` chặn trước bằng `PasswordChangeGate`.

## 6c. Màn Nhật ký thao tác (TU-35)

`pages/audit-page.tsx` đọc ba endpoint: `getAuditFilters()` (nhóm lọc + số ngày lưu + quyền xuất),
`listAuditEntries(query)` và `exportAuditCsv(query)`. Vài điểm đáng chép lại khi làm màn khác:

- **Nhóm lọc do server quyết định.** Web không tự biết nhóm nào đã có thao tác thật; `supported: false` làm mờ ô lọc
  kèm lời giải thích. Đừng viết cứng danh sách nhóm ở web.
- **Quyền xuất file cũng do server trả về** (`canExport`), đọc từ cấu hình quán. Web chỉ làm mờ nút; server vẫn trả
  403 `AUDIT_EXPORT_DENIED` nếu gọi thẳng.
- **Tải file** bằng cách lấy chuỗi CSV qua `api` rồi tạo Blob, không mở URL trong tab mới — như vậy request vẫn đi
  kèm cookie phiên và lỗi quyền hiện ra như mọi lỗi khác.
- **Giờ hiển thị là giờ quán**, qua `fmtAuditTime` trong `audit-format.ts`; đừng dùng `toLocaleString` của máy.

## 7. Kiểm tra bằng tay (layout)

Dự án chưa có jsdom / testing-library, nên test tự động chỉ phủ phần logic
(registry, quyền, ngày kinh doanh). Phần nhìn phải tự kiểm:

- 1440px: sidebar cố định, nội dung cuộn riêng, không có thanh cuộn ngang.
- 1024px và 768px: sidebar thu về nút ☰, mở ra dạng drawer, đóng bằng `Esc`
  hoặc bấm ra ngoài; không nút thao tác nào bị che.
- < 768px: chưa tối ưu trong TU-39, nhưng phải không vỡ và không crash.

Lệnh:

```bash
cd web && pnpm typecheck && pnpm lint && pnpm test
```

---

## 8. Điểm còn thiếu, cần chốt với PO

1. **Tổng quan ca chưa có permission đọc riêng.** `report.read` là báo cáo
   kinh doanh, không phải tình trạng bàn. Hiện trang chỉ chặn ở cửa `/admin`.
2. **Cấu hình chỉ OWNER thấy** vì `venue.configure` trong ma trận RBAC chỉ cấp
   cho OWNER, trong khi Figma vẽ mục này cho cả Admin. Đây là lệch giữa thiết
   kế và RBAC, không phải lỗi khung — cần quyết định ở phía quyền.
3. **Sổ lượt** đang mượn `customer.view_masked` vì chưa có permission đọc lượt.
4. **Báo cáo và Đối soát** dùng chung `report.read`; riêng Đối soát còn thiếu
   toàn bộ dữ liệu tiền (chưa có bảng order/bill/payment trong database).

---

## 9. Chuyển động (animation) trong khung Admin

Quy ước gọn, để các màn mới không ai tự đặt số đo riêng.

**Token** — khai trong `admin-theme.css`, dùng bằng `var()`, không gõ số đo
vào component:

| Token | Giá trị | Dùng cho |
| --- | --- | --- |
| `--adm-dur-fast` | 120ms | hover, đổi nền, đổi màu chữ |
| `--adm-dur-base` | 200ms | mở drawer, mở hộp thoại, panel vào |
| `--adm-dur-exit` | 150ms | đóng — luôn nhanh hơn mở |
| `--adm-ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | mọi chuyển động **vào** |
| `--adm-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | mọi chuyển động **ra** |

Thời lượng phải khớp `ADMIN_MOTION_MS` trong `admin-motion.ts`, vì JS dựa vào
con số đó để biết khi nào gỡ drawer khỏi DOM. Sửa một chỗ thì sửa cả hai.

**Ba luật**

1. **Không dùng `linear`.** Chuyển động tốc độ đều là thứ làm giao diện trông
   như máy móc. Vào thì ease-out, ra thì ease-in. Ngoại lệ duy nhất là mờ
   dần độ trong suốt (overlay) — mắt không cảm nhận gia tốc của opacity.
2. **Không dùng `transition: all`.** Nó bắt luôn `outline` của
   `:focus-visible`, làm viền focus bò ra chậm một nhịp đúng lúc người dùng
   bàn phím cần thấy ngay. Liệt kê rõ thuộc tính cần chuyển.
3. **Phần tử mount/unmount theo điều kiện thì không dùng `transition`.** Vừa
   mount là trình duyệt vẽ luôn trạng thái cuối, transition không chạy; và
   unmount ngay thì không có gì để chạy animation ra. Dùng `@keyframes` theo
   `data-state="open|closed"`, giữ phần tử lại trong DOM suốt lúc đóng
   (pha `closing` trong `admin-motion.ts`), rồi mới gỡ.

**Ngưỡng theo nghiệp vụ** — khác nhau giữa hai cổng:

- **Admin** là việc đọc số và tra cứu, mỗi lần vài giây. 200ms cho panel là
  thoải mái.
- **Lễ tân** thao tác liên tục suốt ca, cùng một nút bấm hàng trăm lần mỗi
  tối. Thứ gì nằm trên đường thao tác lặp lại đó phải ≤ 150ms hoặc bỏ hẳn
  animation. Sơ đồ bàn (`floor-canvas.tsx`) có cơ chế riêng và đã tự đọc
  `prefers-reduced-motion` — **không thêm animation vào đó** mà không hỏi
  trước.

**`prefers-reduced-motion`** đã tắt chung mọi animation/transition ở
`index.css`, nên CSS mới không cần khai lại. Nhưng chỗ nào dùng timer JS để
hẹn unmount thì phải tự đọc thiết lập đó (`prefersReducedMotion()`), nếu
không panel sẽ đứng chết trên màn hình đúng số ms đó rồi mới biến mất.

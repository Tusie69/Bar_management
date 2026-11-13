# Triển khai 21GAM lên VPS Ubuntu

Tài liệu này đủ để dựng lại toàn bộ hệ thống từ một VPS trắng. Mọi lệnh chạy
trên Ubuntu 22.04 hoặc 24.04.

Kiến trúc: **một VPS, một origin.** Nginx phục vụ bundle React tĩnh và đồng
thời proxy `/api/` sang Express trên `127.0.0.1:3000`. Vì web và API cùng tên
miền nên cookie phiên chạy với `SameSite=lax` và không cần CORS cross-site —
đây là lý do không tách API sang subdomain riêng.

```
điện thoại ──HTTPS──> nginx :443 ─┬─ /            → /srv/21gam/web/dist (tĩnh)
                                  ├─ /api/        → 127.0.0.1:3000 (Express)
                                  └─ /api/v1/tables/stream → idem, KHÔNG buffer (SSE)
                                                    Express ──> MySQL 127.0.0.1:3306
```

## 0. Thông tin cần có trước khi bắt đầu

| Mục | Ghi chú |
| --- | --- |
| Tên miền | Đã trỏ bản ghi A về IPv4 của VPS, đã kịp lan truyền |
| IPv4 VPS | Phải mở được cổng 80 và 443 từ Internet |
| SSH | User có `sudo`, cổng SSH, khóa hoặc mật khẩu |
| Mật khẩu MySQL | Tự sinh mới, không dùng lại mật khẩu dev |

Certbot chỉ cấp chứng chỉ khi tên miền đã trỏ đúng về VPS **và** cổng 80 mở.
Kiểm tra trước, đừng chạy certbot rồi mới sửa DNS — Let's Encrypt giới hạn số
lần thất bại.

```bash
dig +short APP_DOMAIN          # phải ra đúng IPv4 của VPS
```

## 1. Chuẩn bị máy

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx mysql-server git curl ufw
```

Node 24 (`.nvmrc` ghi `24`, và `package.json` yêu cầu `>=24 <25`) cùng pnpm
đúng phiên bản trong `packageManager`:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable && sudo corepack prepare pnpm@11.25.0 --activate
```

User riêng cho ứng dụng. Home tách khỏi thư mục mã nguồn, vì `/srv/21gam` là
gốc repo và dotfiles của user không nên nằm lẫn trong cây git:

```bash
sudo useradd --system --create-home --home-dir /home/gam21 --shell /bin/bash gam21
sudo mkdir -p /srv/21gam && sudo chown gam21:gam21 /srv/21gam
```

## 2. Tường lửa

Chỉ mở đúng thứ cần. Mở SSH **trước** khi bật ufw, nếu không bạn tự khoá mình
ra ngoài.

```bash
sudo ufw allow OpenSSH            # hoặc: sudo ufw allow <cổng-ssh>/tcp
sudo ufw allow 'Nginx Full'       # 80 và 443
sudo ufw --force enable
sudo ufw status verbose
```

MySQL **không** được mở ra ngoài. Mặc định Ubuntu đã bind `127.0.0.1`; xác nhận:

```bash
sudo ss -ltnp | grep 3306         # chỉ được thấy 127.0.0.1:3306
```

Nếu thấy `0.0.0.0:3306`, sửa `bind-address = 127.0.0.1` trong
`/etc/mysql/mysql.conf.d/mysqld.cnf` rồi `sudo systemctl restart mysql`.

Siết SSH theo nguồn nếu bạn có IP tĩnh:

```bash
sudo ufw delete allow OpenSSH
sudo ufw allow from <IP-cua-ban> to any port 22 proto tcp
```

## 3. Database

```bash
sudo mysql
```

```sql
CREATE DATABASE gam21_platform
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
-- Tự sinh một chuỗi ngẫu nhiên dài (ví dụ `openssl rand -base64 24`) và điền vào đây.
CREATE USER 'gam21'@'127.0.0.1' IDENTIFIED BY '...';
GRANT ALL PRIVILEGES ON gam21_platform.* TO 'gam21'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Múi giờ và SQL mode phải khớp môi trường dev, nếu không logic ngày kinh doanh
và `ONLY_FULL_GROUP_BY` sẽ lệch. Tạo `/etc/mysql/mysql.conf.d/21gam.cnf`:

```ini
[mysqld]
default-time-zone = '+07:00'
character-set-server = utf8mb4
collation-server = utf8mb4_0900_ai_ci
sql-mode = ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
transaction-isolation = REPEATABLE-READ
binlog-format = ROW
innodb-print-all-deadlocks = ON
```

```bash
sudo systemctl restart mysql
```

Dữ liệu nằm ở `/var/lib/mysql`, là ổ đĩa thật của VPS, nên **restart máy không
mất dữ liệu**. Không chạy MySQL trong container không có volume.

## 4. Mã nguồn và build

```bash
sudo -u gam21 git clone --branch develop https://github.com/Tusie69/Bar_management.git /srv/21gam
cd /srv/21gam && sudo -u gam21 pnpm install --frozen-lockfile
```

`/srv/21gam` phải **rỗng** khi clone. Mọi lệnh `sudo -u gam21` chạy Node hay
pnpm đều cần `env HOME=/home/gam21` nếu shell gọi từ root, nếu không corepack
ghi cache vào `/root`.

### API

```bash
cd /srv/21gam/api
sudo -u gam21 cp ../deploy/env/api.env.production.example .env
sudo -u gam21 chmod 600 .env
sudo -u gam21 nano .env          # điền WEB_ORIGIN, DB_PASSWORD
sudo -u gam21 node scripts/init-local-secrets.mjs --env-file .env
sudo -u gam21 pnpm build
```

`init-local-secrets.mjs` tự sinh `SESSION_CSRF_SECRET` và bộ khóa điện thoại
ngay trên VPS, và không ghi đè giá trị đã có. Sinh khóa tại chỗ thay vì mang từ
máy cá nhân lên: khóa không bao giờ đi qua chat, email hay Git.

API tự từ chối khởi động nếu `NODE_ENV=production` mà `SESSION_CSRF_SECRET`
ngắn hơn 32 ký tự hoặc `SESSION_COOKIE_SECURE` không phải `true`.

### Migration

**Chạy migration lần đầu trên database rỗng thì không cần backup.** Từ lần thứ
hai trở đi, database đã có booking thật, nên:

```bash
sudo -u gam21 /srv/21gam/deploy/scripts/backup-mysql.sh   # BẮT BUỘC trước khi migrate
cd /srv/21gam/api && sudo -u gam21 pnpm db:migrate
```

Migration trong dự án này chỉ thêm bảng và cột, không có `DOWN`. Phương án
rollback là phục hồi bản sao lưu vừa chụp (mục 8), nên đừng bỏ bước backup.

### Dữ liệu nền

Migration chỉ tạo schema và 4 role. Ứng dụng còn cần organization, venue,
cấu hình venue và danh sách nguồn đặt bàn. **Không dùng `pnpm db:seed`**:
`database/seeds/demo.sql` trộn lẫn dữ liệu nền với khách, booking, visit và
waitlist giả — chạy nó là đưa dữ liệu demo lên production.

```bash
sudo -u gam21 mysql --defaults-file=/home/gam21/.my.cnf --default-character-set=utf8mb4 gam21_platform <<'SQL'
INSERT INTO organizations (id, code, name) VALUES (1, "GAM21", "21GAM")
  ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO venues (id, organization_id, code, name) VALUES (1, 1, "21GAM", "21GAM")
  ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO venue_settings (organization_id, venue_id, `key`, `value`) VALUES
  (1, 1, "quick_times", JSON_ARRAY("21:00","21:30","22:00","22:30"))
  ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
INSERT INTO booking_sources (id,organization_id,code,name,sort_order) VALUES
  (1,1,"HOTLINE","Hotline",0), (2,1,"FANPAGE","Fanpage",1), (3,1,"ZALO","Zalo",2),
  (4,1,"SHAREHOLDER","Cổ đông",3), (5,1,"STAFF","Nhân viên",4), (6,1,"SOCIAL","Social",5),
  (7,1,"OTHER","Khác",6)
  ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order);
SQL
```

Bảy mã nguồn trên là tập cố định mà frontend (`web/src/domain/enums.ts`) biết;
thêm mã lạ thì giao diện không hiển thị được.

Còn lại là **sơ đồ sàn thật của quán**: `zones` và `dining_tables` (mã bàn, sức
chứa, toạ độ `pos_x`/`pos_y`). Đây là dữ liệu riêng của từng quán, không có giá
trị mặc định đúng. `demo.sql` có sẵn một bộ zone (A, B, C, Quầy Bar) và danh
sách bàn kèm toạ độ — nếu đó đúng là sơ đồ quán bạn thì trích riêng hai lệnh
`INSERT INTO zones` và `INSERT INTO dining_tables` của `organization_id = 1`,
bỏ mọi lệnh khác trong file.

### Tài khoản quản trị đầu tiên

```bash
cd /srv/21gam/api && sudo -u gam21 env HOME=/home/gam21 pnpm auth:bootstrap   --username <ten-dang-nhap> --display-name "<Ten hien thi>"   --organization-id 1 --venue-id 1 --role OWNER_ADMIN
```

Lệnh này **bắt buộc chạy trong terminal tương tác**: nó hỏi một chuỗi xác nhận
rồi yêu cầu nhập mật khẩu hai lần, ẩn trên màn hình. Thiết kế như vậy để mật
khẩu không bao giờ nằm trong `argv`, trong lịch sử shell hay trong log. Nghĩa
là không chạy được qua script hay qua SSH không tương tác.

### Web

```bash
cd /srv/21gam/web
sudo -u gam21 cp ../deploy/env/web.env.production.example .env.production
sudo -u gam21 nano .env.production     # đổi APP_DOMAIN
sudo -u gam21 pnpm build
```

Bundle ra `/srv/21gam/web/dist`, đúng `root` mà nginx trỏ tới.

### Khóa số điện thoại

Bốn biến `PHONE_*` trong `api/.env.production` để trống thì **lưu số điện thoại
và gọi khách đều hỏng**, trả 503 `PHONE_KEYS_UNAVAILABLE` hoặc
`PHONE_REVEAL_POLICY_UNAVAILABLE`. Sinh khóa ngay trên VPS:

```bash
cd /srv/21gam/api
node -e "const{randomBytes}=require('crypto');console.log('PHONE_ENCRYPTION_KEYS=1:'+randomBytes(32).toString('base64'));console.log('PHONE_HMAC_KEYS=1:'+randomBytes(32).toString('base64'))"
```

Dán hai dòng in ra vào `.env.production`, đặt cả hai id hoạt động bằng `1`:

```
PHONE_ACTIVE_ENCRYPTION_KEY_ID=1
PHONE_ACTIVE_HMAC_KEY_ID=1
PHONE_REVEAL_RATE_LIMIT_MAX=10
PHONE_REVEAL_RATE_LIMIT_WINDOW_MS=600000
```

Khóa mã hóa **không được đổi hay mất**: mất là không mở lại được số nào đã lưu.
Sao lưu database không chứa khóa, nên khóa phải được cất riêng cùng chỗ với
`SESSION_SECRET`.

Hạn mức là 10 lần trong 10 phút cho mỗi cặp (người dùng, booking), đếm chung cho
cả xem số lẫn gọi khách. Bộ đếm nằm trong RAM của tiến trình API nên mỗi lần
khởi động lại - kể cả lần tự triển khai hằng đêm - là về 0.

### Số điện thoại đi tới máy lễ tân: quyết định đã biết

Lễ tân có quyền `booking.phone.call` nhưng **không** có `booking.phone.reveal`,
nên giao diện không bao giờ hiện số. Tuy vậy `POST /bookings/:id/call` trả về
`telUri` dạng `tel:+84...` trong thân phản hồi, vì trình duyệt phải cầm số mới
mở được trình gọi điện của máy. Mở tab Network của trình duyệt là đọc được.

Đây là **đánh đổi có chủ ý**, không phải lỗi: muốn kín hẳn thì phải có tổng đài
hoặc dịch vụ click-to-call đứng giữa, lúc đó máy chủ quay số và máy lễ tân chỉ
nhận cuộc gọi, không bao giờ thấy số khách. Chừng nào chưa có, mọi lần bấm gọi
đều được ghi lại trong `booking_call_logs` và `operation_log`
(`BOOKING_CALL_INITIATED`) kèm người bấm, nên việc lạm dụng truy ra được.

## 5. Dịch vụ API

```bash
sudo cp /srv/21gam/deploy/systemd/21gam-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 21gam-api
sudo systemctl status 21gam-api
```

`Restart=always` nên API tự dậy lại khi crash, và `enable` nên nó tự chạy sau
khi VPS khởi động lại. Xem log: `sudo journalctl -u 21gam-api -f`.

## 6. Nginx và HTTPS

```bash
sudo cp /srv/21gam/deploy/nginx/21gam.conf.example /etc/nginx/sites-available/21gam.conf
sudo sed -i 's/APP_DOMAIN/ten-mien-that/g' /etc/nginx/sites-available/21gam.conf
sudo ln -sf /etc/nginx/sites-available/21gam.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Cấu hình trên tham chiếu đường dẫn chứng chỉ **chưa tồn tại**, nên nạp thẳng
nó lúc này thì `nginx -t` hỏng. Trình tự đúng là dựng một vhost HTTP tạm chỉ để
ACME xác thực, lấy chứng chỉ, rồi mới nạp cấu hình thật:

```bash
sudo apt install -y certbot python3-certbot-nginx

# vhost tam, chi phuc vu /.well-known
sudo tee /etc/nginx/sites-available/21gam.conf >/dev/null <<'CONF'
server {
    listen 80;
    server_name ten-mien-that;
    root /var/www/html;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 404; }
}
CONF
sudo ln -sf /etc/nginx/sites-available/21gam.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/html -d ten-mien-that   --agree-tos --register-unsafely-without-email --non-interactive

# gio moi nap cau hinh that
sudo sed 's/APP_DOMAIN/ten-mien-that/g' /srv/21gam/deploy/nginx/21gam.conf.example   | sudo tee /etc/nginx/sites-available/21gam.conf >/dev/null
sudo nginx -t && sudo systemctl reload nginx
```

`--register-unsafely-without-email` tránh gửi địa chỉ email sang Let's Encrypt
khi chưa cần. Đánh đổi là không nhận được cảnh báo sắp hết hạn; thêm sau bằng
`sudo certbot update_account --email dia-chi@cua-ban`.

Certbot cài sẵn timer tự gia hạn. Kiểm tra:

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

### SSE: chỗ dễ sai nhất

`location = /api/v1/tables/stream` phải giữ nguyên `proxy_buffering off`,
`gzip off` và `proxy_read_timeout 1h`. Thiếu một trong ba thì sàn vẫn hiện
nhưng cập nhật trễ hoặc đứt sau 30 giây. API đã gửi `X-Accel-Buffering: no` và
heartbeat mỗi 20 giây (`REALTIME_HEARTBEAT_MS`), nhưng đừng dựa vào mình nó.

Nếu hạ `REALTIME_HEARTBEAT_MS`, giữ nó **nhỏ hơn** `proxy_read_timeout`.

## 7. Sao lưu tự động

Script sao lưu đọc thông tin đăng nhập từ `~/.my.cnf` của user `gam21` thay vì
nhận mật khẩu trên dòng lệnh, vì tham số dòng lệnh hiện ra trong `ps` cho mọi
user trên máy. Tạo file đó một lần, quyền `600`, nội dung là một mục `[client]`
khai ba khóa: `user` là `gam21`, `password` là mật khẩu MySQL bạn đặt ở mục 3,
`host` là `127.0.0.1`.

```bash
sudo -u gam21 install -m 600 /dev/null /srv/21gam/.my.cnf
sudo -u gam21 nano /srv/21gam/.my.cnf     # tự gõ, đừng dán từ chỗ khác
```

Rồi:

```bash
sudo chmod +x /srv/21gam/deploy/scripts/*.sh
sudo cp /srv/21gam/deploy/systemd/21gam-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 21gam-backup.timer
sudo systemctl start 21gam-backup.service      # chạy thử ngay một lần
ls -lh /srv/21gam/backups
```

Sao lưu lúc 06:00 giờ Việt Nam, sau khi business day worker đã đóng lượt khách
lúc 05:00, nên mỗi bản chụp đúng một ngày kinh doanh đã khép lại. Giữ 14 bản.

Bản sao lưu nằm cùng ổ đĩa với database, nên nó chống được lỗi thao tác chứ
**không** chống được hỏng ổ. Hãy đồng bộ `/srv/21gam/backups` sang nơi khác
(`rclone`, `rsync` sang máy khác) nếu dữ liệu quan trọng.

## 8. Phục hồi

```bash
sudo systemctl stop 21gam-api
sudo -u gam21 /srv/21gam/deploy/scripts/restore-mysql.sh /srv/21gam/backups/gam21_platform-YYYYMMDD-HHMMSS.sql.gz
sudo systemctl start 21gam-api
```

Script tự chụp một bản an toàn của trạng thái hiện tại trước khi ghi đè, từ
chối chạy khi API còn sống, và bắt gõ đúng tên database để xác nhận.

## 9. Tự động triển khai từ `develop`

VPS tự kéo, không phải GitHub đẩy xuống. Nghĩa là không khóa riêng nào rời
khỏi máy chủ, không cần secret trên GitHub, và không phải mở thêm cổng nào.

Các script đã mang sẵn bit thực thi trong Git, nên không cần `chmod`. Nếu
bạn vẫn `chmod +x` một file mà Git lưu là `100644`, Git coi đó là thay đổi
chưa commit và script sẽ từ chối triển khai.

```bash
sudo cp /srv/21gam/deploy/systemd/21gam-deploy.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 21gam-deploy.timer
```

Cổng kiểm thử chạy test tích hợp MySQL nên cần một database test riêng, tạo
một lần:

```bash
sudo mysql -e "CREATE DATABASE IF NOT EXISTS gam21_platform_it_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
sudo mysql -e "GRANT ALL PRIVILEGES ON gam21_platform_it_test.* TO 'gam21'@'127.0.0.1';"
cd /srv/21gam/api && sudo -u gam21 env HOME=/home/gam21   DB_NAME=gam21_platform_it_test NODE_ENV=test pnpm db:migrate
```

### Nó làm gì

Mỗi 2 phút: `git fetch`, nếu `develop` không đổi thì thoát ngay (khoảng 1 giây).
Khi có bản mới:

1. **Cửa sổ giờ.** Từ 17:00 đến 05:00 là giờ mở cửa, script ghi log "đang hoãn"
   rồi thoát. Sáng hôm sau mới đẩy. Đổi bằng `DEPLOY_QUIET_FROM` /
   `DEPLOY_QUIET_UNTIL`, bỏ qua một lần bằng `DEPLOY_FORCE=1`.
2. **Cổng kiểm thử trước khi đụng database**: `typecheck`, `lint`, `build` và
   `test` cho cả api lẫn web. Hỏng ở bước nào thì lùi code về commit cũ,
   build lại, và database chưa hề bị đụng tới.
3. **Sao lưu**, rồi mới `db:migrate`.
4. Khởi động lại API, **health check** trong 30 giây.
5. Health check hỏng thì **chỉ lùi code**, không đụng database.

### Vì sao sắp xếp như vậy

Migration của dự án này chỉ thêm bảng và cột, **không có `DOWN`**. Nên cách
hoàn tác duy nhất ở tầng dữ liệu là phục hồi bản sao lưu — mà làm vậy sẽ xoá
mất những booking lễ tân vừa ghi trong mấy phút đó. Vì thế:

* Test chạy **trước** migration, để phần lớn lỗi bị chặn khi database còn
  nguyên vẹn và hoàn tác chỉ là đổi lại commit.
* Sao lưu chụp **ngay trước** migration chứ không phải đầu quy trình, nên nếu
  migration hỏng giữa chừng thì bản sao lưu chỉ cách đó vài giây.
* Health check hỏng sau migration thì chỉ lùi code: schema mới vẫn tương thích
  ngược với code cũ vì nó chỉ thêm chứ không bỏ.

Nếu migration hỏng, script **dừng hẳn** và không tự phục hồi database — đó là
quyết định của con người, không phải của script. Bản sao lưu vừa chụp nằm
trong `/srv/21gam/backups`, phục hồi theo mục 8.

### Theo dõi

```bash
journalctl -u 21gam-deploy -n 50
```

```bash
sudo systemctl start 21gam-deploy.service
```

```bash
sudo DEPLOY_FORCE=1 /srv/21gam/deploy/scripts/auto-deploy.sh
```

`flock` chặn hai lần chạy chồng nhau, nên gọi tay trong lúc timer đang chạy là
vô hại.

## 10. Cập nhật tay

```bash
cd /srv/21gam
sudo -u gam21 /srv/21gam/deploy/scripts/backup-mysql.sh
sudo -u gam21 git pull --ff-only origin develop
sudo -u gam21 pnpm install --frozen-lockfile
cd api && sudo -u gam21 pnpm build && sudo -u gam21 pnpm db:migrate
cd ../web && sudo -u gam21 pnpm build
sudo systemctl restart 21gam-api
```

Web là file tĩnh nên không cần restart nginx. Trình duyệt đang mở sẽ lấy bundle
mới ở lần tải lại sau, vì `index.html` được gửi kèm `Cache-Control: no-cache`.

## 11. Nghiệm thu sau khi triển khai

| Mã | Kiểm tra | Cách làm |
| --- | --- | --- |
| AC01 | HTTPS hợp lệ | Mở `https://APP_DOMAIN`, xem ổ khoá; `curl -I https://APP_DOMAIN` trả 200 |
| AC02 | Đăng nhập | Vào bằng tài khoản `auth:bootstrap`, rồi bằng một tài khoản lễ tân |
| AC03 | Ba máy đồng bộ | Ba điện thoại mở Layout; đổi bàn trên máy 1, hai máy kia đổi theo dưới 2 giây |
| AC04 | Bền dữ liệu | `sudo reboot`; sau khi máy lên, Booking/Visit/cụm bàn/lượt khách còn nguyên |
| AC05 | MySQL kín | `nmap -p 3306 APP_DOMAIN` từ máy ngoài: `filtered` hoặc `closed` |
| AC06 | SSE nối lại | Bật chế độ máy bay 10 giây rồi tắt; sàn tự cập nhật lại, không cần F5 |
| AC07 | Sao lưu | `ls /srv/21gam/backups` có file; chạy thử mục 8 trên database tạm |
| AC08 | Mobile/tablet | Mở trên điện thoại và máy tính bảng thật |
| AC10 | Chất lượng | `pnpm -r typecheck && pnpm -r lint && pnpm -r build` |

## 12. Khi có sự cố

| Triệu chứng | Nơi nhìn trước |
| --- | --- |
| API không lên | `sudo journalctl -u 21gam-api -n 50` — thường là `.env` thiếu biến |
| 502 Bad Gateway | API chết hoặc sai cổng: `sudo ss -ltnp \| grep 3000` |
| Đăng nhập xong lại văng ra | `WEB_ORIGIN` không khớp đúng origin trình duyệt đang dùng |
| 403 ở mọi thao tác ghi | Cũng là `WEB_ORIGIN`: middleware so sánh header `Origin` |
| Sàn không tự cập nhật | Kiểm tra `location = /api/v1/tables/stream` còn `proxy_buffering off` |
| Chứng chỉ sắp hết hạn | `sudo certbot renew --dry-run` |

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

Node 22 (khớp `.nvmrc`) và pnpm:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable && sudo corepack prepare pnpm@latest --activate
```

User riêng cho ứng dụng, không đăng nhập được:

```bash
sudo useradd --system --create-home --home-dir /srv/21gam --shell /usr/sbin/nologin gam21
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
CREATE USER 'gam21'@'127.0.0.1' IDENTIFIED BY 'MAT-KHAU-MANH-TU-SINH';
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
sudo mkdir -p /srv/21gam && sudo chown gam21:gam21 /srv/21gam
sudo -u gam21 git clone https://github.com/Tusie69/Bar_management.git /srv/21gam
cd /srv/21gam && sudo -u gam21 git checkout develop
sudo -u gam21 pnpm install --frozen-lockfile
```

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

Tạo tài khoản quản trị đầu tiên:

```bash
cd /srv/21gam/api && sudo -u gam21 pnpm auth:bootstrap
```

> **Không chạy `pnpm db:seed` trên production.** Seed là dữ liệu demo.

### Web

```bash
cd /srv/21gam/web
sudo -u gam21 cp ../deploy/env/web.env.production.example .env.production
sudo -u gam21 nano .env.production     # đổi APP_DOMAIN
sudo -u gam21 pnpm build
```

Bundle ra `/srv/21gam/web/dist`, đúng `root` mà nginx trỏ tới.

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

File cấu hình tham chiếu đường dẫn chứng chỉ chưa tồn tại, nên lần đầu hãy để
certbot tự tạo rồi mới bật block 443 — cách gọn nhất là chạy certbot ngay:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ten-mien-that --agree-tos -m email@cua-ban --redirect
```

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

Tạo `~/.my.cnf` cho user `gam21` (chi tiết trong đầu file `backup-mysql.sh`),
rồi:

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

## 9. Cập nhật phiên bản mới

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

## 10. Nghiệm thu sau khi triển khai

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

## 11. Khi có sự cố

| Triệu chứng | Nơi nhìn trước |
| --- | --- |
| API không lên | `sudo journalctl -u 21gam-api -n 50` — thường là `.env` thiếu biến |
| 502 Bad Gateway | API chết hoặc sai cổng: `sudo ss -ltnp \| grep 3000` |
| Đăng nhập xong lại văng ra | `WEB_ORIGIN` không khớp đúng origin trình duyệt đang dùng |
| 403 ở mọi thao tác ghi | Cũng là `WEB_ORIGIN`: middleware so sánh header `Origin` |
| Sàn không tự cập nhật | Kiểm tra `location = /api/v1/tables/stream` còn `proxy_buffering off` |
| Chứng chỉ sắp hết hạn | `sudo certbot renew --dry-run` |

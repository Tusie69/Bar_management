#!/usr/bin/env bash
# Tự động triển khai nhánh develop lên VPS.
#
# Chạy theo 21gam-deploy.timer (mỗi 2 phút). Không làm gì cả nếu develop không
# đổi, nên gọi thường xuyên là vô hại.
#
#   Chạy tay ngay:        sudo systemctl start 21gam-deploy.service
#   Bỏ qua cửa sổ giờ:    sudo DEPLOY_FORCE=1 /srv/21gam/deploy/scripts/auto-deploy.sh
#   Build lại tại chỗ:    sudo DEPLOY_REBUILD=1 DEPLOY_FORCE=1 .../auto-deploy.sh
#   Xem log:              journalctl -u 21gam-deploy -n 50
#
# DEPLOY_REBUILD dùng khi mã nguồn trên máy đã khớp develop nhưng bản build thì
# chưa — chẳng hạn vừa có ai đó `git pull` bằng tay. Không có nó, script thấy
# commit trùng nhau rồi thoát, và máy cứ phục vụ bundle cũ trong khi `git log`
# nói mọi thứ đã mới.
#
# Thứ tự các bước được chọn để một lần hỏng không làm sập quán:
#   1. Cổng kiểm thử (typecheck, lint, build, test) chạy TRƯỚC migration.
#      Code hỏng thì database chưa bị đụng tới, hoàn tác chỉ là đổi lại commit.
#   2. Sao lưu chạy trước migration, không phải trước git pull: nếu migration
#      hỏng giữa chừng thì bản sao lưu chỉ cách đó vài giây.
#   3. Migration của dự án này chỉ thêm bảng và cột, không có DOWN. Nên khi
#      health check hỏng SAU migration, script chỉ lùi CODE chứ không đụng
#      database: schema mới vẫn tương thích ngược với code cũ, còn khôi phục
#      database sẽ xoá mất những booking vừa ghi trong lúc đó.
set -uo pipefail

REPO=/srv/21gam
APP_USER=gam21
BRANCH="${DEPLOY_BRANCH:-develop}"
SERVICE=21gam-api
HEALTH_URL=http://127.0.0.1:3000/api/v1/health
# Giờ mở cửa: không tự triển khai trong khoảng này, đợi tới sáng.
QUIET_FROM="${DEPLOY_QUIET_FROM:-17}"
QUIET_UNTIL="${DEPLOY_QUIET_UNTIL:-5}"

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "THẤT BẠI: $*"; exit 1; }
as_app() { sudo -u "$APP_USER" env HOME="$(getent passwd "$APP_USER" | cut -d: -f6)" "$@"; }

# Hai lần chạy chồng nhau sẽ build cùng một cây thư mục và phá nhau.
exec 9>/var/lock/21gam-deploy.lock
flock -n 9 || { log "một lần triển khai khác đang chạy, bỏ qua"; exit 0; }

hour=$(date +%-H)
in_quiet_window() {
  if [ "$QUIET_FROM" -gt "$QUIET_UNTIL" ]; then
    [ "$hour" -ge "$QUIET_FROM" ] || [ "$hour" -lt "$QUIET_UNTIL" ]
  else
    [ "$hour" -ge "$QUIET_FROM" ] && [ "$hour" -lt "$QUIET_UNTIL" ]
  fi
}

cd "$REPO" || die "không vào được $REPO"

as_app git fetch -q origin "$BRANCH" || die "git fetch hỏng"
current=$(as_app git rev-parse HEAD)
target=$(as_app git rev-parse "origin/$BRANCH")
if [ "$current" = "$target" ] && [ -z "${DEPLOY_REBUILD:-}" ]; then exit 0; fi

# Có thay đổi thật. Giờ mới xét cửa sổ giờ, để log nói rõ là đang hoãn chứ
# không phải không thấy gì.
if [ -z "${DEPLOY_FORCE:-}" ] && in_quiet_window; then
  log "develop đã có ${target:0:7} nhưng đang trong giờ mở cửa (${QUIET_FROM}:00-${QUIET_UNTIL}:00), hoãn"
  exit 0
fi

if [ -n "$(as_app git status --porcelain)" ]; then
  die "cây làm việc có thay đổi chưa commit, không tự ghi đè"
fi

if [ "$current" = "$target" ]; then
  log "build lại tại chỗ ở ${current:0:7} (DEPLOY_REBUILD)"
else
  log "triển khai ${current:0:7} -> ${target:0:7}"
  as_app git log --oneline "$current..$target" | sed 's/^/    /'
fi

rollback() {
  log "hoàn tác về ${current:0:7}"
  as_app git reset -q --hard "$current"
  as_app pnpm install --frozen-lockfile >/dev/null 2>&1
  (cd "$REPO/api" && as_app pnpm build >/dev/null 2>&1)
  (cd "$REPO/web" && as_app pnpm build >/dev/null 2>&1)
  systemctl restart "$SERVICE"
  log "đã quay lại bản cũ"
}

as_app git merge -q --ff-only "origin/$BRANCH" || die "không fast-forward được, cần xử lý tay"
as_app pnpm install --frozen-lockfile >/dev/null || { rollback; die "pnpm install hỏng"; }

# --- Cổng kiểm thử: chạy trước khi đụng vào database ---
for part in api web; do
  for step in typecheck lint build; do
    if ! (cd "$REPO/$part" && as_app pnpm "$step" >/tmp/21gam-deploy-$part-$step.log 2>&1); then
      log "$part pnpm $step hỏng:"
      tail -15 "/tmp/21gam-deploy-$part-$step.log" | sed 's/^/    /'
      rollback
      die "cổng kiểm thử chặn bản này"
    fi
  done
done
# Chạy cả test tích hợp MySQL, trên database test riêng. dotenv không ghi đè
# biến môi trường đã có, nên các biến truyền ở đây thắng api/.env. Fixture còn
# tự từ chối chạy nếu DB_NAME khác gam21_platform_it_test, nên database thật
# không thể bị truncate kể cả khi script này sai.
#
# Hai biến cuối bắt buộc phải ghi đè, nếu không 110 test rớt với lỗi 401:
#   SESSION_COOKIE_SECURE=true khiến cookie phiên chỉ đi qua HTTPS, mà
#   supertest gọi app qua HTTP thường nên cookie không bao giờ quay lại và mọi
#   request sau đăng nhập đều 401.
#   WEB_ORIGIN của production là https://<tên miền>, trong khi fixture gửi
#   Origin của môi trường dev; middleware so sánh hai giá trị này.
if ! (cd "$REPO/api" && as_app env RUN_MYSQL_INTEGRATION=1 NODE_ENV=test       DB_NAME=gam21_platform_it_test SESSION_COOKIE_SECURE=false       WEB_ORIGIN=http://localhost:5173 pnpm test >/tmp/21gam-deploy-test.log 2>&1); then
  log "api test hỏng:"; tail -20 /tmp/21gam-deploy-test.log | sed 's/^/    /'
  rollback; die "test chặn bản này"
fi
if ! (cd "$REPO/web" && as_app pnpm test >/tmp/21gam-deploy-webtest.log 2>&1); then
  log "web test hỏng:"; tail -20 /tmp/21gam-deploy-webtest.log | sed 's/^/    /'
  rollback; die "test chặn bản này"
fi
log "cổng kiểm thử: đạt"

# --- Từ đây mới đụng tới dữ liệu ---
as_app "$REPO/deploy/scripts/backup-mysql.sh" | sed 's/^/    /' || die "sao lưu hỏng, dừng trước migration"
(cd "$REPO/api" && as_app pnpm db:migrate >/tmp/21gam-deploy-migrate.log 2>&1) || {
  log "migration hỏng:"; tail -15 /tmp/21gam-deploy-migrate.log | sed 's/^/    /'
  die "migration hỏng giữa chừng. Bản sao lưu vừa chụp nằm trong /srv/21gam/backups; phục hồi bằng deploy/scripts/restore-mysql.sh"
}

systemctl restart "$SERVICE"

healthy=0
for _ in $(seq 1 15); do
  sleep 2
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL")" = "200" ]; then
    healthy=1; break
  fi
done
if [ "$healthy" != "1" ]; then
  log "health check không lên sau 30 giây"
  journalctl -u "$SERVICE" -n 15 --no-pager | sed 's/^/    /'
  # Chỉ lùi code. Schema mới tương thích ngược, còn khôi phục database sẽ xoá
  # mất booking vừa ghi.
  rollback
  die "bản mới không chạy được, đã quay lại ${current:0:7}"
fi

log "xong: ${target:0:7} đang chạy, health 200"

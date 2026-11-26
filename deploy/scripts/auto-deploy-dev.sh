#!/usr/bin/env bash
# Tự động triển khai nhánh develop lên BẢN DEV (TU-41).
#
# Bản rút gọn của auto-deploy.sh, viết riêng thay vì thêm tham số vào script
# Production: sửa script đang giữ quán chạy chỉ để phục vụ bản thử nghiệm là
# đổi rủi ro thật lấy tiện lợi. Khác biệt có chủ ý:
#   - KHÔNG hoãn trong giờ mở cửa: Dev phải luôn có code mới nhất để test.
#   - KHÔNG chạy cổng test và KHÔNG sao lưu: database Dev chỉ chứa dữ liệu giả,
#     xoá đi tạo lại được. Bỏ test cũng để build nhẹ, đỡ tranh CPU với Production
#     lúc quán đang mở. Cổng test đầy đủ vẫn chạy ở auto-deploy.sh trước khi
#     cùng commit đó lên Production vào sáng hôm sau.
#   - Vẫn giữ build (tsc nằm trong build) và health check: bản Dev hỏng thì
#     lùi code, để buổi demo không gặp màn hình trắng.
#
#   Chạy tay ngay:     sudo systemctl start 21gam-deploy-dev.service
#   Build lại tại chỗ: sudo DEPLOY_REBUILD=1 /srv/21gam-dev/deploy/scripts/auto-deploy-dev.sh
#   Xem log:           journalctl -u 21gam-deploy-dev -n 50
set -uo pipefail

REPO=/srv/21gam-dev
APP_USER=gam21dev
BRANCH="${DEPLOY_BRANCH:-develop}"
SERVICE=21gam-api-dev
HEALTH_URL=http://127.0.0.1:3001/api/v1/health

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "THẤT BẠI: $*"; exit 1; }
as_app() { sudo -u "$APP_USER" env HOME="$(getent passwd "$APP_USER" | cut -d: -f6)" "$@"; }

# Lock riêng: bản Dev và Production build hai cây thư mục khác nhau, không
# cần chờ nhau. Chung một lock thì bản Dev phải đợi cả cổng test Production.
exec 9>/var/lock/21gam-deploy-dev.lock
if [ -n "${DEPLOY_REBUILD:-}" ]; then
  flock -w 600 9 || { log "chờ 10 phút mà lần triển khai khác vẫn chưa xong, bỏ cuộc"; exit 1; }
else
  flock -n 9 || { log "một lần triển khai Dev khác đang chạy, bỏ qua"; exit 0; }
fi

cd "$REPO" || die "không vào được $REPO"

# Chốt chặn: script này không bao giờ được chạy trên cây Production.
grep -qE '^APP_ENV=dev$' "$REPO/api/.env" || die "$REPO/api/.env không khai APP_ENV=dev, từ chối triển khai"
grep -qE '^DB_NAME=[A-Za-z0-9_]+_dev$' "$REPO/api/.env" || die "DB_NAME trong $REPO/api/.env phải kết thúc bằng _dev"

as_app git fetch -q origin "$BRANCH" || die "git fetch hỏng"
current=$(as_app git rev-parse HEAD)
target=$(as_app git rev-parse "origin/$BRANCH")
if [ "$current" = "$target" ] && [ -z "${DEPLOY_REBUILD:-}" ]; then exit 0; fi

if [ -n "$(as_app git status --porcelain)" ]; then
  die "cây làm việc Dev có thay đổi chưa commit, không tự ghi đè"
fi

if [ "$current" = "$target" ]; then
  log "build lại tại chỗ ở ${current:0:7} (DEPLOY_REBUILD)"
else
  log "triển khai Dev ${current:0:7} -> ${target:0:7}"
  as_app git log --oneline "$current..$target" | sed 's/^/    /'
fi

rollback() {
  log "hoàn tác Dev về ${current:0:7}"
  as_app git reset -q --hard "$current"
  as_app pnpm install --frozen-lockfile >/dev/null 2>&1
  (cd "$REPO/api" && as_app pnpm build >/dev/null 2>&1)
  (cd "$REPO/web" && as_app pnpm build >/dev/null 2>&1)
  systemctl restart "$SERVICE"
  log "Dev đã quay lại bản cũ"
}

as_app git merge -q --ff-only "origin/$BRANCH" || die "không fast-forward được, cần xử lý tay"
as_app pnpm install --frozen-lockfile >/dev/null || { rollback; die "pnpm install hỏng"; }

for part in api web; do
  if ! (cd "$REPO/$part" && as_app pnpm build >/tmp/21gam-deploy-dev-$part.log 2>&1); then
    log "$part pnpm build hỏng:"
    tail -15 "/tmp/21gam-deploy-dev-$part.log" | sed 's/^/    /'
    rollback
    die "bản này không build được"
  fi
done

# Database Dev chỉ có dữ liệu giả: migrate thẳng, không sao lưu. Hỏng thì xoá
# sạch và dựng lại theo docs/dev-environment.md mục 8.
(cd "$REPO/api" && as_app pnpm db:migrate >/tmp/21gam-deploy-dev-migrate.log 2>&1) || {
  log "migration Dev hỏng:"; tail -15 /tmp/21gam-deploy-dev-migrate.log | sed 's/^/    /'
  die "migration Dev hỏng. Xoá sạch database Dev theo docs/dev-environment.md mục 8"
}

systemctl restart "$SERVICE"

healthy=0
for _ in $(seq 1 15); do
  sleep 2
  # Phải đúng là bản Dev trả lời, không chỉ là "có gì đó ở cổng 3001".
  if curl -s --max-time 5 "$HEALTH_URL" | grep -q '"appEnv":"dev"'; then
    healthy=1; break
  fi
done
if [ "$healthy" != "1" ]; then
  log "health check Dev không lên sau 30 giây"
  journalctl -u "$SERVICE" -n 15 --no-pager | sed 's/^/    /'
  rollback
  die "bản mới không chạy được trên Dev, đã quay lại ${current:0:7}"
fi

log "xong: Dev đang chạy ${target:0:7}"

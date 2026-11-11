#!/usr/bin/env bash
# Sao lưu database 21GAM ra /srv/21gam/backups, giữ 14 bản gần nhất.
#
# Chạy tay:   sudo -u gam21 /srv/21gam/deploy/scripts/backup-mysql.sh
# Tự động:    bật 21gam-backup.timer (xem deploy/systemd/)
#
# Thông tin đăng nhập đọc từ ~/.my.cnf của user chạy script, KHÔNG truyền
# mật khẩu trên dòng lệnh vì nó lộ ra trong `ps`.
#
# Cách tạo ~/.my.cnf: xem docs/deploy.md mục 7. Tóm tắt: file quyền 600, một
# mục [client] khai ba khóa user, password và host.
set -euo pipefail

DATABASE="${DB_NAME:-gam21_platform}"
DESTINATION="${BACKUP_DIR:-/srv/21gam/backups}"
KEEP="${BACKUP_KEEP:-14}"

mkdir -p "$DESTINATION"
chmod 700 "$DESTINATION"

stamp="$(date +%Y%m%d-%H%M%S)"
target="$DESTINATION/${DATABASE}-${stamp}.sql.gz"

# --single-transaction: ảnh chụp nhất quán trên InnoDB mà không khóa bàn ghi,
#   nên sao lưu giữa giờ mở cửa không chặn lễ tân.
# --routines --events --triggers: giữ đủ schema, không chỉ dữ liệu.
# Ghi ra file tạm rồi mới đổi tên: một lần chạy hỏng không để lại bản .sql.gz
#   cụt mà sau này tưởng là bản tốt.
temporary="${target}.partial"
mysqldump \
  --defaults-file="$HOME/.my.cnf" \
  --single-transaction \
  --quick \
  --routines --events --triggers \
  --default-character-set=utf8mb4 \
  "$DATABASE" | gzip -9 > "$temporary"
mv "$temporary" "$target"
chmod 600 "$target"

# Dọn bản cũ, giữ $KEEP bản mới nhất.
ls -1t "$DESTINATION/${DATABASE}-"*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f -- "$old"
done

printf 'backup ok: %s (%s)\n' "$target" "$(du -h "$target" | cut -f1)"

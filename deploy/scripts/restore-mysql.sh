#!/usr/bin/env bash
# Phục hồi database 21GAM từ một bản sao lưu .sql.gz.
#
#   sudo systemctl stop 21gam-api
#   sudo -u gam21 /srv/21gam/deploy/scripts/restore-mysql.sh /srv/21gam/backups/gam21_platform-20261111-030000.sql.gz
#   sudo systemctl start 21gam-api
#
# Script này GHI ĐÈ dữ liệu đang có. Nó luôn chụp một bản an toàn của trạng
# thái hiện tại trước khi ghi, và bắt gõ đúng tên database để xác nhận.
set -euo pipefail

archive="${1:-}"
DATABASE="${DB_NAME:-gam21_platform}"
DESTINATION="${BACKUP_DIR:-/srv/21gam/backups}"

if [[ -z "$archive" ]]; then
  echo "Dùng: $0 <đường-dẫn-bản-sao-lưu.sql.gz>" >&2
  exit 2
fi
if [[ ! -r "$archive" ]]; then
  echo "Không đọc được $archive" >&2
  exit 2
fi
if ! gzip -t "$archive" 2>/dev/null; then
  echo "Bản sao lưu hỏng hoặc không phải gzip: $archive" >&2
  exit 2
fi

if systemctl is-active --quiet 21gam-api; then
  echo "21gam-api đang chạy. Dừng nó trước để không ai ghi đè lên dữ liệu vừa phục hồi:" >&2
  echo "  sudo systemctl stop 21gam-api" >&2
  exit 1
fi

echo "Sắp ghi đè toàn bộ database '$DATABASE' bằng $archive"
read -r -p "Gõ đúng tên database để xác nhận: " confirmation
if [[ "$confirmation" != "$DATABASE" ]]; then
  echo "Huỷ." >&2
  exit 1
fi

# Lưới an toàn: trạng thái ngay trước khi phục hồi, để quay lại được nếu bản
# sao lưu hoá ra không phải bản mình tưởng.
mkdir -p "$DESTINATION"
safety="$DESTINATION/${DATABASE}-pre-restore-$(date +%Y%m%d-%H%M%S).sql.gz"
mysqldump --defaults-file="$HOME/.my.cnf" --single-transaction --quick \
  --routines --events --triggers --default-character-set=utf8mb4 \
  "$DATABASE" | gzip -9 > "$safety"
chmod 600 "$safety"
echo "Đã chụp trạng thái hiện tại: $safety"

gunzip -c "$archive" | mysql --defaults-file="$HOME/.my.cnf" --default-character-set=utf8mb4 "$DATABASE"

echo "Phục hồi xong. Kiểm tra rồi mới bật lại API:"
echo "  mysql --defaults-file=\$HOME/.my.cnf -e 'SELECT COUNT(*) FROM reservations' $DATABASE"
echo "  sudo systemctl start 21gam-api"

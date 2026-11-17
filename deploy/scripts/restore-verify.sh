#!/usr/bin/env bash
# Diễn tập phục hồi trên database test cô lập (TU-31 mục 6).
#
# Khác restore-mysql.sh: script kia phục hồi database vận hành và ghi đè dữ
# liệu thật. Script này KHÔNG bao giờ chạm vào database vận hành — nó từ chối
# mọi database không có hậu tố `_test`, và đó là chốt an toàn duy nhất đứng
# giữa một buổi diễn tập và việc xoá sạch dữ liệu quán.
#
#   sudo -u gam21 /srv/21gam/deploy/scripts/restore-verify.sh 21gam_20261116_0600.sql.gz
#   sudo -u gam21 /srv/21gam/deploy/scripts/restore-verify.sh /đường/dẫn/local.sql.gz
#
# Tham số là tên file trên remote (tự tải về) hoặc đường dẫn file local.
# Mặc định phục hồi vào `gam21_restore_test`.
set -euo pipefail

export TZ='Asia/Ho_Chi_Minh'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Diễn tập luôn được gõ tay, không qua systemd, nên không có EnvironmentFile
# nào nạp hộ: thiếu bước này thì script không biết remote ở đâu và buổi diễn
# tập dừng ngay ở dòng đầu.
# shellcheck source=backup-config.sh
. "$SCRIPT_DIR/backup-config.sh"
load_backup_config "$(backup_config_path "$SCRIPT_DIR")"

SOURCE="${1:-}"
TARGET_DB="${RESTORE_TEST_DB:-gam21_restore_test}"
REMOTE="${BACKUP_REMOTE:-}"
RCLONE="${RCLONE_BIN:-rclone}"
OPTION_FILE="${BACKUP_OPTION_FILE:-$HOME/.my.cnf}"
WORK_DIR="${RESTORE_WORK_DIR:-/tmp/21gam-restore-verify}"

log() { printf '%s [restore-verify] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*"; }
fail() { log "LỖI: $*"; exit 1; }

if [[ -z "$SOURCE" ]]; then
  echo "Dùng: $0 <tên-file-trên-remote | đường-dẫn-local.sql.gz>" >&2
  exit 2
fi

# Chốt an toàn số 1: chỉ database `*_test`.
# Đặt trước mọi thứ khác để một lần gõ sai tên không bao giờ đi xa hơn dòng này.
if [[ "$TARGET_DB" != *_test ]]; then
  fail "RESTORE_TEST_DB='$TARGET_DB' không có hậu tố _test. Diễn tập phục hồi
chỉ được chạy trên database test cô lập, không phải dev hay production."
fi

[[ -r "$OPTION_FILE" ]] || fail "Không đọc được MySQL option file $OPTION_FILE"
command -v mysql >/dev/null || fail 'Không tìm thấy mysql client'

mysql_run() { mysql --defaults-file="$OPTION_FILE" --default-character-set=utf8mb4 "$@"; }
query() { mysql_run --batch --skip-column-names --execute "$1" "$TARGET_DB"; }

# ---------------------------------------------------------- lấy bản backup ---

mkdir -p "$WORK_DIR"
chmod 700 "$WORK_DIR"

if [[ -f "$SOURCE" ]]; then
  archive="$SOURCE"
  log "Dùng bản local: $archive"
else
  [[ -n "$REMOTE" && "$REMOTE" != 'none' ]] \
    || fail "'$SOURCE' không phải file local và BACKUP_REMOTE chưa được cấu hình."
  command -v "$RCLONE" >/dev/null || fail "Không tìm thấy rclone ($RCLONE)"
  archive="$WORK_DIR/$(basename "$SOURCE")"
  # Tải từ remote chứ không dùng bản local: diễn tập phải chứng minh bản trên
  # Drive dùng được. Một bản local tốt không nói gì về bản đã upload.
  log "Tải $SOURCE từ $REMOTE"
  "$RCLONE" copyto "$REMOTE/$SOURCE" "$archive" --retries 3 \
    || fail 'Không tải được bản backup từ remote'
  chmod 600 "$archive"
fi

log 'Kiểm tra toàn vẹn bản nén'
gzip -t "$archive" || fail "Bản nén hỏng: $archive"
log "gzip OK ($(stat -c '%s' "$archive") byte)"

# ------------------------------------------------------------- restore -------

# Chốt an toàn số 2: database test phải trống. Nếu còn bảng thì đây có thể
# không phải database mình tưởng, nên dừng thay vì ghi đè.
existing="$(mysql_run --batch --skip-column-names --execute \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET_DB'")"
if [[ "$existing" != '0' ]]; then
  fail "Database '$TARGET_DB' đang có $existing bảng. Hãy xoá và tạo lại database
trống trước khi diễn tập:
  DROP DATABASE \`$TARGET_DB\`; CREATE DATABASE \`$TARGET_DB\` CHARACTER SET utf8mb4;"
fi

log "Phục hồi vào '$TARGET_DB'"
set +e
gunzip -c "$archive" | mysql_run "$TARGET_DB"
statuses=("${PIPESTATUS[@]}")
set -e
[[ "${statuses[0]}" -eq 0 ]] || fail "gunzip thoát với mã ${statuses[0]}"
[[ "${statuses[1]}" -eq 0 ]] || fail "mysql thoát với mã ${statuses[1]}"
log 'Phục hồi xong'

# ------------------------------------------------------------ kiểm chứng -----

# Mọi truy vấn dưới đây chỉ đếm và kiểm cấu trúc. Không SELECT cột nào chứa
# tên, số điện thoại hay ghi chú khách, nên kết quả an toàn để chụp ảnh làm
# bằng chứng nghiệm thu.
log '--- Số bảng và migration ---'
table_count="$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET_DB'")"
log "Số bảng: $table_count"
[[ "$table_count" -ge 30 ]] || fail "Chỉ có $table_count bảng, nghi bản dump thiếu schema."

if [[ "$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET_DB' AND table_name='schema_migrations'")" == '1' ]]; then
  log "Migration đã áp dụng: $(query 'SELECT COUNT(*) FROM schema_migrations')"
  log "Migration cuối: $(query 'SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1')"
else
  fail 'Không có bảng schema_migrations. Bản dump không phải database 21GAM.'
fi

# Một bản dump cũ hơn schema hiện tại thì thiếu bảng là ĐÚNG, không phải hỏng.
# Phân biệt hai trường hợp đó bằng cách đối chiếu migration đã áp dụng trong
# bản phục hồi với các file migration có trong repo. Thiếu bảng khi bản dump
# đã ngang schema mới nhất mới là bản dump hỏng.
#
# Không phân biệt thì buổi diễn tập báo đỏ mỗi lần khôi phục một bản cũ, và
# người trực học cách bỏ qua màu đỏ — đúng thói quen không được phép có ở
# người đang khôi phục dữ liệu thật.
migrations_dir="$SCRIPT_DIR/../../api/database/migrations"
pending_migrations=0
if [[ -d "$migrations_dir" ]]; then
  for migration_file in "$migrations_dir"/*.sql; do
    [[ -e "$migration_file" ]] || continue
    name="$(basename "$migration_file")"
    if [[ "$(query "SELECT COUNT(*) FROM schema_migrations WHERE filename='$name'")" != '1' ]]; then
      pending_migrations=$((pending_migrations + 1))
    fi
  done
fi
if [[ "$pending_migrations" -gt 0 ]]; then
  log "Lưu ý: bản dump này cũ hơn schema trong repo $pending_migrations migration."
  log 'Bảng do những migration đó tạo ra sẽ thiếu, và đó là đúng.'
fi

log '--- Row count các bảng nghiệp vụ ---'
missing_tables=''
for table in organizations venues users memberships roles permissions \
             role_permissions membership_roles auth_sessions \
             floors zones dining_tables reservations customers \
             visits table_allocations table_turns waitlist_entries \
             operation_log venue_settings reception_guest_counts; do
  if [[ "$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET_DB' AND table_name='$table'")" == '1' ]]; then
    printf '  %-26s %s\n' "$table" "$(query "SELECT COUNT(*) FROM \`$table\`")"
  elif [[ "$pending_migrations" -gt 0 ]]; then
    # Gom lại rồi báo một lần ở cuối: dừng ở bảng thiếu đầu tiên sẽ giấu mất
    # row count của những bảng còn lại, mà đó mới là thứ cần nhìn.
    printf '  %-26s %s\n' "$table" '(chưa có ở phiên bản schema này)'
    missing_tables="$missing_tables $table"
  else
    fail "Thiếu bảng nghiệp vụ '$table' trong bản phục hồi."
  fi
done

log '--- Toàn vẹn tham chiếu ---'
# Một bản dump --single-transaction phải nhất quán. Nếu còn booking trỏ tới
# bàn không tồn tại thì bản dump bị chụp giữa một transaction, và cả bản backup
# đó không dùng được.
orphan_memberships="$(query 'SELECT COUNT(*) FROM memberships m LEFT JOIN users u ON u.id = m.user_id WHERE u.id IS NULL')"
orphan_allocations="$(query 'SELECT COUNT(*) FROM table_allocations a LEFT JOIN dining_tables t ON t.id = a.table_id WHERE t.id IS NULL')"
orphan_role_grants="$(query 'SELECT COUNT(*) FROM role_permissions rp LEFT JOIN permissions p ON p.id = rp.permission_id WHERE p.id IS NULL')"
log "memberships mồ côi: $orphan_memberships"
log "table_allocations mồ côi: $orphan_allocations"
log "role_permissions mồ côi: $orphan_role_grants"
if [[ "$orphan_memberships" != '0' || "$orphan_allocations" != '0' || "$orphan_role_grants" != '0' ]]; then
  fail 'Bản phục hồi có bản ghi mồ côi: dump không nhất quán.'
fi

log '--- Tài khoản đăng nhập được ---'
# Chỉ đếm, không in username hay hash.
log "Tài khoản còn hoạt động: $(query "SELECT COUNT(*) FROM users WHERE status = 'ACTIVE'")"
log "Số role có trong hệ thống: $(query 'SELECT COUNT(*) FROM roles')"

log '--- Dữ liệu SĐT vẫn ở dạng mã hoá ---'
# Bản dump KHÔNG được chứa khoá giải mã. Kiểm tra cột mã hoá không rỗng mà
# không in nội dung: nếu ở đây ra plaintext thì việc rò rỉ đã xảy ra từ trước.
if [[ "$(query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$TARGET_DB' AND table_name='customers' AND column_name LIKE '%phone%'")" != '0' ]]; then
  log "Cột phone trong customers: $(query "SELECT GROUP_CONCAT(column_name ORDER BY column_name) FROM information_schema.columns WHERE table_schema='$TARGET_DB' AND table_name='customers' AND column_name LIKE '%phone%'")"
  log 'Khoá giải mã KHÔNG nằm trong dump (đúng thiết kế). Muốn đọc được SĐT sau'
  log 'khi phục hồi, phải lấy PHONE_ENCRYPTION_KEYS/PHONE_HMAC_KEYS từ nơi cất'
  log 'bí mật riêng — xem docs/security/phone-encryption-setup.md.'
fi

log ''
if [[ -n "$missing_tables" ]]; then
  log "Bảng chưa có ở phiên bản schema của bản dump này:$missing_tables"
  log 'Chúng sẽ xuất hiện trong các bản sao lưu chụp sau khi migration tương'
  log 'ứng được áp dụng. Không phải lỗi của bản sao lưu.'
fi
log "DIỄN TẬP THÀNH CÔNG: '$TARGET_DB' phục hồi từ $(basename "$archive")"
log 'Bước còn lại phải làm tay (cần API test riêng):'
log "  1. Trỏ api/.env của một API test vào DB_NAME=$TARGET_DB"
log '  2. pnpm --dir api dev, rồi POST /api/v1/auth/login bằng tài khoản thử nghiệm'
log '  3. Xác nhận /api/v1/tables/floor trả đúng sơ đồ bàn'
log "  4. Xoá database diễn tập: DROP DATABASE \`$TARGET_DB\`;"

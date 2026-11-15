#!/usr/bin/env bash
# Sao lưu database 21GAM, đẩy lên remote storage, rồi áp dụng chính sách giữ
# bản (TU-31).
#
# Chạy tay:   sudo -u gam21 /srv/21gam/deploy/scripts/backup-mysql.sh
# Chạy thử:   BACKUP_DRY_RUN=1 sudo -u gam21 /srv/21gam/deploy/scripts/backup-mysql.sh
# Tự động:    bật 21gam-backup.timer (xem deploy/systemd/)
#
# Thông tin đăng nhập đọc từ MySQL option file, KHÔNG truyền mật khẩu trên dòng
# lệnh vì nó lộ ra trong `ps` cho mọi user trên máy. Cách tạo file: docs/deploy.md
# mục 7. Tóm tắt: quyền 600, một mục [client] khai user/password/host.
#
# Script không bao giờ in nội dung option file, biến mật khẩu hay URL remote có
# token. Mọi dòng log đều an toàn để dán vào issue.
set -euo pipefail

# ---------------------------------------------------------------- cấu hình ---

# Giờ trong tên file và trong log là giờ Việt Nam, không phụ thuộc TZ của máy.
# Server có thể đặt UTC; nếu để nguyên thì bản chạy 06:00 VN mang tên 23:00 hôm
# trước và cả chính sách retention lẫn người đọc log đều lệch một ngày.
export TZ='Asia/Ho_Chi_Minh'

DATABASE="${DB_NAME:-gam21_platform}"
DESTINATION="${BACKUP_DIR:-/srv/21gam/backups}"
OPTION_FILE="${BACKUP_OPTION_FILE:-$HOME/.my.cnf}"
# Đích remote dạng rclone, ví dụ 'gdrive-21gam:21GAM/backups'.
# Đặt BACKUP_REMOTE=none để xác nhận có chủ ý rằng máy này chỉ lưu local.
REMOTE="${BACKUP_REMOTE:-}"
RCLONE="${RCLONE_BIN:-rclone}"
# Lệnh được gọi kèm một dòng mô tả khi backup thất bại. Để trống thì chỉ dựa
# vào exit code + OnFailure của systemd.
ALERT_COMMAND="${BACKUP_ALERT_COMMAND:-}"
# Một bản dump của schema 21GAM không bao giờ nhỏ hơn mức này. Dump rỗng vẫn là
# gzip hợp lệ, nên kích thước là chốt duy nhất bắt được "mysqldump chạy xong
# nhưng không ra dữ liệu".
MIN_BYTES="${BACKUP_MIN_BYTES:-20480}"
DRY_RUN="${BACKUP_DRY_RUN:-0}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RETENTION_PLANNER="$SCRIPT_DIR/backup-retention.mjs"
NODE_BIN="${NODE_BIN:-node}"

# ------------------------------------------------------------------- log -----

log() { printf '%s [backup] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*"; }
fail() {
  local message="$*"
  log "LỖI: $message"
  if [[ -n "$ALERT_COMMAND" ]]; then
    # Alert không được phép làm hỏng exit code: thông báo hỏng vẫn phải để lại
    # một lần chạy thất bại rõ ràng cho systemd.
    "$ALERT_COMMAND" "21GAM backup thất bại: $message" || log "Không gửi được thông báo."
  fi
  exit 1
}

# ------------------------------------------------- kiểm tra điều kiện chạy ---

[[ -r "$OPTION_FILE" ]] || fail "Không đọc được MySQL option file $OPTION_FILE"
command -v mysqldump >/dev/null || fail 'Không tìm thấy mysqldump'
command -v gzip >/dev/null || fail 'Không tìm thấy gzip'
[[ -r "$RETENTION_PLANNER" ]] || fail "Thiếu $RETENTION_PLANNER"
command -v "$NODE_BIN" >/dev/null || fail "Không tìm thấy node ($NODE_BIN)"

if [[ -z "$REMOTE" ]]; then
  fail 'Chưa cấu hình BACKUP_REMOTE. Bản sao lưu nằm cùng ổ với database không
chống được hỏng ổ, nên script từ chối chạy ở trạng thái chỉ-local mặc định.
Đặt BACKUP_REMOTE=<remote>:<đường-dẫn> để bật upload, hoặc BACKUP_REMOTE=none
nếu thực sự chấp nhận chỉ lưu local.'
fi
if [[ "$REMOTE" != 'none' ]]; then
  command -v "$RCLONE" >/dev/null || fail "Không tìm thấy rclone ($RCLONE)"
fi

# Quyền option file: 600. Kiểm luôn vì một lần `chmod 644` vô tình là đủ để
# mọi user trên máy đọc được mật khẩu database.
permissions="$(stat -c '%a' "$OPTION_FILE")"
if [[ "$permissions" != '600' && "$permissions" != '400' ]]; then
  fail "$OPTION_FILE đang có quyền $permissions, phải là 600"
fi

mkdir -p "$DESTINATION"
chmod 700 "$DESTINATION"

# Hai lần backup chồng nhau sẽ cùng ghi vào thư mục và cùng chạy retention,
# nên khoá bằng flock. Lần thứ hai thoát ngay chứ không xếp hàng: nếu lần đầu
# còn chạy sau một tiếng thì vấn đề là nó, không phải thiếu bản mới.
LOCK_FILE="${BACKUP_LOCK_FILE:-$DESTINATION/.backup.lock}"
if [[ "${BACKUP_LOCK_HELD:-0}" != '1' ]]; then
  # --conflict-exit-code tách "không lấy được khoá" khỏi "chạy xong nhưng lỗi".
  # Không dùng exec ở đây: exec thay luôn process nên nhánh xử lý xung đột bên
  # dưới sẽ không bao giờ chạy, và một lần chạy chồng sẽ bị báo như một lần
  # backup thất bại.
  set +e
  env BACKUP_LOCK_HELD=1 flock --nonblock --conflict-exit-code 75 \
    --exclusive "$LOCK_FILE" "$0" "$@"
  lock_status=$?
  set -e
  if [[ "$lock_status" -eq 75 ]]; then
    log 'Một lần backup khác đang chạy. Thoát mà không báo lỗi.'
    exit 0
  fi
  exit "$lock_status"
fi

# ------------------------------------------------------------------ dump -----

stamp="$(date '+%Y%m%d_%H%M')"
archive_name="21gam_${stamp}.sql.gz"
target="$DESTINATION/$archive_name"
# Ghi ra .partial rồi mới đổi tên: một lần chạy hỏng không để lại .sql.gz cụt
# mà vài tuần sau tưởng là bản tốt. backup-retention.mjs cũng bỏ qua .partial,
# nên rác của lần hỏng không bao giờ bị tính là một bản backup.
temporary="$target.partial"
trap 'rm -f -- "$temporary"' EXIT

log "Bắt đầu dump database '$DATABASE' -> $archive_name"

if [[ "$DRY_RUN" == '1' ]]; then
  log 'BACKUP_DRY_RUN=1: bỏ qua dump/upload, chỉ in kế hoạch retention.'
else
  # --single-transaction: ảnh chụp nhất quán trên InnoDB mà không khoá bàn ghi,
  #   nên sao lưu không chặn lễ tân nếu phải chạy giữa giờ mở cửa.
  # --quick: đọc theo dòng, không gom cả bảng vào RAM.
  # --routines --events --triggers: giữ đủ schema, không chỉ dữ liệu.
  # --no-tablespaces: user backup chỉ có quyền trên một database, không có
  #   PROCESS toàn cục. Thiếu cờ này mysqldump in "Access denied ... PROCESS"
  #   mỗi lần chạy, và cấp PROCESS chỉ để im lỗi đó là nới quyền thừa.
  # --set-gtid-purged=OFF: KHÔNG nhúng lệnh SET @@GLOBAL.GTID_PURGED vào dump.
  #   Server bật binlog + GTID nên mysqldump mặc định thêm lệnh đó, và nó làm
  #   mọi lần restore vào một database khác TRÊN CÙNG SERVER thất bại với
  #   "GTID_PURGED cannot be changed: the added gtid set must not overlap with
  #   GTID_EXECUTED". Đó đúng là cách diễn tập phục hồi phải chạy (mục 8.1 của
  #   docs/deploy.md), nên không có cờ này thì bản backup không kiểm thử được —
  #   và một bản backup chưa từng restore thử thì chưa biết là dùng được.
  #   Đánh đổi: dump không mang trạng thái GTID nên không dùng để khởi tạo một
  #   replica. 21GAM chạy một MySQL duy nhất, không có replication, và mục đích
  #   của bản dump này là phục hồi dữ liệu.
  #
  # set -o pipefail đã bắt lỗi pipeline, nhưng vẫn đọc PIPESTATUS để log nói
  # được LÀ mysqldump hay gzip hỏng. Khi bị gọi lúc 6 giờ sáng, biết ngay phía
  # nào hỏng tiết kiệm nhiều hơn độ dài của dòng này.
  set +e
  mysqldump \
    --defaults-file="$OPTION_FILE" \
    --single-transaction \
    --quick \
    --no-tablespaces \
    --set-gtid-purged=OFF \
    --routines --events --triggers \
    --default-character-set=utf8mb4 \
    "$DATABASE" | gzip -9 > "$temporary"
  statuses=("${PIPESTATUS[@]}")
  set -e
  [[ "${statuses[0]}" -eq 0 ]] || fail "mysqldump thoát với mã ${statuses[0]}"
  [[ "${statuses[1]}" -eq 0 ]] || fail "gzip thoát với mã ${statuses[1]}"

  # Dump hỏng/rỗng không được công bố. Ba chốt dưới đây bắt ba kiểu hỏng khác
  # nhau: file không tồn tại, nén hỏng, và nén hợp lệ nhưng không có dữ liệu.
  [[ -s "$temporary" ]] || fail 'Dump rỗng'
  gzip -t "$temporary" 2>/dev/null || fail 'Bản nén vừa tạo không hợp lệ'
  size="$(stat -c '%s' "$temporary")"
  if [[ "$size" -lt "$MIN_BYTES" ]]; then
    fail "Dump chỉ $size byte, nhỏ hơn ngưỡng $MIN_BYTES. Nghi dump thiếu dữ liệu."
  fi

  # Công bố: từ đây file mới mang tên thật và mới được coi là một bản backup.
  chmod 600 "$temporary"
  mv -- "$temporary" "$target"
  trap - EXIT
  log "Dump xong: $archive_name ($(numfmt --to=iec "$size" 2>/dev/null || echo "$size byte"))"
fi

# ---------------------------------------------------------------- upload -----

remote_ok=0
if [[ "$REMOTE" == 'none' ]]; then
  log 'BACKUP_REMOTE=none: bỏ qua upload. Bản sao lưu này CHƯA chống được hỏng ổ.'
elif [[ "$DRY_RUN" == '1' ]]; then
  log 'Dry-run: bỏ qua upload.'
else
  log "Upload lên $REMOTE"
  "$RCLONE" copyto "$target" "$REMOTE/$archive_name" \
    --no-traverse --retries 3 --low-level-retries 10 \
    || fail "rclone copyto thất bại"

  # Upload "không báo lỗi" chưa phải là upload thành công: đối chiếu kích thước
  # thật trên remote, rồi để rclone so hash nếu backend có hash.
  local_size="$(stat -c '%s' "$target")"
  remote_size="$("$RCLONE" lsjson "$REMOTE/$archive_name" 2>/dev/null \
    | "$NODE_BIN" -e 'let t="";process.stdin.on("data",c=>t+=c).on("end",()=>{const a=JSON.parse(t||"[]");process.stdout.write(String(a[0]?.Size??-1))})')" \
    || fail 'Không đọc được thông tin file trên remote'
  if [[ "$remote_size" != "$local_size" ]]; then
    fail "Kích thước trên remote ($remote_size) khác local ($local_size)"
  fi
  if "$RCLONE" check "$target" "$REMOTE/$archive_name" --one-way 2>&1 | grep -qi 'differ\|error'; then
    fail 'rclone check báo nội dung trên remote khác local'
  fi
  remote_ok=1
  log "Upload xác minh xong: $REMOTE/$archive_name ($remote_size byte)"
fi

# -------------------------------------------------------------- retention ----

# Chỉ dọn sau khi bản MỚI đã an toàn. Nếu dump hỏng thì script đã exit ở trên;
# nếu upload hỏng cũng vậy. Nghĩa là không có đường nào dẫn tới "xoá bản cũ
# trong khi bản mới chưa tồn tại" — đúng luật "không xoá bản backup mới nhất
# khi backup/upload hiện tại thất bại".
prune() {
  local label="$1" lister="$2" remover="$3"
  local plan deletions
  plan="$($lister 2>/dev/null | "$NODE_BIN" "$RETENTION_PLANNER" || true)"
  if [[ -z "$plan" ]]; then
    log "Retention $label: không có bản nào cần xoá."
    return 0
  fi
  deletions="$(printf '%s\n' "$plan" | wc -l | tr -d ' ')"
  log "Retention $label: xoá $deletions bản ngoài chính sách 7 daily + 4 weekly."
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if [[ "$DRY_RUN" == '1' ]]; then
      log "  [dry-run] sẽ xoá $label/$name"
    else
      # Lỗi xoá một bản cũ không được làm lần backup này thất bại: bản mới đã
      # nằm an toàn trên remote, và một file cũ sót lại chỉ tốn chỗ.
      $remover "$name" || log "  Không xoá được $label/$name"
      log "  đã xoá $label/$name"
    fi
  done <<< "$plan"
}

list_local() { ls -1 "$DESTINATION" 2>/dev/null; }
remove_local() { rm -f -- "$DESTINATION/$1"; }
prune 'local' list_local remove_local

if [[ "$remote_ok" == '1' || ( "$DRY_RUN" == '1' && "$REMOTE" != 'none' ) ]]; then
  # Retention phải áp dụng cả trên remote, nếu không thì Drive phình vô hạn và
  # bản cũ nằm ngoài tầm kiểm soát của chính sách.
  list_remote() { "$RCLONE" lsf "$REMOTE" 2>/dev/null; }
  remove_remote() { "$RCLONE" deletefile "$REMOTE/$1"; }
  prune 'remote' list_remote remove_remote
fi

# ----------------------------------------------------------------- tổng kết --

if [[ "$DRY_RUN" == '1' ]]; then
  log 'Dry-run xong.'
elif [[ "$remote_ok" == '1' ]]; then
  log "HOÀN TẤT: $archive_name đã có bản local và bản remote đã xác minh."
else
  log "HOÀN TẤT (chỉ local): $archive_name. Chưa có bản ngoài server."
fi

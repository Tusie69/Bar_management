#!/usr/bin/env bash
# Nạp cấu hình chung cho nhóm script sao lưu / phục hồi (TU-31).
#
# Vì sao các script tự nạp thay vì dựa vào môi trường: chỉ
# `21gam-backup.service` có `EnvironmentFile=`. Mọi đường chạy khác đều không
# có gì nạp hộ —
#
#   * `auto-deploy.sh` gọi backup-mysql.sh bằng `sudo -u gam21 env HOME=...`
#   * người trực gõ tay `sudo -u gam21 .../restore-verify.sh <ten-file>`
#
# — nên nếu script chỉ đọc biến môi trường thì `BACKUP_REMOTE` trống và chúng
# từ chối chạy, dù cấu hình trên máy hoàn toàn đúng. Một lần đó đủ để chặn
# triển khai, hoặc để buổi diễn tập phục hồi không bắt đầu được.
#
# Biến đã có trong môi trường THẮNG file. Nhờ vậy `DB_NAME=... ./backup-mysql.sh`
# và `BACKUP_DRY_RUN=1 ...` vẫn còn tác dụng, và lần nạp thứ hai dưới systemd
# không ghi đè giá trị systemd vừa đặt.
#
# Không phải trình phân tích shell: file cấu hình chỉ gồm `KHOA=gia-tri`, đúng
# khuôn dạng mà `EnvironmentFile=` của systemd chấp nhận, nên hai đường nạp
# hiểu file giống nhau. Dòng trống, dòng chú thích và dòng không phải tên biến
# hợp lệ đều bị bỏ qua thay vì làm script chết.

load_backup_config() {
  local file="${1:-}" line key value
  [[ -n "$file" && -r "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n "${!key+x}" ]] && continue
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    export "$key=$value"
  done < "$file"
}

# Đường dẫn mặc định tính theo vị trí script gọi, không theo thư mục hiện tại,
# vì systemd và cron chạy script với cwd bất kỳ.
backup_config_path() {
  local script_dir="$1"
  printf '%s' "${BACKUP_CONFIG_FILE:-$script_dir/../env/backup.env}"
}

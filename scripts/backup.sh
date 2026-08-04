#!/usr/bin/env bash
# Sao lưu và phục hồi dữ liệu của cả cụm.
#
# Cần có vì đến giờ hệ thống đang giữ thứ không dựng lại được: token của Page
# thật, lịch đăng, nội dung đã viết, ghi nhớ thương hiệu. Mất volume Postgres là
# mất tất cả, và không có lệnh nào để lấy lại.
#
# Cố ý KHÔNG sao lưu docker/.env.compose. File đó chứa SECRET_KEYS — khoá mở mọi
# credential đã mã hoá trong bản sao lưu này. Để chung một chỗ nghĩa là ai lấy
# được bản sao lưu thì đọc được luôn credential, tức là mã hoá không còn tác
# dụng gì. Khoá phải được giữ riêng, và script chỉ nhắc chứ không tự làm hộ.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/docker/.env.compose"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"

PG="ai-social-os-postgres-1"
MINIO="ai-social-os-minio-1"

# Đọc thẳng từ container đang chạy thay vì đoán từ .env: container biết chắc nó
# được khởi động với user và database nào, còn file .env có thể đã bị sửa sau
# đó mà container thì chưa dựng lại.
pg_env() {
  docker exec "$PG" printenv "$1"
}

require_running() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$1"; then
    echo "Container $1 không chạy. Chạy 'pnpm stack:up' trước." >&2
    exit 1
  fi
}

backup() {
  require_running "$PG"

  local stamp target
  stamp="$(date +%Y%m%d-%H%M%S)"
  target="$BACKUP_DIR/$stamp"
  mkdir -p "$target"

  local user db
  user="$(pg_env POSTGRES_USER)"
  db="$(pg_env POSTGRES_DB)"

  echo "→ Cơ sở dữ liệu"
  # --clean --if-exists: bản sao lưu tự dọn trước khi nạp lại, nên phục hồi vào
  # một database đang có dữ liệu không đẻ ra lỗi trùng khoá giữa chừng và bỏ lại
  # một nửa.
  docker exec "$PG" pg_dump -U "$user" -d "$db" --clean --if-exists \
    | gzip > "$target/postgres.sql.gz"
  echo "  $(du -h "$target/postgres.sql.gz" | cut -f1)"

  # MinIO giữ tài liệu đã tải lên và ảnh bìa đã vẽ. Ảnh bìa vẽ lại được, tài
  # liệu thì không.
  if docker ps --format '{{.Names}}' | grep -qx "$MINIO"; then
    echo "→ Tệp đã tải lên"
    docker run --rm \
      --volumes-from "$MINIO" \
      -v "$target:/backup" \
      alpine tar czf /backup/minio.tar.gz -C /data . 2>/dev/null
    echo "  $(du -h "$target/minio.tar.gz" | cut -f1)"
  fi

  # Qdrant không được sao lưu: nó là chỉ mục, dựng lại được từ tài liệu gốc.
  # Redis cũng không: hàng đợi và cache, mất thì chạy lại.

  cat > "$target/README.txt" <<TXT
Bản sao lưu AI Social OS — $stamp

  postgres.sql.gz   toàn bộ dữ liệu: workspace, lịch, nội dung, credential đã mã hoá
  minio.tar.gz      tài liệu đã tải lên và ảnh bìa đã vẽ

KHÔNG có trong đây: SECRET_KEYS.

Mọi credential trong postgres.sql.gz đều đã mã hoá bằng khoá nằm ở
docker/.env.compose. Không có khoá đó thì phục hồi xong sẽ có đủ workspace, đủ
lịch, đủ nội dung — nhưng mọi kênh mạng xã hội phải nối lại từ đầu.

Hãy cất một bản SECRET_KEYS ở chỗ KHÁC với thư mục này. Để chung hai thứ thì
ai lấy được thư mục này đọc được luôn credential, và mã hoá thành vô nghĩa.

Phục hồi:  pnpm stack:restore $stamp
TXT

  echo
  echo "✓ Đã lưu vào $target"
  echo
  echo "  Nhắc: SECRET_KEYS KHÔNG nằm trong bản sao lưu. Cất riêng một bản,"
  echo "  không để cùng thư mục này — xem $target/README.txt."
}

restore() {
  local stamp="${1:-}"
  if [ -z "$stamp" ]; then
    echo "Cần tên bản sao lưu. Có sẵn:" >&2
    ls -1 "$BACKUP_DIR" 2>/dev/null | tail -10 >&2 || echo "  (chưa có bản nào)" >&2
    exit 1
  fi

  local source="$BACKUP_DIR/$stamp"
  [ -d "$source" ] || { echo "Không có bản sao lưu $stamp" >&2; exit 1; }

  require_running "$PG"

  # Hỏi trước, vì lệnh này GHI ĐÈ dữ liệu đang có. Một lệnh phục hồi gõ nhầm
  # mà chạy ngay thì phá đúng thứ nó sinh ra để cứu.
  echo "Sẽ ghi đè toàn bộ dữ liệu hiện tại bằng bản $stamp."
  printf "Gõ 'phuc hoi' để xác nhận: "
  read -r answer
  [ "$answer" = "phuc hoi" ] || { echo "Đã huỷ."; exit 1; }

  local user db
  user="$(pg_env POSTGRES_USER)"
  db="$(pg_env POSTGRES_DB)"

  echo "→ Cơ sở dữ liệu"
  gunzip -c "$source/postgres.sql.gz" \
    | docker exec -i "$PG" psql -U "$user" -d "$db" -q > /dev/null

  if [ -f "$source/minio.tar.gz" ] && docker ps --format '{{.Names}}' | grep -qx "$MINIO"; then
    echo "→ Tệp đã tải lên"
    docker run --rm \
      --volumes-from "$MINIO" \
      -v "$source:/backup" \
      alpine sh -c "tar xzf /backup/minio.tar.gz -C /data" 2>/dev/null
  fi

  echo
  echo "✓ Đã phục hồi từ $stamp"
  echo "  Chạy 'pnpm stack:restart' để các service đọc lại dữ liệu."
  if [ ! -f "$ENV_FILE" ]; then
    echo
    echo "  CẢNH BÁO: không thấy docker/.env.compose. Thiếu SECRET_KEYS thì mọi"
    echo "  credential vừa phục hồi đều không mở được — phải nối lại các kênh."
  fi
}

case "${1:-}" in
  backup) backup ;;
  restore) restore "${2:-}" ;;
  list) ls -1 "$BACKUP_DIR" 2>/dev/null || echo "(chưa có bản nào)" ;;
  *)
    echo "Dùng: scripts/backup.sh [backup|restore <tên>|list]" >&2
    exit 1
    ;;
esac

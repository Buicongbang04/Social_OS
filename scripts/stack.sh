#!/usr/bin/env bash
# Bật cả nền tảng bằng Docker trên máy này.
#
# Gộp hai file compose lại thành một lệnh, và lo phần cấu hình lần đầu — nếu
# không, người chạy sẽ gặp "AUTH_SECRET is required" và phải tự đi tra xem sinh
# nó thế nào.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/docker/.env.compose"
EXAMPLE="$ROOT/docker/.env.compose.example"

COMPOSE=(docker compose --env-file "$ENV_FILE"
  -f "$ROOT/docker/docker-compose.yml"
  -f "$ROOT/docker/docker-compose.app.yml")

# Sinh một khoá ngẫu nhiên. `openssl` không phải máy nào cũng có; node thì có,
# vì không có node thì repo này không chạy được.
random_key() {
  node -e "console.log(require('crypto').randomBytes($1).toString('base64'))"
}

setup() {
  if [ -f "$ENV_FILE" ]; then
    echo "✓ Đã có docker/.env.compose — giữ nguyên."
    return
  fi

  cp "$EXAMPLE" "$ENV_FILE"

  # Sinh sẵn hai khoá bắt buộc. Để trống thì compose từ chối khởi động, và
  # thông báo lỗi không nói cho ai biết phải sinh chúng bằng cách nào.
  local auth secret
  auth="$(random_key 48)"
  secret="$(random_key 32)"
  node -e '
    const fs = require("node:fs");
    const [file, auth, secret] = process.argv.slice(1);
    let text = fs.readFileSync(file, "utf8");
    text = text.replace(/^AUTH_SECRET=$/m, `AUTH_SECRET=${auth}`);
    text = text.replace(/^SECRET_KEYS=$/m, `SECRET_KEYS=v1:${secret}`);
    fs.writeFileSync(file, text);
  ' "$ENV_FILE" "$auth" "$secret"

  echo "✓ Đã tạo docker/.env.compose và sinh sẵn AUTH_SECRET, SECRET_KEYS."
  echo "  File này KHÔNG được commit. Mất SECRET_KEYS là mất mọi credential đã lưu."
}

case "${1:-up}" in
  up)
    setup
    "${COMPOSE[@]}" up -d --build
    echo
    echo "Giao diện:  http://localhost:${WEB_PORT:-3200}"
    echo "API:        http://localhost:${API_PORT:-3100}/health"
    echo "Nhật ký:    pnpm stack:logs"
    ;;
  down) "${COMPOSE[@]}" down ;;
  # Không xoá volume: dữ liệu ở đó. Muốn xoá thì gõ tay, để việc đó không bao
  # giờ là hệ quả của một lệnh nghe như "dừng lại".
  logs) "${COMPOSE[@]}" logs -f --tail=100 "${@:2}" ;;
  ps) "${COMPOSE[@]}" ps ;;
  restart) "${COMPOSE[@]}" up -d --build "${@:2}" ;;
  *)
    echo "Dùng: scripts/stack.sh [up|down|logs|ps|restart]" >&2
    exit 1
    ;;
esac

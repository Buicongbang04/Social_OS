# docker/ — Infra (Phase 0-2, local dev)

4 service hạ tầng MVP theo `docs/05_TECH_STACK.md#mvp-stack-phase-0-2`: PostgreSQL, Redis, MinIO, Qdrant. Không có Meilisearch/NATS/Kubernetes ở đây — đúng quyết định MVP-first (xem `docs/infrastructure/05_KUBERNETES_ARCHITECTURE.md`, `docs/infrastructure/02_CLOUD_ARCHITECTURE.md`).

## Chạy

```bash
cp .env.example .env   # ở thư mục gốc repo, chỉnh nếu cần
pnpm docker:up          # tương đương: docker compose --env-file .env -f docker/docker-compose.yml up -d
```

| Service    | Host port | Console                         |
| ---------- | --------- | ------------------------------- |
| PostgreSQL | 5433      | —                               |
| Redis      | 6380      | —                               |
| MinIO      | 9000      | http://localhost:9002 (console) |
| Qdrant     | 6333      | http://localhost:6333/dashboard |

> Port host được cố tình lệch khỏi mặc định thông dụng (5432/6379) để stack này chạy song song với các project khác trên cùng máy mà không tranh port. Port bên trong container vẫn là chuẩn. Đổi lại được qua `.env`.

Dừng: `pnpm docker:down`. Xem log: `pnpm docker:logs`.

# AI Social OS

> AI-Native Runtime Platform for Social Media, Marketing Automation and Digital Workforce

Xem `docs/00_VISION.md` cho ý tưởng đầy đủ. Trạng thái hiện tại: **Phase 0 — Foundation** (khung monorepo + hạ tầng local dev), theo `docs/ROADMAP.md`.

## Cấu trúc

```
apps/       Frontend (Next.js) — web, admin, docs, playground, landing
packages/   Shared libraries — core, domain, database, auth, ai, integration, plugin, ui, config, logger, shared, testing, ...
services/   Backend (NestJS) — api, runtime, worker, scheduler, gateway-*, webhook
docker/     Docker Compose cho hạ tầng local dev (Postgres, Redis, MinIO, Qdrant)
docs/       Toàn bộ tài liệu thiết kế/kiến trúc — đọc docs/INDEX.md trước
```

Chi tiết đầy đủ: `docs/06_MONOREPO_STRUCTURE.md`. Công nghệ sử dụng: `docs/05_TECH_STACK.md`.

## Quickstart

Chạy cả nền tảng bằng Docker — không cần cài gì ngoài Docker và pnpm:

```bash
pnpm install
pnpm stack:up      # lần đầu tự sinh khoá; xong thì mở http://localhost:3200
```

Hoặc chạy ở chế độ phát triển, sửa code là thấy ngay:

```bash
cp .env.example .env
pnpm docker:up     # chỉ hạ tầng: PostgreSQL, Redis, MinIO, Qdrant
pnpm dev
```

Hai cách dùng chung volume nên dữ liệu không mất khi đổi qua lại, nhưng **đừng
chạy cả hai cùng lúc** — chúng tranh cổng 3100 và 3200.

## Scripts

| Lệnh                                             | Mô tả                                                   |
| ------------------------------------------------ | ------------------------------------------------------- |
| `pnpm dev`                                       | Chạy toàn bộ apps/services ở chế độ dev (qua Turborepo) |
| `pnpm build`                                     | Build toàn bộ                                           |
| `pnpm lint` / `pnpm typecheck` / `pnpm test`     | Kiểm tra chất lượng code                                |
| `pnpm docker:up` / `docker:down` / `docker:logs` | Quản lý hạ tầng local dev                               |
| `pnpm stack:up` / `stack:down` / `stack:logs`    | Chạy cả nền tảng trong Docker — xem `docker/README.md`  |

## Đóng góp

Coding standard, git workflow, quy trình review: `docs/development/`.

## License

Private — Copyright © AI Social OS

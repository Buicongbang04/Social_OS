# @repo/database — Shared

> Phase 0

Drizzle ORM schema, migration, repository và seed cho PostgreSQL. Xem `docs/data/03_DATABASE_STRATEGY.md`, `docs/data/02_DATA_MODEL.md`.

## Bảng

| Nhóm        | Bảng                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| Identity    | `users`, `user_identities` (nơi duy nhất chứa password hash), `user_profiles` |
| Tenant      | `organizations`, `workspaces`                                                 |
| Membership  | `organization_memberships`, `workspace_memberships`                           |
| Auth        | `sessions` (chỉ lưu hash của refresh token)                                   |
| RBAC        | `permissions`, `roles`, `role_permissions`                                    |
| Operational | `idempotency_keys`                                                            |

## Quy ước bắt buộc

- **ID**: prefixed ULID sinh từ ứng dụng (`wsp_01HX...`), không dùng auto-increment.
- **Metadata**: mọi bảng nghiệp vụ đều có `created_at/updated_at/created_by/updated_by/version` qua `auditColumns`.
- **Optimistic locking**: mọi `update` đều compare-and-swap trên `version`; không khớp → trả `null` → tầng service ném 409 `VERSION_CONFLICT`.
- **Soft delete** là mặc định; `sessions` và `idempotency_keys` là ngoại lệ có chủ đích (dữ liệu vận hành, hết hạn thay vì lưu giữ).
- **Cách ly tenant**: mọi read đều join với membership của chính người gọi. Workspace mà user không phải thành viên coi như không tồn tại → 404, không phải 403, để không lộ sự tồn tại dữ liệu của tenant khác.

## Lệnh

```bash
# Cần .env ở gốc repo (DATABASE_URL)
pnpm --filter @repo/database db:generate   # sinh migration từ schema
pnpm --filter @repo/database db:migrate    # áp migration
pnpm --filter @repo/database db:seed       # seed permission catalog + role matrix
pnpm --filter @repo/database db:studio     # Drizzle Studio

pnpm --filter @repo/database test          # unit test, không cần Docker
pnpm --filter @repo/database test:int      # integration test, cần Postgres đang chạy
```

Seed dev fixture (2 tenant để test cách ly) chỉ chạy khi có `SEED_ADMIN_PASSWORD_HASH` — package này cố tình không phụ thuộc thư viện hash, việc hash thuộc `@repo/auth`.

## Drift test

`src/seed/system.int-spec.ts` khẳng định `permissions`/`roles`/`role_permissions` trong DB khớp **chính xác** với catalog trong `@repo/domain`. Đây là cách vừa giữ được type-safety khi code, vừa tuân thủ nguyên tắc "không hardcode Permission trong source code" của `docs/platform/08_PERMISSION_MODEL.md`.

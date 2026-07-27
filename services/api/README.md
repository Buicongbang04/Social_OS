# services/api — Backend

> Reserved for Phase 1 — AI Runtime

REST API chính của AI Social OS, xây bằng **NestJS**. Ở giai đoạn hiện tại (Phase 0), thư mục này chỉ là placeholder — code thật (module, controller, guard...) sẽ được thêm ở Giai đoạn 2 khi triển khai Authentication + RBAC + Workspace theo `docs/platform/06_AUTHENTICATION.md`, `docs/platform/07_AUTHORIZATION.md`, `docs/platform/08_PERMISSION_MODEL.md`.

**Vai trò kép ở Phase 0-2:** `services/api` đồng thời đóng vai trò API Gateway (routing `/api/v1`, authn/authz, rate limit, validation, error format — theo `docs/platform/09_API_GATEWAY.md`) cho tới khi hệ thống có đủ service khác để cần tách gateway riêng.

Xem thêm: `docs/06_MONOREPO_STRUCTURE.md` (mục Services → api).

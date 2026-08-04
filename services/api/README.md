# services/api — Backend

> Phase 0

REST API của AI Social OS, xây bằng **NestJS**. Ở Phase 0-2 service này đồng thời đóng vai trò **API Gateway** (`docs/platform/09_API_GATEWAY.md`) — chưa tách riêng vì chưa có service thứ hai nào cần gateway phía trước.

## Chạy

```bash
# Cần .env ở gốc repo và hạ tầng đang chạy (pnpm docker:up)
pnpm --filter @repo/api dev     # watch mode
pnpm --filter @repo/api build && pnpm --filter @repo/api start
```

Mặc định: `http://localhost:3100`, prefix `/api/v1`, health ở `/health` (không prefix để probe không phải bám version).

## Endpoint hiện có

| Method           | Path                                     | Auth                                               |
| ---------------- | ---------------------------------------- | -------------------------------------------------- |
| GET              | `/health`                                | Public                                             |
| POST             | `/api/v1/auth/register`                  | Public                                             |
| POST             | `/api/v1/auth/login`                     | Public, giới hạn 5 req/phút                        |
| POST             | `/api/v1/auth/refresh`                   | Public, giới hạn 10 req/phút                       |
| POST             | `/api/v1/auth/logout`                    | Bearer token                                       |
| GET              | `/api/v1/users/me`                       | Bearer token                                       |
| GET/POST         | `/api/v1/organizations`                  | Bearer token                                       |
| GET/PATCH        | `/api/v1/organizations/:id`              | `organization.organization.read` / `.update`       |
| GET/POST         | `/api/v1/workspaces`                     | Bearer token                                       |
| GET/PATCH/DELETE | `/api/v1/workspaces/:id`                 | `workspace.workspace.read` / `.update` / `.delete` |
| GET/POST         | `/api/v1/workspaces/:id/members`         | `workspace.member.read` / `.create`                |
| DELETE           | `/api/v1/workspaces/:id/members/:userId` | `workspace.member.delete`                          |

## Cách API Gateway concern được hiện thực

| Vấn đề            | Cách làm                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Versioning        | `setGlobalPrefix(API_PREFIX)`, loại trừ `/health`                                                                      |
| Correlation ID    | Middleware + `AsyncLocalStorage`, nhận `x-correlation-id`/`x-request-id` từ upstream nếu có, trả lại qua header        |
| Error envelope    | `AllExceptionsFilter` — mọi lỗi ra đúng `{code, message, requestId, timestamp}`; lỗi lạ không bao giờ lộ message/stack |
| Response envelope | `ResponseEnvelopeInterceptor` — controller trả object thuần, interceptor bọc `{data}`                                  |
| Validation        | `ZodValidationPipe` → 422 kèm `details` từng field                                                                     |
| Rate limit        | `ScopedThrottlerGuard` — key theo **user**, không theo IP (IP chung NAT sẽ phạt oan)                                   |
| Authentication    | `JwtAuthGuard` là **global** — route mặc định là protected, phải `@Public()` mới mở                                    |
| Authorization     | `PermissionGuard` là **global** và **fail closed** — route không khai báo chính sách nào sẽ bị từ chối, không phải mở  |

## Quyết định về token

- **Access token**: JWT HS256, 15 phút. **Không chứa role/permission** — quyền là theo từng Workspace và phải thu hồi được, nên luôn resolve phía server.
- **Refresh token**: chuỗi ngẫu nhiên 32 byte (không phải JWT), 30 ngày, **dùng một lần** và xoay vòng. DB chỉ lưu SHA-256 hash.
- **Logout tức thì**: access token đã ký vẫn hợp lệ tới khi hết hạn, nên có thêm denylist trên Redis (`revoked:sid:*`) với TTL bằng tuổi thọ access token.

## Phân quyền

Mỗi route phải khai báo đúng một trong ba:

| Decorator                                     | Ý nghĩa                                                 |
| --------------------------------------------- | ------------------------------------------------------- |
| `@Public()`                                   | Không cần token (login, register, health)               |
| `@AuthenticatedOnly()`                        | Cần token hợp lệ, không cần quyền cụ thể                |
| `@RequirePermission("scope.resource.action")` | Cần quyền cụ thể trong Workspace/Organization tương ứng |

Quên khai báo không làm route bị mở — `PermissionGuard` từ chối luôn, và `src/route-coverage.spec.ts` làm build fail ngay tại commit.

### 404 hay 403?

| Tình huống                      | Mã trả về | Vì sao                                                                |
| ------------------------------- | --------- | --------------------------------------------------------------------- |
| Không phải thành viên           | **404**   | Trả 403 sẽ xác nhận tài nguyên đó tồn tại, làm lộ dữ liệu tenant khác |
| Là thành viên nhưng thiếu quyền | **403**   | Họ đã biết tài nguyên tồn tại rồi, không còn gì để giấu               |

`PermissionGuard` phân biệt hai trường hợp này qua `AuthorizationOutcome`.

## Test

```bash
pnpm --filter @repo/api test       # unit, không cần Docker
# Integration test XOÁ SẠCH dữ liệu tenant. Trỏ DATABASE_URL vào database riêng
# có tên kết thúc bằng _test (xem packages/database/README.md); chạy vào database
# thật thì @repo/database từ chối xoá.
pnpm --filter @repo/api test:int   # integration, cần pnpm docker:up
```

Bộ integration test (`src/workspace-isolation.int-spec.ts`) chạy trên Postgres/Redis thật, không mock gì — vì test cách ly mà mock repository thì không chứng minh được điều gì.

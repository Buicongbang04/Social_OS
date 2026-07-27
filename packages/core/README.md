# @repo/core — Shared

> Phase 0

Primitive dùng chung, **không phụ thuộc framework hay database**. Mọi package/service khác đều có thể import; bản thân nó không import gì trong repo.

| Module        | Nội dung                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ids.ts`      | ID có prefix dạng `wsp_01HX...` (ULID) + branded type (`WorkspaceId` ≠ `UserId`) theo `docs/data/02_DATA_MODEL.md` |
| `entity.ts`   | Metadata bắt buộc cho mọi entity: `createdAt/updatedAt/createdBy/updatedBy/version`, soft delete                   |
| `errors.ts`   | Error có `code` (SCREAMING_SNAKE) + `httpStatus`, dùng trực tiếp cho error envelope                                |
| `envelope.ts` | `{data, meta, links}` và `{code, message, requestId, timestamp}` theo `docs/api/`                                  |

```ts
import { newId, assertId, ConflictError } from "@repo/core";

const id = newId("workspace"); // wsp_01HX...
const safe = assertId("workspace", param); // ném lỗi nếu param sai kiểu ID
throw new ConflictError("Stale write", "VERSION_CONFLICT");
```

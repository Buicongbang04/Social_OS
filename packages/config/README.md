# @repo/config

> Shared Config layer — dùng chung cho mọi package/app/service

Tương ứng `docs/06_MONOREPO_STRUCTURE.md` → "Shared Configuration".

## Nội dung

| Path                          | Dùng cho tầng                                                                    | Ghi chú                                                      |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `eslint/base.js`              | Mọi tầng                                                                         | Rule chung theo `docs/development/02_CODING_STANDARDS.md`    |
| `eslint/nestjs.js`            | **Backend** (`services/*`)                                                       | Nới lỏng rule không hợp với NestJS DI                        |
| `eslint/nextjs.js`            | **Frontend** (`apps/*`)                                                          | Thêm rule React/React Hooks                                  |
| `prettier/index.js`           | Mọi tầng                                                                         | Format chung                                                 |
| `tsconfig/nestjs.json`        | **Backend**                                                                      | `experimentalDecorators`, `emitDecoratorMetadata` cho NestJS |
| `tsconfig/nextjs.json`        | **Frontend**                                                                     | `jsx: preserve`, Next.js plugin                              |
| `tsconfig/react-library.json` | Package UI dùng chung (`packages/ui`)                                            | Build thư viện React                                         |
| `tsconfig/library.json`       | Package TS thuần (`packages/logger`, `packages/shared`, `packages/testing`, ...) | Build thư viện Node/TS thông thường                          |

## Cách dùng

Backend service (`services/api/eslint.config.js`):

```js
import { nestjsConfig } from "@repo/config/eslint/nestjs";
export default nestjsConfig;
```

Frontend app (`apps/web/eslint.config.js`):

```js
import { nextjsConfig } from "@repo/config/eslint/nextjs";
export default nextjsConfig;
```

`tsconfig.json` (bất kỳ package/service/app nào):

```json
{ "extends": "@repo/config/tsconfig/nestjs.json" }
```

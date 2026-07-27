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

Mỗi package tự khai `rootDir`/`outDir` trong tsconfig của mình. **Không** đặt chúng ở config dùng chung: đường dẫn tương đối trong tsconfig được resolve theo file _chứa_ nó, nên `"rootDir": "src"` viết ở đây sẽ trỏ vào `packages/config/tsconfig/src`.

---

## Vì sao các thiết lập này không được đổi

Ba quyết định dưới đây trông tùy tiện nhưng đều chống lại một lỗi **chỉ xuất hiện lúc chạy**, không bị trình biên dịch bắt. Ghi ở đây thay vì viết comment trong file JSON, vì các file này không mang tên `tsconfig.json` nên nhiều editor coi chúng là JSON thuần và báo đỏ comment.

**1. `library.json` xuất CommonJS, không phải ESM.**
NestJS chạy CommonJS và không thể `require()` một package ESM; trong khi Next.js dùng package CommonJS bình thường. Một output CommonJS phục vụ được cả hai, đỡ phải build dual-format. Đổi sang ESM sẽ làm `services/*` chết khi khởi động.

**2. `nestjs.json` bật `emitDecoratorMetadata` và tắt `verbatimModuleSyntax`.**
NestJS resolve dependency trong constructor lúc chạy bằng metadata `design:paramtypes`. `verbatimModuleSyntax: true` sẽ giữ nguyên `import type` và xóa nó trước khi metadata được ghi → DI vỡ với lỗi "Nest can't resolve dependencies of X".

**3. `tsconfig.base.json` cố tình không có `paths`.**
Map `@repo/*` thẳng vào `packages/*/src` sẽ kéo source của package phụ thuộc vào phần biên dịch của package tiêu thụ và gây lỗi TS6059 ("not under rootDir"). Package được resolve qua symlink workspace của pnpm, trỏ tới `dist/*.d.ts`; Turborepo đảm bảo thứ tự build bằng `dependsOn: ["^build"]`.

Cùng lý do (2), rule ESLint `@typescript-eslint/consistent-type-imports` bị tắt cho `services/**` ở cả `packages/config/eslint/nestjs.js` lẫn `eslint.config.js` ở gốc repo — lint-staged chạy từ gốc nên chỉ tắt ở một chỗ là chưa đủ. Có test chặn tái diễn tại `services/api/src/app.module.spec.ts`.

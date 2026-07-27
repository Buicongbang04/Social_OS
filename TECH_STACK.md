# Công nghệ đang dùng

Bản kiểm kê **những gì thực sự có trong repo và đang chạy**, tính đến
2026-07-27 (commit `22af3bd`).

Khác với `docs/05_TECH_STACK.md` — tài liệu đó mô tả stack **dự kiến** cho toàn
bộ sản phẩm (NATS JetStream, Meilisearch, Prometheus, Grafana, OpenTelemetry,
Jaeger…). Bản này chỉ nói về thứ đã cài, đã dùng, và đã chạy được. Chỗ nào có
khoảng cách giữa hai bản, tôi ghi rõ ở mục cuối.

Điểm yếu ghi ở đây là **những gì đã thực sự vấp phải trong quá trình làm**, không
phải nhận xét chung chung chép từ tài liệu.

---

## 1. Ngôn ngữ và môi trường chạy

### TypeScript `5.7`

Toàn bộ mã nguồn, không có JavaScript viết tay.

**Dùng cho:** mọi package, service và app.

**Mạnh:** cấu hình `strict` + `noUncheckedIndexedAccess` bắt được rất nhiều lỗi
trước khi chạy. Kiểu nhánh (branded types) cho ID khiến truyền nhầm `GoalId` vào
chỗ cần `ExecutionId` là lỗi biên dịch chứ không phải lỗi runtime.

**Yếu — đã vấp:** kiểu chỉ tồn tại lúc biên dịch, nên **ép kiểu là lời nói dối
không ai kiểm tra**. Ví dụ thật: `plan` đọc từ `jsonb` được ép thành
`ExecutionPlan`, nhưng các trường `Date` bên trong thực chất là chuỗi. TypeScript
tin, runtime thì không. Chỗ nào ép kiểu ở ranh giới I/O đều phải coi là chưa
được kiểm chứng.

### Node.js `>= 24` (đang chạy v25.2.1)

**Mạnh:** `require(ESM)` ổn định từ 22.12 — đây là thứ duy nhất khiến
`packages/ai` (biên dịch ra CommonJS) nạp được Vercel AI SDK (chỉ xuất bản ESM).

**Yếu — đã vấp:** đây là ràng buộc ngầm và nguy hiểm. Hạ `engines.node` xuống
dưới 22.12 sẽ làm `packages/ai` **chết lúc nạp module**, không phải lúc build —
nên lint, typecheck và test đều xanh rồi mới sập khi khởi động. Đã ghi chú trong
`packages/ai/README.md`.

---

## 2. Monorepo và công cụ

| Công nghệ           | Phiên bản  | Dùng cho                                                     |
| ------------------- | ---------- | ------------------------------------------------------------ |
| pnpm                | 9.15.0     | Quản lý workspace, cài đặt                                   |
| Turborepo           | 2.3        | Chạy lint/typecheck/test/build song song, có cache           |
| ESLint              | 9.15       | Kiểm tra tĩnh (flat config)                                  |
| typescript-eslint   | 8.15       | Luật ESLint hiểu kiểu                                        |
| Prettier            | 3.4        | Định dạng mã                                                 |
| Husky + lint-staged | 9.1 / 15.2 | Chạy lint và format trên file đã stage lúc commit            |
| tsx                 | 4.19       | Chạy TypeScript trực tiếp khi dev (`dev`, script kiểm chứng) |

**pnpm — mạnh:** liên kết cứng theo nội dung nên cài nhanh và tiết kiệm đĩa;
`workspace:*` giữ các package nội bộ luôn ăn khớp phiên bản.

**pnpm — yếu:** cây `node_modules` nghiêm ngặt (không hoisting bừa) làm lộ ra các
phụ thuộc ngầm mà npm/yarn giấu đi. Đúng về nguyên tắc, nhưng khi cần import một
thư viện chỉ để viết test thì phải khai báo tường minh.

**Turborepo — mạnh:** cache khiến chạy lại toàn repo gần như tức thì khi không
có gì đổi.

**Turborepo — yếu — đã vấp:** các package tiêu thụ nhau qua thư mục `dist`. Sửa
`packages/runtime` mà chưa `build` thì `services/runtime` vẫn chạy code cũ, và
`tsx watch` **không** phát hiện thay đổi trong `dist` của package khác. Đã mất
thời gian truy tìm một lỗi hoá ra chỉ là quên build.

**Husky + lint-staged — yếu — đã vấp nặng:** `eslint --fix` chạy lúc commit từng
**làm hỏng dependency injection của NestJS** — nó viết lại import thành
`import type`, xoá mất `design:paramtypes`, ứng dụng chết lúc khởi động dù build
xanh. Phải tắt `consistent-type-imports` ở **cả** config gốc lẫn config của
package, vì lint-staged chạy eslint từ thư mục gốc.

---

## 3. Backend

### NestJS `10.4`

**Dùng cho:** `services/api` — REST API, xác thực, RBAC, giới hạn tần suất.

**Mạnh:** DI và module hoá làm ranh giới rõ ràng; guard/interceptor/filter cho
phép áp dụng auth, phân trang, phong bì lỗi ở một chỗ duy nhất thay vì lặp ở mọi
controller.

**Yếu — đã vấp:** DI dựa vào metadata decorator được phát ra lúc biên dịch, nên
nó **rất mong manh trước công cụ**. Hai lần vấp: (1) `eslint --fix` như trên;
(2) esbuild bỏ `emitDecoratorMetadata`, khiến test tích hợp nhận `undefined` ở
mọi tham số constructor. Cách chữa cho (2) là `unplugin-swc`. Cả hai đều **build
xanh rồi chết lúc chạy**.

Đi kèm: `@nestjs/config`, `@nestjs/throttler` (giới hạn tần suất),
`@nestjs/platform-express`, `reflect-metadata`, `rxjs`.

### Express `5` (qua `@nestjs/platform-express`)

Máy chủ HTTP nền. Không gọi trực tiếp ở đâu.

---

## 4. Dữ liệu

### PostgreSQL `17` (Docker, cổng **5433**)

**Dùng cho:** toàn bộ dữ liệu — người dùng, tổ chức, workspace, quyền, goal,
execution, task, sự kiện, chi phí AI.

**Mạnh:** giao dịch thật, ràng buộc thật. `numeric` cho tiền và
`update ... where` cho compare-and-swap là hai thứ giữ cho hệ thống đúng khi có
nhiều node.

**Yếu — đã vấp (lỗi nặng nhất dự án):** `timestamptz` lưu **micro giây**, còn
`Date` của JavaScript chỉ có **mili giây**. So sánh bằng một timestamp đã đi
vòng qua JS thì **không bao giờ khớp**. Hệ quả: Goal theo lịch im lặng không bao
giờ chạy, không lỗi ở đâu cả, trong khi 39 test tích hợp vẫn xanh. Xem
`packages/database/src/repositories/goal.repository.ts` để biết cách chữa.

### Drizzle ORM `0.38` + drizzle-kit `0.30`

**Dùng cho:** định nghĩa schema, truy vấn, sinh và chạy migration.

**Mạnh:** SQL vẫn nhìn thấy được — truy vấn viết ra gần như SQL, nên biết chính
xác câu lệnh chạy là gì. Kiểu suy ra từ schema nên đổi cột là lỗi biên dịch. Sinh
migration từ diff schema.

**Yếu:** ít "phép màu" hơn Prisma nên phải tự viết nhiều hơn (phân trang,
compare-and-swap, ánh xạ row → entity). Một số kiểu (nhất là `sql<T>` thô) chỉ
là lời hứa, Drizzle không kiểm chứng.

**Đáng chú ý:** cột `numeric` trả về **chuỗi**, không phải số. Ban đầu trông
phiền nhưng thực ra đúng — đó chính là thứ giữ cho tiền không trôi. Cột chi phí
dùng `numeric(18,8)` và cộng bằng SQL chứ không bằng JavaScript.

### postgres `3.4`

Driver mà Drizzle dùng. Không gọi trực tiếp.

---

## 5. Hàng đợi và cache

### Redis `7` (Docker, cổng **6380**)

**Dùng cho:** hàng đợi task (sorted set theo thời điểm đến hạn), khoá phân tán
cho scheduler, cache quyền.

**Mạnh:** thao tác nguyên tử và script Lua cho phép làm khoá đúng — `SET NX PX`
để lấy, so khớp token khi nhả, nên một node chậm không xoá được khoá mà node
khác đang giữ hợp lệ.

**Yếu:** không bền vững như Postgres. Hàng đợi dùng **reservation có hạn**: máy
xử lý chết mà chưa ack thì việc quay lại hàng đợi — nhưng đó là "ít nhất một
lần", nên mọi thứ tiêu thụ nó phải chịu được nhận trùng.

**Ghi chú:** dùng sorted set chứ không dùng Redis Streams, vì cần **giao việc có
độ trễ** (retry backoff, `notBefore`) mà Streams không hỗ trợ trực tiếp.

### ioredis `5.4`

Client Redis. Dùng ở `packages/queue` và `services/api`.

---

## 6. Tầng AI

### Vercel AI SDK — `ai@7` + `@ai-sdk/anthropic@4`, `@ai-sdk/openai@4`, `@ai-sdk/google@4`, `@ai-sdk/openai-compatible@3`

**Dùng cho:** toàn bộ lời gọi model, gói kín trong **một file duy nhất**
(`packages/ai/src/adapters/vercel-adapter.ts`). Mọi thứ phía trên chỉ thấy
`ProviderRequest` / `ProviderResponse`.

**Mạnh:** một giao diện cho nhiều nhà cung cấp; `generateObject` ràng buộc đầu ra
theo JSON Schema; chuẩn hoá token usage giữa các vendor.

**Yếu — đã vấp ba lần:**

1. **Chỉ xuất bản ESM.** Repo build ra CommonJS, nên chỉ chạy được nhờ
   `require(ESM)` của Node ≥22.12.
2. **Tham số schema generic không typecheck với zod 3** — lỗi
   `TS2589: Type instantiation is excessively deep`. Đây là lý do bề mặt công
   khai của Gateway nhận **JSON Schema + hàm `parse`** chứ không nhận zod.
3. **Hệ sinh thái đang tách đôi giữa zod 3 và zod 4.** `ollama-ai-provider-v2`
   đòi zod 4, không dùng được. Phải đi qua `@ai-sdk/openai-compatible` — cũng
   hợp lý vì Ollama có endpoint tương thích OpenAI.

### zod `3.25` + zod-to-json-schema `3.25`

**Dùng cho:** validate body HTTP (`services/api`), và định nghĩa hình dạng đầu ra
bắt buộc cho model.

**Mạnh:** một định nghĩa sinh ra cả JSON Schema gửi cho model **lẫn** hàm kiểm
tra câu trả lời — hai nửa không thể lệch nhau.

**Yếu — đã vấp:** phiên bản 3 vs 4 gây xung đột peer dependency với hệ AI SDK như
trên. Và `zodToJsonSchema` có kiểu trả về điều kiện rất sâu, phải ghim nó vào một
chữ ký đơn giản để tsc không nổ.

### Nhà cung cấp model

| Nhà cung cấp       | Trạng thái                                 |
| ------------------ | ------------------------------------------ |
| Anthropic (Claude) | Đã tích hợp, chưa chạy thật vì chưa có key |
| OpenAI             | Đã tích hợp, chưa chạy thật                |
| Google (Gemini)    | Đã tích hợp, chưa chạy thật                |
| Ollama (cục bộ)    | **Đã chạy thật đầu-cuối** với `qwen2.5:7b` |

**Yếu của Ollama — đã vấp:** giải mã có ràng buộc grammar sẽ **làm chết hẳn
model runner** khi JSON Schema có `maxLength` lớn (2000 chạy được, 4000 thì
sập). Đã chữa bằng cách tỉa các keyword kích thước trước khi gửi cho Ollama.
Chất lượng tiếng Việt của model 7B cũng kém — hashtag sinh ra bị méo chữ.

---

## 7. Xác thực và bảo mật

| Công nghệ               | Phiên bản | Dùng cho                                   |
| ----------------------- | --------- | ------------------------------------------ |
| argon2                  | 0.41      | Băm mật khẩu (argon2id)                    |
| @nestjs/jwt             | 10.2      | Ký và xác minh access token                |
| passport + passport-jwt | 0.7 / 4.0 | Chiến lược xác thực cho NestJS             |
| ulid                    | 2.3       | Sinh ID có tiền tố, sắp xếp theo thời gian |

**argon2 — mạnh:** tốn bộ nhớ nên chống được tấn công bằng GPU, tốt hơn bcrypt.

**argon2 — yếu — đã vấp:** nó **từ chối** `timeCost < 2`, nên hạ chi phí cho CI
có giới hạn. Và `needsRehash` không so sánh trường `type`, nên phải tự xử lý.

**ULID — mạnh:** sắp xếp theo thời gian nên `ORDER BY id DESC` chính là mới nhất
trước, không cần cột thời gian riêng cho phân trang. Tiền tố (`gol_`, `exe_`,
`tsk_`) làm ID tự mô tả trong log và URL.

**Refresh token:** dùng token mờ, **một lần dùng, có xoay vòng**. Trình bày lại
một token đã dùng bị coi là trộm và cả phiên bị huỷ. Đây là lý do client SDK phải
gộp refresh thành một lần duy nhất — hai lần refresh đua nhau sẽ **đăng xuất
người dùng**.

---

## 8. Frontend

| Công nghệ              | Phiên bản         | Dùng cho                                            |
| ---------------------- | ----------------- | --------------------------------------------------- |
| Next.js                | 15.1 (App Router) | `apps/web` — bảng kiểm chứng runtime, cổng **3200** |
| React                  | 19                | Giao diện                                           |
| Tailwind CSS           | 3.4               | Kiểu dáng                                           |
| clsx + tailwind-merge  | 2.1 / 2.5         | Ghép class có điều kiện                             |
| PostCSS + autoprefixer | 8.4 / 10.4        | Xử lý CSS                                           |

**Next.js — mạnh:** App Router + Server Components; dev server khởi động nhanh.

**Next.js — yếu — đã vấp:** khi cổng mặc định 3000 bận, nó **tự nhảy** sang cổng
khác mà không báo gì đáng kể. Lúc đó `CORS_ORIGINS` trỏ sai chỗ và trình duyệt
chặn mọi lời gọi — hiện ra như lỗi ứng dụng chứ không phải xung đột cổng. Đã ghim
cứng 3200.

**Preset tsconfig — đã vấp:** preset Next và React trong `packages/config` ban
đầu **không khai báo `lib: DOM`**, nên mọi chỗ dùng `window` không typecheck
được. Lỗi tiềm ẩn từ Phase 0, chỉ lộ khi có trang làm việc thật với trình duyệt.

---

## 9. Kiểm thử

| Công nghệ       | Phiên bản | Dùng cho                                    |
| --------------- | --------- | ------------------------------------------- |
| Vitest          | 2.1       | Toàn bộ unit và integration test            |
| supertest       | 7.0       | Test HTTP đầu-cuối cho NestJS               |
| @faker-js/faker | 9.3       | Dữ liệu mẫu                                 |
| unplugin-swc    | 1.5       | Giữ `emitDecoratorMetadata` cho test NestJS |

**Vitest — mạnh:** nhanh, cấu hình gọn, API tương thích Jest.

**Vitest — yếu — đã vấp:** `expectTypeOf` **không được đánh giá lúc runtime** trừ
khi bật chế độ typecheck riêng. Tôi từng viết một test chống lệch kiểu bằng
`expectTypeOf`; nó xanh trong khi kiểu đang sai. Phải viết lại thành so sánh giá
trị thật.

**Ba tầng kiểm chứng đang dùng:**

1. **Unit** — logic thuần, không I/O.
2. **Integration** (`*.int-spec.ts`) — Postgres và Redis thật, không mock.
3. **`verify:stack`** — chạy toàn bộ **chỉ qua API công khai**, đúng đường người
   dùng đi.

Tầng 3 tồn tại vì tầng 2 **không đủ**: 39 test tích hợp chạy trên hạ tầng thật
vẫn để lọt lỗi Goal theo lịch không bao giờ chạy, do chúng tự ghi dữ liệu nên vô
tình tránh đúng hình dạng gây lỗi.

**Kỷ luật xuyên suốt:** mọi test bảo vệ đều được **kiểm chứng ngược** — cố tình
khôi phục lỗi để chắc test thật sự fail. Cách này đã tìm ra ba thứ
trông như đang gánh việc nhưng thực ra không: một nhánh fallback trong Gateway
không bao giờ được chạy tới, một cờ `retryOn401` trong SDK không bao giờ được
đặt, và một test chống lệch kiểu luôn xanh vì `expectTypeOf` không chạy lúc
runtime.

---

## 10. Vận hành

| Công nghệ          | Phiên bản  | Dùng cho                               |
| ------------------ | ---------- | -------------------------------------- |
| pino + pino-pretty | 9.5 / 13.0 | Log có cấu trúc                        |
| cron-parser        | 5.6        | Tính lần chạy kế tiếp của Goal định kỳ |
| Docker Compose     | —          | Postgres, Redis, MinIO, Qdrant khi dev |

**pino — mạnh:** log JSON có cấu trúc, nhanh, serialize lỗi sẵn.

**pino — yếu:** log đẹp cần `pino-pretty` riêng; JSON thô khó đọc trực tiếp.

**cron-parser — mạnh:** hỗ trợ múi giờ IANA đúng đắn. `0 8 * * *` ở
`Asia/Ho_Chi_Minh` là 8 giờ sáng giờ địa phương kể cả qua mốc đổi giờ — kiểm
chứng bằng `Europe/Madrid`: mùa đông 07:00Z, mùa hè 06:00Z.

**cron-parser — yếu:** kéo theo `luxon` (~70KB). Chấp nhận được vì chỉ chạy ở
backend.

---

## 11. Đã chạy nhưng **chưa dùng**

Hai dịch vụ này có trong `docker-compose` và đang chạy, nhưng **chưa có một dòng
code nào gọi tới**. Ghi ra để không ai tưởng nhầm là đã tích hợp:

| Dịch vụ | Cổng        | Dự kiến dùng cho                                |
| ------- | ----------- | ----------------------------------------------- |
| MinIO   | 9000 / 9002 | Lưu file (`packages/storage` mới chỉ có README) |
| Qdrant  | 6333        | Vector DB cho RAG / Knowledge / Memory          |

Tương tự, các package sau **mới chỉ có README**, chưa có mã: `packages/storage`,
`packages/plugin`, `packages/integration`. Các app `admin`, `docs`, `landing`,
`playground` cũng vậy.

(`packages/config` không có `src` nhưng **đang được dùng** — nó chứa các preset
ESLint, Prettier và tsconfig dùng chung cho toàn repo.)

---

## 12. Khoảng cách so với stack dự kiến

`docs/05_TECH_STACK.md` còn liệt kê những thứ **chưa làm**:

| Dự kiến                     | Trạng thái                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| NATS JetStream              | Chưa. Đang dùng Redis + `InMemoryEventBus`. Quyết định có chủ đích: dùng Redis trước, nâng cấp sau                           |
| Meilisearch                 | Chưa                                                                                                                         |
| Prometheus / Grafana / Loki | Chưa. Mới có log có cấu trúc                                                                                                 |
| OpenTelemetry / Jaeger      | Chưa. Mới có `correlationId` xuyên suốt                                                                                      |
| Swagger                     | Chưa sinh tài liệu API                                                                                                       |
| Secret Manager              | **Chưa — đây là khoảng cách đáng kể nhất.** API key đang đọc từ biến môi trường, chưa theo từng workspace như FR-031 yêu cầu |

---

## 13. Ràng buộc phiên bản cần nhớ

Những thứ **không được đổi** nếu chưa kiểm tra lại:

- **Node ≥ 24.** Hạ xuống dưới 22.12 làm `packages/ai` chết lúc nạp module.
- **zod ở 3.x.** Nâng lên 4 sẽ đụng `services/api` (pipe validate) và toàn bộ
  schema hiện có; đổi lại sẽ gỡ được vài chỗ chắp vá với AI SDK.
- **`consistent-type-imports` phải tắt cho `services/**`** ở cả hai config
  ESLint. Bật lại sẽ làm hỏng DI của NestJS lúc chạy.
- **Cổng lệch chuẩn có chủ ý:** Postgres 5433, Redis 6380, API 3100, Web 3200,
  MinIO 9000/9002. Lý do: máy dev còn chạy dự án khác trên các cổng mặc định.

---

## 14. Nguyên tắc chọn công nghệ

Rút ra từ những lần vấp ở trên, không phải viết trước:

1. **Xanh lúc build không có nghĩa là chạy được.** Ba lỗi nặng nhất — DI của
   NestJS, ESM/CommonJS, timestamp micro giây — đều qua được lint, typecheck và
   test. Chỉ chạy thật mới thấy.
2. **Ranh giới I/O là chỗ kiểu nói dối.** Ép kiểu ở chỗ đọc từ DB hay từ mạng
   phải coi là chưa kiểm chứng cho tới khi có parse thật.
3. **Tiền không được đi qua số thực.** `numeric` ở DB, số nguyên khi so sánh,
   cộng bằng SQL.
4. **Vendor được gói vào một file.** Đổi Vercel AI SDK sang client riêng của
   từng hãng là sửa một file, không phải sửa cả hệ thống.
5. **Test tự ghi dữ liệu sẽ tránh đúng ca lỗi của mình.** Đó là lý do có
   `verify:stack`.

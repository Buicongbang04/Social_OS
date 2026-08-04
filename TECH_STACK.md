# Công nghệ dùng trong AI Social OS

Giới thiệu toàn bộ công nghệ đang được dùng trong nền tảng: **nó là gì**, **dùng
để làm gì ở đây**, **điểm mạnh**, **điểm yếu**.

Cuối mỗi phần có mục **Lưu ý khi làm nền tảng này** — ghi lại những gì thực sự
gặp phải trong quá trình xây dựng. Phần nào chưa có gì đáng lưu ý thì không có
mục đó.

Tình trạng tính đến 2026-07-28 (commit `37262ff`). Đây là bản kiểm kê **những gì
đã cài và đang chạy thật**; stack dự kiến đầy đủ của sản phẩm nằm ở
`docs/05_TECH_STACK.md`, khoảng cách giữa hai bản ghi ở mục 12.

---

## Mục lục

1. [Ngôn ngữ và môi trường chạy](#1-ngôn-ngữ-và-môi-trường-chạy)
2. [Monorepo và công cụ phát triển](#2-monorepo-và-công-cụ-phát-triển)
3. [Backend](#3-backend)
4. [Cơ sở dữ liệu](#4-cơ-sở-dữ-liệu)
5. [Hàng đợi và cache](#5-hàng-đợi-và-cache)
6. [Tầng AI](#6-tầng-ai)
7. [Tri thức và tìm kiếm ngữ nghĩa](#7-tri-thức-và-tìm-kiếm-ngữ-nghĩa)
8. [Lưu trữ file](#8-lưu-trữ-file)
9. [Xác thực và bảo mật](#9-xác-thực-và-bảo-mật)
10. [Frontend](#10-frontend)
11. [Kiểm thử](#11-kiểm-thử)
12. [Log và tiện ích vận hành](#12-log-và-tiện-ích-vận-hành)
13. [Đã cài nhưng chưa dùng](#13-đã-cài-nhưng-chưa-dùng)
14. [Khoảng cách so với stack dự kiến](#14-khoảng-cách-so-với-stack-dự-kiến)
15. [Phase 2 và Phase 3 — còn thiếu gì](#15-phase-2-và-phase-3--còn-thiếu-gì)

---

## 1. Ngôn ngữ và môi trường chạy

### TypeScript `5.7`

**Là gì:** JavaScript có thêm hệ thống kiểu tĩnh, biên dịch ra JavaScript thuần.
Kiểu chỉ tồn tại lúc biên dịch, không còn lại gì lúc chạy.

**Dùng cho:** 100% mã nguồn của nền tảng — mọi package, service và app. Không có
file JavaScript viết tay nào.

**Điểm mạnh:**

- Bắt lỗi trước khi chạy: gõ sai tên trường, thiếu xử lý `null`, gọi sai tham số.
- Gợi ý code và refactor an toàn trong IDE — đổi tên một trường thì cả repo báo
  chỗ hỏng.
- Kiểu như tài liệu luôn đúng, không bị lỗi thời như comment.
- Hệ sinh thái cực rộng, gần như thư viện lớn nào cũng có kiểu sẵn.

**Điểm yếu:**

- Kiểu bị xoá lúc biên dịch, nên **không bảo vệ được ở ranh giới runtime** —
  dữ liệu từ mạng, từ database, từ file đều có thể sai kiểu mà không ai biết.
- Ép kiểu (`as`) là cửa hậu: nó bảo trình biên dịch im lặng chứ không kiểm tra gì.
- Thời gian biên dịch chậm dần theo quy mô dự án.
- Kiểu nâng cao (generic lồng nhau, conditional types) khó đọc và đôi khi làm
  trình biên dịch bó tay.

### Node.js `>= 24` (đang chạy v25.2.1)

**Là gì:** môi trường chạy JavaScript phía máy chủ, dựng trên engine V8 của
Chrome.

**Dùng cho:** chạy API, runtime, và server render của web.

**Điểm mạnh:**

- Cùng ngôn ngữ cho cả backend lẫn frontend — dùng chung được kiểu, tiện ích,
  và cả người.
- I/O bất đồng bộ hiệu quả, hợp với hệ thống nhiều lời gọi mạng (như gọi AI).
- npm là kho thư viện lớn nhất thế giới.

**Điểm yếu:**

- Đơn luồng cho JavaScript — tác vụ nặng CPU sẽ chặn cả tiến trình.
- Hệ module đang ở giai đoạn chuyển tiếp giữa CommonJS và ESM, gây nhiều va chạm
  khi trộn thư viện cũ và mới.
- Không có kiểu lúc chạy, phụ thuộc hoàn toàn vào tầng validate của ứng dụng.

### Lưu ý khi làm nền tảng này

**Yêu cầu Node ≥ 24 là ràng buộc thật, không phải cho vui.** `packages/ai` biên
dịch ra CommonJS, còn Vercel AI SDK chỉ xuất bản ESM. Việc này chỉ chạy được nhờ
`require(ESM)` — ổn định từ Node 22.12 trở lên. Hạ ngưỡng xuống dưới mốc đó,
package sẽ **chết lúc nạp module chứ không phải lúc build**, nghĩa là lint,
typecheck và test đều xanh rồi mới sập khi khởi động.

**Ép kiểu ở ranh giới I/O phải coi là chưa được kiểm chứng.** Ví dụ có thật trong
repo: cột `plan` đọc từ `jsonb` được ép thành `ExecutionPlan`, nhưng các trường
`Date` bên trong thực chất là chuỗi. Hiện chưa chỗ nào đọc chúng nên chưa gây
lỗi, và đã ghi chú ngay tại chỗ ép kiểu.

---

## 2. Monorepo và công cụ phát triển

### pnpm `9.15`

**Là gì:** trình quản lý gói cho Node, thay thế npm/yarn. Lưu mỗi phiên bản gói
đúng một lần trên đĩa rồi liên kết cứng vào từng dự án.

**Dùng cho:** quản lý toàn bộ workspace — 17 package, service và app trong một
repo.

**Điểm mạnh:**

- Cài nhanh và tiết kiệm đĩa hơn npm/yarn rất nhiều.
- `workspace:*` giữ các package nội bộ luôn dùng đúng bản trong repo.
- Cây `node_modules` nghiêm ngặt, không cho dùng lén thư viện chưa khai báo.

**Điểm yếu:**

- Chính sự nghiêm ngặt đó làm một số công cụ cũ (giả định hoisting) chạy sai.
- Ít phổ biến hơn npm nên tài liệu và câu trả lời trên mạng ít hơn.

### Turborepo `2.3`

**Là gì:** công cụ điều phối build cho monorepo. Hiểu quan hệ phụ thuộc giữa các
package, chạy song song và cache kết quả.

**Dùng cho:** chạy `lint`, `typecheck`, `test`, `build` cho toàn repo bằng một
lệnh.

**Điểm mạnh:**

- Cache theo nội dung: không đổi gì thì chạy lại gần như tức thì.
- Tự sắp xếp thứ tự build theo đồ thị phụ thuộc.
- Cấu hình đơn giản, chỉ một file `turbo.json`.

**Điểm yếu:**

- Thêm một lớp gián tiếp — khi cache sai, việc gỡ rối khó hơn chạy tay.
- Cache chỉ chia sẻ được giữa máy khi có thiết lập remote cache riêng.

### ESLint `9.15` + typescript-eslint `8.15`

**Là gì:** công cụ phân tích tĩnh, phát hiện lỗi và áp đặt quy ước code.
`typescript-eslint` bổ sung các luật hiểu được kiểu.

**Dùng cho:** kiểm tra mọi file `.ts`/`.tsx`, chạy tự động lúc commit.

**Điểm mạnh:**

- Bắt được lớp lỗi mà trình biên dịch bỏ qua (biến thừa, `await` thiếu, so sánh
  vô nghĩa).
- Cấu hình được từng luật, từng thư mục.
- `--fix` sửa tự động phần lớn vi phạm.

**Điểm yếu:**

- Chậm trên repo lớn, nhất là các luật cần thông tin kiểu.
- `--fix` **sửa code thật**, nên một luật cấu hình sai có thể làm hỏng chương
  trình.

### Prettier `3.4` + Husky `9.1` + lint-staged `15.2`

**Là gì:** Prettier định dạng code theo một chuẩn duy nhất. Husky cài git hook.
lint-staged chỉ chạy công cụ trên file đã stage.

**Dùng cho:** tự động format và lint mỗi lần commit.

**Điểm mạnh:**

- Chấm dứt tranh luận về style, review chỉ còn tập trung vào logic.
- Chỉ chạy trên file thay đổi nên commit vẫn nhanh.

**Điểm yếu:**

- Prettier gần như không cấu hình được — phải chấp nhận lựa chọn của nó.
- Git hook chạy ngầm, nên khi nó sửa code thì dễ không nhận ra.

### tsx `4.19`

**Là gì:** trình chạy TypeScript trực tiếp, không cần build trước.

**Dùng cho:** chế độ dev (`tsx watch`) và các script kiểm chứng.

**Điểm mạnh:** khởi động nhanh, tự nạp lại khi sửa file, không cần bước biên dịch.

**Điểm yếu:** dùng esbuild bên dưới nên **không kiểm tra kiểu** — chạy được không
có nghĩa là typecheck qua.

### Lưu ý khi làm nền tảng này

**`eslint --fix` từng làm hỏng dependency injection của NestJS.** Luật
`consistent-type-imports` viết lại import thành `import type`, xoá mất metadata
`design:paramtypes` mà NestJS cần lúc chạy. Ứng dụng chết khi khởi động dù build
hoàn toàn xanh. Phải tắt luật đó ở **cả** config gốc lẫn config của package, vì
lint-staged chạy eslint từ thư mục gốc.

**Các package tiêu thụ nhau qua thư mục `dist`.** Sửa `packages/runtime` mà chưa
`build` thì `services/runtime` vẫn chạy code cũ, và `tsx watch` **không** phát
hiện thay đổi trong `dist` của package khác. Đã có lần mất thời gian truy tìm một
lỗi hoá ra chỉ là quên build.

---

## 3. Backend

### NestJS `10.4`

**Là gì:** framework backend cho Node, lấy cảm hứng từ Angular. Dùng decorator,
dependency injection và cấu trúc module.

**Dùng cho:** `services/api` — REST API, xác thực, phân quyền RBAC, giới hạn tần
suất, phong bì lỗi.

**Điểm mạnh:**

- Cấu trúc rõ ràng, quy ước thống nhất — nhiều người làm chung vẫn ra code giống
  nhau.
- Dependency injection giúp thay thế thành phần khi test mà không cần mock sâu.
- Guard, Interceptor, Filter cho phép áp dụng auth, phân trang, xử lý lỗi ở một
  chỗ thay vì lặp ở mọi controller.
- Hệ sinh thái module chính thức đầy đủ (config, jwt, throttler, swagger…).

**Điểm yếu:**

- Nhiều khuôn mẫu — một endpoint đơn giản cũng cần module, controller, service.
- Dựa vào decorator metadata phát ra lúc biên dịch, nên **nhạy cảm với công cụ
  build**.
- Đường cong học dốc nếu chưa quen mô hình DI.

### Express `5`

**Là gì:** framework HTTP tối giản, lâu đời nhất của Node.

**Dùng cho:** máy chủ HTTP nền bên dưới NestJS. Không gọi trực tiếp ở đâu.

**Điểm mạnh:** đơn giản, ổn định, hệ middleware khổng lồ.

**Điểm yếu:** quá tối giản — không có cấu trúc, dự án lớn dễ loạn nếu dùng trần.

### RxJS `7.8` + reflect-metadata `0.2`

**Là gì:** RxJS là thư viện lập trình phản ứng theo luồng dữ liệu.
`reflect-metadata` cho phép đọc metadata mà decorator ghi ra.

**Dùng cho:** cả hai là yêu cầu bắt buộc của NestJS. Interceptor dùng RxJS.

**Điểm mạnh:** RxJS mạnh khi xử lý luồng sự kiện bất đồng bộ phức tạp.

**Điểm yếu:** RxJS có đường cong học rất dốc và thường là quá mức cần thiết cho
API request/response thông thường.

### Lưu ý khi làm nền tảng này

**DI của NestJS đã hỏng hai lần vì công cụ, cả hai lần đều build xanh rồi chết
lúc chạy.** Lần một do `eslint --fix` (xem mục 2). Lần hai do esbuild bỏ
`emitDecoratorMetadata`, khiến test tích hợp nhận `undefined` ở mọi tham số
constructor — chữa bằng `unplugin-swc`.

Bài học chung: **bất cứ thứ gì biến đổi code trước khi chạy đều có thể phá DI**,
và triệu chứng luôn xuất hiện muộn.

---

## 4. Cơ sở dữ liệu

### PostgreSQL `17`

**Là gì:** hệ quản trị cơ sở dữ liệu quan hệ mã nguồn mở, mạnh và trưởng thành
bậc nhất.

**Dùng cho:** toàn bộ dữ liệu — người dùng, tổ chức, workspace, quyền, goal,
execution, task, nhật ký sự kiện, chi phí AI. Chạy trong Docker ở cổng **5433**.

**Điểm mạnh:**

- Giao dịch ACID thật, ràng buộc khoá ngoại thật — dữ liệu khó hỏng.
- Kiểu `jsonb` cho phép lưu dữ liệu linh hoạt mà vẫn truy vấn và đánh chỉ mục
  được, nên không cần thêm NoSQL riêng.
- `numeric` là số thập phân chính xác tuyệt đối — bắt buộc với tiền.
- Rất nhiều tính năng nâng cao: full-text search, window function, CTE, extension
  (pgvector, PostGIS…).
- Miễn phí, không khoá nhà cung cấp.

**Điểm yếu:**

- Mở rộng theo chiều ngang (sharding) khó hơn nhiều so với các CSDL phân tán.
- Cần tinh chỉnh cấu hình để đạt hiệu năng cao; mặc định khá bảo thủ.
- Mỗi kết nối là một tiến trình riêng, nên phải dùng connection pool.

### Drizzle ORM `0.38` + drizzle-kit `0.30`

**Là gì:** ORM cho TypeScript theo hướng "SQL vẫn nhìn thấy được". `drizzle-kit`
sinh file migration bằng cách so sánh schema.

**Dùng cho:** định nghĩa schema, viết truy vấn, sinh và chạy migration.

**Điểm mạnh:**

- Truy vấn viết ra gần giống SQL nên biết chính xác câu lệnh sẽ chạy — không có
  truy vấn ẩn gây chậm bất ngờ.
- Kiểu suy ra trực tiếp từ schema: đổi tên cột là lỗi biên dịch ngay.
- Rất nhẹ, gần như không có chi phí lúc chạy.
- Sinh migration tự động từ khác biệt schema.

**Điểm yếu:**

- Ít "phép màu" hơn Prisma — phân trang, compare-and-swap, ánh xạ row sang
  entity đều phải tự viết.
- Còn khá mới, hệ sinh thái và tài liệu chưa dày bằng Prisma hay TypeORM.
- Một số kiểu (nhất là `sql<T>` thô) chỉ là lời hứa, Drizzle không kiểm chứng.

### postgres `3.4`

**Là gì:** driver PostgreSQL cho Node, hiệu năng cao.

**Dùng cho:** lớp kết nối bên dưới Drizzle. Không gọi trực tiếp.

**Điểm mạnh:** nhanh, hỗ trợ prepared statement và pipelining.

**Điểm yếu:** API khác `node-postgres` (thư viện phổ biến hơn) nên ví dụ trên
mạng không phải lúc nào cũng áp dụng được.

### Lưu ý khi làm nền tảng này

**Đây là nơi xảy ra lỗi nặng nhất dự án.** `timestamptz` của Postgres lưu tới
**micro giây**, còn `Date` của JavaScript chỉ có **mili giây**. So sánh bằng một
timestamp đã đi vòng qua JS thì **không bao giờ khớp**.

Hệ quả: Goal đặt lịch im lặng không bao giờ chạy — không lỗi, không log, trong
khi 39 test tích hợp trên Postgres thật vẫn xanh. Cách chữa là claim theo điều
kiện "vẫn còn đến hạn" thay vì so bằng; xem
`packages/database/src/repositories/goal.repository.ts`.

**Cột `numeric` trả về chuỗi chứ không phải số.** Ban đầu thấy phiền nhưng đó
chính là thứ giữ cho tiền không trôi. Cột chi phí AI dùng `numeric(18,8)`, và mọi
phép cộng đều làm bằng SQL chứ không bằng JavaScript.

**`jsonb` không giữ được kiểu `Date`.** Ghi vào thành chuỗi ISO, đọc ra vẫn là
chuỗi — trong khi TypeScript vẫn tin đó là `Date`.

---

## 5. Hàng đợi và cache

### Redis `7`

**Là gì:** kho dữ liệu khoá–giá trị trong bộ nhớ, dùng làm cache, hàng đợi, khoá
phân tán, pub/sub.

**Dùng cho:** hàng đợi task, khoá phân tán cho scheduler, cache quyền truy cập.
Chạy trong Docker ở cổng **6380**.

**Điểm mạnh:**

- Cực nhanh vì nằm hoàn toàn trong RAM.
- Mọi lệnh đều nguyên tử; script Lua cho phép gộp nhiều thao tác thành một.
- Nhiều cấu trúc dữ liệu sẵn có: sorted set, list, hash, stream.
- Là lựa chọn mặc định cho hàng đợi và khoá phân tán, tài liệu rất nhiều.

**Điểm yếu:**

- Dữ liệu nằm trong RAM nên **đắt và giới hạn dung lượng**.
- Độ bền kém hơn CSDL thật — mất điện có thể mất vài giây dữ liệu gần nhất.
- Không có truy vấn phức tạp; muốn tìm gì phải tự thiết kế khoá.

### ioredis `5.4`

**Là gì:** client Redis cho Node, đầy đủ tính năng nhất.

**Dùng cho:** mọi giao tiếp với Redis, ở `packages/queue` và `services/api`.

**Điểm mạnh:** hỗ trợ cluster, sentinel, pipeline, script Lua; tự kết nối lại.

**Điểm yếu:** API khá rộng nên dễ dùng sai; kiểu TypeScript của một số lệnh chưa
chặt.

### Lưu ý khi làm nền tảng này

**Hàng đợi dùng sorted set chứ không dùng Redis Streams**, vì cần **giao việc có
độ trễ** (retry backoff, `notBefore`) mà Streams không hỗ trợ trực tiếp.

**Hàng đợi bảo đảm "ít nhất một lần", không phải "đúng một lần".** Máy xử lý chết
mà chưa ack thì việc quay lại hàng đợi sau khi hết hạn giữ chỗ. Mọi thứ tiêu thụ
hàng đợi phải chịu được việc nhận trùng.

**Khoá phân tán chỉ giảm tranh chấp, không bảo đảm đúng một lần.** Bảo đảm thật
nằm ở compare-and-swap trong database. Với nền tảng đăng bài, hai node cùng bắn
một lần hẹn nghĩa là **đăng hai lần**.

---

## 6. Tầng AI

### Vercel AI SDK — `ai@7`

**Là gì:** bộ thư viện chuẩn hoá việc gọi các mô hình ngôn ngữ, cho phép đổi nhà
cung cấp mà không sửa code gọi.

**Dùng cho:** toàn bộ lời gọi model, gói kín trong **một file duy nhất**
(`packages/ai/src/adapters/vercel-adapter.ts`).

**Điểm mạnh:**

- Một giao diện duy nhất cho nhiều nhà cung cấp.
- `generateObject` ép mô hình trả về đúng cấu trúc theo JSON Schema.
- Chuẩn hoá cách đếm token giữa các vendor, nên tính chi phí thống nhất.
- Hỗ trợ streaming, tool calling, ảnh.

**Điểm yếu:**

- Phát triển rất nhanh, breaking change nhiều giữa các bản chính.
- Chỉ xuất bản dạng ESM.
- Là một lớp trừu tượng, nên tính năng riêng của từng vendor bị che bớt hoặc
  chậm được hỗ trợ.

### Các adapter nhà cung cấp

| Gói                           | Nhà cung cấp                         | Trạng thái trong nền tảng                  |
| ----------------------------- | ------------------------------------ | ------------------------------------------ |
| `@ai-sdk/anthropic@4`         | Anthropic (Claude)                   | Đã tích hợp, chưa chạy thật (chưa có key)  |
| `@ai-sdk/openai@4`            | OpenAI (GPT)                         | Đã tích hợp, chưa chạy thật                |
| `@ai-sdk/google@4`            | Google (Gemini)                      | Đã tích hợp, chưa chạy thật                |
| `@ai-sdk/openai-compatible@3` | Ollama và các API tương thích OpenAI | **Đã chạy thật đầu-cuối** với `qwen2.5:7b` |

**Điểm mạnh của việc chạy nhiều nhà cung cấp:** không bị khoá vào một hãng; tự
chuyển sang nhà cung cấp khác khi một bên quá tải; chọn model theo chi phí.

**Điểm yếu:** mỗi hãng hỗ trợ JSON Schema, tool calling và streaming ở mức khác
nhau, nên "chạy được ở hãng này" không suy ra "chạy được ở hãng kia".

### Ollama (chạy cục bộ)

**Là gì:** phần mềm chạy mô hình ngôn ngữ ngay trên máy, có API tương thích
OpenAI.

**Dùng cho:** phát triển và kiểm chứng mà không tốn tiền, không cần API key.

**Điểm mạnh:** miễn phí, dữ liệu không rời khỏi máy, không giới hạn tần suất.

**Điểm yếu:** chất lượng thấp hơn hẳn model đám mây; tốn RAM và GPU; chậm.

### zod `3.25` + zod-to-json-schema `3.25`

**Là gì:** zod là thư viện khai báo và kiểm tra cấu trúc dữ liệu lúc chạy, suy ra
kiểu TypeScript từ chính khai báo đó. `zod-to-json-schema` chuyển khai báo zod
thành JSON Schema.

**Dùng cho:** kiểm tra body của mọi request HTTP, và định nghĩa cấu trúc đầu ra
bắt buộc cho mô hình AI.

**Điểm mạnh:**

- Một khai báo duy nhất sinh ra **cả** kiểu TypeScript **lẫn** hàm kiểm tra lúc
  chạy — hai thứ không thể lệch nhau.
- Thông báo lỗi chi tiết theo từng trường, trả thẳng cho client được.
- API dễ đọc, dễ ghép.

**Điểm yếu:**

- Kiểu suy ra rất phức tạp, làm chậm trình biên dịch trên schema lớn.
- Đang có sự chia rẽ giữa zod 3 và zod 4 trong hệ sinh thái.

**Chat tra tài liệu ở MỌI lượt, không phải khi "thấy cần".** Quyết định xem
câu hỏi có cần tài liệu hay không đòi hỏi thêm một lời gọi model — đắt hơn chính
lời gọi nhúng để đi tìm. Và quyết định sai thì **vô hình**: câu trả lời vẫn nghe
xuôi tai. Ngưỡng điểm là thứ giữ đoạn không liên quan ở ngoài, không phải một
bước phân loại.

**Trích đoạn phải kèm câu lệnh "nếu không trả lời được thì nói thẳng".** Đưa
model một đoạn văn không liên quan mà không có câu đó thì nó vẫn dùng.

**Nguồn gửi TRƯỚC token đầu tiên.** Người đọc thấy câu trả lời sắp dựa trên cái
gì, thay vì biết sau khi đã đọc xong. Và lưu vào metadata của tin nhắn, để bản
ghi đọc lại sau nhiều tháng vẫn biết câu đó dựa trên đâu.

**Hội thoại dài quên phần đầu một cách IM LẶNG nếu không làm gì.** Cắt cứng ở
N lượt gần nhất là cách hỏng tệ nhất: model đơn giản là không còn biết đoạn đầu,
đưa ra câu trả lời mâu thuẫn với thứ đã chốt mười lượt trước, và **không có chỗ
nào nói vì sao**. Nên các lượt rơi ra khỏi cửa sổ được gộp vào một đoạn tóm tắt
(`conversations.summary`), và tóm tắt đó được đưa vào prompt dưới dạng **system
message có nhãn**, không phải replay như lời người dùng — nếu không model sẽ
trích lại nó như thể người dùng vừa nói đúng câu đó.

**Tóm tắt chạy SAU khi đã trả lời xong, không phải trước.** Nó là một lời gọi
model nữa; đặt nó trên đường trả lời sẽ làm mọi lượt trong hội thoại dài chậm
đi thấy rõ, đổi lấy một lợi ích người đọc chỉ thấy ở lượt kế tiếp.

**CAS trên `summarisedCount`, không phải trên `version`.** `version` đổi mỗi khi
có tin nhắn, nên dùng nó sẽ làm việc tóm tắt thất bại mỗi khi có lượt mới rơi
vào đúng lúc — và không bao giờ thử lại được, vì lần sau đọc lại vẫn thấy tóm
tắt cũ rồi lại đua tiếp. `summarisedCount` chỉ đổi khi một bản tóm tắt thật sự
ghi xuống, đúng va chạm cần từ chối.

**SSE, không phải WebSocket, cho chat.** Luồng dữ liệu một chiều; SSE tự kết
nối lại, đi qua proxy được, và không cần nâng cấp giao thức. Nhưng client ở đây
dùng `fetch` chứ không dùng `EventSource`: `EventSource` không gửi được POST
body, không đặt được header `Authorization` hay workspace, và không huỷ được.
Đổi lại là mất tính năng tự kết nối lại của `EventSource` — **cố ý**: kết nối
lại giữa chừng nghĩa là gửi lại request và trả tiền cho câu trả lời thứ hai,
đúng lý do Gateway từ chối fallback giữa stream.

**Một lần đọc mạng KHÔNG phải là một sự kiện.** Một lần `reader.read()` có thể
mang nửa sự kiện, hoặc ba sự kiện rưỡi. Phải đệm phần dư và chỉ parse tới dấu
ngắt dòng trống cuối cùng; parse theo từng lần đọc sẽ **mất** phần nằm vắt qua
ranh giới — triệu chứng là chữ biến mất ở giữa những câu trả lời dài.

**`x-accel-buffering: no`.** Nginx mặc định đệm response nó proxy, giữ lại từng
chunk cho tới khi response kết thúc — làm câu trả lời streaming trông y hệt câu
trả lời không streaming.

**Không trả về từ handler, mà ghi thẳng vào response.** Interceptor bọc envelope
sẽ đệm cả câu trả lời rồi mới đưa ra một lượt, đúng thứ streaming sinh ra để
tránh. Và khi byte đầu tiên đã đi rồi thì lỗi không thể thành 500 được nữa — status
line đã gửi — nên lỗi đi dưới dạng sự kiện `error`.

**Chat chỉ được gọi tool CHỈ-ĐỌC, và điều đó cưỡng chế bằng code.** Đây là chỗ
đầu tiên model được phép **làm** thay vì **nói**, và hai kiểu sai không so sánh
được: câu trả lời sai thì sai và nhìn thấy được, còn hành động sai thì **đã xảy
ra rồi** lúc người ta đọc tới. Đường Goal có planner xem lại được, có kiểm tra
ngân sách, có cổng duyệt và có nhật ký; đường chat **không có cái nào**. Một tool
đăng bài đặt ở đây là đi vòng qua cả bốn. Cờ `readOnly` vừa là kiểu vừa là kiểm
tra lúc chạy — kiểu chỉ giữ được khi mọi thứ còn viết bằng TypeScript và có
người review.

**Vòng lặp tool phải có giới hạn cứng.** Model gọi tool, đọc kết quả, rồi gọi
lại chính tool đó là kiểu hỏng **thường gặp**, không hiếm. Mỗi vòng là một
request trả tiền, nên con số giới hạn chính là thứ đứng giữa một model bối rối
và một hoá đơn không đáy.

**Workspace lấy từ ngữ cảnh request, không bao giờ từ tham số của model.** Model
tự viết tham số; một id nó gọi được là một id nó đổi được. Schema của tool để
`additionalProperties: false` cũng vì lý do đó — schema mở là lời mời model bịa
thêm tham số, và thứ nó bịa dễ nhất là id.

**Ghi nhớ mà không xem được là loại đáng sợ.** Một sự kiện được nhớ sai sẽ định
hình **mọi** câu trả lời, và triệu chứng duy nhất là đầu ra âm thầm sai trong
một thời gian — không có chỗ nào để nhìn. Nên có màn hình xem và sửa, và cột
`source` phân biệt `MANUAL` với `LEARNED` ngay từ đầu dù hiện chỉ ghi `MANUAL`:
một sự kiện do model tự quyết định nhớ, không ai duyệt, là điều workspace chưa
bao giờ đồng ý mà lại chi phối mọi câu trả lời sau đó.

**Ghi nhớ là upsert theo khoá, không phải insert.** Hai câu trả lời cho một câu
hỏi ("giọng thương hiệu của chúng ta là gì") thì model sẽ chọn một, im lặng.
Và phải xoá `deletedAt` khi ghi đè: hàng đã xoá mềm vẫn giữ khoá unique, nên
không xoá cờ đó thì việc lưu **báo thành công mà không thay đổi gì** — loại
no-op tệ nhất.

**Ghi nhớ của workspace khác Semantic Memory.** Tài liệu nằm ở Qdrant và được
**tra theo từng câu hỏi**; ghi nhớ workspace đi kèm **mọi** request. Vì thế nó
phải có giới hạn số lượng — một workspace nhớ năm trăm điều sẽ tiêu hết cửa sổ
ngữ cảnh vào đó và không còn chỗ cho câu hỏi, mà triệu chứng lại trông như model
phớt lờ thứ được hỏi.

**Một chuỗi version chung cho mọi prompt là nói dối.** Sửa câu chữ của planner
mà đóng dấu version mới lên **cả** bản ghi intent thì ai so sánh chất lượng theo
version sẽ thấy một mốc chia nơi chẳng có gì thay đổi — và chỗ mốc đó quan trọng
nhất lại đúng là chỗ nó sai. Giờ mỗi prompt có version riêng.

**Nhãn đặt trên request thì KHÔNG tự đi tới bản ghi chi phí.** `usageRecordFrom`
dựng bản ghi từ **response**, nên `promptVersion` đặt trên request bị ghi rồi
rơi. Mọi dòng `ai_usage` nền tảng này từng ghi đều có `promptVersion` **rỗng** —
đúng cái trường làm cho việc đánh version prompt có ý nghĩa. Gateway giờ mang
nhãn của request sang response, và đặt **trước** metadata của adapter để người
gọi không giả mạo được số liệu Gateway tự đo (`attemptedProviders`, `attempt`).

**Thiếu biến khi render là lỗi, không phải chuỗi rỗng.** Prompt render ra
`Chủ đề: ` đọc như một chỉ dẫn hoàn chỉnh; model trả lời về không-gì-cả và kết
quả trông như model kém chứ không như một lỗi.

**OpenRouter: một key, vài trăm model, id mang tên vendor.** `anthropic/claude-sonnet-5`.
Nó nói giao thức OpenAI nên dùng chung client với Ollama — khác biệt nằm ở base
URL và ở chỗ id model có tiền tố. Không liệt kê model vào catalog: vài trăm cái,
và danh sách viết tay sẽ cũ trong một tuần.

**Giá OpenRouter tra ngược về vendor gốc bằng cách bỏ tiền tố.** Bảng giá đã có
`anthropic:claude-sonnet-5`, nên `anthropic/claude-sonnet-5` dùng lại chính nó.
Nói cho sòng phẳng: đó là **giá niêm yết của vendor**, không nhất thiết là số
OpenRouter thu — nó định tuyến tới host nào rảnh và lấy phần chênh trên credit
chứ không theo token. Đối chiếu với bảng giá OpenRouter công bố ngày 2026-07-28
thì `claude-opus-5` khớp chính xác. Id có tiền tố lạ vẫn trả về **chưa có giá**,
chứ không đoán bừa.

**OpenRouter KHÔNG có API nhúng** — catalog của nó không có model nhúng nào. Nên
nó nằm ngoài `DEFAULT_EMBEDDING_MODELS`, y như Anthropic, và Gateway tự bỏ qua.

**Streaming: fallback dừng ngay khi chunk đầu tiên rời khỏi Gateway.** Trước đó
chưa ai thấy gì nên đổi provider là vô hình và an toàn. Sau đó, thử lại nghĩa là
phát lại câu trả lời từ đầu **đè lên** phần người đọc đã thấy — hai nửa câu trả
lời dán vào nhau, và không có gì ở dưới phân biệt được. Nên hỏng giữa chừng là
hỏng, và lỗi ném ra mang theo phần đã sinh, vì nhà cung cấp **đã tính tiền**
những token đó dù câu trả lời không dùng được.

**Giao thức OpenAI chỉ báo token khi stream nếu request có
`stream_options: {include_usage: true}`.** Không có nó, **mọi** lời gọi stream
trả về usage bằng 0, mà 0 token thì tính ra 0 đồng. Lời gọi không stream không
bị ảnh hưởng, nên lỗi này vô hình cho tới khi có thứ gì đó thật sự stream: đo
trên cùng một model, `generate()` báo 38/25 token còn `stream()` báo 0/0.

**Đọc `result.stream`, không phải `result.textStream`.** `textStream` bỏ im
lặng tool call — người gọi yêu cầu một tool sẽ thấy model không nói gì rồi kết
thúc.

**Có seam `fetch` để test được thứ thật sự đi trên dây.** Vài lỗi ở tầng adapter
đều vô hình nếu chỉ nhìn từ trên: một schema bị SDK bỏ rơi, một cờ usage không
được gửi. Cách trung thực duy nhất để test là nhìn vào chính request body.

### Lưu ý khi làm nền tảng này

**AI SDK chỉ có ESM còn repo build ra CommonJS.** Chỉ chạy được nhờ
`require(ESM)` của Node ≥ 22.12 — đây là lý do `engines.node` phải giữ ở `>= 24`.

**Tham số schema generic của AI SDK không typecheck được với zod 3** (lỗi
`TS2589: Type instantiation is excessively deep`). Vì vậy bề mặt công khai của
Provider Gateway nhận **JSON Schema + một hàm `parse`** chứ không nhận zod. Việc
này hoá ra lại đúng về kiến trúc: không ép mọi bên dùng chung một thư viện
validate.

**Hệ sinh thái đang tách đôi giữa zod 3 và zod 4.** `ollama-ai-provider-v2` đòi
zod 4 nên không dùng được; phải đi qua `@ai-sdk/openai-compatible`.

**Ollama chết hẳn model runner khi JSON Schema có `maxLength` lớn** — 2000 chạy
được, 4000 thì sập. Nguyên nhân là giải mã có ràng buộc grammar phải biên dịch
cận đó thành grammar. Đã chữa bằng cách tỉa các keyword kích thước trước khi gửi
cho Ollama, còn việc ép đúng cấu trúc vẫn do hàm `parse` đảm nhận.

**Đầu ra có cấu trúc là gợi ý, không phải bảo đảm.** Mọi câu trả lời từ mô hình
đều được kiểm tra lại khi nhận về, kể cả khi đã gửi schema đi.

---

## 7. Tri thức và tìm kiếm ngữ nghĩa

### Qdrant `1.18` + `@qdrant/js-client-rest` `1.18`

**Là gì.** Qdrant là một _vector database_ viết bằng Rust: thay vì lưu hàng và
cột rồi tìm theo điều kiện bằng nhau, nó lưu **vector** — một dãy số biểu diễn
ý nghĩa của đoạn văn — và tìm theo **độ gần** giữa các vector. Câu hỏi "cà phê
trồng ở đâu" tìm ra đoạn viết "Đắk Lắk là tỉnh có sản lượng lớn nhất" dù không
có một từ nào trùng nhau. `@qdrant/js-client-rest` là client chính thức cho
Node/TypeScript, gọi qua REST.

**Dùng cho.** Lưu các đoạn (_chunk_) đã cắt từ tài liệu của workspace, kèm
vector và metadata, rồi trả về những đoạn liên quan nhất tới một câu hỏi. Đây
là nền của RAG (Retrieval-Augmented Generation) — cho model đọc tài liệu thật
của người dùng thay vì bịa.

**Điểm mạnh.**

- **Lọc và tìm cùng lúc.** Điều kiện lọc (`workspaceId = ...`) được đưa _vào
  trong_ phép tìm láng giềng gần nhất, không phải lọc sau. Đây là khác biệt rất
  lớn với các thư viện chỉ biết tìm vector rồi để ứng dụng tự lọc.
- **Chỉ mục HNSW**, tìm gần đúng nhưng nhanh gần như tuyến tính theo log số
  điểm — hàng triệu vector vẫn trả lời trong vài mili giây.
- Chạy một container duy nhất, không cần cụm, không cần phụ thuộc ngoài.
- Payload là JSON tự do, nên metadata phục vụ trích dẫn (tên tài liệu, vị trí
  ký tự) nằm ngay cạnh vector.

**Điểm yếu.**

- **Tìm gần đúng, không chính xác tuyệt đối.** HNSW có thể bỏ sót láng giềng
  thật; đổi lại tốc độ. Với dữ liệu nhỏ thì gần như không thấy, nhưng nó là
  đánh đổi có thật.
- Một collection **cố định số chiều** ngay lúc tạo. Đổi model nhúng là phải tạo
  collection mới và lập chỉ mục lại toàn bộ.
- Không có transaction xuyên collection, không join. Nó là nơi để _tìm_, không
  phải nơi để làm nguồn sự thật — nguồn sự thật vẫn là PostgreSQL.
- Client TypeScript khai báo kiểu **rộng hơn** thứ server thật sự chấp nhận,
  nên nhiều lỗi chỉ lộ lúc chạy (xem Lưu ý).

### Embedding models

**Là gì.** Model nhúng biến một đoạn văn thành vector. Khác model sinh chữ ở
chỗ nó không viết gì cả — đầu ra chỉ là một dãy số, và hai đoạn văn có ý nghĩa
gần nhau thì hai vector gần nhau.

**Dùng cho.** Cả hai đầu của việc tìm kiếm: nhúng từng chunk lúc lập chỉ mục, và
nhúng câu hỏi lúc tìm.

| Nhà cung cấp | Model mặc định           | Số chiều |
| ------------ | ------------------------ | -------- |
| OpenAI       | `text-embedding-3-small` | 1536     |
| Google       | `text-embedding-004`     | 768      |
| Ollama       | `nomic-embed-text`       | 768      |
| Anthropic    | _không có_               | —        |

**Điểm mạnh.** Rẻ hơn model sinh chữ khoảng hai bậc; chạy được cục bộ qua
Ollama nên không tốn tiền và không gửi tài liệu ra ngoài.

**Điểm yếu.** Mỗi model là một hệ toạ độ riêng — vector của hai model **không
so sánh được với nhau**, và không có cách nào phát hiện lúc truy vấn. Chất
lượng phụ thuộc nhiều vào ngôn ngữ: các model trên đều mạnh nhất ở tiếng Anh.

### Lưu ý khi làm nền tảng này

**Anthropic không có API nhúng.** Nên `embed` trên `ProviderAdapter` là
**optional**, và Gateway _bỏ qua_ nhà cung cấp không nhúng được thay vì làm hỏng
cả chuỗi. Chuỗi `anthropic,openai` vẫn ưu tiên Anthropic để sinh chữ nhưng lặng
lẽ dùng OpenAI để nhúng.

**Lấy method ra khỏi object là mất `this`.** Gateway rút `adapter.embed` ra để
lọc trước, và adapter thật là class có đọc `this` — trong khi stub dùng arrow
function nên _không_ lộ lỗi. Phải `.bind(adapter)`. Đã viết một test riêng với
adapter dạng class chỉ để giữ điều này.

**Một collection thuộc về đúng một model nhúng.** Trộn vector của hai model cho
ra điểm số _trông có vẻ hợp lý_ nhưng vô nghĩa — hỏng kiểu tệ nhất, vì không có
gì báo lỗi. Tên collection vì thế nhúng cả digest của tên model: `meta-llama/Llama-3`
(OpenRouter) và `qwen3:0.6b` (Ollama) đều biến thành cùng một chuỗi sau khi thay
ký tự không hợp lệ bằng `_`.

**Qdrant chỉ nhận số nguyên hoặc UUID làm point ID**, nhưng kiểu TypeScript của
client ghi là `number | string`. Nên `chk_01HX…` **biên dịch xanh** rồi chết ở
server với lỗi 400 không nhắc gì tới chunk hay ID. Phải ánh xạ ID sang UUID tất
định (sha256), và giữ ID thật trong payload.

**`timeout` lúc khởi tạo client là mili giây**, dù JSDoc của chính nó ghi
"Default 300 seconds"; còn `timeout` theo từng request thì lại **là giây** thật.
Truyền `30` với ý "30 giây" làm mọi lời gọi bị huỷ sau 30ms, và triệu chứng là
"timeout kết nối" tới một server trả lời tức thì.

**Overlap phải tính theo chunk thực tế, không theo `size` yêu cầu.** Hai số này
lệch nhau mỗi khi ranh giới câu rơi sớm trong cửa sổ: `size` 100 mà câu kết thúc
ở ký tự 57, overlap 50 thì con trỏ chỉ tiến 7 — một trang giấy thành hàng trăm
chunk gần như trùng nhau, tốn hàng trăm lời gọi nhúng và tìm kiếm trả về cùng
một câu chục lần.

**Lọc theo workspace phải nằm _trong_ truy vấn.** Lấy top-k trước rồi lọc sau
sẽ âm thầm trả về ít kết quả hơn số đã yêu cầu mỗi khi tenant khác xếp hạng cao
hơn — và chính sự thiếu hụt đó là bằng chứng duy nhất cho thấy dữ liệu của
tenant khác đã từng được đem ra cân nhắc. `SearchQuery.workspaceId` để **bắt
buộc**, không optional, để bỏ sót nó là lỗi biên dịch.

**Xoá tài liệu phải quét mọi collection.** Workspace từng lập chỉ mục lại bằng
model khác vẫn còn chunk ở collection cũ — tìm kiếm không thấy, nhưng dữ liệu
vẫn nằm đó. "Xoá tài liệu của tôi" phải chạm cả bản không ai tìm thấy được.

**Truy xuất xong mà không dùng thì không phải RAG.** `knowledge.search` trả về
trích đoạn, nhưng `content.generate` phải thật sự nhét trích đoạn đó vào prompt
và nói rõ đó là nguồn có thẩm quyền. Lần chạy đầu tiên bước tìm kiếm chạy đúng,
tìm ra đúng đoạn, rồi bài viết vẫn được viết từ trí tưởng tượng của model —
nửa đắt tiền của RAG đã trả, nửa hữu ích thì bỏ. Đầu ra trông tự tin y hệt nhau
trong cả hai trường hợp, nên phải có cờ `usedKnowledge` để phân biệt được.

**Bảo đảm cấu trúc cho thứ tự bước, dù model vẫn đang làm đúng.** Planner là
một model, và không có gì ngăn nó trả về kế hoạch mà bước đăng không phụ thuộc
bước viết. Kế hoạch đó vẫn **chạy**: các bước chạy song song, bước đăng nổ khi
chưa có gì để đăng, và lần chạy báo COMPLETED — không có lỗi nào để mà nhìn
thấy. Vì vậy có bảng producer→consumer ở `data-flow.ts`: nó sắp xếp lại các bước
và thêm phụ thuộc còn thiếu sau khi model trả lời. Nói cho sòng phẳng: trong mọi
lần chạy đã quan sát, model **tự làm đúng** và bảng này không đổi gì cả. Số cạnh
phải thêm được ghi vào metadata của plan, nên nếu nó khác 0 thì biết ngay.

**Biến môi trường khai báo nhưng để trống KHÔNG phải là chưa đặt.** File `.env`
hay viết `AI_MODEL=` để cho thấy biến đó tồn tại; nó tới tiến trình dưới dạng
chuỗi rỗng, mà `??` không bắt được. `env.AI_MODEL ?? DEFAULT` cho ra `""`, request
đi ra không có model, và vendor trả về "model is required" — đọc như lỗi của
gateway chứ không phải lỗi cấu hình.

**Model nhúng phải là biến riêng.** `AI_MODEL` là model sinh chữ; bắt nó nhúng
sẽ lỗi thẳng. Vì vậy có `AI_EMBEDDING_MODEL` tách bạch.

**`wait: true` khi ghi.** Không có nó, Qdrant xác nhận trước khi dữ liệu tìm
được, nên lập chỉ mục xong tìm ngay sẽ ra rỗng — trông hệt như lỗi cắt chunk.
Nói thẳng: bộ test tích hợp **không chứng minh được** điều này, vì Qdrant một
node cỡ nhỏ thì ghi xong là thấy ngay. Nó ở đó dựa trên tài liệu chính thức.

---

## 8. Lưu trữ file

### MinIO + `@aws-sdk/client-s3` `3.7` + `@aws-sdk/s3-request-presigner`

**Là gì.** S3 là giao thức lưu trữ đối tượng của AWS — không phải file system,
mà là một kho khoá–giá trị khổng lồ: mỗi file là một _object_ có khoá, nội dung
và metadata, không có thư mục thật (dấu `/` trong khoá chỉ là quy ước). MinIO là
một server mã nguồn mở nói đúng giao thức đó, chạy được trên máy mình.
`@aws-sdk/client-s3` là client chính thức, và `s3-request-presigner` ký sẵn một
URL có hạn dùng để trình duyệt tải thẳng.

**Dùng cho.** Lưu file người dùng tải lên (tài liệu, ảnh, video). Metadata thì
nằm ở PostgreSQL — bảng `documents` — còn bytes nằm ở đây.

**Điểm mạnh.**

- **Một giao thức, nhiều nhà cung cấp.** Cùng đoạn mã chạy với MinIO lúc dev,
  AWS S3, Cloudflare R2 hay Backblaze B2 lúc chạy thật. Chỉ đổi cấu hình.
- **Presigned URL.** Trình duyệt tải trực tiếp từ storage, không đi qua API —
  một video 200 MB không chiếm giữ tiến trình Node suốt thời gian tải.
- Rẻ hơn nhiều so với lưu trên ổ đĩa của server ứng dụng, và không mất khi
  container bị thay.
- MinIO chạy một container, có sẵn giao diện web để xem file.

**Điểm yếu.**

- **Không phải file system.** Không có "đổi tên", không có "di chuyển thư mục" —
  chỉ có copy rồi xoá. Liệt kê theo tiền tố thì được, nhưng đắt khi nhiều object.
- **Nhất quán cuối cùng ở vài thao tác.** S3 hiện đã strong-consistency cho
  đọc-sau-ghi, nhưng liệt kê và một số thao tác vẫn có độ trễ.
- SDK của AWS **rất nặng** — cây phụ thuộc lớn, và các kiểu TypeScript sinh tự
  động từ OpenAPI nên rộng hơn thứ server thật sự chấp nhận.
- Không có transaction. Ghi file và ghi row database không thể cùng thành công
  hoặc cùng thất bại; phải tự chọn thứ tự sao cho hỏng giữa chừng vẫn sửa được.

### Multer (qua `@nestjs/platform-express`)

**Là gì.** Middleware xử lý `multipart/form-data` — định dạng trình duyệt dùng
khi gửi form có file. Nó tách phần file ra khỏi phần text và đưa cho ứng dụng.

**Dùng cho.** Nhận file ở endpoint `POST /documents`.

**Điểm mạnh.** Chặn được kích thước **giữa chừng luồng**, tức là từ chối trước
khi đọc hết bytes — đó mới là mục đích của giới hạn dung lượng. Tích hợp sẵn
trong NestJS qua `FileInterceptor`.

**Điểm yếu.** Chỉ hiểu multipart, không hiểu upload theo chunk hay resume. Chế
độ memory giữ nguyên file trong RAM nên không hợp với file rất lớn.

### Lưu ý khi làm nền tảng này

**SigV4 ký từng byte của header, nên tên file tiếng Việt làm hỏng chữ ký.**
Đưa thẳng `báo cáo.txt` vào `Content-Disposition` thì **mọi** upload chết với
`SignatureDoesNotMatch` — một lỗi không nhắc gì tới header lẫn tên file. RFC
6266 đã có lời giải: một `filename` thuần ASCII cho client cũ, cộng thêm
`filename*=UTF-8''<đã percent-encode>` mang tên thật.

**Multer giải mã tên file trong multipart bằng latin1.** Nên tên tiếng Việt tới
nơi đã bị méo _trước cả_ khi chạm vào header S3. Phải đọc lại đúng đám byte đó
dưới dạng UTF-8: `Buffer.from(file.originalname, "latin1").toString("utf8")`.

**`forcePathStyle: true` là bắt buộc với MinIO trên localhost.** Kiểu địa chỉ
mặc định của S3 đặt tên bucket vào hostname, tức là phân giải `bucket.localhost`
— thứ không tồn tại.

**Khoá phải do hệ thống dựng, không được nhận từ người gọi.** Người gọi truyền
thư mục và tên; workspace luôn được ghép ở đầu. Đó là khác biệt giữa một tên
`../../documents/<tenant khác>/doc` trỏ tới file của người khác và trỏ tới một
file tên `.._.._documents_...`.

**Presigned URL là một loại chứng chỉ mang theo (bearer credential).** Ai cầm
được là đọc được, nên nó phải hết hạn, và cách duy nhất chứng minh nó hoạt động
là fetch nó mà **không** kèm thông tin xác thực nào.

**Ghi bytes trước, ghi row sau — và đặt tên object theo checksum.** Nhờ vậy thao
tác ghi là bất biến theo nội dung: hỏng ở bước insert rồi thử lại sẽ rơi đúng
vào object cũ, thay vì để lại một bản sao không ai đi tìm.

**Xoá thì ngược lại: row trước, bytes sau.** Nếu xoá bytes hỏng thì tài liệu đã
vô hình và object chỉ là rác chờ dọn; thứ tự ngược lại để lại một tài liệu vẫn
nhìn thấy được nhưng file đã biến mất.

---

## 9. Xác thực và bảo mật

### argon2 `0.41`

**Là gì:** thuật toán băm mật khẩu thắng giải Password Hashing Competition 2015.
Biến thể dùng ở đây là argon2id.

**Dùng cho:** băm mật khẩu người dùng.

**Điểm mạnh:**

- Tốn **bộ nhớ** chứ không chỉ tốn CPU, nên chống được tấn công bằng GPU và ASIC
  tốt hơn bcrypt.
- Điều chỉnh được ba tham số độc lập: bộ nhớ, thời gian, số luồng.
- Là khuyến nghị hiện hành của OWASP.

**Điểm yếu:**

- Là native module, cần biên dịch lúc cài — có thể vướng ở môi trường CI hoặc
  Docker gọn nhẹ.
- Tốn tài nguyên máy chủ hơn bcrypt, phải cân nhắc khi đăng nhập nhiều.

### @nestjs/jwt `10.2` + passport `0.7` + passport-jwt `4.0`

**Là gì:** JWT là chuẩn token tự chứa thông tin, có chữ ký. Passport là framework
xác thực với nhiều chiến lược cắm thêm được.

**Dùng cho:** ký và xác minh access token; tích hợp xác thực vào guard của
NestJS.

**Điểm mạnh:**

- JWT không cần tra database mỗi request — chỉ cần xác minh chữ ký.
- Passport có sẵn hàng trăm chiến lược (Google, Facebook, SAML…), mở rộng dễ.

**Điểm yếu:**

- **JWT không thu hồi được** trước khi hết hạn, trừ khi có thêm danh sách chặn.
- Token càng chứa nhiều thông tin thì càng lớn và càng dễ lỗi thời.
- Passport có API khá cổ, dựa nhiều vào callback.

### ulid `2.3`

**Là gì:** định danh 26 ký tự, sắp xếp được theo thời gian, thay cho UUID.

**Dùng cho:** sinh mọi ID trong hệ thống, có gắn tiền tố theo loại (`gol_`,
`exe_`, `tsk_`, `usr_`…).

**Điểm mạnh:**

- Sắp xếp theo thời gian: `ORDER BY id DESC` chính là mới nhất trước, không cần
  cột thời gian riêng để phân trang.
- Thân thiện với chỉ mục database hơn UUID v4 ngẫu nhiên.
- An toàn khi đưa vào URL, không có ký tự dễ nhầm.

**Điểm yếu:**

- Có lộ thời điểm tạo — không dùng được ở nơi cần bí mật hoàn toàn.
- Ít phổ biến hơn UUID nên một số công cụ chưa nhận diện.

### Lưu ý khi làm nền tảng này

**Refresh token dùng một lần và có xoay vòng.** Trình bày lại một token đã dùng
được coi là dấu hiệu bị trộm và **cả phiên bị huỷ**. Vì vậy client SDK phải gộp
việc refresh thành đúng một lần — hai lời gọi refresh đua nhau sẽ **đăng xuất
người dùng**.

**argon2 từ chối `timeCost < 2`**, nên việc hạ chi phí cho CI có giới hạn. Ngoài
ra `needsRehash` không so sánh trường `type`, phải tự xử lý.

**Quyền mặc định là từ chối.** Guard chặn mọi route trừ khi khai báo tường minh,
và có một test tự quét toàn bộ route để không ai thêm endpoint mà quên khai
quyền.

**Không tiết lộ sự tồn tại của tài nguyên.** Truy cập tài nguyên của workspace
khác trả về 404 chứ không phải 403 — nếu trả 403 thì chính nó đã xác nhận tài
nguyên có tồn tại.

### Kho bí mật (`@repo/secrets`)

| Thành phần | Chọn gì                                                               | Vì sao                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thuật toán | AES-256-GCM qua `node:crypto`                                         | GCM vừa mã hoá vừa xác thực: ciphertext bị sửa trong CSDL sẽ **không giải mã được**, thay vì giải ra một giá trị khác. Với bảng chứa API key thì trả về byte đã bị sửa nguy hiểm hơn là trả về lỗi |
| Thư viện   | Không thêm gì                                                         | `node:crypto` đủ. Một thư viện mã hoá là thứ phải tin tuyệt đối; ít bề mặt hơn thì tốt hơn                                                                                                         |
| Xoay khoá  | Keyring nhiều khoá, `keyId` đi kèm từng ciphertext                    | Xoay khoá không phải là một cuộc di trú phải thành công trọn vẹn — giá trị cũ vẫn nói rõ khoá nào mở được nó                                                                                       |
| Lưu        | Hai bảng: `secrets` (metadata) và `secret_versions` (giá trị đã niêm) | Giá trị **vắng mặt về mặt cấu trúc** khỏi metadata, không phải chỉ vắng theo quy ước. Tài liệu nói thẳng: "Giá trị Secret không bao giờ xuất hiện trong Metadata"                                  |
| Đọc ra     | Không có route nào trả về giá trị                                     | Ghi vào rồi dùng từ bên trong. Có đường đọc ngược ra là mọi credential chỉ cách một lỗi phân quyền                                                                                                 |

**Ghi phiên bản mới thay vì ghi đè.** Một credential bị thay ở đây vẫn còn đang
bay ở nơi khác một lúc nữa. Giữ được bản trước là cái biến một lần xoay khoá
hỏng thành _rollback_, chứ không thành sự cố.

**Gateway đọc key riêng của từng workspace.** Đây là điều FR-031 yêu cầu và là
lý do kho bí mật tồn tại: workspace mang key của mình, tiêu quota của mình, bị
giới hạn tốc độ trên tài khoản của mình. Không có key riêng thì rơi về key của
nền tảng — bỏ đường lui đó nghĩa là bắt người dùng phải mua credential trước khi
được thử sản phẩm.

Kết quả giải được **cache trong tiến trình**, có hạn dùng 60 giây và bị xoá ngay
khi key thay đổi. Giới hạn nói thẳng: xoá cache là chuyện trong một tiến trình,
nên khi chạy nhiều instance API thì key bị thu hồi ở instance này vẫn sống ở
instance kia — **hạn dùng 60 giây mới là thứ chặn cửa sổ đó**, không phải việc
xoá cache.

### Kết nối mạng xã hội (`@repo/connectors`)

| Thành phần      | Chọn gì                                                      | Vì sao                                                                                                                                  |
| --------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Luồng           | OAuth2 authorization code, PKCE khi nền tảng hỗ trợ          | Người dùng gõ mật khẩu vào đúng trang sở hữu nó, thấy rõ đang cấp gì, và thu hồi được từ cài đặt của nền tảng mà không cần quay lại đây |
| `state`         | Sinh ngẫu nhiên, lưu ở Redis, **dùng một lần** bằng `GETDEL` | `state` đọc được hai lần là mã đổi token replay được. `GETDEL` chứ không get-rồi-delete vì hai callback về cùng lúc sẽ cùng tìm thấy nó |
| Workspace       | **Không bao giờ nằm trong URL**                              | Ai cũng gọi được callback. Nếu workspace đi trong redirect thì ai cũng gắn được tài khoản vào workspace mình chọn                       |
| So sánh `state` | `timingSafeEqual`, kiểm tra độ dài trước                     | `state` là giá trị do người gọi callback nộp lên, tức là do bất kỳ ai                                                                   |
| Token           | Niêm vào kho bí mật, bảng chỉ giữ tham chiếu                 | Cùng lý do với `Secret`: một dòng log serialize kết nối không được phép mang theo credential cho khán giả của ai đó                     |
| Scope           | Ghi lại **cái được cấp**, không phải cái đã xin              | Nền tảng có thể cấp ít hơn, và chênh lệch đó chính là thứ workspace thật sự làm được                                                    |
| Endpoint        | Cho phép ghi đè bằng biến môi trường; **scope thì không**    | Nhà cung cấp đánh phiên bản API và có host sandbox. Nhưng nới quyền tác động lên khán giả phải là thay đổi mã nguồn có người xem        |

**Callback chạy không xác thực, và buộc phải thế.** Trình duyệt quay về từ
Facebook không mang theo token nào của mình. Toàn bộ thẩm quyền nằm ở chỗ
`state` tra ra được một bản ghi do chính server này viết — nên bản ghi đó chỉ
dùng một lần, và `state` lạ bị từ chối thẳng chứ không được coi là luồng mới.

**Ba nền tảng, không phải mười.** `docs/ROADMAP.md` Phase 3 liệt kê mười.
Facebook, TikTok, Threads đã có; bảy cái còn lại **vắng mặt chứ không phải
stub** — một nền tảng hiện trong danh sách mà không kết nối được là thứ tệ hơn
danh sách ngắn, vì người dùng chỉ phát hiện ra sau khi đã cấp quyền.

### Đăng bài

Đây là thứ đầu tiên trong hệ thống chạm tới khán giả thật, và là thứ duy nhất
mà chạy lại **không sửa được sai lầm**. Nên nó từ chối nhiều hơn là chấp nhận.

| Tình huống                                         | Làm gì                                                              | Vì sao                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chưa bật `SOCIAL_PUBLISH_LIVE`                     | Chạy bản diễn tập, nói thẳng `published: false`                     | Bật lên là mọi Goal đã có sẵn — kể cả lịch tự chạy không ai ngồi xem — bắt đầu đăng ra ngoài từ lần chạy kế tiếp. Đó không phải thay đổi ai đó đồng ý khi bấm deploy                                                                                                                                                                    |
| Lịch tự chạy, chưa bật `SOCIAL_PUBLISH_UNATTENDED` | **Dừng**, bảo người dùng chạy tay                                   | Đã xảy ra thật trên máy phát triển: bật đăng thật xong, một Goal theo lịch đăng bài marketing lên Page thật vài phút sau, không ai ngồi xem. Nó **không** đỗ lại chờ duyệt — duyệt một task đang WAITING chuyển thẳng sang SUCCESS mà **không chạy lại handler**, nên người bấm duyệt sẽ thấy COMPLETED trong khi chẳng có bài nào đăng |
| Nối một kênh, không nói kênh nào                   | Đăng lên kênh đó                                                    | Không có gì mơ hồ                                                                                                                                                                                                                                                                                                                       |
| Nối nhiều kênh, không nói kênh nào                 | **Dừng**, liệt kê các kênh đang nối                                 | "Đăng bài đi" là câu thiếu tân ngữ. Tự chọn là nền tảng chọn khán giả thay người dùng, và không có nút hoàn tác                                                                                                                                                                                                                         |
| Gọi tên kênh không có                              | **Dừng**                                                            | Kế hoạch dựa trên giả định sai; đăng sang chỗ khác không phải cách sửa                                                                                                                                                                                                                                                                  |
| Nền tảng trả 200 nhưng không có id bài             | **Coi là thất bại**                                                 | Không sửa, không xoá, không dẫn link được. Báo thành công là khẳng định code này không chứng minh nổi                                                                                                                                                                                                                                   |
| Mạng đứt sau khi gửi bài, engine thử lại           | Đọc feed tìm bài trùng **trước** khi đăng lại; thấy thì nhận bài cũ | Facebook không có khoá idempotency cho bài đăng, nên cách duy nhất phân biệt "chưa tới" với "tới rồi mất câu trả lời" là đi xem. Không có bước này thì một lần mạng đứt biến một bài thành hai trên trang thật, không có nút hoàn tác                                                                                                   |
| Feed có bài giống nhưng không **giống hệt**        | Vẫn đăng                                                            | Hai bài khác nhau dù chỉ một chữ là hai bài. So khớp lỏng sẽ âm thầm nuốt mất một bài thật — kiểu hỏng không ai phát hiện, vì triệu chứng là một bài đơn giản không tồn tại                                                                                                                                                             |
| Token đã bị gỡ                                     | Dừng ở lần đăng kế tiếp                                             | Token đọc lại mỗi lần đăng, không giữ trong bộ nhớ — đó là khác biệt giữa _thu hồi_ và _xin phép lịch sự_                                                                                                                                                                                                                               |
| Nền tảng từ chối token (Graph code 190)            | Đánh dấu kết nối là `EXPIRED`, hoặc `REVOKED` nếu quyền bị rút      | Trước đó cột `status` có ba giá trị mà **chưa chỗ nào ghi** `EXPIRED` — một enum không bao giờ được đặt trông như ràng buộc hệ thống có thực thi, tệ hơn là không có. Việc đánh dấu là _best-effort_: không được biến một lỗi đăng bài người dùng xử lý được thành một lỗi khác về sổ sách                                              |
| Lỗi của chính bài đăng (code khác 190)             | **Không đụng** tới kết nối                                          | Ngắt một Page đang chạy tốt vì một bài sai định dạng là hỏng nặng hơn cái đang báo                                                                                                                                                                                                                                                      |

Đăng lần lượt từng kênh chứ không song song: hỏng giữa chừng mà chạy song song
thì không biết kênh nào đã đăng, và lần thử lại sẽ đăng trùng.

### Chat đọc được kênh mạng xã hội

Hai tool chỉ-đọc nữa: `xem_hop_thu` và `so_lieu_bai_dang`. Người dùng hỏi "có ai
nhắn gì không?" bằng tiếng Việt, model tự gọi tool, trả lời bằng dữ liệu thật.
Đã kiểm chứng trọn vòng qua stack đang chạy với Page thật.

| Quyết định                                 | Vì sao                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Không có tool nào **trả lời** khách        | Cùng lý do không có tool đăng bài: đường chat không có cổng duyệt, không có hạn mức, không có idempotency, không có vết kiểm toán |
| Chưa nối kênh nào thì **không chào tool**  | Một tool được chào mà gọi lần nào cũng hỏng sẽ dạy model thôi gọi — và nó thôi gọi cho cả những workspace lẽ ra dùng được         |
| Trả về `khong_doc_duoc` kèm danh sách kênh | Để model nói "có một kênh tôi không đọc được" thay vì trả lời như thể kênh đó không có tin nào                                    |
| **Không** trả lượt tiếp cận dưới dạng 0    | Model nhận một cột toàn số 0 sẽ kết luận không ai xem bài và nói ra — một khẳng định dữ liệu không chống đỡ nổi                   |

Test "mọi tool đều lấy workspace từ context" trước đây dùng `every`, nên một
tool **không gọi gì cả** vẫn lọt qua. Giờ nó đếm: đúng một lượt đọc cho mỗi
tool. Kiểm chứng ngược bằng cách cho tool đọc workspace cố định — đỏ ngay.

### Đặc tả OpenAPI (`@nestjs/swagger` 11.4, `zod-to-json-schema` 3.25)

`GET /docs` **chỉ ở môi trường phát triển**. Tài liệu này mô tả mọi route và
mọi body nền tảng chấp nhận — một tấm bản đồ đáng có, nhưng không phải thứ đem
phát.

**Request body sinh từ chính schema zod đang validate.** Codebase dùng zod chứ
không dùng class DTO, mà Nest suy ra từ class — nên nếu để mặc, đặc tả sẽ ghi
mọi endpoint ghi dữ liệu là **body rỗng**. Một đặc tả bỏ sót thứ người gọi phải
gửi còn tệ hơn không có, vì người gọi tin nó rồi nhận 422 mà không hiểu vì sao.
Suy ra từ schema cũng khiến hai bên **không thể lệch nhau**: sửa validate là đặc
tả đổi theo, trong cùng một commit, hoặc không đổi gì cả.

`openapi.json` được **commit vào repo**, và có test so bản sinh ra với bản trong
repo. Một tài liệu sinh theo yêu cầu mà không ai đối chiếu là tài liệu sẽ trôi,
và cái trôi đó hiện ra dưới dạng người dùng làm theo hướng dẫn đã hết đúng.
Commit nó biến mỗi lần đổi bề mặt API thành một diff có người đọc lúc review.
Sinh lại bằng `pnpm --filter @repo/api openapi:write`.

**Script chạy từ bản build, không qua `tsx`.** `tsx` không phát
`design:paramtypes`, nên Nest tiêm `undefined` vào mọi constructor và lỗi hiện
ra ở tận đâu — dưới dạng đọc thuộc tính của một giá trị không tồn tại. Đây đúng
là lý do `vitest.int.config.ts` phải dùng SWC. Mất gần một giờ mới thấy, vì
`NestFactory` mặc định `abortOnError: true` gọi thẳng `process.exit(1)` và
`logger: false` nuốt luôn thông báo — script hỏng mà **không in ra chữ nào**.

### Metrics (`@repo/observability`, `prom-client` 15.1)

`GET /metrics` ở dạng exposition Prometheus, **nằm ngoài tiền tố `api/v1`** —
cùng lý do với `/health`: một load balancer và một scraper được cấu hình một
lần, không được đổi chỗ khi API lên phiên bản.

| Quyết định                                                | Vì sao                                                                                                                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tắt** khi chưa đặt `METRICS_TOKEN`, và trả **404**      | `/metrics` cho biết hình dạng lưu lượng, tỉ lệ lỗi và mức chi tiêu — bức tranh vận hành không ai bên ngoài nên có. 404 chứ không 401 để một lượt quét không phân biệt được "đang tắt" với "chưa đoán ra token" |
| So token bằng `timingSafeEqual`                           | Token này do người gọi endpoint nộp lên, tức là do bất kỳ ai                                                                                                                                                   |
| Nhãn route là **khuôn mẫu**, không phải đường dẫn         | Một nhãn có miền giá trị vô hạn sinh một chuỗi thời gian cho mỗi execution từng chạy. Kho metrics chết vì chuyện đó, và chết lặng lẽ — đúng lúc có sự cố                                                       |
| Không đo chính `/metrics`                                 | Scraper hỏi mỗi 15 giây sẽ át toàn bộ histogram và biến các con số thành nói về chính nó                                                                                                                       |
| Ghi cả nhánh lỗi                                          | Chỉ đo request thành công sẽ bỏ ngoài histogram đúng những request chậm nhất, và đồ thị trông khoẻ nhất lúc dịch vụ tệ nhất                                                                                    |
| Registry riêng, không dùng registry toàn cục của thư viện | Registry mặc định là singleton sống qua nhiều test; hai suite dùng chung khiến mọi khẳng định về số đếm phụ thuộc vào thứ chạy trước                                                                           |

**Cả runtime cũng có `/metrics`**, ở cổng `RUNTIME_METRICS_PORT` (mặc định
3101), cùng cách gác token. Trước đó chỉ API quan sát được, còn tiến trình làm
việc thật — lập kế hoạch, gọi provider, đăng lên khán giả thật — thì không nhìn
thấy gì, tức là ngược hẳn.

Lời gọi provider được đếm **sau khi** dòng sổ đã ghi. Thứ tự ngược lại sẽ khiến
một lần scrape hiện lời gọi mà sổ không có, và hai bên lệch nhau theo đúng chiều
trông như thất thu.

Số bài đăng đếm cả **lần hỏng**, và tách riêng `duplicate` với `ok`: một lần thử
lại nhận ra bài cũ không phải thêm một thứ nữa tới tay khán giả, đếm nó như vậy
là thổi phồng những gì đã ra ngoài.

**Một lỗi nữa của chính tôi.** Ba trong bốn chỉ số — lời gọi provider, thời gian,
số bài đăng — được định nghĩa, xuất ra, có test riêng, mà **không nơi nào tăng
chúng**. Ba cái đồng hồ không bao giờ nhúc nhích, đúng loại hỏng tôi vừa phê
phán ở cột `status` một commit trước đó. Và test đầu tiên cho chúng cũng sai:
một `Metrics` dùng chung cho cả file khiến mọi khẳng định về số đếm phụ thuộc
vào thứ chạy trước — cái bẫy mà chính docstring của package này cảnh báo.

**Một lỗi thật, do test kiểm sai chỗ.** Bản đầu bọc exposition trong
`{"data": "..."}` của response envelope — Prometheus từ chối thẳng. Test vẫn
xanh vì nó dùng `toContain`, và chuỗi đó vẫn nằm trong JSON. Giờ test khẳng định
thân phản hồi **bắt đầu bằng `# HELP`** và **`JSON.parse` phải ném lỗi**.

**Hai giới hạn ghi rõ:** request bị guard từ chối không được đo (guard chạy
trước interceptor), và đường dẫn không khớp route nào cũng không được đo (Nest
không chạy interceptor khi không có handler). Nghĩa là 404 từ đường dẫn lạ
không xuất hiện trong histogram.

### Chi phí AI trên màn hình

Bảng `ai_usage` được ghi từ Phase 2 và **chưa có đường nào đọc ra** cho tới giờ.
Một sổ kế toán không ai đọc được là sổ không ai tin — và chính nó quyết định
ràng buộc ngân sách trên một Goal có nghĩa lý gì hay không.

| Quyết định                                            | Vì sao                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quyền `workspace.execution.read`, không đặt quyền mới | Đây là tổng của thứ vốn xem được từng cái một. Đặt quyền riêng cho phép tính tổng sẽ cho một vai trò xem từng chi phí nhưng bị từ chối tổng — chẳng bảo vệ gì |
| Chia theo model, đắt trước                            | Tổng trả lời "bao nhiêu"; cái này trả lời "vào đâu", câu người ta hỏi thứ hai và là câu duy nhất hành động được                                               |
| `unpricedCalls` đưa thẳng lên giao diện               | Model chưa có bảng giá đóng góp 0 vào tổng, nên con số hiện ra **thấp hơn thực tế** và người đọc không có cách nào biết thấp bao nhiêu                        |
| Số nhỏ giữ 6 chữ số thập phân                         | Làm tròn 2 số sẽ hiện `$0.00` cho mọi thứ và làm cả khung trông như hỏng                                                                                      |
| `?days` quá lớn thì **chặn lại**, không báo lỗi       | Người gõ `99999` muốn xem tất cả; trả về một năm hữu ích hơn một lỗi về con số họ không nghĩ tới                                                              |

Có test riêng cho việc **con số thuộc đúng workspace được hỏi**, tách khỏi việc
guard chặn người ngoài. Thiếu nó, một service đọc nhầm workspace sẽ đưa cho
Alice chi phí của chính workspace kia của cô ấy, mà mọi test phân quyền vẫn xanh.

### Phiên bản Graph API

Ghim ở **một chỗ duy nhất** (`packages/connectors/src/version.ts`), vì nó xuất
hiện trong năm URL và một lần nâng bỏ sót một URL sẽ để lại đúng endpoint đó
trên phiên bản Meta ngừng phục vụ — kiểu hỏng đến sau vài tháng, ở đúng lời gọi
bị quên. Có test canh chuyện đó, và kiểm chứng ngược bằng cách nâng thiếu một URL.

Meta bảo đảm mỗi phiên bản khoảng hai năm rồi ngừng. **v21.0 ra tháng 10/2024,
dự kiến hết hạn tháng 10/2026** — ghim tiếp là hẹn trước một sự cố. Thăm dò
ngày 28/7/2026 với Page thật: v21 tới v25 đều trả lời đủ các lời gọi package
này dùng, v26 chưa tồn tại. Đã chuyển sang **v25.0**, và kiểm chứng lại trọn
vòng trên phiên bản mới: danh tính, hộp thư, số liệu, đăng bài, xoá bài.

Nâng phiên bản **là thay đổi mã nguồn có chủ ý**, không phải biến môi trường:
phiên bản mới có thể đổi hình dạng phản hồi, và phát hiện điều đó từ một biến
môi trường trên production là cách sai. Biến `FACEBOOK_GRAPH_URL` vẫn có, nhưng
để trỏ sang sandbox chứ không phải để nhảy phiên bản.

### Đọc tin nhắn (`social.inbox`)

Tiêu chí "Nhận tin nhắn" của Phase 3. **Hỏi định kỳ, không phải webhook** — và
đó là giới hạn thật chứ không phải đường tắt: webhook cần app đã được nền tảng
duyệt và một URL công khai để nhận, còn cách này chỉ cần token Page đã có. Đổi
lại tin nhắn tới chậm vài phút thay vì tức thời.

| Quyết định                                              | Vì sao                                                                                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chỉ đọc**, không trả lời được                         | Trả lời khách hàng thay người ta là quyết định lớn hơn hẳn việc đọc. Gộp chung nghĩa là muốn cái này phải cấp luôn cái kia                                                    |
| Đọc **mọi kênh** đã nối, khác hẳn lúc đăng              | Đọc nhầm hộp thư chỉ cho ai đó xem thứ họ vốn có quyền xem; đăng nhầm khán giả thì không lấy lại được. Sự bất đối xứng đó là lý do hai capability chọn mục tiêu theo hai cách |
| Cắt tin nhắn còn 200 ký tự                              | Chuỗi này rơi vào log, vào task output lưu vĩnh viễn, và vào context của model. Cả bức thư của khách không cần có mặt ở chỗ nào trong số đó                                   |
| Lấy tên người **khác** Page trong danh sách participant | Page cũng là một participant trong chính thread của nó. Lấy tên đầu danh sách sẽ gắn nhãn mọi thread bằng tên Page — vô nghĩa với người đọc                                   |
| Không phụ thuộc `SOCIAL_PUBLISH_LIVE`                   | Đọc tin khách đã gửi không thay đổi gì ngoài đời; đăng bài thì có. Gộp cờ nghĩa là phải bật cái nguy hiểm để dùng cái vô hại                                                  |

Trên màn hình có riêng một khung **Hộp thư**, đọc thẳng từ nền tảng mỗi lần
tải chứ không lưu bản sao — bản sao sẽ sai ngay khi có người trả lời từ app
Facebook, và một khách đang chờ hồi âm là thứ cuối cùng nên để cũ. Kênh nào
không đọc được thì **gọi tên ra** thay vì bỏ qua: hộp thư rỗng và hộp thư không
ai mở được trông giống hệt nhau trên màn hình, mà chỉ một trong hai nghĩa là
không có ai đang chờ. Khung đó **không có ô trả lời**, và đó là chủ ý chứ không
phải làm dở.

Ranh giới workspace ở đây **không biểu diễn được** để vượt qua: `list` bắt buộc
nhận `workspaceId`, nên không có cách nào gọi nó mà đọc sang workspace khác —
mạnh hơn một test canh chừng.

**Nói thẳng:** việc này đưa tin nhắn của khách hàng vào context của model. Đó
chính là thứ khiến việc tóm tắt trở nên khả thi, và cũng là điều một workspace
nên biết mình đã bật.

### Số liệu bài đăng (`/connections/stats`)

Tiêu chí "Đồng bộ dữ liệu" của Phase 3, **một nửa**. Nói rõ nửa nào và vì sao.

**Có:** lượt thích, bình luận, chia sẻ của từng bài. Đọc thẳng từ chính đối
tượng post nên chạy với mọi Page, không phụ thuộc ngưỡng nào. Hỏi bằng
`likes.summary(true).limit(0)` — không có `.limit(0)` thì Graph trả về **từng
lượt thích và từng bình luận một**, tức là chuyển một đống dữ liệu của người
khác đi vòng chỉ để hiện một con số.

**Không có: lượt tiếp cận.** Meta bỏ `page_impressions` và `post_impressions`
từ 15/6/2026, thay bằng `page_media_view` / `post_media_view`. Thăm dò bằng
token thật cho thấy tên mới **được chấp nhận** (HTTP 200) nhưng trả về
`data: []` — vì Page thử nghiệm có 4 người theo dõi, dưới ngưỡng Meta trả số.

Nên phần đọc phản hồi đó **chưa từng được kiểm chứng với một câu trả lời thật
nào**. Tôi không viết nó. Một hàm âm thầm trả về 0 trông y hệt một bài không ai
xem, và đó là thứ tệ hơn một khoảng trống được nói thẳng.

| Chi tiết                                             | Vì sao                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Thiếu `shares` đọc là **0**, không phải "không rõ"   | Graph bỏ hẳn trường này ở bài không ai chia sẻ. Đọc là không-rõ sẽ đặt một dấu gạch vào chỗ đáng lẽ là số 0 thật |
| Xếp mới nhất trước, xuyên kênh                       | Bài người ta đang hỏi tới nằm ở trên cùng                                                                        |
| Kênh hỏng thì **gọi tên**, không làm hỏng cả lời gọi | Một token hết hạn không được che số liệu của các kênh còn lại                                                    |
| Gộp khoảng trắng trong đoạn trích                    | Bài viết đầy dòng trống và khoảng cách emoji; để nguyên thì đoạn trích là ba chữ và một mảng trắng               |

**Nối Page bằng token dán tay** nằm **cạnh** OAuth chứ không thay thế. Lý do
thực dụng: đưa một ứng dụng Meta qua vòng xét duyệt mất hàng tuần, và người đã
có sẵn token cho Page của chính mình không nên bị chặn tới lúc đó. Token được
**hỏi Facebook trước khi lưu** — lưu mà không hỏi sẽ tạo ra một kết nối trông
khoẻ mạnh trên màn hình và chỉ hỏng lúc đăng, khi người dán nó đã đi làm việc
khác. Dán nhầm token trả về 400 chứ không phải 500: đó là giá trị sai trong một
ô nhập, và gọi người trực dậy vì chuyện đó là cách làm cho cảnh báo bị bỏ qua.

**Giới hạn nói rõ:** kết nối là _tài khoản người dùng_, chưa phải _trang_.
Chọn trang nào để đăng là bước thứ hai, gọi vào `/me/accounts` — thứ trả về một
danh sách chứ không phải một tài khoản, tức là hình dạng khác hẳn, và không có
trong bản này. Luồng OAuth mới được kiểm chứng với **một máy chủ OAuth thật do test dựng
lên**, chưa phải với Facebook thật — cái đó cần khoá ứng dụng của người vận
hành. Đường đăng bài thì **đã kiểm chứng với Facebook thật**: nối Page bằng
token, đăng một bài lên Page, rồi xoá lại — qua đúng đường code chạy trong sản
phẩm.

---

## 10. Frontend

### Next.js `15.1`

**Là gì:** framework React đầy đủ, có server rendering, routing theo thư mục, và
tối ưu sẵn.

**Dùng cho:** `apps/web` — bảng kiểm chứng runtime, chạy ở cổng **3200**.

**Điểm mạnh:**

- App Router với React Server Components: bớt JavaScript gửi xuống trình duyệt.
- Routing theo cấu trúc thư mục, không cần cấu hình.
- Tối ưu sẵn ảnh, font, code splitting.
- Là framework React phổ biến nhất, tài liệu và cộng đồng rất lớn.

**Điểm yếu:**

- Ranh giới server/client component gây nhầm lẫn, dễ mắc lỗi khó hiểu.
- Thay đổi lớn giữa các phiên bản (Pages Router → App Router).
- Nặng nếu chỉ cần một trang tĩnh đơn giản.

### React `19`

**Là gì:** thư viện xây dựng giao diện theo component.

**Dùng cho:** toàn bộ giao diện web.

**Điểm mạnh:** mô hình component dễ tái sử dụng; hệ sinh thái lớn nhất; cộng
đồng đông.

**Điểm yếu:** chỉ lo phần giao diện, mọi thứ khác (routing, state, data
fetching) phải tự chọn thư viện; hook có nhiều bẫy tinh vi.

### Tailwind CSS `3.4` + clsx `2.1` + tailwind-merge `2.5`

**Là gì:** Tailwind là framework CSS theo lớp tiện ích — viết style trực tiếp
trong class. `clsx` ghép class có điều kiện, `tailwind-merge` xử lý class xung
đột.

**Dùng cho:** toàn bộ giao diện.

**Điểm mạnh:**

- Không phải nghĩ tên class, không có file CSS phình to theo thời gian.
- Chỉ sinh ra CSS thực sự dùng nên file cuối rất nhỏ.
- Style nằm ngay cạnh markup, sửa nhanh.

**Điểm yếu:**

- HTML dài và rối mắt khi nhiều class.
- Phải học tên lớp tiện ích riêng.
- Khó dùng lại style nếu không tách thành component.

### PostCSS `8.4` + autoprefixer `10.4`

**Là gì:** PostCSS là công cụ biến đổi CSS bằng plugin. `autoprefixer` tự thêm
tiền tố cho trình duyệt cũ.

**Dùng cho:** xử lý CSS đầu ra của Tailwind. Cấu hình một lần rồi thôi.

### Lưu ý khi làm nền tảng này

**Web ghim cứng cổng 3200.** Next mặc định lấy 3000, và khi cổng đó bận nó **tự
nhảy** sang cổng khác — lúc đó `CORS_ORIGINS` trỏ sai chỗ và trình duyệt chặn mọi
lời gọi, hiện ra như lỗi của ứng dụng chứ không phải xung đột cổng.

**Preset tsconfig của Next và React ban đầu không khai báo `lib: DOM`**, nên mọi
chỗ dùng `window` không typecheck được. Lỗi tiềm ẩn từ đầu dự án, chỉ lộ khi có
trang làm việc thật với trình duyệt.

**API phải bật CORS với danh sách tường minh, không dùng `*`.** Access token đi
trong header `Authorization`, nên `*` là trao cho mọi website quyền gọi API thay
người dùng đang đăng nhập. Header tuỳ chỉnh `x-workspace-id` cũng phải được khai
trong `allowedHeaders`, thiếu nó thì đăng nhập vẫn chạy còn mọi thứ khác hỏng.

**Token lưu ở `localStorage`** — mọi script trên origin đều đọc được. Chấp nhận
được khi còn một origin và chưa lên production; câu trả lời đúng cho production
là refresh token trong cookie `httpOnly`.

---

## 11. Kiểm thử

### Vitest `2.1`

**Là gì:** framework test dựng trên Vite, API tương thích Jest.

**Dùng cho:** toàn bộ unit test và integration test.

**Điểm mạnh:**

- Nhanh hơn Jest đáng kể, hỗ trợ TypeScript và ESM sẵn.
- Cấu hình tối thiểu.
- Chế độ watch thông minh, chỉ chạy lại test liên quan.

**Điểm yếu:**

- Trẻ hơn Jest nên một số thư viện phụ trợ chưa có.
- Các assertion ở tầng kiểu (`expectTypeOf`) **không chạy** trừ khi bật chế độ
  typecheck riêng.

### supertest `7.0` + @faker-js/faker `9.3` + unplugin-swc `1.5`

**Là gì:** `supertest` gửi request HTTP thật vào ứng dụng để test đầu-cuối.
`faker` sinh dữ liệu mẫu. `unplugin-swc` biên dịch bằng SWC thay vì esbuild.

**Dùng cho:** test API, dữ liệu mẫu, và giữ decorator metadata cho test NestJS.

**Điểm mạnh:** `supertest` test được đúng tầng HTTP thật, kể cả middleware và
guard. SWC giữ được `emitDecoratorMetadata` mà esbuild bỏ mất.

**Điểm yếu:** thêm một trình biên dịch nữa vào chuỗi công cụ, cần giữ đồng bộ.

### Lưu ý khi làm nền tảng này

**Nền tảng dùng ba tầng kiểm chứng, vì hai tầng đầu không đủ:**

1. **Unit** — logic thuần, không I/O.
2. **Integration** (`*.int-spec.ts`) — Postgres và Redis **thật**, không mock.
3. **`verify:stack`** — chạy toàn bộ **chỉ qua API công khai**, đúng đường người
   dùng đi.

Tầng 3 tồn tại vì một lý do cụ thể: **39 test tích hợp chạy trên hạ tầng thật vẫn
để lọt lỗi Goal đặt lịch không bao giờ chạy** — do chúng tự ghi dữ liệu nên vô
tình tránh đúng hình dạng gây lỗi. Khi cần chắc chắn, chạy:

```sh
pnpm --filter @repo/runtime-service verify:stack
```

**`expectTypeOf` của Vitest không chạy lúc runtime.** Từng có một test chống lệch
kiểu viết bằng `expectTypeOf`; nó xanh trong khi kiểu đang sai. Phải viết lại
thành so sánh giá trị thật.

**Mọi test bảo vệ đều được kiểm chứng ngược** — cố tình khôi phục lỗi để chắc
test thật sự fail. Cách này đã tìm ra nhiều thứ trông như đang gánh việc nhưng
thực ra không: một nhánh fallback trong Gateway không bao giờ chạy tới, một cờ
`retryOn401` trong SDK không bao giờ được đặt, một guard `if (!entry?.embed)`
mà bộ lọc phía trên đã đảm bảo, chính cái test `expectTypeOf` ở trên, và một
test đếm số chunk **tự so với chính nó** nên cả hai vế cùng sai vẫn xanh.

**Kiểm tra đỏ không có nghĩa là hệ thống sai.** Hai lần chạy `verify:stack` báo
đỏ mà hệ thống hoàn toàn đúng: một là timeout 120s quá ngắn cho model 7B chạy
cục bộ (Goal thật sự đã dừng ở `WAITING` đúng như mong đợi, chỉ là muộn hơn),
hai là kiểm tra ngân sách hỏi sai câu — nó hỏi "đã tiêu gì chưa", trong khi
ngân sách chặn theo **giá ước tính khai báo trước khi chạy**, nên một provider
miễn phí vẫn bị chặn đúng và câu hỏi kia rút ra kết luận ngược. Đọc kỹ dữ liệu
thật trước khi sửa mã.

---

## 12. Log và tiện ích vận hành

### pino `9.5` + pino-pretty `13.0`

**Là gì:** thư viện log có cấu trúc, nhanh nhất trong hệ Node. `pino-pretty` làm
log dễ đọc khi phát triển.

**Dùng cho:** toàn bộ log của API và runtime.

**Điểm mạnh:**

- Rất nhanh, ảnh hưởng không đáng kể tới hiệu năng.
- Log dạng JSON nên máy đọc được — cắm thẳng vào Loki, Datadog, CloudWatch.
- Tự serialize lỗi, có child logger để gắn ngữ cảnh.

**Điểm yếu:** JSON thô khó đọc bằng mắt, phải qua `pino-pretty`.

### cron-parser `5.6`

**Là gì:** thư viện phân tích biểu thức cron và tính thời điểm chạy kế tiếp, có
hỗ trợ múi giờ.

**Dùng cho:** tính lần chạy tiếp theo của Goal đặt lịch.

**Điểm mạnh:**

- Hỗ trợ múi giờ IANA đúng đắn, kể cả qua mốc đổi giờ mùa.
- API đơn giản, đã được dùng rộng rãi.

**Điểm yếu:** kéo theo `luxon` (~70KB) — chấp nhận được vì chỉ chạy ở backend.

### Docker Compose

**Là gì:** công cụ chạy nhiều container bằng một file cấu hình.

**Dùng cho:** dựng Postgres, Redis, MinIO, Qdrant khi phát triển.

**Điểm mạnh:** một lệnh `pnpm docker:up` là có đủ hạ tầng, giống nhau trên mọi
máy.

**Điểm yếu:** không dùng được cho production ở quy mô lớn; tốn tài nguyên máy dev.

### Lưu ý khi làm nền tảng này

**Cổng được đặt lệch chuẩn có chủ ý:** Postgres 5433, Redis 6380, API 3100, Web
3200, MinIO 9000/9002, Qdrant 6333. Lý do là máy phát triển còn chạy dự án khác
trên các cổng mặc định.

**Múi giờ luôn bắt buộc khi đặt lịch, không có giá trị mặc định.** `0 8 * * *` mà
không nói múi giờ thì mơ hồ. Với `Asia/Ho_Chi_Minh`, biểu thức đó là 8 giờ sáng
giờ địa phương kể cả qua mốc đổi giờ — kiểm chứng bằng `Europe/Madrid`: cùng biểu
thức mà mùa đông là 07:00Z, mùa hè 06:00Z.

**Lỡ lịch thì bỏ qua, không chạy bù.** Runtime chết ba ngày với lịch hằng ngày,
chạy bù sẽ đăng ba ngày bài trong một phút.

---

### fast-xml-parser `4.5`

Google Trends chỉ phát RSS, và RSS là XML. Dùng cho đúng một việc đó.
**Tắt `parseTagValue`** — lý do ở mục xu hướng bên trên: nó là khác biệt giữa
"0888" và 888.

## 13. Đã cài nhưng chưa dùng

Không còn dịch vụ nào trong `docker-compose` ở trạng thái này. Qdrant `:6333`
đã được `packages/knowledge` dùng (mục 7) và MinIO `:9000` được
`packages/storage` dùng (mục 8).

Các package sau mới chỉ có README, chưa có mã: `packages/plugin`,
`packages/integration`. Các app `admin`, `docs`, `landing`, `playground` cũng
vậy.

(`packages/config` không có thư mục `src` nhưng **đang được dùng** — nó chứa các
preset ESLint, Prettier và tsconfig dùng chung cho toàn repo.)

---

### Studio nội dung (Phase 4)

Bốn thao tác thay cho một, vì chúng **hỏng theo những cách khác nhau** và cần
canh những thứ khác nhau. Một lời gọi "làm cho tôi ít nội dung" không thể thực
thi bốn hợp đồng khác nhau — đó là lý do `content.generate` cũ chỉ mãi là bản
nháp đầu.

| Thao tác     | Ràng buộc riêng                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Viết**     | Được sáng tạo, nhưng không được thêm số liệu, cam kết hay khuyến mãi mà brief không nói — người đọc sẽ tin đó là thật                                |
| **Viết lại** | **Không được đổi dữ kiện.** Đổi cách nói, không đổi nội dung. Chỗ nào làm theo yêu cầu sẽ phải đổi dữ kiện thì ghi vào `notes` chứ không im lặng     |
| **Dịch**     | Giữ nguyên số liệu, ngày tháng, tên riêng. **Không quy đổi tiền tệ** — quy đổi cần tỉ giá, mà một bài hứa sai giá còn tệ hơn một bài sai đơn vị tiền |
| **SEO**      | Từ khoá rút từ chính bài. Bịa từ khoá kéo về đúng loại người đọc sẽ rời đi ngay                                                                      |

**Độ dài gửi cho model bằng số từ**, không bằng tính từ: "ngắn" với một caption
TikTok khác hẳn "ngắn" với một bài blog, và đó là thứ khiến mọi bản nháp phải
sửa lại lần hai chỉ vì độ dài.

**Ghi nhớ thương hiệu của workspace đi thành một khối riêng, đặt trước brief.**
Dán nó vào cuối brief thì model viết một bài _về_ giọng văn thương hiệu chứ
không viết _bằng_ giọng đó.

Máy chủ tự đọc ghi nhớ mỗi lần gọi — client không truyền, nên một màn hình
không thể quên. Mọi lời gọi đều vào sổ `ai_usage`; sổ hỏng thì **vẫn trả bản
nháp về**, vì provider đã trả lời và tiền đã tiêu rồi.

### Tự động đăng theo lịch (Phase 4)

Vòng lặp riêng trong runtime, không phải một bước trong scheduler: một lượt
đăng là vài lần gọi ra mạng ngoài, và chạy nó trong tick sẽ chặn mọi task đang
xếp hàng phía sau.

**Uỷ quyền nằm ở nút Duyệt, và theo từng bài.** Đây là chỗ khác hẳn với một
Goal định kỳ có bước đăng bài — trường hợp đã từng hỏng ở đây, khi bật kết nối
kênh làm thay đổi hành vi của mọi lịch đã có, và một lần chạy lúc 3 giờ sáng
đăng nội dung không ai đọc lên Page thật. Ở đây một người viết đúng đoạn văn
đó, chọn đúng giờ đó, và bấm duyệt đúng bài đó. **Bài nháp thì không bao giờ
được đăng, dù ngày đã qua bao lâu.**

Cũng vì thế nó **không** nằm sau `SOCIAL_PUBLISH_UNATTENDED`. Cờ đó tồn tại vì
Goal định kỳ đăng thứ chưa ai đọc; đặt bài đã duyệt sau nó thì nút Duyệt bấm
xong không xảy ra gì và cũng không báo gì — tệ hơn cả hai lựa chọn.

Trạng thái `PUBLISHING` không phải trang trí. Nó là dòng mà một node runtime
**giành lấy trước khi gọi ra platform**, và đó là thứ ngăn hai node cùng gửi
một bài tới cùng một tệp khán giả — sai lầm không có nút hoàn tác.

Điều giữ cho nó đúng là **một câu lệnh duy nhất**: đọc trạng thái và ghi đè
cùng lúc. Đọc trước rồi ghi sau để lại đúng cái khe hở mà hai node cùng lọt
qua. Node thứ hai bị chặn ở dòng đang khoá, khi tỉnh dậy nó **đánh giá lại
subquery**, thấy `PUBLISHING` và không lấy gì cả.

`for update skip locked` vì thế là chuyện **thông lượng, không phải an toàn**:
nó cho node thứ hai bước qua dòng đang bị giữ và nhặt việc khác thay vì đứng
đợi. Ghi rõ ở đây vì bản đầu tiên của chính đoạn ghi chú này nói ngược lại —
đã kiểm chứng bằng cách bỏ `skip locked` ra và chạy hai connection pool độc
lập, không lần nào sinh ra hai lần giành.

**Bài kẹt giữa chừng thì báo hỏng, không đăng lại.** Một node chết giữa lúc
giành và lúc nghe trả lời để lại dòng ở `PUBLISHING`. Lời gọi có thể chưa từng
tới nơi, mà cũng có thể đã tới và được nhận, chỉ mất câu trả lời — từ đây không
có cách nào phân biệt. Đăng lại là cách một bài thành hai bài trên trang thật,
nên nó dừng, nói rõ, và để người quyết định.

API **không cho client tự đặt** `PUBLISHING`, `PUBLISHED` hay `FAILED`. Đó là
bản ghi việc đã xảy ra, không phải mệnh lệnh: một client đặt được `PUBLISHED`
sẽ khiến lịch khẳng định có một bài mà không ai gửi.

Một bài mang **kênh**, không mang tài khoản. Nối hai Page thì "đăng lên
Facebook" là một câu thiếu tân ngữ, nên nó dừng và nói ra tên cả hai — chọn hộ
là nền tảng tự quyết định khán giả của người khác.

### `verify:loop` — chạy cả vòng lặp trên Page thật (Phase 4)

`verify:stack` chứng minh **từng mảnh** chạy được. Cái này chứng minh chúng
**vẫn chạy khi ghép lại**: xu hướng → Studio → lịch → duyệt → đăng → báo cáo.
Đó là câu hỏi khác, và là câu chỉ hỏng sau khi vài lát cắt trôi xa nhau.

Tách thành lệnh riêng vì nó **tốn một bài đăng thật** trên khán giả của ai đó.
Không có `FB_TEST_PAGE_ID` thì nó **từ chối chạy** chứ không bỏ qua như
verify:stack — một lần chạy xanh mà không có Page là một lần chạy không kiểm
chứng được gì.

Bước đáng giá nhất là bước **không có gì xảy ra**: một bài đã quá giờ mà chưa
ai duyệt phải đi qua trọn một vòng quét và vẫn nguyên `DRAFT`. Nếu chỗ đó sai
thì nó sai trên Page của khách, và không server Graph giả nào nói cho biết
được. Khi bước đó hỏng, script **dừng ngay tại đó** thay vì chạy tiếp — thứ
duy nhất trong kịch bản này có nghĩa là "ra xem Page ngay".

Thời gian chờ vòng quét để **20 giây**, không phải 2. Chờ quá ngắn thì bước đó
xanh vì vòng quét chưa kịp chạy — tức là báo cáo tính chất an toàn đang hoạt
động mà chưa hề kiểm tra nó.

Nội dung bài test **cố định là "test đăng bài"**, không sinh bằng model. Nó
xuất hiện thật trên trang trong vài giây trước khi bị xoá, và một đoạn quảng
cáo do model viết là thứ không nên để người lạ nhìn thấy ở đó.

Tạo gì thì dọn nấy: xoá bài, lưu trữ bài và chiến dịch, gỡ kết nối Page. Một
bài kiểm chứng để lại rác trên Page người ta là bài không ai chạy lần thứ hai.

### Báo cáo chiến dịch (Phase 4)

Hai nguồn không join được trong cơ sở dữ liệu: bài viết là của mình, còn tương
tác là của Facebook. Ghép bằng **post id của chính nền tảng** — thứ duy nhất
hai bên cùng công nhận.

Đếm bằng SQL (`count(*) filter (where ...)`), không kéo hết bài về rồi cộng
trong TypeScript: một workspace chạy một năm có hàng nghìn bài, và kéo tất cả
sang chỉ để cộng ra năm con số là một trang mỗi tuần một chậm hơn.

**Bài không thuộc chiến dịch nào là một dòng thật trong báo cáo.** Với phần lớn
workspace, đó mới là đa số bài. Bỏ chúng đi là hiện một phần công việc rồi gọi
đó là tổng.

`postsWithoutStats` được mang tới tận màn hình chứ không gộp mất, cùng lý do
với `unpricedCalls` ở bảng chi tiêu: tương tác chỉ đọc được trong một cửa sổ
bài gần đây, nên bài cũ hơn đóng góp số 0 vào tổng — một con số đưa ra mà không
kèm số này là con số bị hụt, và người đọc không có cách nào biết hụt bao nhiêu.
Cảnh báo đặt **ngay trên dòng đó**, không phải một câu chung ở cuối bảng.

Kênh không đọc được số liệu thì **nêu tên**, không giấu. Mỗi kênh như vậy làm
mọi tổng bên dưới hụt đi, và người đọc không có đường nào khác để biết.

**Không báo cáo chi phí AI theo chiến dịch, và không thể làm cho trung thực.**
`ai_usage` không có cột chiến dịch, mà cũng không nên có: một bản nháp được
viết ở Studio trước khi ai đó quyết định nó thuộc chiến dịch nào, nên mọi cách
quy kết đều là phỏng đoán được trình bày như một con số kế toán.

### Test cho giao diện: vitest + Testing Library `16.1` (Phase 4)

Trước đợt này `apps/web` **không có một test nào**, trong khi ba lát cắt gần
nhất đều dồn quyết định thật vào màn hình: nút nào hiện với trạng thái nào, có
đưa ô chọn trang ra hay không, brief được ghép từ cái gì. Sai ở đó nghĩa là một
bài không duyệt được, hoặc một bài đi nhầm tệp khán giả.

Chạy trong `jsdom` và thao tác qua `@testing-library/user-event` — tức là bấm
và chọn như người dùng, không gọi thẳng hàm xử lý sự kiện. Truy vấn theo
**role** chứ không theo class: một test tìm phần tử bằng tên class sẽ đỏ khi
đổi màu nút, và vẫn xanh khi nút biến mất.

`cleanup()` sau mỗi test là bắt buộc, không phải dọn dẹp cho gọn: Testing
Library render vào cùng một document, nên thiếu nó thì một truy vấn "Duyệt" sẽ
bắt được nút còn sót lại của test trước và **xanh vì lý do sai**.

`scrollIntoView` được stub trong setup vì jsdom không có layout nên không có gì
cuộn. Stub ở đó chứ không `?.()` trong component: lời gọi đó đúng ở mọi trình
duyệt thật, và để một dấu hỏi trong mã chạy production chỉ để chiều môi trường
test là để lại giàn giáo ở chỗ người dùng đứng.

Hai thứ tìm ra ngay khi viết test đầu tiên: hai thẻ `<select>` chọn trang
**không có nhãn**, nên trình đọc màn hình không đọc được chúng — chính điều đó
làm truy vấn theo role bị nhập nhằng. Đã thêm `aria-label`.

Đợt phủ nốt bốn panel còn lại (Kênh, Kho khoá, Hộp thư, Chat) tìm ra thêm hai
thứ cùng loại. Nút xoá hội thoại có nhãn hiển thị là `×`, và `title` **không**
sửa được điều đó — nội dung chữ thắng `title` khi trình duyệt tính accessible
name, nên trình đọc màn hình chỉ đọc "times". Đã thêm `aria-label` kèm tên hội
thoại.

Và một test của chính tôi **xanh vì lý do sai**: nó kiểm "ô nhập user token đã
biến mất" sau khi nối Page — nhưng ô đó biến mất vì cả panel đóng lại, chứ
không phải vì token bị xoá. Break-check bỏ dòng `setUserToken("")` đi mà test
vẫn xanh. Giờ nó mở lại panel và kiểm ô rỗng.

### Đọc bình luận dưới bài (Phase 3, bổ sung)

Với một Page bán hàng, **phần lớn câu hỏi của khách nằm ở bình luận chứ không
phải tin nhắn**. Hộp thư chỉ đọc tin nhắn nghĩa là một màn hình trống trong khi
khách đang hỏi ngay dưới bài.

`fetchComments` (đọc bình luận của **một** bài) đã có sẵn từ Phase 3 nhưng
**không chỗ nào gọi** — code chết. Thay vì nối nó vào rồi gọi một lần cho mỗi
bài, hàm mới đọc **lồng bình luận vào trong lượt đọc feed**: một request thay
vì mười một, và mười một cơ hội dính rate limit rút còn một.

Bình luận mang theo **bài nó nằm dưới**. Không có nó thì "còn hàng không" là
câu hỏi không ai trả lời được.

Sắp xếp theo **thời gian bình luận**, không theo thứ tự feed. Thứ tự feed là
theo bài, nên một bình luận tuần trước dưới bài hôm nay sẽ nằm trên một bình
luận một giờ trước ở bài phía dưới.

Trên màn hình, bình luận nằm **thành một khối riêng dưới tin nhắn**, không trộn
lẫn. Trộn nghĩa là xếp một bình luận cạnh một tin nhắn theo thời gian rồi gọi đó
là thứ tự — trong khi hai thứ được trả lời ở hai chỗ khác nhau, thường bởi hai
người khác nhau. Con số trên tiêu đề thì **cộng cả hai**, vì cả hai đều là người
đang chờ.

Vẫn **không có ô trả lời**, cùng lý do với hộp thư.

### Ảnh bìa cho bài đăng: sharp `0.35` (Phase 4)

Media là nhóm duy nhất của Phase 4 chưa có gì. Sinh ảnh và sinh video cần khoá
model ảnh chưa ai có, nên đây là **nửa không cần khoá nào**: vẽ ảnh bìa từ
chính chữ đã viết.

**Đây không phải sinh ảnh, và cách đặt tên giữ đúng sự phân biệt đó.** Không có
model nào ở đây và không có gì được bịa ra. Sinh một bức ảnh về sản phẩm không
tồn tại là tính năng khác với rủi ro khác; gọi cả hai là "ảnh" sẽ che mất điều
đó.

SVG rồi rasterise bằng `sharp`, không dùng canvas: bố cục chỉ là chữ trên một
hình chữ nhật — thứ SVG mô tả trực tiếp — còn canvas nghĩa là vẽ đúng thứ đó
một cách tuần tự với nhiều chỗ sai hơn.

**Alpine không có font nào, và `sharp` không báo lỗi vì chuyện đó** — nó trả về
một tấm ảnh không có chữ. Cùng một tấm bìa: 2403 pixel sáng ở máy có font, 576
ở máy không. Image runtime giờ cài `fontconfig` và `font-noto`; Noto ở đây vì
nó có dấu tiếng Việt, thiếu nó thì mọi chữ có dấu là một ô vuông. Test bắt lỗi
này **đếm mực** chứ không tin rằng có PNG trả về là xong — và nó thật sự đỏ
trong container không font, đã kiểm chứ không đoán.

Hệ số bề rộng ký tự cũng là **đo được**, không phải đoán. Ở 0.52, một tiêu đề
thật chạm 1165px trên ảnh rộng 1200px có lề phải bắt đầu ở 1104 — chữ tràn ra
ngoài, chỉ nhìn thấy khi render ra rồi mở ảnh lên xem. Test giờ đọc cột pixel
sát mép phải.

Bài có ảnh đi vào `/photos` chứ không phải `/feed`, và chữ chuyển sang
`caption`. Gửi `message` vào `/photos` cho ra một tấm ảnh **không có chữ bên
dưới** — được chấp nhận, nên không có gì báo lỗi, và bài đăng đơn giản là sai.
`/photos` trả về cả `id` (của ảnh) lẫn `post_id` (của bài); `post_id` mới là
thứ người ta mở ra xem và là thứ lệnh xoá phải nhắm vào.

Lưu **khoá kho**, không lưu URL: URL ký sẵn hết hạn, và lưu nó lại sẽ khiến
lịch hiển thị một tấm ảnh ngừng tải sau vài phút. Ký ảnh hỏng thì **vẫn đăng**
— bài không ảnh là bài kém hơn, không có bài nào mới là kết quả tệ hơn.

### Đọc trang đối thủ (FR-104, FR-105 — Phase 4)

Hai mục cuối của Trend Discovery, và là hai mục duy nhất còn lại **không cần
app Meta**.

**robots.txt được kiểm tra trước mỗi lần đọc, và đó không phải phép lịch sự.**
Nền tảng này đi lấy trang của người khác _thay mặt khách hàng_; một crawler
phớt lờ robots.txt sẽ khiến IP của khách bị chặn và tên khách nằm trong đơn
khiếu nại — không ai yêu cầu điều đó. File không tồn tại nghĩa là cứ đọc; file
**không đọc được** lại là một lời từ chối, vì đi tiếp đồng nghĩa với đoán, và
đoán sai là lấy đúng thứ người ta bảo đừng lấy.

User agent **xưng danh** chứ không giả làm trình duyệt. Chủ trang đọc log phải
nhận ra đây là cái gì và chặn được nó một cách có chủ đích.

Mọi thứ còn lại đều từ chối thay vì cố thêm: chỉ http(s), chỉ HTML, chỉ trong
giới hạn dung lượng đã thoả thuận, và chỉ trong một khoảng chờ — nó chạy bên
trong một request có người đang đợi.

**Lỗi tìm được bằng cách đọc vnexpress.net, không phải bằng cách đọc code:**
các tiêu đề được rút từ HTML thô, nên một `<h1>` viết bên trong template
literal của JavaScript cũng bị tính là tiêu đề — "tiêu đề thứ hai" của trang
chủ trả về là `'+((articleData['privacy']&8)?' Live '...`. Giờ code bị bóc **một
lần, trước khi bất kỳ thứ gì đọc cấu trúc trang**.

Trang gần như không có chữ trong HTML thì **báo thẳng** chứ không gửi cho model
— đó là hình dạng của một trang dựng hoàn toàn bằng JavaScript, và model nhận
một trang rỗng sẽ bịa ra cả một công ty.

`gaps` — những gì trang **không** nói — là trường hữu ích nhất và cũng dễ bịa
nhất. Prompt vì thế nêu đích danh loại thông tin cần tìm (giá, phí, thời gian
giao, đổi trả) thay vì hỏi chung chung "điểm yếu là gì". Trên màn hình nó nằm
tách hẳn ra, để không bao giờ bị đọc nhầm thành điều đối thủ tuyên bố.

Mỗi lần một trang, do người bấm. Không quét cả site, không chạy nền: khác biệt
giữa một trang ai đó yêu cầu và một vòng quét tự động chính là khác biệt giữa
đọc và cào.

Mỗi `gap` có nút **Viết bài về chỗ này** đưa brief sang Studio — một nút cho
mỗi chỗ trống, không phải một nút cho tất cả: một bài không trả lời được bốn
khoảng lặng khác nhau, và giả vờ làm được thì ra một bài không nói về gì cả.

Brief nói đối thủ **không đề cập** điều gì, rồi dừng ở đó, kèm câu **"không
nhắc tới đối thủ và không suy đoán gì về họ"**. Trang không nói về thời gian
giao hàng không phải bằng chứng họ giao chậm; một brief ám chỉ điều đó sẽ đẻ ra
một khẳng định về công việc làm ăn của người khác mà không ai kiểm chứng.

### Xu hướng nối thẳng sang Studio (Phase 4)

Mỗi dòng xu hướng có nút **Viết bài**, đưa một câu brief sang Studio.

Brief là **một câu, không phải từ khoá thô**. "sân bay" đứng một mình không nói
cho model biết phải viết gì; dòng tin bên dưới nó mới là lý do từ đó đang nóng
— và nó vốn đã hiện trên màn hình, nên brief chỉ nói lại đúng thứ người bấm đã
nhìn thấy. Ghi vào ô brief để sửa được, không gửi thẳng đi đâu.

Nó **thay** nội dung đang có trong ô chứ không nối thêm. Nối thêm sẽ lặng lẽ
ghép ba xu hướng chẳng liên quan thành một brief, còn hỏi "có ghi đè không?"
mỗi lần thì lại là một hộp thoại chắn ngang một thao tác đáng ra chỉ một cú
bấm.

Trạng thái truyền xuống mang theo một **`nonce` đếm lên**, không phải chỉ đoạn
text. Bấm lại đúng xu hướng đó lần thứ hai phải chạy — mà nếu chỉ so text thì
giá trị không đổi, effect không chạy, và cú bấm thứ hai trông như hỏng. Đó
chính là lúc người ta cần nó nhất: vừa sửa brief xong và muốn lấy lại bản gốc.

**Chưa có test tự động cho phần này.** `apps/web` hiện không có test runner
nào, và dựng cả một bộ khung test chỉ cho một hàm ghép chuỗi thì không cân
xứng. Đã kiểm bằng typecheck, lint, build và xác nhận chuỗi mới nằm trong
bundle được phục vụ — không phải bằng một cú bấm thật.

### Nối nhiều Page bằng một user token (Phase 4)

Nối mười Page bằng tay nghĩa là đi tìm mười Page ID và mười Page token trong
công cụ của Facebook. Một **user token** trả lời cho tất cả cùng lúc qua
`/me/accounts`.

**Hai lời gọi, cố ý.** Lời gọi đầu chỉ trả về tên và id — **không có Page
token**. Lời gọi thứ hai nhận danh sách id được chọn và **máy chủ tự đọc lại
token**. Trả token về cho trình duyệt để nó gửi ngược lên sẽ đặt một credential
sống của khán giả ai đó vào một response JSON, một tab devtools, và mọi log nằm
giữa — chỉ để tiết kiệm một vòng gọi.

**Một Page hỏng không làm hỏng cả mẻ.** Nối được 8 trên 10 và nói rõ 2 cái nào
thì có ích hơn một lỗi duy nhất khiến người gọi không biết đã lưu được gì chưa.

`limit=100` được ghi rõ: mặc định của Facebook là 25, và người có nhiều Page hơn
thế sẽ thấy một danh sách bị cắt mà **không có gì trên màn hình nói rằng nó bị
cắt**.

Page đã nối rồi thì **hiện mờ chứ không ẩn**. Người đi tìm một Page họ nối tuần
trước phải thấy nó kèm lý do, chứ không phải ngồi nghi token sai.

Một chi tiết tìm được khi thử với Graph thật: dán **Page token** vào ô user
token thì Facebook trả về `Tried accessing nonexisting field (accounts)` —
đúng, và vô dụng với người vừa dán. Thông báo đó được dịch lại thành đúng điều
cần biết.

### Nhiều Page: bài tự chọn kênh (Phase 4)

`content_pieces.social_account_id` **để trống được**, và đó là một trạng thái
thật chứ không phải chưa làm xong: nối đúng một Page thì không có gì để chọn,
bắt chọn nghĩa là mọi bản nháp phải nêu tên kênh mới lưu được. Trống = "kênh
duy nhất trên channel này", và publisher từ chối ngay khi điều đó thôi đúng.

Bài **có nêu tên kênh thì chỉ đi đúng kênh đó**. Kênh đó bị ngắt kết nối thì
báo hỏng, không lùi về kênh còn lại — một bài viết cho tệp khán giả này không
được rơi sang tệp khác vì ai đó vừa ngắt một kết nối.

API **kiểm tra kênh có thuộc workspace không**, trả 404 nếu không. Nếu chỉ lưu
nguyên id thì bài vẫn không bao giờ đăng nhầm (vòng quét chỉ đọc kết nối của
chính workspace đó), nhưng dòng dữ liệu sẽ trỏ ngang qua ranh giới tenant, và
lỗi người dùng thấy sau này sẽ là "kênh đã ngắt kết nối" thay vì "kênh này chưa
bao giờ là của bạn".

Trên giao diện, ô chọn trang **chỉ hiện khi có từ hai Page trở lên** trên cùng
channel. Một Page thì không có gì để quyết, và một select chỉ có một lựa chọn
là màn hình giả vờ đang hỏi. Bài đã đăng thì ô chọn thành chữ tĩnh: trang đã
đăng là một sự thật, để dropdown lên trên một sự thật khiến người ta tưởng đang
chuyển được bài đi chỗ khác.

### Xu hướng: Google Trends và YouTube (Phase 4)

**Google Trends không có API dùng được.** API chính thức có tồn tại — công bố
tháng 7/2025 — nhưng đến giờ vẫn là alpha phải nộp đơn xin quyền, nên không
xây nền tảng lên nó được. Nguồn ở đây đọc **RSS công khai**
(`trends.google.com/trending/rss?geo=VN`): không cần khoá, không quota, không
phải xin ai.

Cái giá phải nói rõ, không giấu: **chỉ có xu hướng tìm kiếm của hôm nay.**
Không có biểu đồ theo thời gian, không so sánh được hai từ khoá, không có lịch
sử 5 năm — đó chính là phần API bị khoá kia bổ sung. Nó trả lời "bây giờ đang
nóng cái gì", không trả lời "tháng trước có nóng hơn không".

YouTube dùng Data API v3 với `chart=mostPopular` chứ không phải `search`: đó là
thứ chính YouTube gọi là trending, tốn **1 đơn vị quota** thay vì 100, và không
cần từ khoá — mà "tìm từ khoá nào" chính là câu hỏi đang cần trả lời chứ không
phải câu trả lời.

`volume` là **chuỗi**, cố ý. Google công bố một khoảng — "200+", "20K+" — chứ
không phải một con số; đọc nó thành 200 là biến một cận dưới thành một phép đo.
YouTube trả về lượt xem thật, nhưng cũng để dạng chuỗi, để không chỗ nào phía
sau cộng được lượt xem với lượt tìm kiếm.

**Trình đọc XML bị tắt đoán kiểu.** Để mặc định, nó đọc "0888" thành số 888 và
"1.50" thành 1.5 — mà người ta tìm số điện thoại và tìm giá. Số 0 mất trước khi
bất kỳ dòng code nào ở đây nhìn thấy từ khoá, nên ép về chuỗi sau đó không cứu
lại được.

Kết quả cache trong Redis 15 phút. **Khoá cache không chứa workspace**: cả nước
tìm gì thì là cùng một câu hỏi bất kể ai hỏi, và thêm workspace vào khoá là
nhân số lời gọi giống hệt nhau lên đúng bằng số tenant. Chỉ ghi cache sau khi
gọi thành công — cache một lần hỏng là kéo dài một phút xấu thành mười lăm.

Khoá YouTube lấy theo cùng thứ tự như khoá AI: khoá riêng của workspace
(`sources/youtube` trong Kho khoá) trước, `YOUTUBE_API_KEY` của máy chủ sau.
Không có cả hai thì thông báo nói rõ phải sửa cái nào.

### Chiến dịch và lịch nội dung (Phase 4)

Hai bảng, `campaigns` và `content_pieces`, và **`campaign_id` được để trống
được** — vì đó là thứ tự công việc diễn ra thật: bài được viết trước, sau đó
mới có người quyết định nó thuộc chiến dịch nào. Bắt buộc phải có chiến dịch
đồng nghĩa với việc phải bịa ra một chiến dịch rỗng chỉ để chứa một bản nháp.

`scheduled_at` là **một thời điểm tuyệt đối**, không phải giờ treo tường kèm
múi giờ. Client tự quy từ múi giờ của người dùng rồi gửi thời điểm đi. Lưu
"09:00" kèm tên múi giờ nghĩa là phải trả lời câu hỏi "bài đã hẹn sẽ ra sao khi
workspace đổi quốc gia" — mà chưa ai trả lời. API vì thế **từ chối** chuỗi
không có múi giờ (`2026-08-15T09:00:00`): đó là chín giờ ở đâu đó, và nhận nó
nghĩa là máy chủ tự đoán ở đâu.

Bốn trạng thái, với `APPROVED` nằm giữa `DRAFT` và `PUBLISHED`: **"sẵn sàng
đăng" không phải là "đã đăng"**. Gộp hai cái đó lại là cách một bản nháp được
duyệt trở thành một bài đã ra ngoài mà không ai bấm nút nào.

`PATCH` phân biệt **thiếu trường** với **trường bằng `null`**: thiếu là "để
nguyên", `null` là "xoá đi". Gộp lại thì mỗi lần đổi tên một bài là một lần nó
mất lịch đăng — và không gì bắt được, vì người gọi chưa từng nhắc tới trường
đó. Có test giữ đúng chỗ này ở cả tầng repository lẫn tầng HTTP.

Chỉ mục lịch để `(workspace_id, scheduled_at)` chứ không phải ngày trước: mọi
lượt đọc đều thuộc về một workspace, và chỉ mục theo ngày trước sẽ quét ngang
qua các tenant khác rồi mới lọc.

Lưu trữ chiến dịch **không đụng vào các bài của nó**. Một chiến dịch bị huỷ vẫn
để lại những bài ai đó đã viết và có thể muốn dùng ở chỗ khác.

### Đóng gói và chạy cả cụm

Ba service có Dockerfile chung, một compose chạy cả cụm kèm bước migrate riêng.
Chi tiết ở `docker/README.md`. Điều đáng ghi ở đây là **cái giá của việc trước
đó chưa từng đóng gói**: 65 commit, 814 test, kiểm chứng với Facebook thật — và
lần đầu chạy trong container lộ ra ba lỗi mà không thứ nào trong số đó bắt
được, trong đó **một là lỗi sản phẩm thật**: link tải file được ký bằng host
nội bộ, nên mọi triển khai có MinIO trong mạng riêng đều hỏng nút tải. Chữ ký
SigV4 phủ cả host, nên không sửa URL sau khi ký được — phải ký bằng host công
khai, và đó là `MINIO_PUBLIC_URL`.

Migration chạy như một **job riêng**, không phải một bước trong API: hai bản
API khởi động cùng lúc sẽ cùng migrate, và Postgres quyết định ai thắng bằng
cách deadlock.

## 14. Khoảng cách so với stack dự kiến

`docs/05_TECH_STACK.md` mô tả stack đầy đủ của sản phẩm. Những phần **chưa làm**:

| Dự kiến                     | Trạng thái hiện tại                                                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NATS JetStream              | Chưa. Đang dùng Redis + `InMemoryEventBus`. Quyết định có chủ đích: dùng Redis trước, nâng cấp sau                                                                                                                                                                    |
| Meilisearch                 | Chưa                                                                                                                                                                                                                                                                  |
| Social Connectors           | OAuth cho Facebook / TikTok / Threads, nối Page bằng token dán tay, **đăng bài**, **đọc hộp thư**, **số liệu tương tác** — tất cả đã kiểm chứng với Facebook thật. Chưa có: chọn Page từ `/me/accounts`, làm mới token, webhook, lượt tiếp cận, và 7 nền tảng còn lại |
| Prometheus / Grafana / Loki | **Có `GET /metrics`** dạng exposition Prometheus (thời gian request theo route, lời gọi provider, số bài đăng), tắt mặc định tới khi đặt `METRICS_TOKEN`. Chưa dựng Prometheus/Grafana/Loki để thu và vẽ                                                              |
| OpenTelemetry / Jaeger      | Chưa, và **cố ý chưa**: tracing chỉ có nghĩa khi có collector chạy thật, mà đưa vào thứ không kiểm chứng được với hạ tầng thật đúng là cách sinh lỗi mà repo này đã gặp nhiều lần. Mới có `correlationId` xuyên suốt một lần chạy                                     |
| Swagger                     | **Xong.** `GET /docs` ở môi trường phát triển, `openapi.json` commit trong repo kèm test chống trôi. Request body sinh từ chính schema zod đang validate                                                                                                              |
| Secret Manager              | **Xong phần cốt lõi.** AES-256-GCM có keyring xoay khoá, bảng `secrets` + `secret_versions`, và Gateway đọc key riêng của từng workspace (FR-031). Còn thiếu: HashiCorp Vault, scope ngoài PLATFORM/WORKSPACE, xoay khoá tự động                                      |

---

## 15. Phase 2 và Phase 3 — còn thiếu gì

Bảng này từng lạc hậu nặng: nó liệt kê là "chưa" những thứ đã làm xong từ lâu.
Một bảng sai còn tệ hơn không có bảng, nên mỗi dòng dưới đây đã được kiểm lại
với mã nguồn chứ không chép lại từ bản cũ.

### Phase 2

Bốn tiêu chí thoát đều đạt và có kiểm chứng thật: Multi Provider, Streaming
Chat, RAG, Memory.

| Deliverable                  | Trạng thái                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouter                   | **Xong.** Dùng chung giao thức OpenAI qua `createOpenAICompatible`                                                                            |
| Tool Calling trong chat      | **Xong.** Năm tool, tất cả chỉ-đọc: tài liệu, tìm trong tài liệu, ghi nhớ, hộp thư, số liệu bài đăng                                          |
| Workspace / Brand Memory     | **Xong.** Có kho riêng, có màn hình sửa                                                                                                       |
| Trích dẫn nguồn trong chat   | **Xong.** Sự kiện `sources` tới trước token đầu tiên, giao diện hiện nguồn                                                                    |
| Prompt Versioning / Registry | Mỗi prompt có version riêng, nhưng vẫn là hằng số trong mã. Kho lưu trong CSDL **đã cân nhắc và cố ý không làm** — xem ghi chú bên dưới       |
| Multi Conversation           | **Xong.** Giao diện liệt kê mọi luồng, chuyển qua lại, xoá được. Lịch sử đọc lại từ server mỗi lần chuyển chứ không giữ trong bộ nhớ theo tab |

**Vì sao không làm Prompt Registry trong CSDL.** Bản theo workspace trùng gần
hết với Workspace Memory đã có. Phần thật sự khác biệt — sửa system prompt của
Planner — không nên trao cho tenant. Bản cấp người vận hành thì đáng có, nhưng
buộc phải biến sáu hằng số prompt (đang tính một lần lúc nạp module) thành đọc
CSDL mỗi lời gọi, kèm cache, kèm đường lui khi CSDL chết: nhiều bề mặt hỏng mới
cho một lợi ích là "sửa không cần deploy".

### Phase 3

| Tiêu chí thoát  | Trạng thái                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Đăng bài        | **Đạt.** Đã đăng lên Page thật rồi xoá. Có chống trùng khi thử lại, có chặn lịch tự chạy khi không có người duyệt                                                                                                                                                               |
| Nhận tin nhắn   | **Đạt.** Đọc hộp thư Page thật, có màn hình riêng, chat cũng đọc được                                                                                                                                                                                                           |
| Đồng bộ dữ liệu | **Nửa.** Tương tác từng bài (thích / bình luận / chia sẻ) đã kiểm chứng thật. Lượt tiếp cận **cố ý chưa làm**: Meta bỏ chỉ số impressions từ 15/6/2026 và không trả chỉ số thay thế cho Page dưới ngưỡng follower, nên phần đọc phản hồi chưa từng gặp một câu trả lời thật nào |

Còn thiếu, và mỗi thứ vướng một điều kiện bên ngoài chứ không vướng mã: chọn
Page từ `/me/accounts`, làm mới token trước khi hết hạn, webhook, inbox của
TikTok / Threads, và bảy nền tảng còn lại — tất cả đều cần một ứng dụng đã đăng
ký ở nền tảng tương ứng.

---

## Phụ lục: ràng buộc không nên đổi nếu chưa kiểm tra lại

Ba trong bốn mục dưới đây hỏng **lúc chạy chứ không phải lúc build**, nên lint và
typecheck xanh không chứng minh được gì:

- **Node ≥ 24** — hạ xuống dưới 22.12 làm `packages/ai` chết lúc nạp module.
- **zod giữ ở 3.x** — nâng lên 4 sẽ đụng tầng validate của `services/api` và toàn
  bộ schema hiện có.
- **`consistent-type-imports` phải tắt cho `services/**`** ở cả hai config ESLint
  — bật lại sẽ phá dependency injection của NestJS lúc chạy.
- **Cổng lệch chuẩn** — xem mục 12.

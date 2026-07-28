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
15. [Phase 2 — những gì còn thiếu](#15-phase-2--những-gì-còn-thiếu)

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

## 14. Khoảng cách so với stack dự kiến

`docs/05_TECH_STACK.md` mô tả stack đầy đủ của sản phẩm. Những phần **chưa làm**:

| Dự kiến                     | Trạng thái hiện tại                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| NATS JetStream              | Chưa. Đang dùng Redis + `InMemoryEventBus`. Quyết định có chủ đích: dùng Redis trước, nâng cấp sau                    |
| Meilisearch                 | Chưa                                                                                                                  |
| Prometheus / Grafana / Loki | Chưa. Mới có log dạng JSON, sẵn sàng để cắm vào                                                                       |
| OpenTelemetry / Jaeger      | Chưa. Mới có `correlationId` xuyên suốt một lần chạy                                                                  |
| Swagger                     | Chưa sinh tài liệu API                                                                                                |
| Secret Manager              | **Chưa — khoảng cách đáng kể nhất.** API key đang đọc từ biến môi trường, chưa theo từng workspace như FR-031 yêu cầu |

---

## 15. Phase 2 — những gì còn thiếu

Bốn tiêu chí thoát của `docs/ROADMAP.md` Phase 2 đều đã chạy được và có kiểm
chứng thật: Multi Provider, Streaming Chat, RAG, Memory. Nhưng phần deliverables
thì chưa hết. Ghi ra để khỏi nhầm "tiêu chí thoát đạt" với "phase xong":

| Deliverable                  | Trạng thái                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| OpenRouter                   | Chưa. Dùng chung giao thức OpenAI nên thêm adapter rất rẻ                            |
| Prompt Versioning / Registry | Chưa. Prompt hiện là hằng số có gắn `PROMPT_VERSION`; chưa có kho lưu, chưa A/B được |
| Tool Calling trong chat      | Gateway đã truyền tool call qua stream, nhưng endpoint chat chưa khai báo tool nào   |
| Multi Conversation           | Có nhiều hội thoại rồi, nhưng UI mới hiện một luồng tại một thời điểm                |
| Workspace / Brand Memory     | Chưa. Mới có Conversation Memory; ghi nhớ lâu dài xuyên hội thoại là kho riêng       |
| Trích dẫn nguồn trong chat   | Chưa. `knowledge.search` có trả về nguồn, nhưng chat chưa gọi nó                     |

Điểm cuối là đáng chú ý nhất: **chat chưa đọc tài liệu của workspace.** RAG chạy
trong đường Goal, không chạy trong đường chat. Hỏi khung chat về một file vừa
tải lên thì model trả lời bằng kiến thức sẵn có của nó chứ không mở tài liệu ra.

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

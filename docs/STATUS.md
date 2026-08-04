# Trạng thái thật của hệ thống

> Cái gì đã chạy, cái gì chưa, và vì sao.

Cập nhật: 2026-08-04

---

## Vì sao có file này

`ROADMAP.md` là **kế hoạch**, không phải mô tả hệ thống. Nó được viết trước khi
code, và nhiều chỗ đã lệch — có chỗ vì gặp giới hạn thật, có chỗ vì làm rồi thấy
không đáng làm. Sửa lại roadmap cho khớp với thứ đã xây sẽ **xoá mất bản ghi ấy**:
người đọc sau sẽ tưởng mọi thứ diễn ra đúng như dự định.

Nên roadmap giữ nguyên, còn file này nói thật.

Quy ước: ✅ chạy được và có kiểm chứng · ⚠️ có một phần, ghi rõ phần nào ·
❌ chưa làm · ⛔ đã quyết định không làm, kèm lý do.

---

## Phase 0 — Foundation ✅

| Mục                              |     | Ghi chú                                                             |
| -------------------------------- | --- | ------------------------------------------------------------------- |
| Monorepo                         | ✅  | pnpm workspace + Turborepo                                          |
| Docker                           | ✅  | `pnpm stack:up` dựng cả cụm                                         |
| CI/CD                            | ✅  | GitHub Actions: lint, typecheck, test, build                        |
| PostgreSQL, Redis, MinIO, Qdrant | ✅  |                                                                     |
| Authentication, RBAC             | ✅  |                                                                     |
| API Gateway                      | ⚠️  | Là NestJS app, không phải gateway riêng. Không có gì đứng trước nó. |

---

## Phase 1 — AI Runtime ✅

Goal → Intent → Plan → DAG → Execution → Task đều chạy, có retry và dead-letter.
Policy có ngân sách và cổng duyệt. Worker Pool chạy trong tiến trình runtime.

**"Resource Manager"** trong roadmap không tồn tại như một thành phần: giới hạn
tài nguyên hiện là `batchSize` của scheduler và pool kết nối của Postgres. Đặt
tên nó là một thành phần sẽ ngụ ý có thứ để cấu hình, mà không có.

---

## Phase 2 — AI Platform ✅ (trừ một mục)

| Mục                                          |     | Ghi chú                                                                                                                                                          |
| -------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude, OpenAI, Gemini, Ollama, OpenRouter   | ✅  | Qua Vercel AI SDK. Đang chạy `gemini-2.5-flash` (bậc miễn phí), trước đó là `qwen2.5:7b` cục bộ                                                                  |
| Prompt Versioning, Template                  | ✅  | Hằng số có gắn version, trong code                                                                                                                               |
| **Prompt Registry**                          | ⛔  | Bản trong DB, sửa được lúc chạy. Không làm: nó chồng lên Workspace Memory (đã có), và bản cho operator sẽ biến 6 hằng số module thành 6 lượt đọc DB mỗi lời gọi. |
| Document Upload, Chunking, Embedding, Search | ✅  |                                                                                                                                                                  |
| Conversation Memory, Workspace Memory        | ✅  |                                                                                                                                                                  |
| Brand Memory                                 | ✅  | Không phải bảng riêng — là Workspace Memory, đúng như `docs/ai/06_AGENT_MEMORY.md` phân loại                                                                     |
| Streaming, Tool Calling, Multi Conversation  | ✅  |                                                                                                                                                                  |
| Token Usage, Cost Tracking, Budget           | ✅  | `ai_usage`, và bảng chi tiêu đọc được                                                                                                                            |

---

## Phase 3 — Social Platform ⚠️

**Đây là phase lệch nhiều nhất, vì một lý do nằm ngoài code: không có Meta app.**
Toàn bộ luồng OAuth cần một app được Meta duyệt, mất hàng tuần. Thay vào đó,
kênh được nối bằng **token dán tay** — và một user token nối được nhiều Page
cùng lúc.

| Connector                                                     |     |                                                                                                                                                                                    |
| ------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facebook                                                      | ✅  | Đăng bài, đọc inbox, đọc số liệu — đã kiểm chứng với Page thật                                                                                                                     |
| Threads, TikTok                                               | ⚠️  | Có trong catalog, nhưng **chỉ nối được qua OAuth** — mà OAuth cần app. Đường dán token từ chối cả hai, và `canPublish` cũng chỉ trả về true cho Facebook. Thực tế: chưa dùng được. |
| Messenger, Instagram, YouTube, Telegram, WhatsApp, Zalo, Lark | ❌  | Vắng mặt, không phải stub. Một nền tảng hiện trong danh sách mà không nối được là thứ tệ hơn một danh sách ngắn — người dùng phát hiện ra sau khi đã cấp quyền.                    |

| Tính năng  |     |                                                                                           |
| ---------- | --- | ----------------------------------------------------------------------------------------- |
| OAuth      | ⚠️  | Code có, chưa chạy được vì chưa có app                                                    |
| Publishing | ✅  | Kèm ảnh, có chống đăng trùng                                                              |
| Inbox      | ✅  | Chỉ đọc                                                                                   |
| Analytics  | ✅  | Like, bình luận, chia sẻ theo bài                                                         |
| Comment    | ❌  | Chỉ đọc được **số** bình luận trên mỗi bài, không đọc được nội dung và không trả lời được |
| Webhook    | ❌  | Không có endpoint nhận. Inbox đọc chủ động mỗi lần mở.                                    |

---

## Phase 4 — Marketing Platform ⚠️

| Nhóm                                          |     | Ghi chú                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content: AI Writer, SEO, Rewrite, Translation | ✅  |                                                                                                                                                                                                                                                                                                                                                                                 |
| Trend: Google Trend                           | ✅  | Qua RSS công khai. **API chính thức không dùng được** — công bố 7/2025, đến nay vẫn là alpha phải xin quyền.                                                                                                                                                                                                                                                                    |
| Trend: YouTube Trend                          | ✅  | Data API v3, cần khoá                                                                                                                                                                                                                                                                                                                                                           |
| Trend: Competitor Analysis                    | ✅  | Đọc một trang, tôn trọng robots.txt                                                                                                                                                                                                                                                                                                                                             |
| Trend: Facebook Trend, TikTok Trend           | ⛔  | Cần app của hai nền tảng đó. Cùng lý do với OAuth.                                                                                                                                                                                                                                                                                                                              |
| Media: Thumbnail, Banner                      | ✅  | Vẽ từ chữ đã viết, không cần model                                                                                                                                                                                                                                                                                                                                              |
| Media: Image Generation, Video Generation     | ⛔  | **Đã quyết định không làm** (4/8/2026). Ảnh: mọi model miễn phí của Google trả `RESOURCE_EXHAUSTED` từ đợt cắt 12/2025, phải bật thanh toán (~$0.03/ảnh). Video: Veo và Sora đều tính theo giây và đắt, còn sinh video cục bộ trên 4 GB VRAM là không thực tế. Ảnh bìa vẽ từ chữ đã đáp ứng nhu cầu thật — nó dùng chính chữ đã viết nên không bao giờ vẽ ra thứ không tồn tại. |
| Campaign, Approval, Calendar                  | ✅  |                                                                                                                                                                                                                                                                                                                                                                                 |
| Scheduler: Cron, Retry, Queue, Auto Publish   | ✅  | Đã chạy đầu-cuối với Page thật: `pnpm verify:loop`                                                                                                                                                                                                                                                                                                                              |

---

## Phase 5 — Plugin Platform ❌

`packages/plugin` và `packages/integration` chỉ có `README.md`, không có code.
Plugin SDK, Marketplace, MCP đều chưa bắt đầu.

---

## Phase 6 — Enterprise ⚠️

Có: mã hoá credential (AES-256-GCM, xoay khoá), audit trên mọi bảng, metrics
Prometheus, đo chi phí AI, sao lưu/phục hồi (`pnpm stack:backup`).

Chưa có: SSO, đa vùng, OpenTelemetry, hoá đơn.

---

## Những thứ trong tài liệu mà **không** có trong code

Ghi ở đây vì đọc doc rồi đi tìm code sẽ mất thời gian:

- **GraphQL API** (`docs/api/04_GRAPHQL_API.md`) — không có. Toàn bộ là REST,
  có OpenAPI sinh tự động ở `services/api/openapi.json`.
- **MCP** (`docs/api/06_MCP_API.md`) — không có client lẫn server.
- **Webhooks** (`docs/api/07_WEBHOOKS.md`) — không có.
- **NATS JetStream** — có trong stack dự kiến, không cài. Event bus hiện chạy
  trong tiến trình và **không có subscriber nào**; thay nó bằng NATS là thay một
  no-op bằng một no-op phân tán.
- **Meilisearch** — có trong stack dự kiến, không cài. Chưa có nhu cầu nào.
- **Reach / Impressions** — Meta đã bỏ hai chỉ số này từ 15/6/2026, và bản thay
  thế trả về rỗng nếu Page dưới ngưỡng người theo dõi.

---

## Cách tự kiểm chứng, không cần tin file này

```bash
pnpm stack:up                                   # dựng cả cụm
cd services/runtime && pnpm verify:stack        # kiểm qua API công khai
FB_TEST_PAGE_ID=… FB_TEST_PAGE_TOKEN=… pnpm verify:loop   # cả vòng lặp, Page thật
```

`verify:stack` in khoảng 47 dòng kiểm tra trong một lần chạy điển hình — con số
thay đổi theo phần bị bỏ qua. Nó gọi đúng HTTP API mà giao diện dùng, không mock
gì. Cái gì nó không kiểm được thì **bỏ qua và nói rõ là đang bỏ qua** — một dòng
"bỏ qua: chưa có FB_TEST_PAGE_ID" đáng tin hơn một dấu tích không có gì đứng sau.

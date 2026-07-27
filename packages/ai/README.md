# @repo/ai — Provider Gateway

Lớp duy nhất trong hệ thống được phép nói chuyện với nhà cung cấp AI. Worker và
Runtime chỉ thấy `ProviderRequest` / `ProviderResponse`, không biết ai đã trả lời.

Tham chiếu: `docs/runtime/05_PROVIDER_GATEWAY.md`,
`docs/runtime/19_RUNTIME_CONFIGURATION.md`.

## Dùng

```ts
import {
  ProviderGateway,
  ProviderRegistry,
  VercelProviderAdapter,
  describeProvider,
  structured,
} from "@repo/ai";

const registry = new ProviderRegistry();
registry.register(
  new VercelProviderAdapter({
    provider: "anthropic",
    defaultModel: "claude-sonnet-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),
  describeProvider("anthropic"),
);

const gateway = new ProviderGateway(registry, {
  default: "anthropic",
  fallback: ["openai"],
  timeoutMs: 60_000,
  attempts: 3,
});

const answer = await gateway.generate({
  messages: [{ role: "user", content: "Tóm tắt xu hướng AI tuần này" }],
});
// answer.text, answer.usage, answer.cost.totalUsd, answer.latencyMs
```

Khi cần kết quả có cấu trúc — Intent, Plan — dùng `generateObject`:

```ts
const PlanSchema = structured("plan", z.object({ steps: z.array(/* ... */) }));
const { object } = await gateway.generateObject(request, PlanSchema);
```

## Những quyết định đáng biết trước khi sửa

**Fallback chỉ xảy ra với lỗi tạm thời.** 429, 5xx, timeout thì thử nhà cung cấp
kế tiếp; 400 hay 401 thì dừng ngay. Một request sai định dạng sẽ sai y hệt ở mọi
nhà cung cấp, nên fallback chỉ biến một lỗi rõ ràng thành bốn lời gọi — và nếu
nhà cung cấp thứ hai lại chấp nhận, ta âm thầm tính tiền một vendor khác cho
request đã biết là sai. Cùng một phép thử quyết định cả retry lẫn fallback, ở
đúng một chỗ.

**Ghim `provider` thì không fallback.** Ai đã chỉ đích danh nhà cung cấp là có lý
do — giá, vùng dữ liệu, hành vi đã kiểm chứng. Trả lời bằng một vendor khác sau
lưng họ tệ hơn là báo lỗi.

**Demotion có hạn.** Provider bị 429 sẽ bị né trong 60s, 5xx thì 30s, sau đó được
thử lại. Không có hạn này thì một lần 429 duy nhất đủ để loại nhà cung cấp mặc
định khỏi vòng quay đến hết đời tiến trình — vì Gateway chỉ chạm tới provider đã
bị hạ cấp khi mọi provider khỏe mạnh đều đã thất bại. Con số là quyết định của
chúng ta; tài liệu vẽ cạnh `RateLimited → Healthy` nhưng không nói cái gì kích
hoạt nó.

**`BUSY` có trong vòng đời nhưng Gateway không bao giờ đặt.** Một trường trạng
thái không diễn tả được "3 trong 8 lời gọi đang bay", nên dùng nó làm tín hiệu
đồng thời sẽ sai ngay khi có hai request chồng nhau. Giới hạn đồng thời là việc
của rate limiter; registry ở đây chỉ theo dõi sức khỏe.

**Cost là ước lượng cận trên, token thô mới là sổ cái.** Token đã cache thường
được tính rẻ hơn, nhưng mức giảm khác nhau theo từng vendor và từng model — áp
một mức ta không chắc sẽ tính thiếu tiền của workspace. Vì vậy mọi token đầu vào
được tính giá đầy đủ, còn `usage.cachedInputTokens` được giữ nguyên để Billing
định giá lại chính xác sau (`docs/platform/24_BILLING_METERING.md`).

**Model không có trong bảng giá được báo `priced: false`, không phải 0.** Một báo
cáo cộng các lời gọi không rõ giá thành $0 sẽ báo thiếu chi phí mà không ai nhận
ra cho tới khi hóa đơn về. Ollama chạy cục bộ nên là số 0 thật (`priced: true`).

**Bảng giá là dữ liệu, không phải luật.** `DEFAULT_MODEL_PRICING` là ảnh chụp
theo trang giá công khai của từng vendor ngày 2026-07-27. Giá thay đổi liên tục,
nên truyền `pricing` vào `ProviderGateway` để ghi đè mà không cần phát hành lại.

**Gateway không chạy tool.** `tools` được chuyển tiếp và `toolCalls` được trả về,
nhưng việc thực thi thuộc về Runtime — chạy tác dụng phụ ở đây là chạy ngoài
đường đi của Policy Engine và audit.

**Bề mặt public không dính zod.** Schema đi vào dưới dạng `StructuredSchema`
(JSON Schema + hàm `parse`). Lý do vừa là kiến trúc — không ép mọi consumer theo
lịch phát hành của một thư viện validate — vừa là thực tế: tham số schema generic
của Vercel AI SDK không typecheck được với zod 3 mà repo đang dùng
(`TS2589: Type instantiation is excessively deep`). Ai dùng zod thì gọi
`structured()` để có cả hai nửa từ một định nghĩa duy nhất, khỏi lệch nhau.

**Ollama đi qua endpoint OpenAI-compatible.** `ollama-ai-provider-v2` yêu cầu
zod 4 còn repo đang ở zod 3; `@ai-sdk/openai-compatible` là gói first-party và
không xung đột.

## Ràng buộc runtime

Gói này build ra CommonJS như mọi package khác, nhưng `ai` và `@ai-sdk/*` chỉ
xuất bản ESM. Việc này chạy được nhờ `require(ESM)` — ổn định từ Node 22.12 trở
lên, và root `package.json` đã yêu cầu `node >= 24`. Hạ ngưỡng Node xuống dưới
22.12 sẽ làm gói này chết lúc nạp module chứ không phải lúc build, nên đừng nới
`engines` mà không kiểm tra lại.

## Kiểm thử

`StubProviderAdapter` trả lời theo bảng tra thay vì gọi mạng, nên test chạy được
đường retry, fallback và tính tiền **thật** mà không cần API key, không tốn tiền
và không đổi kết quả giữa các lần chạy. Mock thẳng Gateway thì không chứng minh
được gì về đoạn code thực sự chạy trong production.

```sh
pnpm --filter @repo/ai test
```

## Intent và Planning bằng LLM

`LlmIntentAnalyzer` và `LlmPlanner` hiện thực đúng hai port `IntentAnalyzer` /
`Planner` có sẵn từ Phase 1, nên thay chúng vào không đụng tới scheduling,
state machine hay retry. Chúng nằm ở đây chứ không ở `@repo/runtime` để giữ
chiều phụ thuộc một hướng: `ai → runtime`, không bao giờ ngược lại — nhờ vậy
`@repo/runtime` vẫn không kéo theo AI SDK.

Kết quả từ model luôn được ràng buộc bằng schema **và** kiểm tra lại khi nhận
về. Riêng planner chặn thêm ba thứ không thể tin model:

- **Capability phải có trong registry.** Một cái bịa ra sẽ thành task không
  worker nào chạy được, và chỉ lộ ra khi nó timeout.
- **Phụ thuộc chỉ được trỏ về bước trước.** Chính ràng buộc này làm chu trình
  trở nên bất khả thi về mặt cấu trúc, chứ không phải phát hiện sau;
  `validateDag` vẫn chạy phía sau như lớp thứ hai.
- **Kế hoạch bị từ chối thì raise `PLANNING` và không retry.** Gateway đã retry
  và đã đi hết chuỗi fallback rồi; lặp lại chỉ tốn thêm tiền cho cùng một lỗi.

## Kiểm chứng bằng vendor thật

Toàn bộ test dùng `StubProviderAdapter`. Điều đó chứng minh code của chúng ta
đúng, nhưng không nói gì về việc một vendor thật có hiểu prompt và trả đúng
hình dạng ta yêu cầu hay không. Script này lấp chỗ đó:

```sh
pnpm --filter @repo/runtime-service verify:llm
pnpm --filter @repo/runtime-service verify:llm "Mục tiêu của bạn"
```

Cần `AI_PROVIDER` và key tương ứng trong `.env`. Không cần database, không cần
Redis. Nếu chưa cấu hình, script dừng và báo rõ thay vì âm thầm rơi về engine
keyword rồi báo thành công — một kết quả không chứng minh được gì.

Chạy nó là cách phát hiện hai lỗi mà không test nào bắt được: Ollama cần bật
`supportsStructuredOutputs` (thiếu thì schema bị bỏ qua), và việc in thẳng đối
tượng lỗi ra `console.error` có thể làm chết tiến trình ngay trong
`util.inspect` — xem `formatError`.

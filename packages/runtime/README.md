# @repo/runtime — Execution Runtime kernel

> Phase 1. Thuần TypeScript, **không** NestJS, **không** Redis/Postgres — chạy và test được độc lập.

Hiện thực phần lõi mô tả ở `docs/kernel/`: mô hình Goal/Execution/Task, các state machine, taxonomy lỗi, và các port để tầng ngoài cắm implementation vào.

## Vì sao tách riêng, không nằm trong service

Toàn bộ quyết định khó của Runtime — transition nào hợp lệ, lỗi nào được retry, task nào chạy song song được — đều là logic thuần. Tách khỏi framework nghĩa là chúng test được không cần Docker, không cần khởi động Nest, và không phụ thuộc thứ tự dependency injection.

## Các port

| Port                         | Phase 1                                    | Phase sau                      |
| ---------------------------- | ------------------------------------------ | ------------------------------ |
| `IntentAnalyzer`             | `KeywordIntentAnalyzer` (luật từ khóa)     | Adapter LLM (Phase 2)          |
| `Planner`                    | `TemplatePlanner` (DAG theo stage cố định) | Planner do LLM sinh (Phase 2)  |
| `CapabilityRegistry`         | `InMemoryCapabilityRegistry`               | + Plugin/MCP (Phase 5)         |
| `TaskQueue`, `SchedulerLock` | Redis (Commit 2)                           | NATS JetStream                 |
| `PolicyEvaluator`            | Commit 3                                   | + Cost/Budget policy (Phase 2) |

AI Provider thuộc Phase 2 theo `docs/ROADMAP.md`, nên Phase 1 dùng bản tất định. **Đây là hạn chế thật**: `KeywordIntentAnalyzer` không suy luận được bước người dùng chỉ ngụ ý, không xử lý được đại từ mơ hồ. Đổi lại, cả pipeline tất định — mọi bug tìm được từ đây là bug của Runtime, không phải nhiễu từ model.

## Những chỗ tài liệu mâu thuẫn và lựa chọn đã chốt

| Vấn đề           | Xung đột                                                        | Chọn                                                                                             |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Execution states | `02_EXECUTION_MODEL` 11 state vs `04_STATE_MACHINE` 14 state    | **04** — nó là spec chuyên trách; 02 cho `Running → Cancelled` thẳng, sẽ bỏ rơi worker đang chạy |
| Task timeout     | 60s (doc 04) vs 2m (doc 02)                                     | **60s**, capability được phép nâng                                                               |
| Capability id    | Kernel dùng `GenerateContent`, docs ai/plugin dùng `search.web` | **dotted lowercase** — phải liên thông với Plugin/MCP vốn đã dùng dạng này                       |

Tài liệu **không hề có**: danh sách transition bị cấm (nên ở đây whitelist, ngoài danh sách là từ chối), ngưỡng confidence (chọn 0.5), ngưỡng circuit breaker (hoãn sang Phase 2 — nó bảo vệ AI Provider mà Phase 1 chưa có provider nào).

## Vài quyết định đáng chú ý

**`SUCCESS` và `COMPLETED` của Task là hai state khác nhau.** SUCCESS = worker đã trả kết quả, COMPLETED = kết quả đã ghi bền. Gộp lại sẽ mất đúng khoảnh khắc worker xong nhưng runtime chết trước khi ghi — chính là ca mà recovery phải xử lý.

**Task chỉ vào Ready khi mọi dependency đã `COMPLETED`, không phải `SUCCESS`.** Phụ thuộc vào SUCCESS sẽ để task sau đọc output chưa ghi bền.

**Lỗi nhóm MAYBE mặc định KHÔNG retry.** Chúng bao gồm các lời gọi có side effect; retry nhầm là cách một request thành ba bài đăng.

**Ước lượng thời gian tính theo critical path**, không phải tổng — task cùng wave chạy song song.

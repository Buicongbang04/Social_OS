# Task Executor

> AI Social OS Runtime Layer

Version: 2.0.0

Status: Draft

Last Updated: 2026-07-25

---

# Table of Contents

- Overview
- Why Task Executor
- Responsibilities
- Architecture
- Task Lifecycle
- Task Model
- Task Context
- Task Execution Flow
- Input Resolution
- Output Resolution
- Dependency Injection
- Task Retry
- Task Timeout
- Task Cancellation
- Task Checkpoint
- Design Decisions

---

# Overview

Task Executor là thành phần trực tiếp thực thi một Task trong Runtime.

Task Executor nhận Task từ Worker Dispatcher, chuẩn bị môi trường thực thi, gọi Worker tương ứng, xử lý kết quả và cập nhật Runtime State.

Task Executor không quyết định:

- Task nào chạy
- Worker nào được chọn
- Policy nào được áp dụng

Các quyết định đó đã được Runtime Scheduler, Worker Dispatcher và Policy Engine xử lý trước đó.

---

# Responsibilities

Task Executor chịu trách nhiệm:

- Initialize Task
- Resolve Inputs
- Build Task Context
- Execute Worker
- Handle Timeout
- Handle Retry
- Capture Output
- Update Runtime State
- Publish Events
- Release Resources

---

# Architecture

```mermaid
flowchart LR
    TaskExecutor --> ContextBuilder[Context Builder]
    TaskExecutor --> Worker
    TaskExecutor --> MemoryBus[Memory Bus]
    TaskExecutor --> EventBus[Event Bus]
    TaskExecutor --> RuntimeState[Runtime State]
    TaskExecutor --> ResultAggregator[Result Aggregator]
```

---

# Task Lifecycle

```mermaid
stateDiagram-v2
    Pending --> Initializing
    Initializing --> Running
    Running --> Completed
    Running --> Failed
    Running --> Timeout
    Running --> Cancelled
    Failed --> Retry
    Retry --> Running
    Completed --> Archived
    Cancelled --> Archived
    Timeout --> Archived
```

---

# Task Model

```typescript
Task

├── id

├── executionId

├── capability

├── workerType

├── inputs

├── outputs

├── dependencies

├── timeout

├── retryPolicy

├── priority

├── metadata

└── status
```

---

# Task Context

Mỗi Task có Context riêng.

```text
Task Context

├── Execution Context

├── Runtime Variables

├── Memory

├── Previous Outputs

├── Workspace

├── User

├── Capability Config

└── Secrets
```

Task Context chỉ tồn tại trong vòng đời của Task.

---

# Execution Flow

```mermaid
flowchart LR
    ResolveInput --> BuildContext[Build Context]
    BuildContext --> ExecuteWorker[Execute Worker]
    ExecuteWorker --> CaptureOutput[Capture Output]
    CaptureOutput --> UpdateState[Update State]
    UpdateState --> PublishEvent[Publish Event]
    PublishEvent --> Complete
```

---

# Input Resolution

Input của Task có thể đến từ nhiều nguồn.

```mermaid
flowchart LR
    ExecutionVariables[Execution Variables] --> TaskContext
    Memory --> TaskContext
    PreviousTask[Previous Task] --> TaskContext
    Secrets --> TaskContext
```

Ví dụ.

```yaml
title:

{{ previous.title }}

image:

{{ memory.brand.logo }}

language:

vi
```

---

# Dependency Injection

Task Executor tự động Inject Dependency.

Ví dụ.

```
Generate Image
```

được Inject.

```
Article Content

Brand Guideline

Logo

Color Palette
```

Worker chỉ nhận Context đã hoàn chỉnh.

---

# Worker Invocation

```mermaid
sequenceDiagram
    Worker->>Gateway: Invoke Provider
    Gateway-->>Worker: Result
    Worker-->>Task Executor: Output
```

Task Executor không gọi AI Provider trực tiếp.

---

# Output Resolution

Output sau khi Worker hoàn thành.

```mermaid
flowchart LR
    Normalize --> Validate
    Validate --> Store
    Store --> ResultAggregator[Result Aggregator]
```

Nếu Output không hợp lệ.

Task sẽ Failed.

---

# Output Model

```typescript
Task Output

├── result

├── artifacts

├── logs

├── metrics

├── metadata

└── status
```

---

# Task Variables

Task có thể sinh Runtime Variable.

Ví dụ.

```
generated_title

generated_image

hashtags

video_url
```

Các Task phía sau có thể sử dụng.

---

# Task Checkpoint

Sau khi hoàn thành.

Task Executor lưu Snapshot.

```text
Checkpoint

├── Inputs

├── Outputs

├── Variables

├── Runtime State

└── Timestamp
```

Checkpoint phục vụ Recovery.

---

# Task Timeout

Ví dụ.

```yaml
timeout:

120s
```

Nếu vượt quá.

```mermaid
flowchart LR
    Timeout --> CancelWorker[Cancel Worker]
    CancelWorker --> Retry
    CancelWorker --> Failed
```

---

# Task Retry

Retry tuân theo Retry Policy.

Ví dụ.

```yaml
max_attempts:

3

strategy:

exponential_backoff
```

Retry không tạo Task mới.

Task ID được giữ nguyên.

---

# Task Cancellation

Task có thể bị hủy bởi:

- User
- Policy Engine
- Runtime Shutdown
- Dependency Failure

```mermaid
flowchart LR
    StopWorker --> ReleaseResource[Release Resource]
    ReleaseResource --> Cancelled
```

---

# Runtime State Update

Sau mỗi Task.

Task Executor cập nhật.

```text
Execution Progress

Completed Tasks

Variables

Outputs

Metrics

Runtime State
```

---

# Event Publishing

Task Executor phát Event.

Ví dụ.

- TaskStarted
- TaskCompleted
- TaskFailed
- TaskTimeout
- TaskCancelled
- TaskRetried

Các Event được gửi tới Event Bus.

---

# Failure Handling

Nếu Worker trả lỗi.

Task Executor.

- ghi Log
- cập nhật Runtime State
- phát Event
- Retry nếu cần
- Fallback nếu Policy cho phép

---

# Metrics

Theo dõi.

- Task Duration
- Task Success Rate
- Retry Count
- Timeout Count
- Average Execution Time
- Input Size
- Output Size

---

# Design Decisions

| Decision | Reason |
|-----------|--------|
| Executor không chọn Worker | Single Responsibility |
| Context Build riêng | Dễ mở rộng |
| Output Normalize | Chuẩn hóa Runtime |
| Checkpoint sau mỗi Task | Recovery |
| Retry giữ nguyên Task ID | Dễ Trace |
| Event sau mỗi trạng thái | Quan sát hệ thống |

---

# Runtime Flow

```mermaid
flowchart LR
    TaskExecutor --> Worker
    Worker --> Gateway
    Gateway --> Provider
    Provider --> Worker
    Worker --> TaskExecutor
    TaskExecutor --> ResultAggregator[Result Aggregator]
    ResultAggregator --> RuntimeState[Runtime State]
```

---

# Summary

Task Executor là thành phần trực tiếp điều khiển quá trình thực thi của từng Task trong AI Social OS Runtime.

Task Executor chịu trách nhiệm chuẩn bị Context, gọi Worker, xử lý kết quả, cập nhật Runtime State và phát Event mà không tham gia vào việc lập kế hoạch hay lựa chọn Worker.

Thiết kế này giúp Runtime có thể thực thi hàng triệu Task một cách nhất quán, hỗ trợ Retry, Timeout, Checkpoint và Recovery, đồng thời giữ cho các Worker luôn đơn giản, độc lập và dễ mở rộng.
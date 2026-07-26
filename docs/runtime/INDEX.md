# Runtime Documentation Index

> AI Social OS Runtime Layer

Version: 2.0.0

Status: Stable

Last Updated: 2026-07-25

---

# Overview

Bộ tài liệu Runtime mô tả toàn bộ kiến trúc và cơ chế vận hành của AI Social OS Runtime.

Runtime là nền tảng thực thi trung tâm của AI Social OS, chịu trách nhiệm điều phối Workflow, Agent, Automation và toàn bộ vòng đời của Execution.

Các tài liệu được tổ chức từ kiến trúc cốt lõi đến hạ tầng vận hành và hướng dẫn phát triển.

---

# Documentation Map

```mermaid
mindmap
  root((Runtime))
    Foundation
    Runtime Overview
    Execution Model
    Runtime Engine
    Execution
    Execution Graph
    Task Model
    Scheduler
    Dispatcher
    Worker Pool
    Infrastructure
    Runtime State
    Event Bus
    Result Aggregator
    Progress Tracker
    Runtime Cache
    Runtime Storage
    Operations
    Observability
    Runtime Security
    Runtime Recovery
    Runtime Scaling
    Runtime Configuration
    Integration
    Runtime API
    Runtime Deployment
    Runtime CLI
    Runtime SDK
    Engineering
    Runtime Best Practices
```

---

# Foundation

| File | Description |
|------|-------------|
| 01_RUNTIME_OVERVIEW.md | Tổng quan Runtime |
| 02_EXECUTION_MODEL.md | Mô hình Execution |
| 03_RUNTIME_ENGINE.md | Runtime Engine |

---

# Execution Layer

| File | Description |
|------|-------------|
| 04_EXECUTION_GRAPH.md | Execution Graph |
| 05_TASK_MODEL.md | Task Model |
| 06_SCHEDULER.md | Scheduler |
| 07_DISPATCHER.md | Dispatcher |
| 08_WORKER_POOL.md | Worker Pool |

---

# Runtime Infrastructure

| File | Description |
|------|-------------|
| 09_RUNTIME_STATE.md | Runtime State |
| 10_EVENT_BUS.md | Event Bus |
| 11_RESULT_AGGREGATOR.md | Result Aggregator |
| 12_PROGRESS_TRACKER.md | Progress Tracker |
| 13_RUNTIME_CACHE.md | Runtime Cache |
| 14_RUNTIME_STORAGE.md | Runtime Storage |

---

# Runtime Operations

| File | Description |
|------|-------------|
| 15_OBSERVABILITY.md | Observability |
| 16_RUNTIME_SECURITY.md | Runtime Security |
| 17_RUNTIME_RECOVERY.md | Runtime Recovery |
| 18_RUNTIME_SCALING.md | Runtime Scaling |
| 19_RUNTIME_CONFIGURATION.md | Runtime Configuration |

---

# Runtime Integration

| File | Description |
|------|-------------|
| 20_RUNTIME_API.md | Runtime API |
| 21_RUNTIME_DEPLOYMENT.md | Runtime Deployment |
| 22_RUNTIME_CLI.md | Runtime CLI |
| 23_RUNTIME_SDK.md | Runtime SDK |

---

# Engineering

| File | Description |
|------|-------------|
| 24_RUNTIME_BEST_PRACTICES.md | Best Practices |

---

# Learning Path

```mermaid
flowchart LR
    C[03 Runtime Engine] --> D[Execution Layer]
    D --> E[Infrastructure]
    E --> F[Operations]
    F --> G[Integration]
    G --> H[Best Practices]
```

---

# Dependency Graph

```mermaid
flowchart LR
    Runtime_Engine --> Scheduler
    Runtime_Engine --> Dispatcher
    Runtime_Engine --> Worker_Pool
    Scheduler --> Execution_Graph
    Dispatcher --> Task_Model
    Worker_Pool --> Runtime_State
    Runtime_State --> Runtime_Storage
    Runtime_State --> Runtime_Cache
    Runtime_Engine --> Event_Bus
    Event_Bus --> Result_Aggregator
    Result_Aggregator --> Progress_Tracker
    Runtime_Engine --> Observability
    Runtime_Engine --> Security
    Runtime_Engine --> Recovery
    Runtime_Engine --> Scaling
    Runtime_Engine --> Configuration
    Runtime_Engine --> Runtime_API
    Runtime_API --> CLI
    Runtime_API --> SDK
    Deployment --> Runtime_API
    Best_Practices --> Deployment
```

---

# Summary

Bộ Runtime Documentation bao gồm 24 tài liệu chuyên sâu và 2 tài liệu điều hướng (`README.md` và `INDEX.md`), mô tả toàn bộ kiến trúc, vòng đời thực thi, hạ tầng, vận hành, tích hợp và các nguyên tắc kỹ thuật của AI Social OS Runtime.

Các tài liệu được thiết kế theo hướng độc lập nhưng có liên kết chặt chẽ, giúp người đọc có thể tiếp cận từng chủ đề riêng lẻ hoặc nghiên cứu toàn bộ Runtime như một nền tảng điều phối AI hoàn chỉnh.
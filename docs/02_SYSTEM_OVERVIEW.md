# System Overview

> High-Level Overview of AI Social OS

Version: 2.0.0

Status: Draft

Last Updated: 2026-07-25

---

# Table of Contents

- Overview
- System Goals
- Design Principles
- System Architecture
- Core Components
- Runtime Lifecycle
- Execution Flow
- Data Flow
- External Systems
- Storage
- Communication
- Security
- Scalability
- Deployment

---

# Overview

AI Social OS được thiết kế như một **AI Runtime Platform**.

Thay vì xây dựng Workflow bằng Node như n8n, Runtime sẽ tiếp nhận Goal và tự điều phối toàn bộ quá trình thực thi.

Runtime là trung tâm của hệ thống.

Mọi Module đều hoạt động thông qua Runtime.

---

# System Goals

Hệ thống được thiết kế để đáp ứng các mục tiêu sau.

- AI Native
- Runtime First
- Event Driven
- Modular
- Extensible
- Cloud Native
- Provider Agnostic
- Connector Agnostic
- Plugin First
- Enterprise Ready

---

# Design Principles

```mermaid
mindmap
  root((AI Social OS))
    Runtime
    Capability
    Worker
    Provider
    Connector
    Plugin
    MCP
    Event Bus
    Memory Bus
```

---

# System Architecture

```mermaid
flowchart LR
    %% =========================
    %% Client
    %% =========================
    subgraph Client
    User[User]
    WebApp[Web App]
    Admin[Admin]
    end
    %% =========================
    %% Gateway
    %% =========================
    subgraph Gateway
    APIGateway[API Gateway]
    WebSocket[WebSocket]
    Webhook[Webhook]
    end
    %% =========================
    %% Runtime
    %% =========================
    subgraph Runtime
    ExecutionRuntime[Execution Runtime]
    IntentEngine[Intent Engine]
    PlanningEngine[Planning Engine]
    PolicyEngine[Policy Engine]
    ContextEngine[Context Engine]
    CapabilityEngine[Capability Engine]
    Scheduler[Scheduler]
    StateManager[State Manager]
    EventBus[Event Bus]
    MemoryBus[Memory Bus]
    end
    %% =========================
    %% Worker
    %% =========================
    subgraph Worker
    WorkerPool[Worker Pool]
    LLMWorker[LLM Worker]
    CrawlerWorker[Crawler Worker]
    MediaWorker[Media Worker]
    BrowserWorker[Browser Worker]
    PluginWorker[Plugin Worker]
    WorkerPool --> LLMWorker
    WorkerPool["WorkerPool"] --> CrawlerWorker
    WorkerPool["WorkerPool"] --> MediaWorker
    WorkerPool["WorkerPool"] --> BrowserWorker
    WorkerPool["WorkerPool"] --> PluginWorker
    end
    %% =========================
    %% Platform Gateway
    %% =========================
    subgraph Gateway2
    ProviderGateway[Provider Gateway]
    ConnectorGateway[Connector Gateway]
    PluginRuntime[Plugin Runtime]
    MCPClient[MCP Client]
    end
    %% =========================
    %% Storage
    %% =========================
    subgraph Storage
    PostgreSQL[(PostgreSQL)]
    Redis[(Redis)]
    Qdrant[(Qdrant)]
    MinIO[(MinIO)]
    end
    %% =========================
    %% Flow
    WebApp["%% ========================= WebApp"] --> APIGateway
    User["User"] --> WebApp
    Admin["Admin"] --> WebApp
    APIGateway["APIGateway"] --> ExecutionRuntime
    ExecutionRuntime["ExecutionRuntime"] --> IntentEngine
    ExecutionRuntime["ExecutionRuntime"] --> PlanningEngine
    ExecutionRuntime["ExecutionRuntime"] --> PolicyEngine
    ExecutionRuntime["ExecutionRuntime"] --> ContextEngine
    ExecutionRuntime["ExecutionRuntime"] --> CapabilityEngine
    ExecutionRuntime["ExecutionRuntime"] --> Scheduler
    ExecutionRuntime["ExecutionRuntime"] --> StateManager
    ExecutionRuntime["ExecutionRuntime"] --> EventBus
    ExecutionRuntime["ExecutionRuntime"] --> MemoryBus
    CapabilityEngine["CapabilityEngine"] --> WorkerPool
    LLMWorker["LLMWorker"] --> ProviderGateway
    CrawlerWorker["CrawlerWorker"] --> ConnectorGateway
    MediaWorker["MediaWorker"] --> ConnectorGateway
    BrowserWorker["BrowserWorker"] --> ConnectorGateway
    PluginWorker["PluginWorker"] --> PluginRuntime
    PluginRuntime["PluginRuntime"] --> MCPClient
    ExecutionRuntime["ExecutionRuntime"] --> PostgreSQL
    ExecutionRuntime["ExecutionRuntime"] --> Redis
    ExecutionRuntime["ExecutionRuntime"] --> Qdrant
    ExecutionRuntime["ExecutionRuntime"] --> MinIO
```

---

# Runtime Responsibilities

Execution Runtime là Kernel của AI Social OS.

Runtime chịu trách nhiệm:

- tiếp nhận Goal
- phân tích Intent
- lập kế hoạch
- xây dựng Context
- kiểm tra Permission
- lựa chọn Capability
- điều phối Worker
- quản lý State
- Retry
- Timeout
- Audit
- Logging
- Event
- Memory

Runtime **không trực tiếp gọi AI Provider**.

---

# Runtime Lifecycle

```mermaid
stateDiagram-v2
    GoalReceived --> Planning
    Planning --> Waiting
    Waiting --> Running
    Running --> Paused
    Paused --> Running
    Running --> Completed
    Running --> Failed
    Failed --> Retry
    Retry --> Running
    Completed --> Archived
    Archived --> [*]
```

---

# Execution Flow

```mermaid
sequenceDiagram
    actor User
    participant API
    participant Runtime
    participant Intent
    participant Planner
    participant Capability
    participant Worker
    participant Provider
    User->>API: Submit Goal
    API->>Runtime: Create Execution
    Runtime->>Intent: Analyze Goal
    Intent-->>Runtime: Intent
    Runtime->>Planner: Build Plan
    Planner-->>Runtime: Execution Plan
    Runtime->>Capability: Resolve Capability
    Capability-->>Runtime: Worker Type
    Runtime->>Worker: Execute Task
    Worker->>Provider: Call AI
    Provider-->>Worker: Response
    Worker-->>Runtime: Result
    Runtime-->>API: Final Result
    API-->>User: Response
```

---

# Execution Pipeline

```mermaid
flowchart LR
    Planning --> Execution_Plan["Execution Plan"]
    Execution_Plan --> Policy
    Policy --> Capability
    Capability --> Worker
    Worker --> Provider
    Provider --> Result
    Result --> Memory
    Memory --> Analytics
```

---

# Event Flow

Mọi thay đổi trong Runtime đều được phát thành Event.

```mermaid
flowchart LR
    TaskCreated --> TaskStarted
    TaskStarted --> TaskCompleted
    TaskCompleted --> ExecutionCompleted
```

Ví dụ Event:

- ConversationCreated
- ContentGenerated
- ImageGenerated
- VideoGenerated
- CampaignCreated
- PublishStarted
- PublishCompleted
- ApprovalRequested

---

# Memory Flow

```mermaid
flowchart LR
    Short_Memory --> Memory_Bus
    Memory_Bus --> Long_Memory["Long Memory"]
    Memory_Bus --> Knowledge
    Knowledge --> Context_Engine["Context Engine"]
```

Memory không được truy cập trực tiếp bởi Worker.

Mọi truy cập đều thông qua Memory Bus.

---

# Capability Flow

Capability mô tả **hệ thống có thể làm gì**.

Ví dụ:

- Generate Content
- Generate Image
- Generate Video
- Publish Facebook
- Crawl Website
- Research Trend
- Send Lark Message

Capability không chứa Business Logic.

---

# Worker Flow

Worker thực thi Capability.

```mermaid
flowchart LR
    Provider --> Result
```

Ví dụ:

- LLM Worker
- Browser Worker
- Python Worker
- Media Worker
- Connector Worker

---

# Provider Gateway

Provider Gateway chuẩn hóa toàn bộ AI Provider.

Runtime không biết:

- Claude
- GPT
- Gemini

Runtime chỉ biết Provider Gateway.

```mermaid
flowchart LR
    Provider_Gateway["Provider Gateway"] --> Claude
    Provider_Gateway["Provider Gateway"] --> OpenAI
    Provider_Gateway["Provider Gateway"] --> Gemini
    Provider_Gateway["Provider Gateway"] --> Ollama
```

---

# Connector Gateway

Connector Gateway chuẩn hóa toàn bộ Social Platform.

```mermaid
flowchart LR
    Connector_Gateway["Connector Gateway"] --> Facebook
    Connector_Gateway["Connector Gateway"] --> Instagram
    Connector_Gateway["Connector Gateway"] --> Messenger
    Connector_Gateway["Connector Gateway"] --> Telegram
    Connector_Gateway["Connector Gateway"] --> TikTok
    Connector_Gateway["Connector Gateway"] --> Lark
    Connector_Gateway["Connector Gateway"] --> WhatsApp
    Connector_Gateway["Connector Gateway"] --> Zalo
```

---

# Plugin Runtime

Plugin Runtime cho phép mở rộng hệ thống mà không sửa Core.

Plugin có thể đăng ký:

- Capability
- Worker
- Provider
- Connector
- API
- UI
- Prompt

---

# MCP

MCP Runtime tương thích với Model Context Protocol.

```mermaid
flowchart LR
    Runtime[Runtime]
    MCPClient[MCP Client]
    MCPServer[MCP Server]
    ExternalTool[External Tool]
    Runtime --> MCPClient
    MCPClient["MCPClient"] --> MCPServer
    MCPServer["MCPServer"] --> ExternalTool
```

Ví dụ:

- GitHub
- Notion
- PostgreSQL
- Google Drive
- Slack
- Browser

---

# Storage Architecture

| Storage | Purpose |
|----------|----------|
| PostgreSQL | Business Data |
| Redis | Cache & Queue |
| Qdrant | Vector Database |
| MinIO | Object Storage |

---

# External Systems

## AI Providers

- Claude
- OpenAI
- Gemini
- Ollama
- OpenRouter

---

## Social Platforms

> Đây là các nền tảng bên ngoài được kết nối qua Integration Layer / Connector Gateway, khác với mạng xã hội nội bộ (native) mô tả tại `docs/social_network/` (hạng mục tầm nhìn dài hạn, chưa thuộc roadmap hiện tại).

- Facebook
- Messenger
- Instagram
- Threads
- TikTok
- YouTube
- Telegram
- WhatsApp
- Zalo
- Lark

---

## AI Services

- Image Generation
- Video Generation
- Speech To Text
- Text To Speech
- OCR

---

# Communication

| Component | Protocol |
|------------|----------|
| Browser --> API | HTTPS |
| API --> Runtime | Internal API |
| Runtime --> Worker | NATS |
| Worker --> Provider | HTTPS |
| Worker --> Connector | HTTPS |
| Runtime --> Browser | WebSocket |
| Social --> Runtime | Webhook |

---

# Security Model

Runtime áp dụng nhiều lớp bảo mật.

- Authentication
- Authorization
- RBAC
- Workspace Isolation
- Secret Vault
- Audit Log
- API Key Encryption

---

# Scalability

```mermaid
flowchart LR
    LoadBalancer[Load Balancer]
    APICluster[API × N]
    RuntimeCluster[Runtime × N]
    WorkerPool[Worker Pool × N]
    ProviderGateway[Provider Gateway]
    ConnectorGateway[Connector Gateway]
    LoadBalancer --> APICluster
    APICluster["APICluster"] --> RuntimeCluster
    RuntimeCluster["RuntimeCluster"] --> WorkerPool
    WorkerPool["WorkerPool"] --> ProviderGateway
    WorkerPool["WorkerPool"] --> ConnectorGateway
```

Các thành phần có thể scale độc lập.

- API
- Runtime
- Worker
- Queue
- Connector

---

# Deployment Overview

```mermaid
flowchart LR
    Browser[Browser]
    Cloudflare[Cloudflare]
    APIGateway[API Gateway]
    RuntimeCluster[Runtime Cluster]
    PostgreSQL[(PostgreSQL)]
    Redis[(Redis)]
    Qdrant[(Qdrant)]
    MinIO[(MinIO)]
    WorkerCluster[Worker Cluster]
    AIProviders[AI Providers]
    SocialPlatforms[Social Platforms]
    Browser --> Cloudflare
    Cloudflare["Cloudflare"] --> APIGateway
    APIGateway["APIGateway"] --> RuntimeCluster
    RuntimeCluster["RuntimeCluster"] --> PostgreSQL
    RuntimeCluster["RuntimeCluster"] --> Redis
    RuntimeCluster["RuntimeCluster"] --> Qdrant
    RuntimeCluster["RuntimeCluster"] --> MinIO
    RuntimeCluster["RuntimeCluster"] --> WorkerCluster
    WorkerCluster["WorkerCluster"] --> AIProviders
    WorkerCluster["WorkerCluster"] --> SocialPlatforms
```

---

# Summary

AI Social OS được xây dựng theo mô hình **Runtime-Centric Architecture**.

Execution Runtime đóng vai trò Kernel, điều phối toàn bộ hệ thống.

Các thành phần như Capability Engine, Worker, Provider Gateway, Connector Gateway, Plugin Runtime và MCP Client đều hoạt động thông qua Runtime.

Nhờ kiến trúc này, hệ thống có thể:

- hỗ trợ nhiều AI Provider
- kết nối nhiều nền tảng Social
- mở rộng bằng Plugin hoặc MCP
- scale từng thành phần độc lập
- phát triển từ Marketing Automation thành AI Operating System mà không cần thay đổi kiến trúc cốt lõi.
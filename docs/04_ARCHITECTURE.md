# Architecture

> AI Social OS System Architecture

Version: 2.0.0

Status: Draft

Last Updated: 2026-07-25

---

# Table of Contents

- Architecture Philosophy
- Design Principles
- High-Level Architecture
- Runtime Architecture
- Core Components
- Execution Flow
- AI Layer
- Social Layer
- Plugin Layer
- MCP Layer
- Data Layer
- Infrastructure Layer
- Security Layer
- Deployment Architecture

---

# Architecture Philosophy

AI Social OS được xây dựng theo kiến trúc **Runtime-Centric Architecture**.

Khác với n8n, Make hay Zapier, hệ thống không lấy Workflow làm trung tâm.

Thay vào đó, **Execution Runtime** là trái tim của toàn bộ nền tảng.

Mọi tác vụ đều đi qua Runtime.

Runtime quyết định:

- phân tích Goal
- lập kế hoạch
- lựa chọn AI
- lựa chọn Tool
- điều phối Worker
- quản lý Memory
- theo dõi State
- Retry
- Audit

---

# Design Principles

```mermaid
mindmap
  root((Architecture))
    Runtime First
    AI Native
    Event Driven
    Capability Driven
    Worker Driven
    Plugin First
    Provider Agnostic
    Cloud Native
    Scalable
    Observable
```

---

# Overall Architecture

```mermaid
flowchart LR
    %% =========================
    %% Client
    %% =========================
    subgraph Client
    Web[Web]
    Admin[Admin]
    API[API]
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
    CapabilityEngine[Capability Engine]
    ContextEngine[Context Engine]
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
    BrowserWorker[Browser Worker]
    MediaWorker[Media Worker]
    PythonWorker[Python Worker]
    ConnectorWorker[Connector Worker]
    PluginWorker[Plugin Worker]
    WorkerPool --> LLMWorker
    WorkerPool["WorkerPool"] --> BrowserWorker
    WorkerPool["WorkerPool"] --> MediaWorker
    WorkerPool["WorkerPool"] --> PythonWorker
    WorkerPool["WorkerPool"] --> ConnectorWorker
    WorkerPool["WorkerPool"] --> PluginWorker
    end
    %% =========================
    %% Gateway
    %% =========================
    subgraph Gateway
    GatewayCore[Gateway]
    ProviderGateway[Provider Gateway]
    ConnectorGateway[Connector Gateway]
    PluginRuntime[Plugin Runtime]
    MCPClient[MCP Client]
    GatewayCore --> ProviderGateway
    GatewayCore["GatewayCore"] --> ConnectorGateway
    GatewayCore["GatewayCore"] --> PluginRuntime
    PluginRuntime["PluginRuntime"] --> MCPClient
    end
    %% =========================
    %% Storage
    %% =========================
    subgraph Storage
    StorageCore[Storage]
    PostgreSQL[(PostgreSQL)]
    Redis[(Redis)]
    Qdrant[(Qdrant)]
    MinIO[(MinIO)]
    Meilisearch[(Meilisearch)]
    StorageCore --> PostgreSQL
    StorageCore["StorageCore"] --> Redis
    StorageCore["StorageCore"] --> Qdrant
    StorageCore["StorageCore"] --> MinIO
    StorageCore["StorageCore"] --> Meilisearch
    end
    %% =========================
    %% Flow
    Web["%% ========================= Web"] --> ExecutionRuntime
    Admin["Admin"] --> ExecutionRuntime
    API["API"] --> ExecutionRuntime
    Webhook["Webhook"] --> ExecutionRuntime
    ExecutionRuntime["ExecutionRuntime"] --> IntentEngine
    ExecutionRuntime["ExecutionRuntime"] --> PlanningEngine
    ExecutionRuntime["ExecutionRuntime"] --> PolicyEngine
    ExecutionRuntime["ExecutionRuntime"] --> CapabilityEngine
    ExecutionRuntime["ExecutionRuntime"] --> ContextEngine
    ExecutionRuntime["ExecutionRuntime"] --> Scheduler
    ExecutionRuntime["ExecutionRuntime"] --> StateManager
    ExecutionRuntime["ExecutionRuntime"] --> EventBus
    ExecutionRuntime["ExecutionRuntime"] --> MemoryBus
    CapabilityEngine["CapabilityEngine"] --> WorkerPool
    WorkerPool["WorkerPool"] --> GatewayCore
    ExecutionRuntime["ExecutionRuntime"] --> StorageCore
```

---

# Architecture Layers

```mermaid
flowchart LR
    Runtime --> Capability
    Capability --> Worker
    Worker --> Gateway
    Gateway --> Infrastructure
```

---

# Layer Responsibilities

| Layer | Responsibility |
|---------|----------------|
| Presentation | Dashboard, Chat, Marketing UI |
| Application | API, Authentication, Permission |
| Runtime | Goal Execution |
| Capability | What the system can do |
| Worker | Execute the capability |
| Gateway | Connect external services |
| Infrastructure | Storage, Queue, Monitoring |

---

# Runtime Architecture

Execution Runtime là Kernel của toàn bộ hệ thống.

```mermaid
flowchart LR
    Planning_Engine["Planning Engine"] --> Context_Engine["Context Engine"]
    Context_Engine --> Policy_Engine["Policy Engine"]
    Policy_Engine --> Capability_Engine["Capability Engine"]
    Capability_Engine --> Worker_Dispatcher["Worker Dispatcher"]
    Worker_Dispatcher --> Worker
    Worker --> Result
```

---

# Runtime Components

## Execution Runtime

Điều phối toàn bộ vòng đời của một Execution.

---

## Intent Engine

Phân tích Goal.

Ví dụ

```
Viết bài Facebook về AI
```

```mermaid
flowchart LR
```

```
GenerateContent
```

---

## Planning Engine

Sinh Execution Plan.

Ví dụ

```mermaid
flowchart LR
```

---

## Context Engine

Thu thập Context.

Nguồn Context

- Conversation
- Memory
- Knowledge
- Prompt
- Workspace
- Brand

---

## Policy Engine

Áp dụng Policy.

Ví dụ

- Approval
- Permission
- Retry
- Timeout
- Budget

---

## Capability Engine

Tìm Capability phù hợp.

Ví dụ

```mermaid
flowchart LR
```

---

## Worker Dispatcher

Lựa chọn Worker.

Ví dụ

```mermaid
flowchart LR
```

---

# Runtime Lifecycle

```mermaid
stateDiagram-v2
    Created --> Planning
    Planning --> Ready
    Ready --> Running
    Running --> Waiting
    Waiting --> Running
    Running --> Completed
    Running --> Failed
    Failed --> Retry
    Retry --> Running
    Completed --> Archived
```

---

# Execution Flow

```mermaid
sequenceDiagram
    Runtime->>Intent: Analyze
    Intent-->>Runtime: Intent
    Runtime->>Planner: Plan
    Planner-->>Runtime: Execution Plan
    Runtime->>Capability: Resolve
    Capability-->>Runtime: Worker
    Runtime->>Worker: Execute
    Worker->>Gateway: External Call
    Gateway-->>Worker: Response
    Worker-->>Runtime: Result
    Runtime-->>User: Final Result
```

---

# Capability Layer

Capability mô tả **khả năng của hệ thống**.

Ví dụ

```
GenerateContent

GenerateImage

PublishFacebook

SendLark

SearchKnowledge

ResearchTrend

CreateVideo
```

Capability không chứa Business Logic.

---

# Worker Layer

Worker chịu trách nhiệm thực thi.

```mermaid
flowchart LR
    Worker --> ExternalService[External Service]
```

Ví dụ

| Worker | Responsibility |
|---------|----------------|
| LLM Worker | Chat, Completion |
| Browser Worker | Crawl Website |
| Media Worker | Image, Video |
| Connector Worker | Social API |
| Plugin Worker | Plugin Execution |
| Python Worker | AI Script |

---

# AI Layer

```mermaid
flowchart LR
    Provider_Gateway["Provider Gateway"] --> Claude
    Provider_Gateway["Provider Gateway"] --> GPT
    Provider_Gateway["Provider Gateway"] --> Gemini
    Provider_Gateway["Provider Gateway"] --> Ollama
    Provider_Gateway["Provider Gateway"] --> OpenRouter
```

Provider Gateway chuẩn hóa API của tất cả AI Provider.

---

# Social Layer

```mermaid
flowchart LR
    ConnectorWorker[Connector Worker]
    ConnectorGateway[Connector Gateway]
    Facebook[Facebook]
    Messenger[Messenger]
    Instagram[Instagram]
    Threads[Threads]
    TikTok[TikTok]
    Telegram[Telegram]
    WhatsApp[WhatsApp]
    YouTube[YouTube]
    Zalo[Zalo]
    Lark[Lark]
    ConnectorWorker --> ConnectorGateway
    ConnectorGateway["ConnectorGateway"] --> Facebook
    ConnectorGateway["ConnectorGateway"] --> Messenger
    ConnectorGateway["ConnectorGateway"] --> Instagram
    ConnectorGateway["ConnectorGateway"] --> Threads
    ConnectorGateway["ConnectorGateway"] --> TikTok
    ConnectorGateway["ConnectorGateway"] --> Telegram
    ConnectorGateway["ConnectorGateway"] --> WhatsApp
    ConnectorGateway["ConnectorGateway"] --> YouTube
    ConnectorGateway["ConnectorGateway"] --> Zalo
    ConnectorGateway["ConnectorGateway"] --> Lark
```

---

# Plugin Layer

Plugin Runtime cho phép cài đặt Plugin tương tự Claude Desktop.

Plugin có thể mở rộng:

- Capability
- Worker
- Connector
- Provider
- Prompt
- Dashboard Widget
- API
- UI Component

---

# MCP Layer

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

Ví dụ

- GitHub
- PostgreSQL
- Notion
- Slack
- Browser
- Filesystem

---

# Event Bus

Mọi thành phần giao tiếp bằng Event.

```mermaid
flowchart LR
    Runtime[Runtime]
    EventBus[Event Bus]
    Worker[Worker]
    Analytics[Analytics]
    Notification[Notification]
    Audit[Audit]
    Runtime --> EventBus
    EventBus["EventBus"] --> Worker
    EventBus["EventBus"] --> Analytics
    EventBus["EventBus"] --> Notification
    EventBus["EventBus"] --> Audit
```

---

# Memory Bus

Memory không được truy cập trực tiếp.

```mermaid
flowchart LR
    Runtime[Runtime]
    MemoryBus[Memory Bus]
    ShortMemory[Short Memory]
    LongMemory[Long Memory]
    Knowledge[Knowledge]
    BrandMemory[Brand Memory]
    Runtime --> MemoryBus
    MemoryBus["MemoryBus"] --> ShortMemory
    MemoryBus["MemoryBus"] --> LongMemory
    MemoryBus["MemoryBus"] --> Knowledge
    MemoryBus["MemoryBus"] --> BrandMemory
```

---

# Storage Architecture

```mermaid
flowchart LR
    Runtime["Runtime"] --> PostgreSQL
    Runtime["Runtime"] --> Redis
    Runtime["Runtime"] --> Qdrant
    Runtime["Runtime"] --> MinIO
    Runtime["Runtime"] --> Meilisearch
```

---

# Security Architecture

```mermaid
flowchart LR
    Authentication[Authentication]
    Authorization[Authorization]
    RBAC[RBAC]
    WorkspaceIsolation[Workspace Isolation]
    SecretVault[Secret Vault]
    AuditLog[Audit Log]
    Authentication --> Authorization
    Authorization["Authorization"] --> RBAC
    RBAC["RBAC"] --> WorkspaceIsolation
    WorkspaceIsolation["WorkspaceIsolation"] --> SecretVault
    SecretVault["SecretVault"] --> AuditLog
```

---

# Deployment Architecture

```mermaid
flowchart LR
    Internet[Internet]
    Cloudflare[Cloudflare]
    Traefik[Traefik]
    API[API]
    RuntimeCluster[Runtime Cluster]
    WorkerCluster[Worker Cluster]
    PostgreSQL[(PostgreSQL)]
    Redis[(Redis)]
    Qdrant[(Qdrant)]
    MinIO[(MinIO)]
    AIProviders[AI Providers]
    SocialPlatforms[Social Platforms]
    MCPServers[MCP Servers]
    Internet --> Cloudflare
    Cloudflare["Cloudflare"] --> Traefik
    Traefik["Traefik"] --> API
    API["API"] --> RuntimeCluster
    RuntimeCluster["RuntimeCluster"] --> WorkerCluster
    RuntimeCluster["RuntimeCluster"] --> PostgreSQL
    RuntimeCluster["RuntimeCluster"] --> Redis
    RuntimeCluster["RuntimeCluster"] --> Qdrant
    RuntimeCluster["RuntimeCluster"] --> MinIO
    WorkerCluster["WorkerCluster"] --> AIProviders
    WorkerCluster["WorkerCluster"] --> SocialPlatforms
    WorkerCluster["WorkerCluster"] --> MCPServers
```

---

# Scalability

Tất cả Service đều có thể scale độc lập.

```mermaid
flowchart LR
    APICluster[API × N]
    RuntimeCluster[Runtime × N]
    WorkerCluster[Worker × N]
    GatewayCluster[Gateway × N]
    APICluster --> RuntimeCluster
    RuntimeCluster["RuntimeCluster"] --> WorkerCluster
    WorkerCluster["WorkerCluster"] --> GatewayCluster
```

Ví dụ:

- Runtime scale theo số lượng Execution.
- Worker scale theo loại tác vụ.
- Gateway scale theo số lượng Provider hoặc Connector.

---

# Fault Tolerance

Runtime hỗ trợ:

- Retry
- Timeout
- Dead Letter Queue
- Event Replay
- Circuit Breaker
- Provider Failover

---

# Observability

Toàn bộ hệ thống được theo dõi thông qua:

- Metrics
- Logs
- Distributed Tracing
- Audit Log
- AI Usage
- Token Usage
- Cost Tracking

---

# Architecture Summary

AI Social OS được xây dựng dựa trên **Execution Runtime** thay vì Workflow Engine.

Execution Runtime điều phối toàn bộ Capability, Worker, Gateway và Storage, tạo nên một nền tảng AI thống nhất có khả năng:

- hỗ trợ nhiều AI Provider
- tích hợp nhiều nền tảng Social
- mở rộng bằng Plugin và MCP
- quản lý Memory và Knowledge tập trung
- mở rộng theo chiều ngang
- phát triển thành AI Operating System trong tương lai mà không cần thay đổi kiến trúc cốt lõi.
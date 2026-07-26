# AI Layer Index

> AI Social OS

Version: 2.0.0

Status: Stable

Last Updated: 2026-07-25

---

# Overview

AI Layer là tầng trí tuệ của AI Social OS, chịu trách nhiệm xây dựng khả năng suy luận, lập kế hoạch, ghi nhớ, phối hợp và ra quyết định của AI Agents.

Bộ tài liệu này mô tả toàn bộ kiến trúc AI của hệ thống, từ Agent Architecture đến Multi-Agent Collaboration, Prompt Engineering và AI Deployment.

---

# Document Map

## Foundation

| No | Document | Status |
|----|----------|--------|
| 01 | AI Overview | Stable |
| 02 | Agent Architecture | Stable |
| 03 | Agent Lifecycle | Stable |
| 04 | Agent Types | Stable |
| 05 | Agent State | Stable |

---

## Intelligence

| No | Document | Status |
|----|----------|--------|
| 06 | Agent Memory | Stable |
| 07 | Agent Context | Stable |
| 08 | Agent Reasoning | Stable |
| 09 | Agent Planning | Stable |
| 10 | Agent Execution | Stable |

---

## Multi-Agent

| No | Document | Status |
|----|----------|--------|
| 11 | Agent Coordination | Stable |
| 12 | Multi-Agent System | Stable |
| 13 | Agent Communication | Stable |

---

## Agent Operations

| No | Document | Status |
|----|----------|--------|
| 14 | Agent Capabilities | Stable |
| 15 | Agent Registry | Stable |
| 16 | Agent Routing | Stable |
| 17 | Agent Discovery | Stable |
| 18 | Agent Health | Stable |
| 19 | Agent Workflow | Stable |
| 20 | Agent Governance | Stable |
| 21 | Agent Evaluation | Stable |
| 22 | Agent Learning | Stable |

---

## Summary Document

| No | Document | Status |
|----|----------|--------|
| 23 | AI Layer Summary | Stable |

---

# Planned / Not Yet Written

These topics are intentional future work — they show up conceptually in architecture diagrams and component lists elsewhere in this folder, but no dedicated document exists yet. Treat them as roadmap items, not broken links.

| Planned Document | Notes |
|-------------------|-------|
| Model Router | Routing requests across AI providers/models |
| Prompt Engine | Prompt templating and construction |
| Context Engine | Context assembly for Agent reasoning |
| Memory Engine | Persistent/semantic memory storage layer |
| Tool Engine | Tool registration and invocation |
| Inference Engine | Model inference execution |
| Streaming Engine | Token/response streaming |
| Session Engine | Conversation/session state management |
| AI Pipeline | End-to-end request pipeline |
| AI Security | AI-specific security controls |
| AI Observability | AI-specific tracing/metrics |
| AI Configuration | AI Layer configuration surface |
| AI APIs | Public AI Layer API surface |
| AI Deployment | AI Layer deployment topology |
| AI Reference Architecture | Consolidated AI Layer architecture |
| AI Roadmap | AI Layer long-term roadmap |

---

# Reading Order

Khuyến nghị đọc theo thứ tự sau.

```text
AI Overview
        │
        ▼
Agent Architecture
        │
        ▼
Agent Lifecycle
        │
        ▼
Agent Types
        │
        ▼
Agent State
        │
        ▼
Memory
        │
        ▼
Context
        │
        ▼
Reasoning
        │
        ▼
Planning
        │
        ▼
Execution
        │
        ▼
Multi-Agent
        │
        ▼
Agent Operations
        │
        ▼
AI Layer Summary
```

---

# Dependencies

```text
Kernel
        │
Runtime
        │
Platform
        │
AI Layer
        │
Social
Plugin
API
Frontend
```

AI Layer phụ thuộc vào.

- Kernel
- Runtime
- Platform

Các Layer khác sẽ sử dụng AI Layer để xây dựng Business Capability.

---

# Related Modules

| Module | Relationship |
|----------|-------------|
| Kernel | Execution Foundation |
| Runtime | AI Execution |
| Platform | Infrastructure Services |
| Plugin | AI Tool Extensions |
| Data | Knowledge & Memory Storage |
| API | AI APIs |
| Frontend | AI User Experience |

---

# AI Domains

```mermaid
flowchart LR
```

---

# Architecture Coverage

Tài liệu hiện có (01-23) bao phủ.

- Agent System (Architecture, Lifecycle, Types, State)
- Reasoning & Planning
- Context Management
- Memory Management
- Agent Execution
- Multi-Agent Coordination & Communication
- Agent Capabilities, Registry, Routing, Discovery
- Agent Health, Workflow, Governance
- Agent Evaluation & Learning

Xem mục "Planned / Not Yet Written" phía trên cho các chủ đề (Model Routing, Tool Orchestration, AI Deployment, AI Security, AI Observability, ...) chưa có tài liệu riêng.

---

# Version History

| Version | Changes |
|----------|---------|
| 1.0 | Initial Architecture |
| 2.0 | Enterprise AI OS Architecture |

---

# Summary

AI Layer Index cung cấp điểm truy cập trung tâm cho toàn bộ tài liệu AI của AI Social OS.

Bộ tài liệu hiện có gồm 23 tài liệu đánh số (01-23) cùng `README.md` và `INDEX.md`, được tổ chức theo từng nhóm chức năng từ nền tảng Agent, Intelligence, Multi-Agent đến Agent Operations. Các chủ đề mở rộng (AI Engines, Platform Integration, Reference Architecture, Roadmap) được liệt kê riêng trong mục "Planned / Not Yet Written" vì chưa có tài liệu tương ứng.
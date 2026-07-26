# Event Store

> AI Social OS Data Layer

Version: 2.0.0

Status: Stable

Last Updated: 2026-07-25

---

> **Giai đoạn áp dụng:** Giai đoạn sau — cân nhắc khi có nhu cầu scale thực tế, dự kiến Phase 3+/Enterprise. Lý do: một Event Log dạng append-only trong PostgreSQL (bảng Event với eventId/aggregateId/payload) đủ phục vụ Audit và CQRS cơ bản ở MVP; một Event Store chuyên dụng (EventStoreDB/Kafka) chỉ là nâng cấp khi khối lượng Event và nhu cầu Replay/Streaming vượt quá khả năng của PostgreSQL.

---

# Table of Contents

- Overview
- Objectives
- Why Event Store
- Event Sourcing
- Event Structure
- Event Streams
- Event Replay
- Snapshots
- Retention
- Consumers
- Storage Strategy
- Design Principles
- Summary

---

# Overview

Event Store lưu trữ toàn bộ Domain Event của AI Social OS.

Event Store là nguồn dữ liệu bất biến (Immutable Log), phục vụ.

- Audit
- Replay
- Analytics
- AI Learning
- Recovery
- CQRS

---

# Objectives

Event Store hướng tới.

- Immutable
- Replayable
- Ordered
- Durable
- Observable
- Scalable

---

# Why Event Store

Thay vì chỉ lưu trạng thái cuối cùng.

```mermaid
flowchart LR
```

Event Store lưu toàn bộ lịch sử.

```mermaid
flowchart LR
```

---

# Event Sourcing

Entity được xây dựng từ chuỗi Event.

```mermaid
flowchart LR
```

Không chỉnh sửa Event cũ.

---

# Event Structure

```yaml
eventId:

aggregateId:

aggregateType:

eventType:

version:

timestamp:

actor:

tenantId:

payload:

metadata:
```

---

# Event Streams

Mỗi Aggregate có Stream riêng.

Ví dụ.

```mermaid
flowchart LR
    PostArchived
```

---

# Event Replay

Có thể xây dựng lại trạng thái.

```mermaid
flowchart LR
```

Ứng dụng.

- Recovery
- Debugging
- AI Simulation

---

# Snapshots

Đối với Aggregate lớn.

```mermaid
flowchart LR
```

Giảm thời gian Replay.

---

# Consumers

Event được sử dụng bởi.

- Analytics
- Search
- AI Memory
- Feed
- Recommendation
- Notifications

---

# Retention

Chính sách.

| Event Type | Retention |
|------------|-----------|
| Audit | Forever |
| Business | Forever |
| Analytics | Configurable |
| Debug | 30 Days |

---

# Storage Strategy

Khuyến nghị.

- Kafka
- EventStoreDB
- PostgreSQL Event Table

---

# Design Principles

- Immutable
- Ordered
- Replayable
- Append Only
- Observable

---

# Summary

Event Store là nền tảng của kiến trúc Event-driven trong AI Social OS, cho phép lưu trữ lịch sử đầy đủ của mọi thay đổi, hỗ trợ Audit, CQRS, AI Learning và khả năng khôi phục hệ thống thông qua Replay Event.
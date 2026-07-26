# Data Model

> AI Social OS Data Layer

Version: 2.0.0

Status: Stable

Last Updated: 2026-07-25

---

# Table of Contents

- Overview
- Objectives
- Domain-driven Modeling
- Aggregate Design
- Entity Types
- Identifiers
- Relationships
- Metadata
- Versioning
- Multi-tenancy
- Naming Conventions
- Design Principles
- Summary

---

# Overview

Data Model định nghĩa cách dữ liệu được tổ chức trong AI Social OS.

Thay vì thiết kế theo Database trước, AI Social OS áp dụng Domain-driven Design (DDD), trong đó Domain Model là nguồn sự thật duy nhất (Single Source of Truth).

Database chỉ là một cách hiện thực hóa Domain Model.

---

# Objectives

Data Model hướng tới.

- Domain Driven
- Technology Independent
- Strong Consistency
- Extensible
- Versioned
- Multi-Tenant
- AI Ready

---

# Domain-driven Modeling

Mỗi Domain sở hữu Model riêng.

Ví dụ.

```text
Identity

Users

Roles

Permissions

Social

Posts

Comments

Communities

AI

Agents

Memory

Workflows

Plugin

Plugins

Tools

Connectors
```

Không Domain nào được ghi trực tiếp vào Database của Domain khác.

---

# Aggregate Design

Mỗi Aggregate có một Aggregate Root.

Ví dụ.

```mermaid
flowchart LR
```

Chỉ Aggregate Root mới được phép thay đổi trạng thái của Aggregate.

---

# Entity Types

Data Layer sử dụng ba loại chính.

## Entity

Có định danh riêng.

Ví dụ.

```text
User

Post

Community

Agent
```

---

## Value Object

Không có định danh.

Ví dụ.

```text
Address

Location

Email

Phone
```

---

## Event

Biểu diễn thay đổi.

Ví dụ.

```text
PostCreated

UserRegistered

CommentAdded
```

---

# Global Identifier

Toàn bộ hệ thống sử dụng UUID hoặc ULID.

Ví dụ.

```text
usr_01HX...

agt_01HX...

pst_01HX...

com_01HX...
```

Identifier không phụ thuộc Database.

---

# Relationships

Có ba loại quan hệ.

## One-to-One

```mermaid
flowchart LR
```

---

## One-to-Many

```mermaid
flowchart LR
```

---

## Many-to-Many

```mermaid
flowchart LR
```

Thông qua bảng hoặc Graph.

---

# Metadata

Mọi Entity đều có.

```yaml
id:

createdAt:

updatedAt:

createdBy:

updatedBy:

version:

status:

tenantId:
```

---

# Soft Delete

Entity mặc định không bị xóa vật lý.

```yaml
deletedAt:

deletedBy:
```

Cho phép.

- Audit
- Recovery
- Compliance

---

# Versioning

Entity hỗ trợ.

```mermaid
flowchart LR
```

Phục vụ.

- Audit
- Rollback
- AI Memory

---

# Multi-tenancy

Mọi dữ liệu đều thuộc Tenant.

```mermaid
flowchart LR
```

Không được truy cập chéo Tenant.

---

# Naming Conventions

Tên Entity.

```text
PascalCase
```

Tên Field.

```text
camelCase
```

Tên Table.

```text
snake_case
```

Tên Event.

```text
Past Tense
```

Ví dụ.

```text
UserCreated

PostPublished

CommentDeleted
```

---

# Design Principles

- Domain First
- Aggregate Oriented
- Immutable Events
- Versioned
- Multi-Tenant
- Technology Independent

---

# Summary

Data Model là nền tảng logic của AI Social OS.

Mọi Storage, API và Event đều được xây dựng từ Domain Model thống nhất, giúp hệ thống dễ mở rộng, dễ bảo trì và không phụ thuộc vào công nghệ lưu trữ cụ thể.
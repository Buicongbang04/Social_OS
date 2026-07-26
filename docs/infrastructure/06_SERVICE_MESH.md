# Service Mesh

> AI Social OS Infrastructure Layer

Version: 2.0.0

Status: Stable

Last Updated: 2026-07-25

---

> **Giai đoạn áp dụng:** Giai đoạn sau — cân nhắc khi có nhu cầu scale thực tế, dự kiến Phase 3+/Enterprise. Lý do: ở MVP số lượng Microservices còn ít, Retry/TLS/Load Balancing có thể xử lý ở tầng API Gateway/Application; Istio/Linkerd (mTLS, Traffic Management, sidecar) chỉ cần khi số lượng Service và yêu cầu Zero Trust tăng cao.

---

# Table of Contents

- Overview
- Objectives
- Why Service Mesh
- Architecture
- Sidecar Model
- Traffic Management
- Security
- Observability
- Reliability
- Policy Management
- Recommended Technologies
- Summary

---

# Overview

Service Mesh quản lý toàn bộ giao tiếp giữa các Services trong AI Social OS.

Thay vì mỗi Service tự triển khai.

- Retry
- TLS
- Load Balancing
- Circuit Breaker

Service Mesh cung cấp các chức năng này ở tầng hạ tầng.

---

# Objectives

Service Mesh hướng tới.

- Secure Communication
- Traffic Control
- Service Discovery
- Observability
- Reliability

---

# Why Service Mesh

Không sử dụng Service Mesh.

```mermaid
flowchart LR
```

Có Service Mesh.

```mermaid
flowchart LR
```

---

# High-Level Architecture

```mermaid
flowchart LR
    Sidecar --> Mesh
    Mesh --> Sidecar2
    Sidecar2 --> Service_B["Service B"]
```

---

# Sidecar Proxy

Mỗi Pod có một Proxy.

Proxy chịu trách nhiệm.

- Routing
- TLS
- Retry
- Metrics
- Authentication

---

# Traffic Management

Mesh hỗ trợ.

- Load Balancing
- Retry
- Timeout
- Circuit Breaker
- Canary Deployment
- Blue-Green Deployment

---

# Security

Hỗ trợ.

- mTLS
- Identity
- Certificate Rotation
- Zero Trust

---

# Observability

Mesh thu thập.

- Request Count
- Error Rate
- Latency
- Dependency Graph

---

# Reliability

Các tính năng.

- Retry
- Failover
- Traffic Mirroring
- Fault Injection

---

# Policy Management

Quản lý.

- Authorization
- Rate Limit
- Routing Policy
- Traffic Rules

---

# Recommended Technologies

- Istio
- Linkerd
- Kuma

---

# Summary

Service Mesh cung cấp lớp giao tiếp an toàn, tin cậy và có khả năng quan sát cao giữa các Microservices, giảm đáng kể lượng mã hạ tầng cần triển khai trong từng Service.
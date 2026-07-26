# Agent Health

> AI Social OS AI Layer

Version: 2.0.0

Status: Stable

---

# Overview

Agent Health theo dõi trạng thái hoạt động của Agent.

Mọi Agent phải gửi Heartbeat định kỳ.

---

# Health States

```text
Healthy

Degraded

Unhealthy

Offline
```

---

# Health Metrics

- CPU
- Memory
- Latency
- Error Rate
- Queue Length
- Success Rate

---

# Heartbeat

```json
{
  "agentId":"agent-01",
  "status":"healthy",
  "timestamp":"..."
}
```

---

# Failure Detection

```mermaid
flowchart LR
```

---

# Recovery

```mermaid
flowchart LR
```

---

# Summary

Agent Health đảm bảo chỉ những Agent khỏe mạnh mới nhận Task.
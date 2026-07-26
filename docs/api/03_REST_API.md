# REST API

> AI Social OS API Layer

Version: 2.0.0

Status: Stable

---

# Table of Contents

- Overview
- Principles
- Resources
- Request Format
- Response Format
- Pagination
- Filtering
- Idempotency
- Error Handling
- Best Practices
- Summary

---

# Overview

REST API là giao diện mặc định cho phần lớn Business Services trong AI Social OS.

---

# Principles

REST tuân theo.

- Stateless
- Resource-based
- Cacheable
- Uniform Interface

---

# Resources

Ví dụ.

```text
/users

/posts

/workflows

/plugins

/models

/files
```

---

# Request Format

```http
POST /v1/posts
Content-Type: application/json
Authorization: Bearer TOKEN
```

---

# Response Format

```json
{
  "data": {},
  "meta": {},
  "links": {}
}
```

---

# Pagination

Cursor-based.

```text
cursor

limit
```

---

# Filtering

```text
status=draft

category=marketing
```

---

# Idempotency

POST hỗ trợ.

```text
Idempotency-Key
```

để tránh tạo dữ liệu trùng.

---

# Error Handling

```json
{
    "code":"INVALID_REQUEST",
    "message":"..."
}
```

---

# Best Practices

- Stateless
- Small Payload
- Compression
- Cache Headers
- ETag Support

---

# Summary

REST API phục vụ các nghiệp vụ CRUD và Business Operations với thiết kế đơn giản, ổn định và tương thích rộng.
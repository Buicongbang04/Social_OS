# API Design Guidelines

> AI Social OS API Layer

Version: 2.0.0

Status: Stable

---

# Table of Contents

- Overview
- Naming
- Resources
- HTTP Methods
- URL Design
- Status Codes
- Error Format
- Pagination
- Filtering
- Sorting
- Versioning
- Design Principles
- Summary

---

# Overview

Tài liệu này quy định chuẩn thiết kế API thống nhất cho toàn bộ AI Social OS.

---

# Resource Naming

Sử dụng.

- Danh từ
- Số nhiều
- lowercase
- kebab-case

Ví dụ.

```text
/users

/workspaces

/posts

/ai-models
```

---

# HTTP Methods

| Method | Purpose |
|----------|----------|
| GET | Read |
| POST | Create |
| PUT | Replace |
| PATCH | Update |
| DELETE | Delete |

---

# URL Design

Đúng.

```text
/users

/users/{id}

/posts/{id}/comments
```

Không đúng.

```text
/getUser

/createPost

/deleteComment
```

---

# Status Codes

| Code | Meaning |
|--------|----------|
| 200 | Success |
| 201 | Created |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Validation Error |
| 500 | Internal Error |

---

# Error Format

Chuẩn.

```json
{
  "code": "USER_NOT_FOUND",
  "message": "User does not exist.",
  "requestId": "...",
  "timestamp": "..."
}
```

---

# Pagination

Cursor-based.

```text
GET /posts

?cursor=...

&limit=20
```

---

# Filtering

Ví dụ.

```text
status=published

author=user01
```

---

# Sorting

```text
sort=createdAt

order=desc
```

---

# Versioning

```text
/v1/

/v2/
```

---

# Design Principles

- Predictable
- Resource Oriented
- Consistent
- Stateless
- Backward Compatible

---

# Summary

API Design Guidelines đảm bảo mọi API trong AI Social OS có cấu trúc nhất quán, dễ sử dụng và dễ mở rộng.
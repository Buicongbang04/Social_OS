# Content Model

> AI Social OS Social Layer

Version: 2.0.0

---

> **Trạng thái phạm vi:** Tài liệu này mô tả mạng xã hội nội bộ (native) của nền tảng — Social Graph, Feed, Recommendation Engine, Community System và Creator Economy riêng — đây là hạng mục tầm nhìn dài hạn (long-term / future-vision), **không** thuộc MVP hiện tại và **không** thuộc 6 Phase trong `docs/ROADMAP.md`. Đừng nhầm với Integration Layer (kết nối và đăng bài ra nền tảng bên ngoài như Facebook, Instagram, TikTok, v.v. — xem `docs/03_DOMAIN_MODEL.md` và `docs/04_ARCHITECTURE.md`).

---

# Overview

Content là thực thể trung tâm của Social Layer.

Mọi tương tác đều xoay quanh Content.

---

# Content Types

- Text
- Image
- Video
- Audio
- Document
- Live Stream
- AI Generated
- Poll
- Story
- Thread

---

# Content Structure

```yaml
id:
author:
workspace:
visibility:
title:
body:
media:
tags:
mentions:
status:
createdAt:
updatedAt:
```

---

# Content Lifecycle

```mermaid
flowchart LR
    Scheduled --> Published
    Published --> Distributed
    Distributed --> Archived
    Archived --> Deleted
```

---

# Visibility

- Public
- Followers
- Community
- Workspace
- Private

---

# Metadata

- Language
- Topic
- Category
- AI Score
- Moderation Status
- Embedding
- Version

---

# Versioning

Content hỗ trợ.

- Edit History
- Rollback
- Audit

---

# Summary

Content Model chuẩn hóa mọi loại nội dung trong nền tảng.
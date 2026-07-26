# Engagement System

> **Trạng thái phạm vi:** Tài liệu này mô tả mạng xã hội nội bộ (native) của nền tảng — Social Graph, Feed, Recommendation Engine, Community System và Creator Economy riêng — đây là hạng mục tầm nhìn dài hạn (long-term / future-vision), **không** thuộc MVP hiện tại và **không** thuộc 6 Phase trong `docs/ROADMAP.md`. Đừng nhầm với Integration Layer (kết nối và đăng bài ra nền tảng bên ngoài như Facebook, Instagram, TikTok, v.v. — xem `docs/03_DOMAIN_MODEL.md` và `docs/04_ARCHITECTURE.md`).

---

# Overview

Engagement quản lý toàn bộ tương tác.

---

# Interaction Types

- Like
- Comment
- Share
- Save
- Follow
- Mention
- Quote
- Bookmark

---

# Engagement Score

Dựa trên.

- Time
- Relationship
- Quality
- AI Score

---

# Event Flow

```mermaid
flowchart LR
    Analytics --> Recommendation
    Recommendation --> Feed_Update["Feed Update"]
```

---

# Summary

Engagement phản ánh mức độ tương tác của hệ sinh thái.
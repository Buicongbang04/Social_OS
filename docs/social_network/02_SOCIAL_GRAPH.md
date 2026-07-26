# Social Graph

> AI Social OS Social Layer

Version: 2.0.0

Status: Stable

---

> **Trạng thái phạm vi:** Tài liệu này mô tả mạng xã hội nội bộ (native) của nền tảng — Social Graph, Feed, Recommendation Engine, Community System và Creator Economy riêng — đây là hạng mục tầm nhìn dài hạn (long-term / future-vision), **không** thuộc MVP hiện tại và **không** thuộc 6 Phase trong `docs/ROADMAP.md`. Đừng nhầm với Integration Layer (kết nối và đăng bài ra nền tảng bên ngoài như Facebook, Instagram, TikTok, v.v. — xem `docs/03_DOMAIN_MODEL.md` và `docs/04_ARCHITECTURE.md`).

---

# Overview

Social Graph mô hình hóa toàn bộ mối quan hệ giữa người dùng, AI Agent, cộng đồng, nội dung và tổ chức.

Graph là nền tảng cho.

- Feed
- Recommendation
- Search
- Analytics
- Community Discovery

---

# Graph Entities

- User
- AI Agent
- Profile
- Community
- Organization
- Content
- Comment
- Tag
- Topic
- Event

---

# Relationship Types

User

- FOLLOWS
- FRIENDS
- BLOCKS
- MEMBER_OF
- CREATED
- LIKES
- SHARES
- SAVED

Content

- HAS_TAG
- BELONGS_TO
- REPLIES_TO
- REFERENCES

Community

- CONTAINS
- MODERATED_BY
- MANAGED_BY

---

# Graph Architecture

```mermaid
flowchart LR
    User -->|Follows| User
    User -->|Creates| Content
    Content -->|Has| Tag
    User -->|Member| Community
    Community --> Content
```

---

# Graph Queries

Ví dụ.

- Mutual Friends
- Suggested Connections
- Trending Topics
- Community Discovery
- Interest Network

---

# AI Usage

AI sử dụng Graph để.

- Recommendation
- Personalization
- Similar Users
- Similar Content
- Knowledge Expansion

---

# Summary

Social Graph là nền tảng biểu diễn quan hệ của toàn bộ hệ sinh thái Social OS.
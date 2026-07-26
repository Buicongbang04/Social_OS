# Social Layer Summary

---

# Components

Core

- Moderation
- Content
- Feed
- Recommendation
- Engagement
- Analytics

---

# High-Level Flow

```mermaid
flowchart LR
    Content --> Feed
    Feed --> Recommendation
    Recommendation --> Engagement
    Engagement --> Analytics
    Analytics --> AILayer["AI Layer"]
```

---

# Summary

Social Layer là nền tảng vận hành của AI Social OS.

Layer này quản lý toàn bộ người dùng, nội dung, cộng đồng, mối quan hệ, feed, recommendation, moderation và analytics thông qua kiến trúc Event-driven. Đây là lớp kết nối giữa AI Layer và người dùng cuối, tạo nên một nền tảng Social AI có khả năng mở rộng tới quy mô hàng triệu người dùng và hàng tỷ sự kiện mỗi ngày.
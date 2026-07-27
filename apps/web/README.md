# apps/web — Bảng kiểm chứng runtime

Một trang duy nhất để trả lời đúng một câu hỏi: **một Goal viết bằng ngôn ngữ
tự nhiên có thật sự được hiểu, lập kế hoạch, chạy, và tốn bao nhiêu?**

Cố ý không phải dashboard. Mỗi màn hình chen giữa ô nhập mục tiêu và kết quả là
một chỗ câu hỏi đó có thể lạc mất. Các bề mặt sản phẩm mô tả trong
`docs/frontend/` sẽ làm sau.

## Chạy

Cần Postgres + Redis (`pnpm docker:up`) và `.env` đã điền — xem `.env.example`.

```sh
# 1. API
pnpm --filter @repo/api dev

# 2. Runtime (tiến trình nhận việc). Không có nó, Execution nằm mãi ở CREATED —
#    giao diện sẽ nói thẳng điều đó thay vì quay vòng im lặng.
pnpm --filter @repo/runtime-service dev

# 3. Web
pnpm --filter web dev
```

Mở http://localhost:3200

Muốn dùng LLM thật thay vì engine keyword, đặt `AI_PROVIDER` (và key tương ứng)
trước khi chạy runtime:

```sh
AI_PROVIDER=ollama AI_MODEL=qwen2.5:7b pnpm --filter @repo/runtime-service dev
```

## Vì sao cổng 3200

Cùng lý do Postgres ở 5433 và API ở 3100: stack này phải sống chung với những
gì đã chạy sẵn trên máy. Next mặc định lấy 3000, và khi cổng đó bận nó **tự
nhảy** sang cổng khác — lúc đó `CORS_ORIGINS` trỏ sai chỗ và trình duyệt chặn
mọi lời gọi, hiện ra như một lỗi của ứng dụng chứ không phải xung đột cổng.
Ghim cứng thì không có chuyện đó.

## Giới hạn cần biết

**Token lưu ở `localStorage`.** Mọi script trên origin đều đọc được. Chấp nhận
được khi còn một origin và chưa lên production; câu trả lời đúng cho production
là refresh token trong cookie `httpOnly`.

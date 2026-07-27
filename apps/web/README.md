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

## Tài liệu

Ô tải file ở giữa trang. Tải lên `.txt`, `.md`, `.csv` hoặc `.json`, rồi viết
một Goal hỏi về nội dung trong đó — bước `knowledge.search` sẽ tra tài liệu
thật thay vì để model tự nghĩ ra.

Trạng thái của từng tài liệu luôn hiện trên màn hình, vì đó là câu trả lời
trung thực cho "hỏi được chưa": file được **lưu** trước, **tìm được** sau. Một
danh sách chỉ hiện tên file sẽ khiến người ta tải lên một chính sách, hỏi ngay
một giây sau, không thấy gì, và kết luận là tìm kiếm hỏng.

Cần MinIO và Qdrant (`pnpm docker:up`) cùng một AI provider. Thiếu bất cứ thứ
gì trong ba cái đó thì runtime vẫn khởi động nhưng **nói rõ knowledge bị tắt**
trong log lúc start, và tài liệu sẽ nằm mãi ở `PENDING`.

PDF và Word chưa nhận: chúng cần một bước bóc tách chữ chưa làm, và lưu chúng
bây giờ sẽ tạo ra tài liệu kẹt ở `PENDING` vĩnh viễn — trông như lỗi chứ không
phải như tính năng còn thiếu.

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

## Kiểm chứng cả stack

```sh
pnpm --filter @repo/runtime-service verify:stack
```

Chạy toàn bộ luồng **chỉ qua API công khai**, đúng như trình duyệt: đăng ký,
gửi Goal, chờ chạy xong, thử cổng duyệt, thử chặn ngân sách, và chờ một Goal
theo lịch tự bắn. Không đụng repository, không đụng database.

Model chạy cục bộ (Ollama trên CPU) mất vài phút cho mỗi lời gọi, nên mặc định
300 giây một lần chạy là không đủ. Nâng lên:

```sh
VERIFY_RUN_TIMEOUT_MS=900000 pnpm --filter @repo/runtime-service verify:stack
```

Có cả luồng tài liệu: tải một file tên tiếng Việt lên, chờ runtime tự lập chỉ
mục, tải về bằng link ký sẵn, rồi chạy một Goal phải đọc tài liệu mới trả lời
đúng. Kiểm tra khẳng định trên **đoạn được tìm ra**, không phải trên bài viết
— bài viết thì mỗi lần một khác, còn việc tìm đúng đoạn thì không.

Đây không phải test thừa. Có một lỗi khiến Goal theo lịch **không bao giờ chạy**
mà toàn bộ 39 test tích hợp — dù chạy trên Postgres và Redis thật — vẫn xanh,
vì chúng tự ghi dữ liệu nên vô tình tránh đúng hình dạng gây lỗi. Script này
bắt được nó ngay lần chạy đầu. Nếu sửa gì mà không chắc, chạy cái này.

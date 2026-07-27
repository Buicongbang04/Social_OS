# services/runtime — Execution Runtime

> Phase 1. Tiến trình headless: nhận task từ queue, chạy, ghi kết quả, phát event.

Không có HTTP ngoài process này. `services/api` mới là bề mặt API — nó đã có sẵn auth, RBAC, rate limit từ Phase 0, nhân đôi sang đây là vô nghĩa. Runtime chỉ **tiêu thụ**: API ghi Goal/Execution xuống DB và queue, Runtime lấy ra chạy.

## Chạy

```bash
pnpm docker:up                              # Postgres + Redis
pnpm --filter @repo/database db:migrate
pnpm --filter @repo/runtime-service dev
```

## Vòng lặp scheduler

Mỗi tick:

1. Khôi phục reservation hết hạn (worker chết thì task quay lại queue)
2. Giành distributed lock → `queue.reserve(batchSize)` → **nhả lock ngay**
3. Chạy từng task, ack nếu xong, để queue giữ nếu còn retry
4. Kiểm tra Execution đã xong chưa; nếu chưa, đẩy tiếp các task vừa đủ điều kiện

Nhả lock ngay sau khi giành task là có chủ ý: giữ lock trong lúc chạy sẽ khiến mọi node chạy tuần tự, mất sạch lợi ích của việc scale ngang. Lock chỉ giảm tranh chấp; **reservation của queue mới là thứ đảm bảo một task chỉ giao một lần**.

## Capability trong Phase 1

Đây **không** phải bản thật. `content.generate` không gọi LLM, `social.publish` không gọi Facebook — chúng thuộc Phase 2 và Phase 3. Nhưng chúng đi qua đủ mọi nhánh runtime phải làm đúng: sinh output, đọc output của task phụ thuộc, lỗi tạm thời, lỗi vĩnh viễn.

Giữ chúng tất định là có chủ ý: bug scheduling hay retry tìm được ở đây chắc chắn là bug của runtime.

## Test

```bash
pnpm --filter @repo/runtime-service test:int   # cần pnpm docker:up
```

10 test end-to-end trên Postgres và Redis thật, không mock gì. Bao gồm: Goal ngôn ngữ tự nhiên chạy tới `COMPLETED`, output truyền đúng giữa các task phụ thuộc, task không bao giờ chạy trước dependency, retry rồi thành công, hết lượt retry thì vào dead letter và Execution `FAILED`.

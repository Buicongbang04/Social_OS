# docker/ — Hạ tầng và cả cụm ứng dụng

4 service hạ tầng MVP theo `docs/05_TECH_STACK.md#mvp-stack-phase-0-2`: PostgreSQL, Redis, MinIO, Qdrant. Không có Meilisearch/NATS/Kubernetes ở đây — đúng quyết định MVP-first (xem `docs/infrastructure/05_KUBERNETES_ARCHITECTURE.md`, `docs/infrastructure/02_CLOUD_ARCHITECTURE.md`).

## Chạy

```bash
cp .env.example .env   # ở thư mục gốc repo, chỉnh nếu cần
pnpm docker:up          # tương đương: docker compose --env-file .env -f docker/docker-compose.yml up -d
```

| Service    | Host port | Console                         |
| ---------- | --------- | ------------------------------- |
| PostgreSQL | 5433      | —                               |
| Redis      | 6380      | —                               |
| MinIO      | 9000      | http://localhost:9002 (console) |
| Qdrant     | 6333      | http://localhost:6333/dashboard |

> Port host được cố tình lệch khỏi mặc định thông dụng (5432/6379) để stack này chạy song song với các project khác trên cùng máy mà không tranh port. Port bên trong container vẫn là chuẩn. Đổi lại được qua `.env`.

Dừng: `pnpm docker:down`. Xem log: `pnpm docker:logs`.

---

## Chạy cả nền tảng bằng một lệnh

```bash
pnpm stack:up      # lần đầu tự tạo docker/.env.compose và sinh sẵn khoá
```

Xong là mở http://localhost:3200.

| Lệnh                     | Làm gì                                                      |
| ------------------------ | ----------------------------------------------------------- |
| `pnpm stack:up`          | Bật cả cụm, build lại phần nào đã đổi                       |
| `pnpm stack:ps`          | Xem container nào đang chạy                                 |
| `pnpm stack:logs`        | Xem nhật ký. Thêm tên service để lọc: `pnpm stack:logs api` |
| `pnpm stack:restart api` | Build và khởi động lại một service                          |
| `pnpm stack:down`        | Dừng. **Không xoá dữ liệu** — volume vẫn còn                |

Cổng giữ đúng như khi chạy `pnpm dev`: 5433, 6380, 9000, 6333, và 3100 / 3200.
Dữ liệu nằm trong volume Docker nên chuyển qua lại giữa hai cách chạy không mất
gì.

`pnpm stack:down` cố ý **không** xoá volume. Muốn xoá sạch phải gõ tay
`docker compose ... down -v`, để việc mất dữ liệu không bao giờ là hệ quả của
một lệnh nghe như "dừng lại".

### Chạy Docker hay chạy `pnpm dev`

Hai cách dùng chung volume, nên chọn cái nào cũng được — nhưng **đừng chạy cả
hai cùng lúc**: cả hai sẽ tranh cổng 3100 và 3200.

`pnpm dev` sửa code là thấy ngay. `pnpm stack:up` chạy đúng như khi triển khai,
và là cách duy nhất phát hiện những lỗi chỉ xuất hiện trong container — đã có ba
lỗi như vậy, ghi ở phần dưới.

---

## Chạy cả cụm (API + runtime + web trong container)

Hai file compose, tách nhau có chủ ý. `docker-compose.yml` chỉ chạy bốn thứ
phụ thuộc — đó là cách làm việc hằng ngày: hạ tầng trong Docker, ba service
bằng `pnpm dev`. Gộp chúng lại sẽ khiến mỗi lần `docker compose up` phải build
lại ứng dụng.

`docker-compose.app.yml` chạy đúng cách nó sẽ được triển khai:

```bash
cp docker/.env.compose.example docker/.env.compose   # rồi điền giá trị bắt buộc
docker compose --env-file docker/.env.compose \
  -f docker/docker-compose.yml -f docker/docker-compose.app.yml up -d --build
```

**Đừng dùng chung `.env` ở gốc repo.** `.env` dành cho `pnpm dev`, nơi service
chạy trên máy và gọi vào cổng đã publish (`localhost:5433`). Trong compose
chúng gọi nhau bằng **tên service** và cổng gốc (`postgres:5432`). Dùng nhầm
file cho lỗi "connection refused" trong khi mọi thứ trông đều đúng.

### Cạm bẫy: hai file dùng chung một project

Cả hai file khai `name: ai-social-os`, nên chúng là **một project Docker Compose
duy nhất**. Đó là điều kiện để xếp lớp `-f a.yml -f b.yml` hoạt động — nhưng nó
cũng có nghĩa: bật cụm ứng dụng với một `--env-file` đặt cổng khác sẽ **cấu hình
lại luôn bốn container hạ tầng đang phục vụ `pnpm dev`**.

Tôi đã mắc đúng lỗi này khi làm phần này: chọn cổng lệch để "khỏi đụng dev", và
chính việc đó đẩy Postgres từ 5433 sang 5434. Dữ liệu còn nguyên (chung volume),
nhưng `.env` vẫn trỏ 5433 nên **toàn bộ 105 test tích hợp hỏng cùng lúc** với
lỗi kết nối — trông như code vỡ tan trong khi chẳng có dòng nào sai.

Muốn một cụm tách hẳn thì đặt project khác, đừng đổi cổng:

```bash
docker compose -p social-os-thu --env-file docker/.env.compose \
  -f docker/docker-compose.yml -f docker/docker-compose.app.yml up -d --build
```

### Một Dockerfile cho ba service

Một file cho mỗi service sẽ trôi: bước cài và build giống hệt nhau, nên ba bản
sao là ba cơ hội để một bản tụt lại. Image là service nào do
`--build-arg PACKAGE` quyết định, ngoài ra không khác gì.

Lớp cài phụ thuộc chép **từng `package.json` một** thay vì chép cả cây nguồn —
chép nguồn ở đó sẽ làm lớp này mất cache mỗi lần sửa code. Cái giá là một danh
sách phải theo kịp workspace, nên có test canh: thêm package mà quên khai báo
thì test đỏ, thay vì image build hỏng với thông báo về checksum.

**Image hiện 1,5GB** vì mang theo cả `node_modules` gồm devDependencies.
`pnpm deploy --prod` sẽ nhỏ hơn nhiều và đáng làm — nhưng một image đúng và
chạy được là điểm xuất phát tốt hơn một image nhỏ chưa ai chạy, và đây là lần
đầu thứ này rời khỏi máy phát triển.

### Ba lỗi chỉ lộ ra khi chạy trong container

Không lỗi nào bị lint, typecheck hay 814 test bắt được:

| Lỗi                                    | Bản chất                                                                                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host.docker.internal` không phân giải | Quy ước của Docker Desktop; trên Linux phải khai `extra_hosts: host-gateway`. Ollama chạy trên máy chủ nên **mọi lời gọi AI** đi qua đường này                                                                                            |
| `OLLAMA_BASE_URL` thiếu `/v1`          | Adapter dùng giao thức tương thích OpenAI. Thiếu nó trả "Not Found" — thông báo không hề nhắc tới đường dẫn                                                                                                                               |
| Link tải ký bằng host nội bộ           | **Lỗi sản phẩm, không phải lỗi cấu hình.** API ký link bằng `http://minio:9000`; trình duyệt bên ngoài không mở được. Chữ ký SigV4 phủ cả host nên không thể sửa URL sau khi ký — phải ký bằng host công khai. Đã thêm `MINIO_PUBLIC_URL` |

`NEXT_PUBLIC_API_URL` là **build arg**, không phải biến môi trường: Next.js
nhúng nó vào bundle lúc build, nên đặt lúc chạy không có tác dụng gì. Đổi nó
phải build lại image web.

## Sao lưu

```bash
pnpm stack:backup          # lưu vào backups/<ngày-giờ>/
pnpm stack:backups         # xem có những bản nào
pnpm stack:restore <tên>   # ghi đè dữ liệu hiện tại, có hỏi xác nhận
```

Lấy cơ sở dữ liệu và các tệp đã tải lên. **Không** lấy `docker/.env.compose`.

File đó giữ `SECRET_KEYS` — khoá mở mọi credential đã mã hoá nằm trong chính
bản sao lưu. Cất chung hai thứ nghĩa là ai lấy được bản sao lưu thì đọc được
luôn token của các kênh, và mã hoá không còn tác dụng gì. **Hãy cất một bản
`SECRET_KEYS` ở nơi khác.** Không có nó, phục hồi xong vẫn đủ workspace, đủ
lịch, đủ nội dung — nhưng mọi kênh phải nối lại từ đầu.

Qdrant và Redis không được sao lưu: một cái là chỉ mục dựng lại được từ tài
liệu gốc, một cái là hàng đợi và cache.

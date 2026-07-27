# @repo/logger — Shared

> Phase 0

Structured logging (pino) dùng chung cho mọi backend service — correlation-id-aware, tự động redact secret/token. Xem `docs/development/02_CODING_STANDARDS.md#logging`, `docs/runtime/15_OBSERVABILITY.md`.

```ts
import { createLogger, withCorrelation } from "@repo/logger";

const logger = createLogger("api");
const requestLogger = withCorrelation(logger, executionId);
requestLogger.info({ taskId }, "task started");
```

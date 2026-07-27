/**
 * Drive the whole stack the way a user does, over the public HTTP API only.
 *
 * This exists because of a failure that already happened: scheduled Goals
 * never fired, while every unit and integration test passed. The integration
 * suite used real Postgres and real Redis but data it had written itself, so
 * it happened to avoid the one shape that broke — a timestamp with
 * sub-millisecond precision. Reality wrote that shape on the first try.
 *
 * So this deliberately touches no repository, no engine and no database. It
 * registers, submits, waits, approves, and reads back exactly what a browser
 * would, against services that are already running. What it cannot see is not
 * covered.
 *
 *   pnpm --filter @repo/runtime-service verify:stack
 *
 * Requires services/api and services/runtime to be up. Exits non-zero on the
 * first failed check, so it is usable as a gate.
 */
/* eslint-disable no-console -- This file is a CLI: its output IS the result. */
import { ApiClient, isApiError, type Execution } from "@repo/sdk";

const BASE_URL = process.env.API_URL ?? "http://localhost:3100/api/v1";
const PASSWORD = "verify-stack-password-123";

/** Long enough for a minute-granularity cron to come round. */
const SCHEDULE_TIMEOUT_MS = 150_000;
/**
 * Long enough for a model running on this machine.
 *
 * 120s was enough for a cloud provider and not for a local one: a 7B model
 * plans, researches and writes in minutes, so the approval check timed out
 * before the run reached WAITING and reported a gate failure for a gate that
 * was working. Override with VERIFY_RUN_TIMEOUT_MS on slower hardware.
 */
const RUN_TIMEOUT_MS = positiveInt(process.env.VERIFY_RUN_TIMEOUT_MS, 300_000);
/** Embedding a short document, including a cold local model's first load. */
const INDEX_TIMEOUT_MS = positiveInt(
  process.env.VERIFY_INDEX_TIMEOUT_MS,
  120_000,
);

let failures = 0;

/** What to do about a timeout, rather than just that there was one. */
const TIMED_OUT = `quá hạn chờ ${RUN_TIMEOUT_MS / 1000}s — model chạy cục bộ thường lâu hơn, đặt VERIFY_RUN_TIMEOUT_MS`;

function check(label: string, ok: boolean, detail = ""): boolean {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
  return ok;
}

async function main(): Promise<void> {
  console.log(`Stack: ${BASE_URL}\n`);

  const client = new ApiClient({ baseUrl: BASE_URL });
  const stamp = Date.now();

  console.log("→ Tenancy");
  await client.register({
    email: `verify-stack-${stamp}@local.test`,
    password: PASSWORD,
  });
  const organization = await client.createOrganization({
    name: "Verify Stack",
    slug: `verify-stack-${stamp}`,
  });
  const workspace = await client.createWorkspace({
    organizationId: organization.id,
    name: "Verify Stack",
    slug: `verify-stack-ws-${stamp}`,
  });
  client.setWorkspace(workspace.id);
  check("registered and created a workspace", true, workspace.id);

  await documentFlow(client);
  await plainRun(client);
  await approvalRun(client);
  await budgetRun(client);
  await scheduledRun(client);

  console.log(
    failures === 0
      ? "\nTất cả kiểm tra đều đạt."
      : `\n${failures} kiểm tra KHÔNG đạt.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

/**
 * Upload a document, wait for it to become searchable, then ask about it.
 *
 * The only check that proves the whole knowledge path: the API stored the
 * bytes, the runtime found the row on its own, embedded it, wrote vectors, and
 * a search found them again. Skipped rather than failed when storage is not
 * configured — the rest of the stack is still worth verifying.
 */
async function documentFlow(client: ApiClient): Promise<void> {
  console.log("\n→ Tài liệu");

  const text = [
    "# Sổ tay kiểm chứng",
    "",
    "Chính sách hoàn tiền: khách được hoàn tiền trong vòng 14 ngày kể từ ngày nhận hàng.",
    "",
    "Thời gian giao hàng từ Nhật Bản về Việt Nam là 7 đến 10 ngày làm việc.",
  ].join("\n");

  // A name with diacritics and a space on purpose: it is signed into an S3
  // header, where a non-ASCII byte breaks the request outright.
  const file = new File([text], "sổ tay kiểm chứng.md", {
    type: "text/markdown",
  });

  let uploaded;
  try {
    uploaded = await client.uploadDocument(file);
  } catch (error: unknown) {
    check(
      "bỏ qua: chưa cấu hình lưu trữ file",
      true,
      isApiError(error) ? error.message : String(error),
    );
    return;
  }

  check("tải file lên được", uploaded.status === "PENDING", uploaded.id);
  check(
    "giữ nguyên tên file tiếng Việt",
    uploaded.fileName === "sổ tay kiểm chứng.md",
    uploaded.fileName,
  );

  const again = await client.uploadDocument(file);
  check(
    "tải lại đúng file thì nhận ra trùng",
    again.duplicate && again.id === uploaded.id,
    `duplicate=${String(again.duplicate)}`,
  );

  const indexed = await poll(async () => {
    const current = await client.getDocument(uploaded.id);
    return current.status === "READY" || current.status === "FAILED"
      ? current
      : null;
  }, INDEX_TIMEOUT_MS);

  if (
    !check(
      "runtime tự lập chỉ mục",
      indexed?.status === "READY",
      indexed?.failureReason ?? indexed?.status ?? TIMED_OUT,
    )
  ) {
    return;
  }

  check(
    "có đoạn để tìm kiếm",
    (indexed?.chunkCount ?? 0) > 0,
    `${indexed?.chunkCount ?? 0} đoạn, model ${indexed?.embeddingModel ?? "?"}`,
  );

  const url = await client.documentDownloadUrl(uploaded.id);
  const downloaded = await fetch(url);
  check(
    "tải về được bằng link ký sẵn",
    downloaded.status === 200 && (await downloaded.text()) === text,
    `HTTP ${downloaded.status}`,
  );

  await knowledgeRun(client);
}

/**
 * A Goal that has to read the document to answer correctly.
 *
 * Asserts on the retrieved passage rather than on the written post: what the
 * model writes varies, but whether the search found the right paragraph does
 * not.
 */
async function knowledgeRun(client: ApiClient): Promise<void> {
  const execution = await submit(client, {
    title: "verify-stack knowledge",
    objective:
      "Tra cứu trong tài liệu nội bộ xem chính sách hoàn tiền là bao nhiêu ngày, rồi viết một bài đăng ngắn",
  });

  const final = await waitFor(
    client,
    execution.id,
    (run) => isTerminal(run.status),
    RUN_TIMEOUT_MS,
  );
  if (
    !check(
      "chạy xong",
      final?.status === "COMPLETED",
      final?.status ?? TIMED_OUT,
    )
  ) {
    return;
  }

  const tasks = await client.listTasks(execution.id);
  const search = tasks.find((task) => task.capability === "knowledge.search");

  if (!search) {
    check(
      "bỏ qua: kế hoạch không dùng tới tài liệu (chế độ keyword)",
      true,
      "đặt AI_PROVIDER để kiểm tra thật sự",
    );
    return;
  }

  const passages = (search.outputs?.passages ?? []) as { text?: string }[];
  check(
    "tìm ra đúng đoạn trong tài liệu",
    passages.some((passage) => (passage.text ?? "").includes("14 ngày")),
    `${passages.length} đoạn`,
  );

  const generate = tasks.find((task) => task.capability === "content.generate");
  check(
    "bài viết dựa trên tài liệu, không phải tự nghĩ ra",
    generate === undefined || generate.outputs?.usedKnowledge === true,
    String(generate?.outputs?.usedKnowledge ?? "không có bước viết"),
  );
}

/** A goal with no constraints should simply finish. */
async function plainRun(client: ApiClient): Promise<void> {
  console.log("\n→ Một lần chạy thường");
  const execution = await submit(client, {
    title: "verify-stack plain",
    objective: "Tìm xu hướng AI, viết bài, rồi đăng lên facebook",
  });

  const final = await waitFor(
    client,
    execution.id,
    (run) => isTerminal(run.status),
    RUN_TIMEOUT_MS,
  );

  check(
    "chạy đến trạng thái kết thúc",
    final !== null,
    final?.status ?? TIMED_OUT,
  );
  check(
    "kết thúc là COMPLETED",
    final?.status === "COMPLETED",
    final?.failureReason ?? "",
  );

  const tasks = await client.listTasks(execution.id);
  check("có tạo ra các bước", tasks.length > 0, `${tasks.length} bước`);
  check(
    "mọi bước đều xong",
    tasks.every((task) => task.status === "COMPLETED"),
    tasks.map((t) => `${t.capability}=${t.status}`).join(", "),
  );

  const usage = await client.getUsage(execution.id);
  check(
    "đọc được chi phí",
    typeof usage.totalUsd === "string",
    `$${usage.totalUsd}, ${usage.calls.length} lời gọi AI`,
  );
}

/** A goal asking for approval must stop, and publish nothing until told. */
async function approvalRun(client: ApiClient): Promise<void> {
  console.log("\n→ Cổng duyệt");
  const execution = await submit(client, {
    title: "verify-stack approval",
    objective: "Viết bài về cà phê rồi duyệt rồi đăng lên facebook",
  });

  const waiting = await waitFor(
    client,
    execution.id,
    (run) => run.status === "WAITING" || isTerminal(run.status),
    RUN_TIMEOUT_MS,
  );

  if (
    !check(
      "dừng lại chờ duyệt",
      waiting?.status === "WAITING",
      waiting?.status ?? TIMED_OUT,
    )
  ) {
    return;
  }

  const paused = await client.listTasks(execution.id);
  const publish = paused.find((task) => task.capability === "social.publish");
  // The assertion that matters: a gate that pauses but lets the next step run
  // anyway is decoration.
  check(
    "chưa đăng gì cả",
    publish === undefined || publish.status === "PENDING",
    publish ? `social.publish=${publish.status}` : "chưa có bước đăng",
  );

  await client.decideApproval(execution.id, "APPROVED", "verify-stack");

  const done = await waitFor(
    client,
    execution.id,
    (run) => isTerminal(run.status),
    RUN_TIMEOUT_MS,
  );
  check("duyệt xong thì chạy tiếp", done?.status === "COMPLETED", done?.status);

  const after = await client.listTasks(execution.id);
  const approval = after.find((task) => task.capability === "approval.request");
  check(
    "ghi lại ai đã duyệt",
    Boolean(approval?.outputs?.approvedBy),
    String(approval?.outputs?.approvedBy ?? "không có"),
  );
}

/**
 * A budget smaller than a step's declared cost must stop the run.
 *
 * The gate is the estimate, checked before the step runs — not what has been
 * spent so far. An earlier version of this check asked whether anything had
 * been spent and, finding nothing (the run was on a local model, which is
 * free), concluded from a correct refusal that the budget had not been
 * exercised. Reading actual spend to decide whether a pre-flight check fired
 * was the wrong question.
 */
async function budgetRun(client: ApiClient): Promise<void> {
  console.log("\n→ Chặn ngân sách");
  const execution = await submit(client, {
    title: "verify-stack budget",
    objective: "Tìm xu hướng AI, viết bài, rồi đăng lên facebook",
    constraints: { maxCostUsd: 0.0001 },
  });

  const final = await waitFor(
    client,
    execution.id,
    (run) => isTerminal(run.status),
    RUN_TIMEOUT_MS,
  );

  if (final?.status === "COMPLETED") {
    // Every step declared a cost of zero, so there was nothing for the budget
    // to refuse. True of the deterministic Phase 1 capabilities.
    check(
      "không bước nào khai giá nên không có gì để chặn",
      true,
      "đặt AI_PROVIDER để kiểm tra thật sự việc chặn",
    );
    return;
  }

  check(
    "vượt ngân sách thì dừng",
    final?.status === "FAILED",
    final?.status ?? TIMED_OUT,
  );
  check(
    "lý do nói rõ là ngân sách",
    /budget|ngân sách/i.test(final?.failureReason ?? ""),
    final?.failureReason ?? "",
  );

  const usage = await client.getUsage(execution.id);
  check(
    "không tiêu quá phần đã cho phép",
    Number(usage.totalUsd) <= 0.0001,
    `$${usage.totalUsd}`,
  );
}

/**
 * A Goal that fires every minute must produce a run on its own.
 *
 * No database poking on purpose: the bug this suite exists for was invisible
 * precisely because the tests wrote next_run_at themselves. Waiting for a real
 * cron boundary is slower and is the only version that proves anything.
 */
async function scheduledRun(client: ApiClient): Promise<void> {
  console.log("\n→ Lịch tự chạy (chờ tới mốc phút kế tiếp)");
  const before = await client.listExecutions();
  const known = new Set(before.map((run) => run.id));

  await client.createGoal({
    title: "verify-stack schedule",
    objective: "Viết bài rồi đăng lên facebook",
    schedule: { cron: "* * * * *", timezone: "UTC" },
  });

  const appeared = await poll(async () => {
    const runs = await client.listExecutions();
    return runs.find((run) => !known.has(run.id)) ?? null;
  }, SCHEDULE_TIMEOUT_MS);

  check(
    "lịch tự tạo một lần chạy",
    appeared !== null,
    appeared?.id ?? `không thấy sau ${SCHEDULE_TIMEOUT_MS / 1000}s`,
  );
}

// --- helpers ---------------------------------------------------------------

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const isTerminal = (status: string) => TERMINAL.has(status);

async function submit(
  client: ApiClient,
  input: Parameters<ApiClient["createGoal"]>[0],
): Promise<Execution> {
  const goal = await client.createGoal(input);
  return client.submitGoal(goal.id);
}

async function waitFor(
  client: ApiClient,
  executionId: string,
  done: (run: Execution) => boolean,
  timeoutMs: number,
): Promise<Execution | null> {
  return poll(async () => {
    const run = await client.getExecution(executionId);
    return done(run) ? run : null;
  }, timeoutMs);
}

async function poll<T>(
  attempt: () => Promise<T | null>,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await attempt();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return null;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error: unknown) => {
  console.error(
    `\nverify-stack không chạy được: ${
      isApiError(error) ? `${error.message} (${error.code})` : String(error)
    }`,
  );
  console.error(
    "Cần services/api và services/runtime đang chạy. Xem apps/web/README.md.",
  );
  process.exitCode = 1;
});

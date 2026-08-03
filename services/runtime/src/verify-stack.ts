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
import { deleteFacebookPost } from "@repo/connectors";
import { ApiClient, isApiError, type Execution, type Task } from "@repo/sdk";

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

  await secretFlow(client);
  await documentFlow(client);
  await plainRun(client);
  await approvalRun(client);
  await budgetRun(client);
  await chatFlow(client);
  await scheduledRun(client);
  // Last, and never earlier. It connects a live Page, and every Goal submitted
  // while that connection exists will publish for real — which is exactly how
  // an earlier version of this file left five posts on somebody's Page.
  await calendarFlow(client);
  await trendFlow(client);
  await socialFlow(client);

  console.log(
    failures === 0
      ? "\nTất cả kiểm tra đều đạt."
      : `\n${failures} kiểm tra KHÔNG đạt.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

/**
 * Store a credential, confirm the workspace moves onto it, then revoke it.
 *
 * Through the public API only, like everything else here. What it proves that a
 * unit test cannot: the value is sealed with a key the running process actually
 * holds, and no response anywhere in the flow carries the plaintext back.
 */
async function secretFlow(client: ApiClient): Promise<void> {
  console.log("\n→ Kho bí mật");

  // Obviously not a live key. The point is what the platform does with it, and
  // sending a real one to a script that prints its output would be a poor idea.
  const value = `sk-ant-verify-stack-${Date.now()}`;

  let stored;
  try {
    stored = await client.putSecret({ name: "providers/anthropic", value });
  } catch (error: unknown) {
    check(
      "bỏ qua: chưa cấu hình SECRET_KEYS",
      true,
      isApiError(error) ? error.message : String(error),
    );
    return;
  }

  check("lưu được credential", stored.activeVersion === 1, stored.hint);
  check(
    "không trả lại giá trị ở bất kỳ đâu",
    !JSON.stringify(await client.listSecrets()).includes(value),
  );

  const connected = await client.providerKeys();
  check(
    "workspace chuyển sang key của chính nó",
    connected.source === "workspace" &&
      connected.providers.includes("anthropic"),
    connected.providers.join(", "),
  );

  const rotated = await client.putSecret({
    name: "providers/anthropic",
    value: `${value}-v2`,
  });
  check("xoay khoá tạo bản mới", rotated.activeVersion === 2);
  check(
    "quay lại được bản trước",
    (await client.rollbackSecret(rotated.id, 1)).activeVersion === 1,
  );

  await client.deleteSecret(stored.id);
  check(
    "thu hồi là ngừng dùng ngay",
    (await client.providerKeys()).source === "platform",
  );
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
 * Chat, over the wire it actually uses.
 *
 * A gap since Phase 2: chat has integration tests, but nothing here — and this
 * file exists because integration tests share a process with the thing they
 * test. Streaming in particular is where that matters, since a broken SSE
 * frame, a proxy that buffers, or a header the browser refuses are all invisible
 * to a test that calls the service directly.
 *
 * Asserts that tokens arrive and that the turn is stored, not what the model
 * said. What a model writes varies; whether the stream carried it does not.
 */
async function chatFlow(client: ApiClient): Promise<void> {
  console.log("\n→ Chat");

  let conversation;
  try {
    conversation = await client.createConversation("verify-stack chat");
  } catch (error: unknown) {
    check(
      "bỏ qua: chưa cấu hình AI provider",
      true,
      isApiError(error) ? error.message : String(error),
    );
    return;
  }

  const deltas: string[] = [];
  let done = false;
  let failure: string | null = null;

  try {
    for await (const event of client.streamMessage(
      conversation.id,
      "Trả lời đúng một câu ngắn: 1 + 1 bằng mấy?",
    )) {
      if (event.type === "delta") deltas.push(event.text);
      if (event.type === "done") done = true;
      if (event.type === "error") failure = event.message;
    }
  } catch (error: unknown) {
    failure = isApiError(error) ? error.message : String(error);
  }

  if (failure !== null) {
    check("bỏ qua: chat chưa chạy được", true, failure);
    return;
  }

  check(
    "nhận được token trong lúc trả lời",
    deltas.length > 0,
    `${deltas.length} mảnh`,
  );
  // The `done` frame is what tells a client the answer is complete rather than
  // cut off. A stream that ends without it looks identical to a dropped
  // connection.
  check("stream kết thúc bằng khung done", done);

  const stored = await client.listChatMessages(conversation.id);
  const answer = stored.find((message) => message.role === "assistant");

  check(
    "câu trả lời được lưu lại",
    answer !== undefined && answer.content.trim() !== "",
    `${stored.length} tin nhắn`,
  );
  // The stream and the row must agree. If they can differ, one of them is
  // lying to somebody — and the row is what the next turn is built from.
  check(
    "nội dung đã lưu khớp với thứ đã truyền đi",
    (answer?.content ?? "") === deltas.join(""),
  );

  await client.deleteConversation(conversation.id);
}

/**
 * Whether the only thing that went wrong is that publishing is live and this
 * workspace has no channel connected.
 *
 * Not a weakening of the checks — it is the product behaving correctly. With
 * `SOCIAL_PUBLISH_LIVE` on, a publish step cannot succeed without a connected
 * channel, and the general Goals here deliberately have none: connecting one
 * for them would put their output on a real Page, which is exactly the mess
 * that made this function necessary.
 */
function blockedOnNoChannel(tasks: readonly Task[]): boolean {
  const publish = tasks.find((task) => task.capability === "social.publish");
  if (!publish || publish.status !== "FAILED") return false;

  return String(publish.lastError ?? "").includes("chưa kết nối kênh nào");
}

/** The steps that are not the publish step. */
function withoutPublish(tasks: readonly Task[]): readonly Task[] {
  return tasks.filter((task) => task.capability !== "social.publish");
}

/**
 * The whole chain, ending at a real Facebook Page.
 *
 * Every other check here stops at the edge of this process. This one does not:
 * it connects a Page, asks in Vietnamese for a post, lets the planner decide
 * the steps, and then goes and looks at what Facebook actually stored. Then it
 * deletes the post, because a verification that leaves litter on somebody's
 * Page is one nobody runs twice.
 *
 * Skipped without FB_TEST_PAGE_ID and FB_TEST_PAGE_TOKEN rather than failed —
 * publishing needs a credential nobody should have to supply just to check the
 * rest of the stack works.
 */
/**
 * Plan something, put it on the calendar, then take it off.
 *
 * What a repository test cannot reach: the window filter reads dates off a
 * query string, a PATCH sent from a client leaves untouched fields alone, and
 * archiving a campaign does not take its content with it.
 */
async function calendarFlow(client: ApiClient): Promise<void> {
  console.log("\n→ Chiến dịch và lịch");

  const campaign = await client.createCampaign({
    name: `verify-stack ${Date.now()}`,
  });
  check("tạo được chiến dịch", campaign.status === "DRAFT", campaign.name);

  const when = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const piece = await client.createContentPiece({
    campaignId: campaign.id,
    title: "Bài kiểm tra",
    body: "Nội dung kiểm tra.",
    channel: "facebook",
    scheduledAt: when,
  });
  check(
    "hẹn được lịch đăng",
    piece.scheduledAt === when,
    piece.scheduledAt ?? "không có lịch",
  );

  const window = await client.listContentPieces({
    from: new Date(Date.now() - 60_000).toISOString(),
    to: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  });
  check(
    "đọc được cửa sổ thời gian",
    window.some((item) => item.id === piece.id),
    `${window.length} bài`,
  );

  const renamed = await client.updateContentPiece(piece.id, {
    title: "Bài đã đổi tên",
  });
  // PUBLISHED is a record of something that happened, not an instruction. The
  // SDK's type still offers it because the field carries every status a piece
  // can be read in; the server is what refuses to be told one.
  check(
    "không cho client tự nhận là đã đăng",
    await client
      .updateContentPiece(piece.id, { status: "PUBLISHED" })
      .then(() => false)
      .catch(() => true),
  );
  check(
    "đổi tên không mất lịch",
    renamed.title === "Bài đã đổi tên" && renamed.scheduledAt === when,
    renamed.scheduledAt ?? "mất rồi",
  );

  // A piece may name which connection it goes to; naming one that is not this
  // workspace's is a 404 rather than a row pointing across a tenant boundary.
  check(
    "không trỏ được sang kênh của workspace khác",
    await client
      .updateContentPiece(piece.id, { socialAccountId: "sac_notmine" })
      .then(() => false)
      .catch(() => true),
  );

  await client.archiveCampaign(campaign.id);
  const survivors = await client.listContentPieces();
  check(
    "lưu trữ chiến dịch không xoá bài",
    survivors.some((item) => item.id === piece.id),
  );

  await client.archiveContentPiece(piece.id);
  check(
    "dọn sạch sau khi kiểm tra",
    !(await client.listContentPieces()).some((item) => item.id === piece.id),
  );
}

/**
 * Read what the country is searching for.
 *
 * The one check no fixture can make: Google's RSS feed still has the shape the
 * parser expects. YouTube is only checked when a key exists — without one the
 * useful assertion is that the platform says which key is missing.
 */
async function trendFlow(client: ApiClient): Promise<void> {
  console.log("\n→ Xu hướng");

  const google = await client.listTrends({ source: "google", limit: 5 });
  check(
    "đọc được xu hướng Google",
    google.length > 0 && google.every((item) => item.title.length > 0),
    google[0]?.title,
  );

  try {
    const youtube = await client.listTrends({ source: "youtube", limit: 5 });
    check("đọc được xu hướng YouTube", youtube.length > 0, youtube[0]?.title);
  } catch (error: unknown) {
    const message = isApiError(error) ? error.message : String(error);
    check(
      "bỏ qua YouTube: chưa có khoá, và nói rõ thiếu khoá nào",
      message.includes("sources/youtube"),
      message,
    );
  }
}

async function socialFlow(client: ApiClient): Promise<void> {
  console.log("\n→ Đăng bài thật");

  const pageId = process.env.FB_TEST_PAGE_ID?.trim();
  const pageToken = process.env.FB_TEST_PAGE_TOKEN?.trim();
  if (!pageId || !pageToken) {
    check(
      "bỏ qua: chưa có FB_TEST_PAGE_ID / FB_TEST_PAGE_TOKEN",
      true,
      "đặt hai biến này để kiểm chứng với Facebook thật",
    );
    return;
  }

  let connection;
  try {
    connection = await client.attachConnection("facebook", {
      externalId: pageId,
      accessToken: pageToken,
    });
  } catch (error: unknown) {
    check(
      "nối được Page",
      false,
      isApiError(error) ? error.message : String(error),
    );
    return;
  }

  check("nối được Page", true, connection.displayName);

  // Everything posted from here on belongs to this run and gets taken down.
  const startedAt = new Date(Date.now() - 60_000).toISOString();

  try {
    await readChannel(client);
    await publishOnce(client, pageId, pageToken);
  } finally {
    // In `finally`, because a failure halfway through is exactly when a live
    // connection must not be left behind for the next run to inherit.
    await client.disconnect(connection.id);
    await removeStrayPosts(pageId, pageToken, startedAt);
  }
}

/**
 * Read the channel back through the API: messages waiting, and how posts did.
 *
 * Separate from publishing and run first, because these two work whether or not
 * live publishing is switched on — and because they are the routes a browser
 * calls, which is exactly what this file is for. Their integration tests share
 * a process with the service; nothing before this had them crossing a socket.
 */
async function readChannel(client: ApiClient): Promise<void> {
  const inbox = await client.inbox();

  // Not a count: this Page's inbox will differ from anyone else's. What has to
  // hold is that the read succeeded, named its channel, and reported any it
  // could not open rather than quietly returning fewer threads.
  check(
    "đọc được hộp thư",
    inbox.failed.length === 0,
    inbox.failed.length === 0
      ? `${inbox.threads.length} luồng, ${inbox.threads.filter((t) => t.unread).length} chưa đọc`
      : inbox.failed.map((f) => `${f.account}: ${f.reason}`).join("; "),
  );

  check(
    "mỗi luồng nói rõ thuộc kênh nào",
    inbox.threads.every((thread) => thread.account !== ""),
    `${inbox.threads.length} luồng`,
  );

  const stats = await client.postStats();

  check(
    "đọc được số liệu bài đăng",
    stats.failed.length === 0,
    stats.failed.length === 0
      ? `${stats.posts.length} bài`
      : stats.failed.map((f) => `${f.account}: ${f.reason}`).join("; "),
  );

  // A count that arrives as undefined would render as a blank where a number
  // belongs, and nothing upstream would have complained.
  check(
    "mọi con số đều là số, không phải chỗ trống",
    stats.posts.every(
      (post) =>
        Number.isInteger(post.likes) &&
        Number.isInteger(post.comments) &&
        Number.isInteger(post.shares),
    ),
    `${stats.posts.length} bài`,
  );
}

/** Ask for a post, wait for it, and check Facebook actually has it. */
async function publishOnce(
  client: ApiClient,
  pageId: string,
  pageToken: string,
): Promise<void> {
  const execution = await submit(client, {
    title: "verify-stack social",
    objective:
      'Viết đúng một câu ngắn có cụm từ "test đăng bài" rồi đăng lên Facebook.',
  });

  const final = await waitFor(
    client,
    execution.id,
    (run) => isTerminal(run.status),
    RUN_TIMEOUT_MS,
  );

  const tasks = await client.listTasks(execution.id);
  const publish = tasks.find((task) => task.capability === "social.publish");

  if (!publish) {
    check(
      "bỏ qua: kế hoạch không có bước đăng",
      true,
      final?.status ?? TIMED_OUT,
    );
    return;
  }

  if (publish.outputs?.simulated === true) {
    // Not a failure: the operator has not turned live publishing on. Said out
    // loud so nobody reads a green line as proof a post went out.
    check(
      "bỏ qua: SOCIAL_PUBLISH_LIVE chưa bật, mới chỉ chạy thử",
      true,
      String(publish.outputs?.reason ?? ""),
    );
    return;
  }

  if (
    !check(
      "chạy xong",
      final?.status === "COMPLETED",
      final?.status ?? TIMED_OUT,
    )
  ) {
    return;
  }

  const posts = (publish.outputs?.posts ?? []) as {
    postId?: string;
    url?: string;
  }[];
  const postId = posts[0]?.postId;

  if (!check("Facebook nhận bài và trả về id", Boolean(postId), postId ?? "")) {
    return;
  }

  // Asked of Facebook, not of our own output. The point of this check is that
  // the post exists somewhere other than in a row we wrote ourselves.
  const stored = await readPost(postId!, pageToken);
  check(
    "bài có thật trên Facebook",
    stored !== null,
    stored?.message?.slice(0, 60) ?? "không đọc lại được",
  );

  await deleteFacebookPost(postId!, pageToken);
  check(
    "dọn bài test sau khi kiểm tra xong",
    (await readPost(postId!, pageToken)) === null,
  );
}

/**
 * Take down anything this run posted, not just the post it meant to make.
 *
 * The earlier version deleted only the post `socialFlow` asked for, and left
 * behind everything the other Goals published once a live Page was connected.
 * Sweeping by time is the only way to catch posts nobody wrote down the id of.
 */
async function removeStrayPosts(
  pageId: string,
  token: string,
  since: string,
): Promise<void> {
  const base = graphBase();
  const response = await fetch(
    `${base}/${pageId}/feed?fields=id,created_time&limit=50`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    check("dọn bài lạ do lần chạy này tạo ra", false, "không đọc được feed");
    return;
  }

  const payload = (await response.json()) as {
    data?: { id: string; created_time: string }[];
  };
  const strays = (payload.data ?? []).filter(
    (post) => post.created_time >= since,
  );

  for (const post of strays) await deleteFacebookPost(post.id, token);

  check(
    "không để lại bài nào trên Page",
    true,
    strays.length === 0
      ? "không có bài lạ"
      : `đã xoá thêm ${strays.length} bài`,
  );
}

function graphBase(): string {
  return (
    process.env.FACEBOOK_GRAPH_URL?.trim() || "https://graph.facebook.com/v21.0"
  ).replace(/\/+$/, "");
}

/** Read a post back from Facebook, or null when it is not there. */
async function readPost(
  postId: string,
  token: string,
): Promise<{ message?: string } | null> {
  const response = await fetch(`${graphBase()}/${postId}?fields=message`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return response.ok ? ((await response.json()) as { message?: string }) : null;
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

  const tasks = await client.listTasks(execution.id);
  // The publish step failing for want of a channel says nothing about whether
  // the document was found, which is all this run is here to check.
  if (
    !check(
      "chạy xong",
      final?.status === "COMPLETED" || blockedOnNoChannel(tasks),
      blockedOnNoChannel(tasks)
        ? "dừng ở bước đăng vì chưa nối kênh — đúng thiết kế"
        : (final?.status ?? TIMED_OUT),
    )
  ) {
    return;
  }

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

  const tasks = await client.listTasks(execution.id);
  const noChannel = blockedOnNoChannel(tasks);

  if (noChannel) {
    check(
      "bỏ qua bước đăng: đang bật đăng thật mà workspace chưa nối kênh",
      true,
      "đúng như thiết kế — bước đăng không thể thành công khi chưa có kênh",
    );
  } else {
    check(
      "kết thúc là COMPLETED",
      final?.status === "COMPLETED",
      final?.failureReason ?? "",
    );
  }

  check("có tạo ra các bước", tasks.length > 0, `${tasks.length} bước`);
  const graded = noChannel ? withoutPublish(tasks) : tasks;
  check(
    "mọi bước khác đều xong",
    graded.every((task) => task.status === "COMPLETED"),
    graded.map((t) => `${t.capability}=${t.status}`).join(", "),
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
  const after = await client.listTasks(execution.id);

  // The gate is what this run exists to prove, and it did its job the moment
  // the run reached WAITING with nothing published. Whether the publish step
  // then succeeds depends on whether a channel is connected, which is a
  // different question and has its own check.
  check(
    "duyệt xong thì chạy tiếp",
    done?.status === "COMPLETED" || blockedOnNoChannel(after),
    blockedOnNoChannel(after)
      ? "chạy tiếp rồi dừng ở bước đăng vì chưa nối kênh — đúng thiết kế"
      : (done?.status ?? TIMED_OUT),
  );
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

  const goal = await client.createGoal({
    title: "verify-stack schedule",
    objective: "Viết bài rồi đăng lên facebook",
    schedule: { cron: "* * * * *", timezone: "UTC" },
  });

  try {
    const appeared = await poll(async () => {
      const runs = await client.listExecutions();
      return runs.find((run) => !known.has(run.id)) ?? null;
    }, SCHEDULE_TIMEOUT_MS);

    check(
      "lịch tự tạo một lần chạy",
      appeared !== null,
      appeared?.id ?? `không thấy sau ${SCHEDULE_TIMEOUT_MS / 1000}s`,
    );
  } finally {
    // In `finally` because it has to happen even when the check above fails or
    // throws. This Goal fires every minute for ever, and every run of this
    // script used to leave one behind — on a machine with a local model, a few
    // runs of it are enough to starve everything else.
    const archived = await client.archiveGoal(goal.id);
    check(
      "dọn lịch sau khi kiểm tra xong",
      archived.nextRunAt === null,
      archived.status,
    );
  }
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

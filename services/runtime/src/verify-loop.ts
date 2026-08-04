import { deleteFacebookPost } from "@repo/connectors";
import { ApiClient, isApiError } from "@repo/sdk";

/**
 * The whole loop, on a real Page: trend → studio → calendar → approval →
 * published → report.
 *
 * Separate from verify-stack rather than another flow inside it. verify-stack
 * proves each piece works; this proves they still work joined together, which
 * is a different question and the one that only fails once several slices have
 * drifted apart. It also costs a real post on somebody's audience, so it has to
 * be a thing you choose to run.
 *
 * The single most valuable check here is the one where nothing happens: a piece
 * whose time has passed but which nobody approved must survive a full sweep
 * untouched. If that is ever wrong it is wrong on a customer's Page, and no
 * fake Graph server can tell you.
 *
 * Everything it creates, it removes. A verification that leaves litter on
 * somebody's Page is one nobody runs twice.
 */
const BASE_URL = process.env.API_URL ?? "http://localhost:3100/api/v1";
const PASSWORD = "verify-loop-password-123";

/**
 * What a test post says, and all it says.
 *
 * Fixed rather than generated. This reaches a real audience for the seconds
 * before it is deleted, and marketing copy written by a model is the wrong
 * thing for a stranger to see there.
 */
const TEST_POST = "test đăng bài";

/** Long enough for the publisher's sweep, which runs every 15 seconds. */
const PUBLISH_TIMEOUT_MS = positiveInt(
  process.env.VERIFY_PUBLISH_TIMEOUT_MS,
  90_000,
);
/**
 * One full sweep with nothing approved, plus room to spare.
 *
 * Too short and the check passes because the sweep had not run yet — which
 * would report the safety property as working without ever testing it.
 */
const QUIET_SWEEP_MS = positiveInt(process.env.VERIFY_QUIET_SWEEP_MS, 20_000);

let failures = 0;

function check(label: string, ok: boolean, detail = ""): boolean {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
  return ok;
}

async function main(): Promise<void> {
  const pageId = process.env.FB_TEST_PAGE_ID?.trim();
  const pageToken = process.env.FB_TEST_PAGE_TOKEN?.trim();

  if (!pageId || !pageToken) {
    // Refused rather than skipped, unlike verify-stack. There is nothing left
    // of this script without a Page, so a green run with no Page would be a
    // green run that verified nothing.
    console.error(
      "verify:loop cần FB_TEST_PAGE_ID và FB_TEST_PAGE_TOKEN — toàn bộ kịch bản này là về một Page thật.",
    );
    process.exit(1);
  }

  console.log(`Stack: ${BASE_URL}`);
  console.log(`Page:  ${pageId}\n`);

  const client = new ApiClient({ baseUrl: BASE_URL });
  const stamp = Date.now();

  console.log("→ Workspace");
  await client.register({
    email: `verify-loop-${stamp}@local.test`,
    password: PASSWORD,
  });
  const organization = await client.createOrganization({
    name: "Verify Loop",
    slug: `verify-loop-${stamp}`,
  });
  const workspace = await client.createWorkspace({
    organizationId: organization.id,
    name: "Verify Loop",
    slug: `verify-loop-ws-${stamp}`,
  });
  client.setWorkspace(workspace.id);
  check("tạo được workspace", true, workspace.id);

  console.log("\n→ Nối Page");
  const account = await client
    .attachConnection("facebook", {
      externalId: pageId,
      accessToken: pageToken,
    })
    .catch((error: unknown) => {
      check(
        "nối được Page",
        false,
        isApiError(error) ? error.message : String(error),
      );
      return null;
    });
  if (!account) return;
  check("nối được Page", account.status === "ACTIVE", account.displayName);

  console.log("\n→ Xu hướng");
  const trends = await client.listTrends({ source: "google", limit: 3 });
  check(
    "đọc được xu hướng Google",
    trends.length > 0 && trends.every((item) => item.title.length > 0),
    trends[0]?.title,
  );

  await client
    .listTrends({ source: "youtube", limit: 3 })
    .then((videos) =>
      check("đọc được xu hướng YouTube", videos.length > 0, videos[0]?.title),
    )
    .catch((error: unknown) => {
      const message = isApiError(error) ? error.message : String(error);
      check(
        "bỏ qua YouTube: chưa có khoá, và nói rõ thiếu khoá nào",
        message.includes("sources/youtube"),
        message,
      );
    });

  console.log("\n→ Studio viết từ xu hướng");
  // The draft is written and checked, then not published. What goes out is the
  // fixed test line — see TEST_POST.
  const draft = await client.writeContent({
    brief: `Người Việt đang tìm nhiều về "${trends[0]?.title ?? "mua hộ hàng Nhật"}".`,
    channel: "facebook",
    tone: "than-thien",
    length: "ngan",
  });
  check(
    "viết được bản nháp",
    draft.object.body.trim().length > 0,
    `${draft.model} · $${draft.costUsd}`,
  );

  console.log("\n→ Chiến dịch và lịch");
  const campaign = await client.createCampaign({
    name: `verify-loop ${stamp}`,
  });
  const piece = await client.createContentPiece({
    campaignId: campaign.id,
    // Named explicitly even with one Page connected, because that is what a
    // workspace running several does and it is the path worth exercising.
    socialAccountId: account.id,
    title: TEST_POST,
    body: TEST_POST,
    channel: "facebook",
    scheduledAt: new Date(Date.now() - 60_000).toISOString(),
  });
  check("hẹn lịch cho một bài đã quá giờ", piece.status === "DRAFT", piece.id);

  console.log("\n→ Chưa duyệt thì không được đăng");
  console.log(`  (đợi ${QUIET_SWEEP_MS / 1000}s cho một vòng quét trọn vẹn)`);
  await sleep(QUIET_SWEEP_MS);
  const unreviewed = await find(client, piece.id);
  const untouched = check(
    "một vòng quét trọn vẹn không đụng vào bài chưa duyệt",
    unreviewed?.status === "DRAFT",
    unreviewed?.status ?? "biến mất",
  );

  if (!untouched) {
    // Stop here rather than carry on. Something published without an approval
    // is the one failure in this script that means "go and look at the Page
    // now", and burying it under more output is the wrong way to say so.
    console.error(
      "\nDỪNG: có thứ gì đó đã đụng vào bài chưa ai duyệt. Kiểm tra Page ngay.",
    );
    process.exit(1);
  }

  console.log("\n→ Duyệt, rồi để nó tự đăng");
  await client.updateContentPiece(piece.id, { review: "APPROVED" });

  const published = await waitFor(async () => {
    const current = await find(client, piece.id);
    // The verdict no longer moves, so waiting on it would wait forever: what
    // changes is the publish state.
    return current &&
      current.status !== "DRAFT" &&
      current.status !== "APPROVED" &&
      current.status !== "PUBLISHING"
      ? current
      : null;
  }, PUBLISH_TIMEOUT_MS);

  if (!published) {
    check("tự đăng sau khi duyệt", false, `quá ${PUBLISH_TIMEOUT_MS / 1000}s`);
  } else {
    check(
      "tự đăng sau khi duyệt",
      published.status === "PUBLISHED",
      published.publishedPostId ?? published.lastError ?? published.status,
    );
    check(
      "ghi lại id bài đăng thật của nền tảng",
      Boolean(published.publishedPostId),
      published.publishedPostId
        ? `https://www.facebook.com/${published.publishedPostId}`
        : "không có",
    );
  }

  console.log("\n→ Báo cáo");
  const report = await client.campaignReport();
  const row = report.rows.find((entry) => entry.campaignId === campaign.id);
  check(
    "báo cáo đếm đúng bài đã đăng",
    row?.published === 1,
    row
      ? `nháp=${row.drafts} đăng=${row.published} hỏng=${row.failed}`
      : "không có dòng nào",
  );
  check(
    "không có kênh nào bị bỏ sót số liệu",
    report.unreadable.length === 0,
    JSON.stringify(report.unreadable),
  );

  console.log("\n→ Dọn dẹp");
  if (published?.publishedPostId) {
    await deleteFacebookPost(published.publishedPostId, pageToken).catch(
      (error: unknown) => {
        check(
          "xoá bài test khỏi Page",
          false,
          error instanceof Error ? error.message : String(error),
        );
      },
    );
    check(
      "xoá bài test khỏi Page",
      (await readPost(published.publishedPostId, pageToken)) === null,
    );
  }
  await client.archiveContentPiece(piece.id);
  await client.archiveCampaign(campaign.id);
  await client.disconnect(account.id);
  check("gỡ kết nối Page sau khi xong", true);

  console.log(
    failures === 0
      ? "\nCả vòng lặp chạy được từ xu hướng tới bài đăng."
      : `\n${failures} kiểm tra không đạt.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

async function find(client: ApiClient, id: string) {
  const pieces = await client.listContentPieces();
  return pieces.find((piece) => piece.id === id) ?? null;
}

/** Poll until it answers, or give up. */
async function waitFor<T>(
  read: () => Promise<T | null>,
  timeoutMs: number,
): Promise<T | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = await read();
    if (found) return found;
    await sleep(3_000);
  }
  return null;
}

/** Whether the post is still there. Null means gone. */
async function readPost(
  postId: string,
  pageToken: string,
): Promise<unknown | null> {
  const response = await fetch(
    `https://graph.facebook.com/v25.0/${postId}?fields=id`,
    { headers: { authorization: `Bearer ${pageToken}` } },
  );
  return response.ok ? await response.json() : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error: unknown) => {
  console.error("\nverify:loop hỏng:", error);
  process.exit(1);
});
